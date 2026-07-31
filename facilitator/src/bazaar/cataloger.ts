import type { CatalogConfig, NetworkConfig, RequestEnvelope, StellarNetwork } from "../types.js";
import type { CatalogStore, CatalogOutcome } from "../db/catalog.js";
import { extractCandidate, type RejectionCode } from "./extract.js";

export interface BazaarExtensionResponse {
  status: "success" | "processing" | "rejected";
  rejectedReason?: string;
}

/** Wire response plus the internal identifiers used to link analytics facts. */
export interface CatalogingResult extends BazaarExtensionResponse {
  resourceId?: number;
  versionId?: number;
  paymentOptionId?: number;
}

/** Strips internal identifiers so only official fields reach the header. */
export function toWireResponse(result: CatalogingResult): BazaarExtensionResponse {
  return { status: result.status, ...(result.rejectedReason ? { rejectedReason: result.rejectedReason } : {}) };
}

export interface CatalogingContext {
  stage: "verified" | "settled";
  payer?: string;
  settlementRecordId?: number;
}

/** Stable, non-leaking public explanations for every internal rejection code. */
const PUBLIC_REASON: Record<RejectionCode, string> = {
  bazaar_extension_not_an_object: "bazaar extension must be a JSON object",
  metadata_too_large: "bazaar metadata exceeds the configured size limit",
  metadata_too_deep: "bazaar metadata exceeds the configured nesting limit",
  spec_validation_failed: "info failed bazaar specification validation",
  schema_validation_failed: "info failed schema validation",
  schema_too_large: "declared schema exceeds the configured size limit",
  example_too_large: "declared example exceeds the configured size limit",
  missing_resource_url: "resource.url is required for cataloging",
  invalid_resource_url: "resource.url is not a valid absolute URL",
  unsupported_url_scheme: "resource.url uses an unsupported URL scheme",
  url_credentials_present: "resource.url must not contain credentials",
  control_characters_in_url: "resource.url contains control characters",
  insecure_resource_origin: "resource origin must use https",
  local_resource_origin: "resource origin is not publicly routable",
  missing_mcp_tool_name: "mcp discovery info requires a tool name",
  payto_ownership_conflict: "resource is already cataloged for a different payTo",
  duplicate_change_rejected: "changed declarations are rejected by operator policy",
  catalog_write_failed: "catalog is temporarily unavailable",
};

const WIRE_STATUS: Record<CatalogOutcome, BazaarExtensionResponse["status"]> = {
  indexed: "success",
  refreshed: "success",
  versioned: "success",
  pending: "processing",
  rejected: "rejected",
  quarantined: "rejected",
  skipped: "processing",
};

/** Encodes the official base64 JSON `EXTENSION-RESPONSES` header value. */
export function encodeExtensionResponses(responses: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(responses), "utf8").toString("base64");
}

/**
 * Automatic cataloging. Every path is soft-failing: a catalog problem records a
 * precise internal reason and an official `rejected` extension response, and
 * never changes the payment outcome.
 */
export class Cataloger {
  constructor(
    private readonly config: CatalogConfig,
    private readonly store: CatalogStore,
    private readonly networks: Map<StellarNetwork, NetworkConfig>,
  ) {}

  /**
   * @returns the bazaar extension response, or undefined when the payload
   * carried no bazaar extension and cataloging therefore does not apply.
   */
  async observe(
    request: RequestEnvelope,
    context: CatalogingContext,
  ): Promise<CatalogingResult | undefined> {
    if (!this.config.autoCatalog) return undefined;
    // `index_on: settled` still records the candidate at verify time so that a
    // later settlement can activate it without a second declaration.
    const activate = this.config.indexOn === "verified" || context.stage === "settled";
    const requirements = request.paymentRequirements;
    const asset = this.networks.get(requirements.network as StellarNetwork)
      ?.allowedAssets.get(requirements.asset);

    let extraction;
    try {
      extraction = extractCandidate(
        request.paymentPayload, requirements, this.config,
        asset ? { symbol: asset.symbol, decimals: asset.decimals } : undefined,
      );
    } catch (error) {
      await this.record({
        stage: context.stage, outcome: "rejected", wireStatus: "rejected",
        rejectedReason: PUBLIC_REASON.spec_validation_failed,
        internalReason: `extraction_threw:${error instanceof Error ? error.message : "unknown"}`,
        network: requirements.network, scheme: requirements.scheme, payTo: requirements.payTo,
        ...(context.payer ? { payer: context.payer } : {}),
        ...(context.settlementRecordId ? { settlementRecordId: context.settlementRecordId } : {}),
      });
      return { status: "rejected", rejectedReason: PUBLIC_REASON.spec_validation_failed };
    }

    if (extraction.kind === "absent") return undefined;

    if (extraction.kind === "rejected") {
      await this.record({
        stage: context.stage, outcome: "rejected", wireStatus: "rejected",
        rejectedReason: PUBLIC_REASON[extraction.code],
        internalReason: extraction.detail ? `${extraction.code}: ${extraction.detail}` : extraction.code,
        network: requirements.network, scheme: requirements.scheme, payTo: requirements.payTo,
        ...(context.payer ? { payer: context.payer } : {}),
        ...(context.settlementRecordId ? { settlementRecordId: context.settlementRecordId } : {}),
      });
      return { status: "rejected", rejectedReason: PUBLIC_REASON[extraction.code] };
    }

    const candidate = extraction.candidate;
    try {
      const result = await this.store.observe(candidate, {
        stage: context.stage,
        activate,
        duplicateChanged: this.config.duplicateChanged,
        ...(context.payer ? { payer: context.payer } : {}),
        ...(context.settlementRecordId ? { settlementRecordId: context.settlementRecordId } : {}),
      });
      const status = WIRE_STATUS[result.outcome];
      const reason = result.code ? PUBLIC_REASON[result.code] : undefined;
      await this.record({
        ...(result.resourceId ? { resourceId: result.resourceId } : {}),
        ...(result.versionId ? { versionId: result.versionId } : {}),
        resourceKey: candidate.resourceKey,
        resourceUrl: candidate.resourceUrl,
        stage: context.stage,
        outcome: result.outcome,
        wireStatus: status,
        ...(reason ? { rejectedReason: reason } : {}),
        internalReason: result.code
          ?? (candidate.softDropped.length > 0 ? `soft_dropped:${candidate.softDropped.join(",")}` : result.outcome),
        declarationHash: candidate.declarationHash,
        network: requirements.network,
        scheme: requirements.scheme,
        payTo: requirements.payTo,
        ...(context.payer ? { payer: context.payer } : {}),
        ...(context.settlementRecordId ? { settlementRecordId: context.settlementRecordId } : {}),
      });
      return {
        status,
        ...(reason ? { rejectedReason: reason } : {}),
        ...(result.resourceId ? { resourceId: result.resourceId } : {}),
        ...(result.versionId ? { versionId: result.versionId } : {}),
        ...(result.paymentOptionId ? { paymentOptionId: result.paymentOptionId } : {}),
      };
    } catch (error) {
      await this.record({
        resourceKey: candidate.resourceKey,
        resourceUrl: candidate.resourceUrl,
        stage: context.stage, outcome: "rejected", wireStatus: "rejected",
        rejectedReason: PUBLIC_REASON.catalog_write_failed,
        internalReason: `catalog_write_failed:${error instanceof Error ? error.message : "unknown"}`,
        declarationHash: candidate.declarationHash,
        network: requirements.network, scheme: requirements.scheme, payTo: requirements.payTo,
        ...(context.payer ? { payer: context.payer } : {}),
      }).catch(() => undefined);
      return { status: "rejected", rejectedReason: PUBLIC_REASON.catalog_write_failed };
    }
  }

  private async record(entry: Parameters<CatalogStore["recordObservation"]>[0]): Promise<void> {
    await this.store.recordObservation(entry).catch(() => undefined);
  }
}
