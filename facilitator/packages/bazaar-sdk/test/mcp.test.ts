import { declareDiscoveryExtension, validateDiscoveryExtension } from "@x402/extensions/bazaar";
import { describe, expect, it } from "vitest";
import { bazaar, BazaarConfigError } from "../src/index.js";

const inputSchema = {
  type: "object",
  properties: {
    ticker: { type: "string", description: "Stock ticker symbol, such as AAPL." },
    analysis_type: {
      type: "string",
      enum: ["quick", "deep"],
      description: "How detailed the analysis should be.",
    },
  },
  required: ["ticker"],
};

describe("bazaar.mcp", () => {
  it("matches the official MCP wire structure byte for byte", () => {
    const metadata = bazaar.mcp({
      toolName: "financial_analysis",
      description: "Analyzes a public company using financial data.",
      transport: "streamable-http",
      inputSchema,
      example: { ticker: "AAPL", analysis_type: "deep" },
      output: { type: "json", example: { summary: "Strong fundamentals", score: 8.5 } },
    });

    const official = declareDiscoveryExtension({
      toolName: "financial_analysis",
      description: "Analyzes a public company using financial data.",
      transport: "streamable-http",
      inputSchema,
      example: { ticker: "AAPL", analysis_type: "deep" },
      output: { example: { summary: "Strong fundamentals", score: 8.5 } },
    });

    expect(metadata.extensions).toEqual(official);
    expect(JSON.stringify(metadata.extensions)).toBe(JSON.stringify(official));
    expect(validateDiscoveryExtension(metadata.extensions.bazaar).valid).toBe(true);
  });

  it("reuses the tool inputSchema unchanged and keeps parameter descriptions inside it", () => {
    const metadata = bazaar.mcp({ toolName: "financial_analysis", inputSchema });
    const info = metadata.extensions.bazaar.info as { input: Record<string, unknown> };
    expect(info.input.inputSchema).toBe(inputSchema);
    const properties = (info.input.inputSchema as { properties: Record<string, { description?: string }> }).properties;
    expect(properties.ticker?.description).toBe("Stock ticker symbol, such as AAPL.");
  });

  it("keeps the tool description on the tool, not on the service resource block", () => {
    const metadata = bazaar.mcp({
      toolName: "financial_analysis",
      description: "Analyzes a public company.",
      serviceName: "Finance Tools",
      inputSchema,
    });
    expect(metadata.resource).toEqual({ serviceName: "Finance Tools" });
    const info = metadata.extensions.bazaar.info as { input: Record<string, unknown> };
    expect(info.input.description).toBe("Analyzes a public company.");
  });

  it("omits transport when the seller does not declare one", () => {
    const metadata = bazaar.mcp({ toolName: "tool", inputSchema });
    const info = metadata.extensions.bazaar.info as { input: Record<string, unknown> };
    expect(info.input.transport).toBeUndefined();
  });

  it("rejects invalid MCP configurations", () => {
    expect(() => bazaar.mcp({ toolName: "", inputSchema })).toThrow(BazaarConfigError);
    expect(() => bazaar.mcp({
      toolName: "tool",
      inputSchema: { type: "array" },
    })).toThrow(BazaarConfigError);
    expect(() => bazaar.mcp({
      toolName: "tool",
      inputSchema,
      transport: "websocket" as "sse",
    })).toThrow(BazaarConfigError);
  });
});
