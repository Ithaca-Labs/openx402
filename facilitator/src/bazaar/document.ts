import type { CatalogCandidate } from "./extract.js";
import { canonicalJson } from "./sanitize.js";

/** The formatter version is part of the embedding source hash. */
export const SEARCH_DOCUMENT_COMPILER_VERSION = 3;

export interface SearchDocumentPaymentOption {
  scheme: string;
  network: string;
  amount: string;
  assetSymbol?: string;
  asset: string;
  payTo?: string;
}

/**
 * The human document is shared by embeddings and reranking. The three lexical
 * inputs are deliberately separate so PostgreSQL can give identifiers a
 * stronger weight without changing what semantic providers see.
 */
export interface CompiledSearchDocument {
  document: string;
  lexicalHigh: string;
  lexicalMedium: string;
  lexicalLow: string;
}

/**
 * Compiles a catalog version into deterministic, human-readable index text.
 *
 * Only seller-declared facts and normalized payment terms appear. Missing
 * fields are omitted rather than inferred, and no generative model participates,
 * so the same declaration always produces the same document.
 */
export function compileSearchDocument(
  candidate: CatalogCandidate,
  options: SearchDocumentPaymentOption[],
): string {
  return compileSearchDocumentParts(candidate, options).document;
}

/** Compiles the shared human document and the weighted lexical field inputs. */
export function compileSearchDocumentParts(
  candidate: CatalogCandidate,
  options: SearchDocumentPaymentOption[],
): CompiledSearchDocument {
  const lines: string[] = [];
  const high: string[] = [];
  const medium: string[] = [];
  const low: string[] = [];

  if (candidate.serviceName) {
    lines.push(`Service: ${candidate.serviceName}`);
    high.push(candidate.serviceName);
  }
  if (candidate.description) {
    lines.push(`Description: ${candidate.description}`);
    medium.push(candidate.description);
  }

  const typeLine = candidate.type === "mcp"
    ? `Type: MCP tool ${candidate.toolName}`
    : `Type: HTTP ${candidate.method ?? ""}`.trimEnd();
  lines.push(typeLine);
  high.push(candidate.type, candidate.method ?? "", candidate.toolName ?? "");

  if (candidate.routeTemplate) {
    lines.push(`Route: ${candidate.routeTemplate}`);
    high.push(candidate.routeTemplate);
  }
  lines.push(`Resource: ${candidate.resourceUrl}`);
  high.push(candidate.resourceUrl);

  const parameters = parameterEntries(candidate);
  if (parameters.length > 0) {
    lines.push("Parameters:");
    lines.push(...parameters.map(formatParameter));
    for (const parameter of parameters) {
      medium.push(parameter.name, parameter.description ?? "");
    }
  }

  if (candidate.outputType) {
    lines.push(`Output: ${candidate.outputType}`);
    medium.push(candidate.outputType);
  }
  if (candidate.tags.length > 0) {
    lines.push(`Tags: ${candidate.tags.join(", ")}`);
    low.push(...candidate.tags);
  }
  if (candidate.mimeType) {
    lines.push(`MIME: ${candidate.mimeType}`);
    low.push(candidate.mimeType);
  }
  if (candidate.transport) {
    lines.push(`Transport: ${candidate.transport}`);
    low.push(candidate.transport);
  }

  const examples = [
    ...(candidate.inputExample === undefined ? [] : exampleLines("Input", candidate.inputExample)),
    ...(candidate.outputExample === undefined ? [] : exampleLines("Output", candidate.outputExample)),
  ];
  if (examples.length > 0) {
    lines.push("Examples:");
    lines.push(...examples.map(line => `- ${line}`));
    low.push(...examples);
  }

  for (const option of options) {
    const payment = `${option.network}, ${option.scheme}, ${option.amount} ${option.assetSymbol ?? option.asset}`;
    lines.push(`Payment: ${payment}`);
    low.push(option.network, option.scheme, option.amount, option.assetSymbol ?? "", option.asset, option.payTo ?? "");
  }

  return {
    document: lines.join("\n"),
    lexicalHigh: lexicalField(high),
    lexicalMedium: lexicalField(medium),
    lexicalLow: lexicalField(low),
  };
}

interface ParameterEntry {
  name: string;
  required: boolean;
  description?: string;
}

function parameterEntries(candidate: CatalogCandidate): ParameterEntry[] {
  const schema = candidate.inputSchema;
  const entries: ParameterEntry[] = [];
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    const record = schema as Record<string, unknown>;
    const properties = record.properties;
    const required = new Set(
      Array.isArray(record.required)
        ? record.required.filter((value): value is string => typeof value === "string")
        : [],
    );
    if (properties && typeof properties === "object" && !Array.isArray(properties)) {
      for (const [name, value] of Object.entries(properties as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, 50)) {
        const description = value && typeof value === "object" && !Array.isArray(value)
          && typeof (value as Record<string, unknown>).description === "string"
          ? (value as Record<string, unknown>).description as string
          : undefined;
        entries.push({ name, required: required.has(name), ...(description ? { description } : {}) });
      }
    }
  }
  if (entries.length === 0 && candidate.inputExample && typeof candidate.inputExample === "object"
      && !Array.isArray(candidate.inputExample)) {
    for (const name of Object.keys(candidate.inputExample as Record<string, unknown>)
      .sort((left, right) => left.localeCompare(right)).slice(0, 50)) {
      entries.push({ name, required: false });
    }
  }
  return entries;
}

function formatParameter(parameter: ParameterEntry): string {
  return `- ${parameter.name}${parameter.required ? " (required)" : ""}${parameter.description ? `: ${parameter.description}` : ""}`;
}

/**
 * Adds deterministic identifier aliases to the lexical input. PostgreSQL's
 * parser intentionally splits URLs and punctuation-heavy tool names in ways
 * that vary by parser version; the aliases preserve their searchable parts
 * without changing the human/embedding document.
 */
function lexicalField(values: string[]): string {
  const present = values.filter(value => value.length > 0);
  // Keep the first occurrence of a token inside each declared value and drop
  // repeats. This preserves readable identifiers and phrases while preventing
  // a seller from increasing lexical rank by appending the same query terms
  // dozens of times. Aliases remain unique and aid punctuation-heavy IDs.
  const bounded = present.map(value => {
    const seen = new Set<string>();
    return value.replace(/[\p{L}\p{N}]+/gu, token => {
      const normalized = token.normalize("NFKC").toLowerCase();
      if (seen.has(normalized)) return "";
      seen.add(normalized);
      return token;
    });
  });
  const aliases = present.flatMap(value => value.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? []);
  return [...bounded, ...new Set(aliases.map(alias => alias.toLowerCase()))].join(" ");
}

function exampleLines(label: string, value: unknown): string[] {
  const flattened = flattenExample(value, label);
  return flattened.length > 0 ? flattened : [`${label}: ${canonicalJson(value)}`];
}

function flattenExample(value: unknown, path: string, depth = 0): string[] {
  if (value === null || typeof value !== "object") {
    return [`${path}: ${exampleScalar(value)}`];
  }
  if (depth >= 8) return [`${path}: ${canonicalJson(value)}`];
  if (Array.isArray(value)) {
    return value.slice(0, 50).flatMap((entry, index) => flattenExample(entry, `${path}[${index}]`, depth + 1));
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return [`${path}: {}`];
  return entries.slice(0, 50).flatMap(([key, entry]) => flattenExample(entry, `${path}.${key}`, depth + 1));
}

function exampleScalar(value: unknown): string {
  if (typeof value === "string") {
    return value.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  }
  return String(value);
}
