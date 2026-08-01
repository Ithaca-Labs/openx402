import type { PaymentRequired } from "@x402/core/types";
import type { CanonicalResource, ResourceIdentity } from "./types.js";
import { McpToolError } from "./errors.js";
import { canonicalJson } from "./resourceRef.js";
import { bazaarInput, bazaarSchema, type HasBazaarExtension } from "./bazaarExtension.js";

export interface CatalogGuardInput {
  /** The dual-copy-validated PaymentRequired from the live, unpaid tool call. */
  liveChallenge: PaymentRequired;
  /** The catalog version selected at search/get time. */
  catalogResource: CanonicalResource;
  identity: ResourceIdentity;
  selection: { network: string; scheme: string; asset: string };
}

/**
 * Step 5-6 of the discover-pay-retry state machine: the live challenge must
 * match the selected catalog version on every field that changes what the
 * agent is agreeing to pay for. Any mismatch is `RESOURCE_CHANGED` -- no
 * silent acceptance of new terms, and this check runs strictly before any
 * budget reservation or signing.
 */
export function guardAgainstCatalog(input: CatalogGuardInput): void {
  const { liveChallenge, catalogResource, identity, selection } = input;
  const mismatches: string[] = [];

  if (liveChallenge.resource?.url !== catalogResource.resource) {
    mismatches.push("resource.url");
  }

  if (identity.type === "mcp") {
    const liveInput = bazaarInput(liveChallenge as unknown as HasBazaarExtension);
    const catalogInput = bazaarInput(catalogResource);
    if (liveInput?.toolName !== identity.toolName) mismatches.push("toolName");
    if ((liveInput?.transport ?? "streamable-http") !== (catalogInput?.transport ?? "streamable-http")) {
      mismatches.push("transport");
    }
    const liveSchema = canonicalJson(liveInput?.inputSchema ?? bazaarSchema(liveChallenge as unknown as HasBazaarExtension) ?? null);
    const catalogSchema = canonicalJson(catalogInput?.inputSchema ?? bazaarSchema(catalogResource) ?? null);
    if (liveSchema !== catalogSchema) mismatches.push("schema");
  }

  const matches = (accepted: { network: string; scheme: string; asset: string }): boolean =>
    accepted.network === selection.network && accepted.scheme === selection.scheme && accepted.asset === selection.asset;

  const liveOption = liveChallenge.accepts.find(matches);
  const catalogOption = catalogResource.accepts.find(matches);
  if (!liveOption) mismatches.push("accepts.selected.missing_from_live_challenge");
  if (!catalogOption) mismatches.push("accepts.selected.missing_from_catalog");
  if (liveOption && catalogOption) {
    if (liveOption.payTo !== catalogOption.payTo) mismatches.push("payTo");
    if (liveOption.amount !== catalogOption.amount) mismatches.push("amount");
    if (liveOption.maxTimeoutSeconds !== catalogOption.maxTimeoutSeconds) mismatches.push("maxTimeoutSeconds");
    if (canonicalJson(liveOption.extra ?? {}) !== canonicalJson(catalogOption.extra ?? {})) mismatches.push("extra");
  }

  if (mismatches.length > 0) {
    throw new McpToolError("RESOURCE_CHANGED", "live challenge does not match the selected catalog version", { mismatches });
  }
}
