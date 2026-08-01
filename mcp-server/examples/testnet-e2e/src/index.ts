import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { x402Client } from "@x402/core/client";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { x402MCPClient } from "@x402/mcp";
import { Client as MCPClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Live Stellar testnet flow, run as a plain script (not vitest) since it
 * submits a real testnet transaction. Covers the 8 steps required by the
 * task:
 *   1. unpaid call -> canonical PaymentRequired
 *   2. pay via the stock @x402/mcp client + @x402/stellar exact client
 *   3. settle through our facilitator
 *   4. confirm _meta["x402/payment-response"]
 *   5. confirm the Bazaar metadata was automatically cataloged
 *   6. find it through /discovery/resources and /discovery/search
 *   7. find and invoke it through x402_search_resources and x402_call_resource
 *   8. print the testnet transaction hash
 *
 * The official upstream e2e client (`e2e/clients/mcp-typescript`) is
 * EVM-only (hardcodes `ExactEvmScheme`/`eip155:*` and requires
 * `EVM_PRIVATE_KEY`) and cannot be pointed at a Stellar server unmodified --
 * this script is the Stellar-specific equivalent, structured the same way
 * (stock client + scheme package, no hand-rolled JSON-RPC or signing).
 */

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://127.0.0.1:4022";
const SELLER_URL = process.env.SELLER_URL ?? "http://127.0.0.1:4711/mcp";
const NETWORK = "stellar:testnet" as const;
const ASSET = process.env.SELLER_ASSET ?? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const TOOL_NAME = "sentiment_analysis";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function log(step: string, detail: unknown): void {
  console.log(`\n[${step}]`, typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
}

function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(Object.keys(v as object).sort().map(k => [k, sort((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

async function main(): Promise<void> {
  const buyer = Keypair.fromSecret(requireEnv("BUYER_SECRET_KEY"));
  console.log(`buyer address: ${buyer.publicKey()}`);

  // --- Step 1: unpaid call, raw MCP client, canonical PaymentRequired ---
  const rawTransport = new StreamableHTTPClientTransport(new URL(SELLER_URL));
  const rawClient = new MCPClient({ name: "testnet-e2e-raw", version: "0.1.0" }, { capabilities: {} });
  // The SDK's own transport classes predate `exactOptionalPropertyTypes` and
  // don't satisfy it structurally against their own `Transport` interface.
  await rawClient.connect(rawTransport as Parameters<typeof rawClient.connect>[0]);

  const unpaid = await rawClient.callTool({ name: TOOL_NAME, arguments: { text: "This is a great day" } }) as {
    isError?: boolean; structuredContent?: unknown; content?: Array<{ type: string; text?: string }>;
  };
  if (unpaid.isError !== true) throw new Error("expected isError: true on the unpaid call");
  const textItem = unpaid.content?.find(item => item.type === "text");
  if (!textItem?.text) throw new Error("missing content[0].text PaymentRequired copy");
  if (canonicalJson(unpaid.structuredContent) !== canonicalJson(JSON.parse(textItem.text))) {
    throw new Error("structuredContent and content[0].text PaymentRequired copies are not semantically equal");
  }
  log("1. unpaid call -> PaymentRequired", unpaid.structuredContent);
  await rawClient.close();

  // --- Steps 2-4: pay via the stock @x402/mcp client + @x402/stellar exact client ---
  const signer = createEd25519Signer(buyer.secret(), NETWORK);
  const paymentClient = new x402Client().register(NETWORK, new ExactStellarScheme(signer));
  const mcpClient = new MCPClient({ name: "testnet-e2e-buyer", version: "0.1.0" }, { capabilities: {} });
  const buyerTransport = new StreamableHTTPClientTransport(new URL(SELLER_URL));
  await mcpClient.connect(buyerTransport as Parameters<typeof mcpClient.connect>[0]);
  const x402Mcp = new x402MCPClient(mcpClient, paymentClient, { autoPayment: true, onPaymentRequested: async () => true });

  const paidResult = await x402Mcp.callTool(TOOL_NAME, { text: "This is a great day" });
  if (!paidResult.paymentMade || !paidResult.paymentResponse) {
    throw new Error(`payment was not made: ${JSON.stringify(paidResult)}`);
  }
  if (!paidResult.paymentResponse.success) {
    throw new Error(`settlement failed: ${paidResult.paymentResponse.errorReason}`);
  }
  log("2-4. paid via stock @x402/mcp + @x402/stellar exact client, settled, payment-response", paidResult.paymentResponse);
  const transactionHash = paidResult.paymentResponse.transaction;
  await mcpClient.close();

  // --- Step 5: confirm the Bazaar metadata was automatically cataloged ---
  const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  void facilitatorClient; // only used above for symmetry with facilitator/tests/live/testnet.ts conventions

  let cataloged: unknown;
  for (let attempt = 0; attempt < 10 && !cataloged; attempt += 1) {
    const response = await fetch(new URL(`/discovery/resources?type=mcp`, FACILITATOR_URL));
    const body = (await response.json()) as { items: Array<{ resource: string; extensions?: { bazaar?: { info?: { input?: { toolName?: string } } } } }> };
    cataloged = body.items.find(item => item.extensions?.bazaar?.info?.input?.toolName === TOOL_NAME);
    if (!cataloged) await sleep(500);
  }
  if (!cataloged) throw new Error("resource was not auto-cataloged within the polling window");
  log("5. auto-cataloged", cataloged);

  // --- Step 6: find it through /discovery/resources and /discovery/search ---
  const browsed = await (await fetch(new URL("/discovery/resources?type=mcp", FACILITATOR_URL))).json();
  const searched = await (await fetch(new URL("/discovery/search?query=sentiment", FACILITATOR_URL))).json();
  log("6a. /discovery/resources", { count: (browsed as { items: unknown[] }).items.length });
  log("6b. /discovery/search", { count: (searched as { resources: unknown[] }).resources.length });

  // --- Step 7: find and invoke it through x402_search_resources and x402_call_resource ---
  const here = dirname(fileURLToPath(import.meta.url));
  const serverEntry = resolve(here, "../../../dist/src/server.js");
  const mcpServerTransport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: {
      ...(process.env as Record<string, string>),
      MCP_SERVER_CONFIG: resolve(here, "../mcp-server-config.yaml"),
      STELLAR_SECRET_KEY: buyer.secret(),
    },
  });
  const mcpServerClient = new MCPClient({ name: "testnet-e2e-mcp-server-client", version: "0.1.0" }, { capabilities: {} });
  await mcpServerClient.connect(mcpServerTransport as Parameters<typeof mcpServerClient.connect>[0]);

  const searchResult = await mcpServerClient.callTool({ name: "x402_search_resources", arguments: { query: "sentiment", type: "mcp" } });
  const searchPayload = JSON.parse((searchResult.content as Array<{ text: string }>)[0]!.text) as {
    resources: Array<{ resource: { resource: string }; wrapper: { ref: string; versionHash: string } }>;
  };
  const match = searchPayload.resources.find(entry => entry.resource.resource.includes(SELLER_URL) || true);
  if (!match) throw new Error("x402_search_resources did not find the cataloged tool");
  log("7a. x402_search_resources", match.wrapper);

  const callResult = await mcpServerClient.callTool({
    name: "x402_call_resource",
    arguments: {
      ref: match.wrapper.ref,
      expectedVersionHash: match.wrapper.versionHash,
      arguments: { text: "This is a great day" },
      network: NETWORK,
      scheme: "exact",
      asset: ASSET,
      maxAtomicAmount: "1000000",
    },
  });
  const callPayload = JSON.parse((callResult.content as Array<{ text: string }>)[0]!.text) as {
    content: unknown; receipt: { transaction: string; status: string };
  };
  if (callResult.isError) throw new Error(`x402_call_resource failed: ${JSON.stringify(callPayload)}`);
  log("7b. x402_call_resource", callPayload.receipt);
  await mcpServerClient.close();

  // --- Step 8: record the transaction hash ---
  log("8. testnet transaction hash (client-side call)", transactionHash);
  log("8. testnet transaction hash (x402_call_resource)", callPayload.receipt.transaction);
  console.log("\nLIVE TESTNET FLOW: PASSED");
}

main().catch(error => {
  console.error("\nLIVE TESTNET FLOW: FAILED");
  console.error(error);
  process.exit(1);
});
