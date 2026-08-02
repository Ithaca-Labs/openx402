/** Query parsing is intentionally deterministic and has no model or network dependency. */

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

// This is only a recall-oriented guard for the `simple` PostgreSQL config. It
// is not presented as language detection, and identifiers/numbers are never
// removed by it.
const COMMON_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it",
  "of", "on", "or", "the", "to", "with",
]);

const HTTP_METHODS = new Set(["CONNECT", "DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT", "TRACE"]);

export interface SearchQueryShape {
  normalizedLength: number;
  tokenCount: number;
  uniqueTokenCount: number;
  phraseTokenCount: number;
  hasPhrase: boolean;
  hasIdentifier: boolean;
  hasUrl: boolean;
  hasHttpMethod: boolean;
  hasNumericToken: boolean;
  hasPunctuation: boolean;
  stopwordOnly: boolean;
}

/** Normalizes query text without expanding it or changing seller content. */
export function normalizeSearchQuery(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(BIDI_CONTROLS, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 512);
}

/**
 * Returns a safe `to_tsquery` expression. Every lexeme comes from a Unicode
 * letter/number token and is quoted; callers pass the result as a SQL value,
 * never as SQL text. The phrase clause improves exact multi-token matches while
 * the OR clause keeps recall when a phrase is absent from a declaration.
 */
export function buildSearchTsquery(raw: string): string {
  const normalized = normalizeSearchQuery(raw);
  const phraseTokens = atomicTokens(normalized)
    .map(token => token.toLowerCase())
    .filter(token => !COMMON_STOPWORDS.has(token));
  const identifierTokens = identifierTokensFor(normalized)
    .map(token => token.toLowerCase())
    .filter(token => !COMMON_STOPWORDS.has(token));
  if (phraseTokens.length === 0 || identifierTokens.length === 0) return "'x402zzzznomatch'";

  const phrase = phraseTokens.map(quoteTsqueryLexeme).join(" <-> ");
  const fallback = [...new Set(identifierTokens)].map(quoteTsqueryLexeme).join(" | ");
  return `(${phrase}) | (${fallback})`;
}

export function describeSearchQuery(raw: string): SearchQueryShape {
  const normalized = normalizeSearchQuery(raw);
  const atomic = atomicTokens(normalized);
  const searchable = atomic
    .map(token => token.toLowerCase())
    .filter(token => !COMMON_STOPWORDS.has(token));
  return {
    normalizedLength: normalized.length,
    tokenCount: searchable.length,
    uniqueTokenCount: new Set(searchable).size,
    phraseTokenCount: searchable.length,
    hasPhrase: searchable.length > 1 && /\s/u.test(normalized),
    hasIdentifier: /(?:[_:/\\.@#%~-])/u.test(normalized),
    hasUrl: /\b(?:https?|mcp):\/\//iu.test(normalized),
    hasHttpMethod: searchable.some(token => HTTP_METHODS.has(token.toUpperCase())),
    hasNumericToken: searchable.some(token => /\d/u.test(token)),
    hasPunctuation: /[^\p{L}\p{N}\s]/u.test(normalized),
    stopwordOnly: normalized.length > 0 && searchable.length === 0,
  };
}

function atomicTokens(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function identifierTokensFor(value: string): string[] {
  const result: string[] = [];
  for (const match of value.match(/[\p{L}\p{N}]+(?:[_-][\p{L}\p{N}]+)*/gu) ?? []) {
    result.push(match, ...match.split(/[_-]+/u));
  }
  return result;
}

function quoteTsqueryLexeme(value: string): string {
  // The tokenizer only emits letters/numbers/underscore/hyphen, but escaping
  // here documents the boundary and keeps this helper safe if it is reused.
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}
