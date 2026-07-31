import type { CatalogCandidate } from "./extract.js";

/**
 * Compiles a catalog version into deterministic, human-readable index text.
 *
 * Only seller-declared facts and normalized payment terms appear. Missing
 * fields are omitted rather than inferred, and no generative model participates,
 * so the same declaration always produces the same document.
 */
export function compileSearchDocument(
  candidate: CatalogCandidate,
  options: Array<{ scheme: string; network: string; amount: string; assetSymbol?: string; asset: string }>,
): string {
  const lines: string[] = [];
  if (candidate.serviceName) lines.push(`Service: ${candidate.serviceName}`);
  if (candidate.description) lines.push(`Description: ${candidate.description}`);
  lines.push(candidate.type === "mcp"
    ? `Type: MCP tool ${candidate.toolName}`
    : `Type: HTTP ${candidate.method ?? ""}`.trimEnd());
  lines.push(`Resource: ${candidate.resourceUrl}`);

  const parameters = parameterLines(candidate);
  if (parameters.length > 0) {
    lines.push("Parameters:");
    lines.push(...parameters);
  }

  if (candidate.outputType) lines.push(`Output: ${candidate.outputType}`);
  if (candidate.tags.length > 0) lines.push(`Tags: ${candidate.tags.join(", ")}`);
  for (const option of options) {
    lines.push(`Payment: ${option.network}, ${option.scheme}, ${option.amount} ${option.assetSymbol ?? option.asset}`);
  }
  return lines.join("\n");
}

function parameterLines(candidate: CatalogCandidate): string[] {
  const schema = candidate.inputSchema;
  const lines: string[] = [];
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    const properties = (schema as Record<string, unknown>).properties;
    const required = new Set(
      Array.isArray((schema as Record<string, unknown>).required)
        ? ((schema as Record<string, unknown>).required as unknown[]).filter((v): v is string => typeof v === "string")
        : [],
    );
    if (properties && typeof properties === "object") {
      for (const [name, value] of Object.entries(properties as Record<string, unknown>).slice(0, 50)) {
        const description = value && typeof value === "object" && typeof (value as Record<string, unknown>).description === "string"
          ? (value as Record<string, unknown>).description as string
          : undefined;
        lines.push(`- ${name}${required.has(name) ? " (required)" : ""}${description ? `: ${description}` : ""}`);
      }
    }
  }
  if (lines.length === 0 && candidate.inputExample && typeof candidate.inputExample === "object") {
    for (const name of Object.keys(candidate.inputExample as Record<string, unknown>).slice(0, 50)) {
      lines.push(`- ${name}`);
    }
  }
  return lines;
}
