/** Normalized complete-token matching for deterministic forbidden-capability signatures. */

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function matchesForbiddenSignature(text: string, signature: string): boolean {
  const textTokens = normalizeSearchText(text).split(" ").filter(Boolean);
  const signatureTokens = normalizeSearchText(signature).split(" ").filter(Boolean);
  if (signatureTokens.length === 0 || signatureTokens.length > textTokens.length) return false;

  const lastStart = textTokens.length - signatureTokens.length;
  for (let start = 0; start <= lastStart; start++) {
    if (signatureTokens.every((token, offset) => textTokens[start + offset] === token)) return true;
  }
  return false;
}
