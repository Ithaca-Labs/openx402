import { declareDiscoveryExtension, type DiscoveryExtension } from "@x402/extensions/bazaar";
import type { BazaarMetadata, McpMetadataConfig } from "./types.js";
import { applyOutput, serviceMetadata } from "./compile.js";
import { validateMcpConfig } from "./validate.js";

/**
 * Declares an MCP tool for the Bazaar catalog.
 *
 * The tool's existing `inputSchema` is reused unchanged, so parameter
 * descriptions stay in `inputSchema.properties.<name>.description` and no second
 * schema language is introduced. The catalog identity of an MCP tool is the
 * tuple (`resource.url`, `info.input.toolName`).
 *
 * @example
 * ```ts
 * const analysis = bazaar.mcp({
 *   toolName: "financial_analysis",
 *   description: "Analyzes a public company using financial data.",
 *   transport: "streamable-http",
 *   inputSchema: {
 *     type: "object",
 *     properties: { ticker: { type: "string", description: "Stock ticker, such as AAPL." } },
 *     required: ["ticker"],
 *   },
 *   example: { ticker: "AAPL" },
 *   output: { type: "json", example: { summary: "Strong fundamentals", score: 8.5 } },
 * });
 * ```
 */
export function mcp(config: McpMetadataConfig): BazaarMetadata {
  validateMcpConfig(config);

  const declared = declareDiscoveryExtension({
    toolName: config.toolName,
    ...(config.description !== undefined ? { description: config.description } : {}),
    ...(config.transport !== undefined ? { transport: config.transport } : {}),
    inputSchema: config.inputSchema,
    ...(config.example !== undefined ? { example: config.example } : {}),
    ...(config.output
      ? {
          output: {
            ...(config.output.example !== undefined ? { example: config.output.example } : {}),
            ...(config.output.schema !== undefined ? { schema: config.output.schema } : {}),
          },
        }
      : {}),
  });

  const extension = applyOutput(declared.bazaar as DiscoveryExtension, config.output);
  // `description` on an MCP tool belongs to the tool, not to the service, so it
  // is not repeated on the resource object.
  const { description: _toolDescription, ...service } = config;
  const resource = serviceMetadata(service);
  const extensions = { bazaar: extension };
  return { resource, extensions, compile: () => ({ resource, extensions }) };
}
