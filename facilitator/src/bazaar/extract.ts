import { createHash } from "node:crypto";
import {
  isValidRouteTemplate,
  sanitizeResourceServiceMetadata,
  validateDiscoveryExtension,
  validateDiscoveryExtensionSpec,
  type DiscoveryExtension,
} from "@x402/extensions/bazaar";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { CatalogConfig } from "../types.js";
import { canonicalJson, hasControlCharacters, jsonBytes, jsonDepth, sanitizeText } from "./sanitize.js";

/** Stable internal rejection codes. They are recorded, never invented per call. */
export type RejectionCode =
  | "bazaar_extension_not_an_object"
  | "metadata_too_large"
  | "metadata_too_deep"
  | "spec_validation_failed"
  | "schema_validation_failed"
  | "schema_too_large"
  | "example_too_large"
  | "missing_resource_url"
  | "invalid_resource_url"
  | "unsupported_url_scheme"
  | "url_credentials_present"
  | "control_characters_in_url"
  | "insecure_resource_origin"
  | "local_resource_origin"
  | "missing_mcp_tool_name"
  | "payto_ownership_conflict"
  | "duplicate_change_rejected"
  | "catalog_write_failed";

export interface CatalogCandidate {
  type: "http" | "mcp";
  /** Stable catalog identity string. */
  resourceKey: string;
  /** Canonical Bazaar `resource` value returned by discovery. */
  resourceUrl: string;
  origin: string;
  routeTemplate?: string;
  method?: string;
  toolName?: string;
  transport?: string;
  x402Version: number;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags: string[];
  iconUrl?: string;
  /** The validated Bazaar extension exactly as declared. */
  bazaarExtension: Record<string, unknown>;
  /** Every echoed extension, used for the catalog `extensions` echo. */
  extensions: Record<string, unknown>;
  inputSchema?: unknown;
  inputExample?: unknown;
  outputType?: string;
  outputSchema?: unknown;
  outputExample?: unknown;
  /** sha256 over the canonical metadata declaration; identical hash = no new version. */
  declarationHash: string;
  paymentOption: PaymentOption;
  /** Fields that failed their rule and were discarded rather than rejecting. */
  softDropped: string[];
}

export interface PaymentOption {
  optionHash: string;
  x402Version: number;
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
  /** Operator asset label; never part of the option hash or of settlement. */
  assetSymbol?: string;
  assetDecimals?: number;
}

export type ExtractionResult =
  | { kind: "absent" }
  | { kind: "rejected"; code: RejectionCode; detail?: string | undefined }
  | { kind: "candidate"; candidate: CatalogCandidate };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const LOCAL_HOSTS = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"]);

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host)) return true;
  if (/^127\./.test(host) || host === "0.0.0.0" || host === "::1" || host === "[::1]") return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

interface NormalizedUrl {
  canonical: string;
  origin: string;
  pathname: string;
  protocol: string;
  hostname: string;
}

/**
 * Parses and normalizes a client-supplied resource URL. Query strings, fragments
 * and default ports are dropped; the host is lowercased by the WHATWG parser.
 */
export function normalizeResourceUrl(raw: string): NormalizedUrl | RejectionCode {
  if (typeof raw !== "string" || raw.length === 0) return "missing_resource_url";
  if (raw.length > 2048) return "invalid_resource_url";
  if (hasControlCharacters(raw)) return "control_characters_in_url";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "invalid_resource_url";
  }
  if (!["http:", "https:", "mcp:"].includes(url.protocol)) return "unsupported_url_scheme";
  if (url.username !== "" || url.password !== "") return "url_credentials_present";
  // URL.origin is the literal string "null" for non-special schemes such as mcp:.
  const origin = `${url.protocol}//${url.host}`;
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  return { canonical: `${origin}${pathname === "/" ? "" : pathname}` || origin, origin, pathname, protocol: url.protocol, hostname: url.hostname };
}

function originPolicy(url: NormalizedUrl, config: CatalogConfig): RejectionCode | undefined {
  if (url.protocol === "mcp:") return undefined;
  const local = isLocalHost(url.hostname);
  if (local && !config.allowLocalOrigins) return "local_resource_origin";
  if (url.protocol !== "https:" && config.requireHttpsOrigins && !(local && config.allowLocalOrigins)) {
    return "insecure_resource_origin";
  }
  return undefined;
}

function boundedExample(value: unknown, limit: number): boolean {
  return value === undefined || jsonBytes(value) <= limit;
}

/**
 * Extracts a catalog candidate from an already payment-verified request.
 *
 * `paymentRequirements` is facilitator-validated and cryptographically bound to
 * the signed authorization, so payment terms are trustworthy. Everything reached
 * through `paymentPayload.resource` and `paymentPayload.extensions` is hostile
 * input and only ever soft-drops or rejects.
 */
export function extractCandidate(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
  config: CatalogConfig,
  assetMetadata?: { symbol: string; decimals: number },
): ExtractionResult {
  const extensions = isPlainObject(paymentPayload.extensions) ? paymentPayload.extensions : {};
  const raw = extensions["bazaar"];
  if (raw === undefined) return { kind: "absent" };
  if (!isPlainObject(raw)) return { kind: "rejected", code: "bazaar_extension_not_an_object" };

  if (jsonBytes(raw) > config.maxMetadataBytes) return { kind: "rejected", code: "metadata_too_large" };
  if (jsonDepth(raw, config.maxJsonDepth) > config.maxJsonDepth) {
    return { kind: "rejected", code: "metadata_too_deep" };
  }

  const spec = validateDiscoveryExtensionSpec(raw);
  if (!spec.valid) {
    return { kind: "rejected", code: "spec_validation_failed", detail: spec.errors?.join("; ") };
  }
  if (config.requireValidSchema) {
    const schemaResult = validateDiscoveryExtension(raw as unknown as DiscoveryExtension);
    if (!schemaResult.valid) {
      return { kind: "rejected", code: "schema_validation_failed", detail: schemaResult.errors?.join("; ") };
    }
  }
  if (jsonBytes(raw.schema) > config.maxSchemaBytes) {
    return { kind: "rejected", code: "schema_too_large" };
  }

  const info = raw.info as Record<string, unknown>;
  const input = info.input as Record<string, unknown>;
  const output = isPlainObject(info.output) ? info.output : undefined;
  const inputType = input.type === "mcp" ? "mcp" : "http";

  // MCP carries the tool schema in `info`; HTTP declares its parameters in the
  // extension schema, so both end up in one structured column.
  const schemaInput = isPlainObject(raw.schema)
    && isPlainObject((raw.schema as Record<string, unknown>).properties)
    ? ((raw.schema as Record<string, Record<string, unknown>>).properties as Record<string, unknown>).input
    : undefined;
  const schemaInputProperties = isPlainObject(schemaInput) && isPlainObject(schemaInput.properties)
    ? schemaInput.properties
    : undefined;
  const declaredInputSchema = inputType === "mcp"
    ? input.inputSchema
    : schemaInputProperties?.body ?? schemaInputProperties?.queryParams;
  const declaredOutputSchema = isPlainObject(raw.schema)
    && isPlainObject((raw.schema as Record<string, unknown>).properties)
    ? ((raw.schema as Record<string, Record<string, unknown>>).properties as Record<string, unknown>).output
    : undefined;

  for (const example of [input.example, input.body, input.queryParams, output?.example]) {
    if (!boundedExample(example, config.maxExampleBytes)) {
      return { kind: "rejected", code: "example_too_large" };
    }
  }

  const resource = isPlainObject(paymentPayload.resource) ? paymentPayload.resource : undefined;
  const rawUrl = typeof resource?.url === "string" ? resource.url : "";
  const normalized = normalizeResourceUrl(rawUrl);
  if (typeof normalized === "string") return { kind: "rejected", code: normalized };
  const policy = originPolicy(normalized, config);
  if (policy) return { kind: "rejected", code: policy };

  const softDropped: string[] = [];

  // routeTemplate is percent-decoded and traversal-checked by the official
  // validator; an invalid template falls back to the concrete path.
  let routeTemplate: string | undefined;
  const declaredTemplate = typeof raw.routeTemplate === "string" ? raw.routeTemplate : undefined;
  if (declaredTemplate !== undefined) {
    if (declaredTemplate.length <= config.maxRouteTemplateLength && isValidRouteTemplate(declaredTemplate)) {
      routeTemplate = declaredTemplate;
    } else {
      softDropped.push("routeTemplate");
    }
  }

  let description: string | undefined;
  if (typeof resource?.description === "string") {
    const cleaned = sanitizeText(resource.description, config.maxDescriptionLength);
    if (cleaned.length > 0) description = cleaned;
    else softDropped.push("description");
  }

  let mimeType: string | undefined;
  if (typeof resource?.mimeType === "string") {
    const cleaned = sanitizeText(resource.mimeType, 128);
    if (/^[\w.+-]+\/[\w.+-]+$/.test(cleaned)) mimeType = cleaned;
    else softDropped.push("mimeType");
  }

  const service = sanitizeResourceServiceMetadata(resource ?? undefined);
  if (resource?.serviceName !== undefined && service.serviceName === undefined) softDropped.push("serviceName");
  if (resource?.tags !== undefined && service.tags === undefined) softDropped.push("tags");
  if (resource?.iconUrl !== undefined && service.iconUrl === undefined) softDropped.push("iconUrl");
  const tags = (service.tags ?? []).slice(0, config.maxTags)
    .map(tag => sanitizeText(tag, config.maxTagLength))
    .filter(tag => tag.length > 0);
  const iconUrl = service.iconUrl && service.iconUrl.length <= config.maxIconUrlLength
    ? service.iconUrl
    : undefined;
  const serviceName = service.serviceName
    ? sanitizeText(service.serviceName, config.maxServiceNameLength)
    : undefined;

  const method = typeof input.method === "string" ? input.method.toUpperCase() : undefined;
  const toolName = typeof input.toolName === "string" ? input.toolName : undefined;
  if (inputType === "mcp" && !toolName) return { kind: "rejected", code: "missing_mcp_tool_name" };

  // Catalog identity. MCP multiplexes tools over one endpoint, so the tuple
  // (resource.url, toolName) is required; HTTP collapses concrete dynamic paths
  // onto the declared template.
  const resourceKey = inputType === "mcp"
    ? `mcp|${normalized.canonical}|${toolName}`
    : `http|${normalized.origin}|${routeTemplate ?? normalized.pathname}|${method ?? ""}`;

  const resourceUrl = inputType === "mcp"
    ? normalized.canonical
    : `${normalized.origin}${routeTemplate ?? normalized.pathname}`;

  const declaration = {
    type: inputType,
    resourceKey,
    resourceUrl,
    description: description ?? null,
    mimeType: mimeType ?? null,
    serviceName: serviceName ?? null,
    tags,
    iconUrl: iconUrl ?? null,
    bazaar: raw,
  };

  const extra = isPlainObject(paymentRequirements.extra) ? paymentRequirements.extra : {};
  const option: PaymentOption = {
    optionHash: sha256(canonicalJson({
      scheme: paymentRequirements.scheme,
      network: paymentRequirements.network,
      asset: paymentRequirements.asset,
      amount: paymentRequirements.amount,
      payTo: paymentRequirements.payTo,
      maxTimeoutSeconds: paymentRequirements.maxTimeoutSeconds,
      extra,
    })),
    x402Version: paymentPayload.x402Version,
    scheme: paymentRequirements.scheme,
    network: paymentRequirements.network,
    asset: paymentRequirements.asset,
    amount: String(paymentRequirements.amount),
    payTo: paymentRequirements.payTo,
    maxTimeoutSeconds: paymentRequirements.maxTimeoutSeconds,
    extra,
    ...(assetMetadata ? { assetSymbol: assetMetadata.symbol, assetDecimals: assetMetadata.decimals } : {}),
  };

  const candidate: CatalogCandidate = {
    type: inputType,
    resourceKey,
    resourceUrl,
    origin: normalized.origin,
    ...(routeTemplate ? { routeTemplate } : {}),
    ...(method ? { method } : {}),
    ...(toolName ? { toolName } : {}),
    ...(typeof input.transport === "string" ? { transport: input.transport } : {}),
    x402Version: paymentPayload.x402Version,
    ...(description ? { description } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(serviceName ? { serviceName } : {}),
    tags,
    ...(iconUrl ? { iconUrl } : {}),
    bazaarExtension: raw,
    extensions,
    ...(declaredInputSchema !== undefined ? { inputSchema: declaredInputSchema } : {}),
    ...(declaredOutputSchema !== undefined ? { outputSchema: declaredOutputSchema } : {}),
    ...(input.example !== undefined ? { inputExample: input.example }
      : input.body !== undefined ? { inputExample: input.body }
      : input.queryParams !== undefined ? { inputExample: input.queryParams } : {}),
    ...(typeof output?.type === "string" ? { outputType: output.type } : {}),
    ...(output?.example !== undefined ? { outputExample: output.example } : {}),
    declarationHash: sha256(canonicalJson(declaration)),
    paymentOption: option,
    softDropped,
  };
  return { kind: "candidate", candidate };
}
