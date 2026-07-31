/**
 * A paid MCP tool declaring itself to the Bazaar catalog.
 *
 * Run with: npx tsx packages/bazaar-sdk/examples/analysis-mcp.ts
 */
import { bazaar } from "../src/index.js";

/** The schema the MCP tool already declares in `tools/list`. Reused unchanged. */
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

const analysis = bazaar.mcp({
  toolName: "financial_analysis",
  description: "Analyzes a public company using financial data.",
  transport: "streamable-http",
  serviceName: "Finance Tools",
  tags: ["finance", "equities"],
  inputSchema,
  example: { ticker: "AAPL", analysis_type: "deep" },
  output: { type: "json", example: { summary: "Strong fundamentals", score: 8.5 } },
});

export const paymentRequired = {
  x402Version: 2,
  error: "Payment required",
  // The catalog identity of an MCP tool is (resource.url, input.toolName).
  resource: { url: "https://api.example.com/mcp", ...analysis.resource },
  accepts: [
    {
      scheme: "upto",
      network: "stellar:testnet",
      asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      amount: "50000",
      payTo: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
      maxTimeoutSeconds: 120,
      extra: {},
    },
  ],
  extensions: { ...analysis.extensions },
};

console.log(JSON.stringify(paymentRequired, null, 2));
