import { createHash } from "node:crypto";
import type { CanonicalResource, ResourceIdentity } from "./types.js";
import { McpToolError } from "./errors.js";

/** Deterministic JSON: sorted keys, no whitespace. Mirrors the facilitator's canonicalJson. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Encodes a stable, opaque, decodable reference to a cataloged resource's
 * identity -- exactly the `(type, url, toolName)` tuple the facilitator keys
 * its catalog on. Two MCP tools on the same URL encode to two distinct refs.
 * Reversible by design: `x402_get_resource`/`x402_call_resource` decode it
 * locally and re-validate against the live catalog before doing anything, so
 * a hand-crafted ref pointing at a non-cataloged URL is rejected downstream
 * rather than trusted as an arbitrary URL.
 */
export function encodeResourceRef(identity: ResourceIdentity): string {
  const payload = canonicalJson(
    identity.type === "mcp"
      ? { t: identity.type, u: identity.url, n: identity.toolName ?? "" }
      : { t: identity.type, u: identity.url },
  );
  return `v1.${Buffer.from(payload, "utf8").toString("base64url")}`;
}

export function decodeResourceRef(ref: string): ResourceIdentity {
  const separator = ref.indexOf(".");
  const version = separator === -1 ? ref : ref.slice(0, separator);
  const encoded = separator === -1 ? "" : ref.slice(separator + 1);
  if (version !== "v1" || encoded.length === 0) {
    throw new McpToolError("INVALID_ARGUMENT", "malformed resource reference");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new McpToolError("INVALID_ARGUMENT", "malformed resource reference");
  }
  if (!isPlainObject(parsed) || (parsed.t !== "http" && parsed.t !== "mcp") || typeof parsed.u !== "string") {
    throw new McpToolError("INVALID_ARGUMENT", "malformed resource reference");
  }
  if (parsed.t === "mcp" && typeof parsed.n !== "string") {
    throw new McpToolError("INVALID_ARGUMENT", "malformed resource reference");
  }
  return {
    type: parsed.t,
    url: parsed.u,
    ...(parsed.t === "mcp" ? { toolName: parsed.n as string } : {}),
  };
}

/**
 * Deterministic sha256 over canonical resource identity, declaration content
 * and payment terms. Two fetches of the same catalog version always hash
 * identically; any change to price, payTo, asset, network, schema or
 * metadata changes the hash, which is how `RESOURCE_STALE`/`RESOURCE_CHANGED`
 * are detected without re-fetching the whole page.
 */
export function computeVersionHash(resource: CanonicalResource): string {
  const declaration = {
    resource: resource.resource,
    type: resource.type,
    description: resource.description ?? null,
    mimeType: resource.mimeType ?? null,
    serviceName: resource.serviceName ?? null,
    tags: resource.tags ?? [],
    iconUrl: resource.iconUrl ?? null,
    extensions: resource.extensions ?? {},
  };
  const accepts = [...resource.accepts]
    .map(accepted => ({
      scheme: accepted.scheme,
      network: accepted.network,
      asset: accepted.asset,
      amount: accepted.amount,
      payTo: accepted.payTo,
      maxTimeoutSeconds: accepted.maxTimeoutSeconds,
      extra: accepted.extra ?? {},
    }))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  return createHash("sha256").update(canonicalJson({ declaration, accepts })).digest("hex");
}

export { canonicalJson };
