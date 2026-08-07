import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "../bazaar/sanitize.js";

export interface CursorPayload {
  /** Catalog watermark the first page was issued against. */
  snapshot: string;
  offset: number;
  /** Hash of the filter set, so a cursor cannot be replayed against a different query. */
  filters: string;
  expiresAt: number;
  /** Stable attribution id reused by every page of one ranked search. */
  searchSessionId?: string;
}

const VERSION = "c1";

function sign(key: Buffer, body: string): string {
  return createHmac("sha256", key).update(`${VERSION}.${body}`).digest("base64url");
}

export function filterFingerprint(filters: Record<string, unknown>): string {
  return createHmac("sha256", "x402-discovery-filters")
    .update(canonicalJson(filters)).digest("base64url").slice(0, 22);
}

/** Opaque, tamper-resistant cursor. Clients must treat it as a blob. */
export function encodeCursor(key: Buffer, payload: CursorPayload): string {
  const body = Buffer.from(canonicalJson(payload), "utf8").toString("base64url");
  return `${VERSION}.${body}.${sign(key, body)}`;
}

export function decodeCursor(key: Buffer, cursor: string): CursorPayload | undefined {
  const parts = cursor.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return undefined;
  const [, body, signature] = parts as [string, string, string];
  const expected = Buffer.from(sign(key, body), "utf8");
  const provided = Buffer.from(signature, "utf8");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CursorPayload;
    if (typeof payload.snapshot !== "string" || typeof payload.offset !== "number") return undefined;
    if (typeof payload.filters !== "string" || typeof payload.expiresAt !== "number") return undefined;
    if (payload.searchSessionId !== undefined
        && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.searchSessionId)) {
      return undefined;
    }
    if (payload.offset < 0 || !Number.isSafeInteger(payload.offset)) return undefined;
    if (payload.expiresAt < Date.now()) return undefined;
    return payload;
  } catch {
    return undefined;
  }
}
