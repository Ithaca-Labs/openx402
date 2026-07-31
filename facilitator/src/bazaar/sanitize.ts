/**
 * Bounding and sanitizing helpers for seller-authored, client-echoed metadata.
 *
 * Everything here treats its input as hostile: a paying client controls the
 * whole `resource` block and the whole `extensions.bazaar` object.
 */

// C0 controls, DEL, and C1 controls.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
// Bidi marks, overrides and isolates, which can visually reorder a listing.
const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f-\u009f]/.test(value);
}

/**
 * Produces the display/index form of a seller string: Unicode-normalized, with
 * control and bidi-override characters removed and length bounded. The original
 * declaration is stored separately and is never modified.
 */
export function sanitizeText(value: string, maxLength: number): string {
  return value
    .normalize("NFC")
    .replace(CONTROL_CHARACTERS, "")
    .replace(BIDI_CONTROLS, "")
    .trim()
    .slice(0, maxLength);
}

export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

/** Depth of a parsed JSON value; a scalar is depth 1. */
export function jsonDepth(value: unknown, limit: number, depth = 1): number {
  if (depth > limit || value === null || typeof value !== "object") return depth;
  let deepest = depth;
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    deepest = Math.max(deepest, jsonDepth(entry, limit, depth + 1));
    if (deepest > limit) return deepest;
  }
  return deepest;
}

/** Deterministic JSON with sorted object keys, used for every catalog hash. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}
