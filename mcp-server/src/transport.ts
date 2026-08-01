import type { PaymentRequired } from "@x402/core/types";
import { McpToolError } from "./errors.js";
import { canonicalJson } from "./resourceRef.js";

const MAX_CHALLENGE_BYTES = 262_144;

interface RawToolResult {
  isError?: boolean | undefined;
  structuredContent?: unknown;
  content?: Array<{ type: string; text?: string }> | undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikePaymentRequired(value: unknown): value is PaymentRequired {
  return isPlainObject(value)
    && typeof value.x402Version === "number"
    && isPlainObject(value.resource)
    && typeof (value.resource as Record<string, unknown>).url === "string"
    && Array.isArray(value.accepts);
}

/**
 * Enforces `transports-v2/mcp.md` exactly: an unpaid paid-tool call must
 * come back `isError: true` with `PaymentRequired` present in BOTH
 * `structuredContent` (the object) and `content[0].text` (the identical
 * object JSON-stringified). The two copies are compared by semantic JSON
 * equality, not string equality, since key order is not guaranteed. Missing,
 * malformed, oversized or unequal copies are all rejected the same way --
 * this is the resource server violating the wire contract, not a retryable
 * condition.
 */
export function validatePaymentRequiredDualCopy(result: RawToolResult): PaymentRequired {
  if (result.isError !== true) {
    throw new McpToolError("UPSTREAM_PROTOCOL_ERROR", "expected isError: true on an unpaid paid-tool call");
  }
  const structured = result.structuredContent;
  if (!looksLikePaymentRequired(structured)) {
    throw new McpToolError("UPSTREAM_PROTOCOL_ERROR", "structuredContent is missing or is not a valid PaymentRequired object");
  }
  const textItem = result.content?.find(item => item.type === "text");
  if (!textItem || typeof textItem.text !== "string") {
    throw new McpToolError("UPSTREAM_PROTOCOL_ERROR", "content[0].text is missing the JSON-encoded PaymentRequired copy");
  }
  if (Buffer.byteLength(textItem.text, "utf8") > MAX_CHALLENGE_BYTES) {
    throw new McpToolError("UPSTREAM_PROTOCOL_ERROR", "PaymentRequired text copy exceeded the size bound");
  }
  let fromText: unknown;
  try {
    fromText = JSON.parse(textItem.text);
  } catch {
    throw new McpToolError("UPSTREAM_PROTOCOL_ERROR", "content[0].text is not valid JSON");
  }
  if (canonicalJson(structured) !== canonicalJson(fromText)) {
    throw new McpToolError("UPSTREAM_PROTOCOL_ERROR", "structuredContent and content[0].text PaymentRequired copies are not semantically equal");
  }
  return structured;
}
