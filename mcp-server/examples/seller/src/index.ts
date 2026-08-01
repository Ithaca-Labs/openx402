import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { x402ResourceServer } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { createPaymentWrapper } from "@x402/mcp";
import { bazaar } from "@openx402/bazaar-sdk";

/**
 * Minimal paid MCP seller: one x402-priced tool ("sentiment_analysis"),
 * declared to Bazaar via `bazaar.mcp()` over the *same* zod-derived
 * inputSchema the tool is registered with, settled entirely through the
 * configured facilitator (this process never verifies or settles a payment
 * itself). Used by `tests/e2e` and the live testnet flow.
 */
const TOOL_NAME = "sentiment_analysis";
const PORT = Number(process.env.PORT ?? 4711);
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:4022";
const NETWORK = (process.env.SELLER_NETWORK ?? "stellar:testnet") as "stellar:testnet" | "stellar:pubnet";
const ASSET = process.env.SELLER_ASSET ?? "";
const PAY_TO = process.env.SELLER_PAY_TO ?? "";
const AMOUNT = process.env.SELLER_AMOUNT ?? "10000";

if (!ASSET || !PAY_TO) {
  throw new Error("SELLER_ASSET and SELLER_PAY_TO are required");
}

const inputShape = { text: z.string().min(1).max(2_000).describe("Text to analyze.") };
const inputSchema = z.object(inputShape);
const inputJsonSchema = zodToJsonSchema(inputSchema, { name: undefined, $refStrategy: "none" }) as Record<string, unknown>;

const POSITIVE = ["great", "good", "excellent", "love", "amazing", "happy", "positive"];
const NEGATIVE = ["bad", "terrible", "hate", "awful", "sad", "negative", "poor"];

function score(text: string): { label: "positive" | "negative" | "neutral"; score: number } {
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  const positive = words.filter(word => POSITIVE.includes(word)).length;
  const negative = words.filter(word => NEGATIVE.includes(word)).length;
  const value = positive - negative;
  return { label: value > 0 ? "positive" : value < 0 ? "negative" : "neutral", score: value };
}

const accepts: PaymentRequirements[] = [{
  scheme: "exact",
  network: NETWORK,
  asset: ASSET,
  amount: AMOUNT,
  payTo: PAY_TO,
  maxTimeoutSeconds: 60,
  extra: { areFeesSponsored: true },
}];

const bazaarMetadata = bazaar.mcp({
  toolName: TOOL_NAME,
  description: "Deterministic keyword-based sentiment analysis of a short text.",
  transport: "streamable-http",
  serviceName: "Example Sentiment Tool",
  tags: ["nlp", "sentiment", "example"],
  inputSchema: inputJsonSchema,
  example: { text: "This is a great day" },
  output: { type: "json", example: { label: "positive", score: 1 } },
});

const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR_URL }));

const paid = createPaymentWrapper(resourceServer, {
  accepts,
  // Matches what this process actually serves (plain HTTP for local
  // dev/testnet use). A seller advertising an https:// resource.url that
  // doesn't actually terminate TLS there would fail every real connection
  // attempt -- declare the scheme you actually run.
  resource: { url: `${process.env.SELLER_PUBLIC_URL ?? `http://localhost:${PORT}/mcp`}`, ...bazaarMetadata.resource },
  extensions: bazaarMetadata.extensions,
});

function buildServer(): McpServer {
  const server = new McpServer({ name: "openx402-example-seller", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.tool(
    TOOL_NAME,
    "Deterministic keyword-based sentiment analysis of a short text. Paid via x402.",
    inputShape,
    paid(async args => {
      const result = score(args.text);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }),
  );
  return server;
}

const app = express();
app.use(express.json());

// One transport per MCP session, kept alive across requests -- a fresh
// transport per POST would never see the client's `initialize` call before
// the follow-up `notifications/initialized`, and the SDK rejects that as
// "Server not initialized".
const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  const existing = typeof sessionId === "string" ? transports.get(sessionId) : undefined;
  if (existing) {
    await existing.handleRequest(req, res, req.body);
    return;
  }
  const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: id => { transports.set(id, transport); },
    onsessionclosed: id => { transports.delete(id); },
  });
  const server = buildServer();
  await server.connect(transport as Parameters<typeof server.connect>[0]);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, () => {
  console.log(`example seller listening on :${PORT}, tool=${TOOL_NAME}, network=${NETWORK}, facilitator=${FACILITATOR_URL}`);
});
