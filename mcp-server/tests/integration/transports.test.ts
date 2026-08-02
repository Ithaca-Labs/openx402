import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client as MCPClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FakeFacilitator, type FakeResource } from "../helpers/fakeFacilitator.js";
import type { AppConfig } from "../../src/config.js";
import { createHttpApp } from "../../src/http/server.js";
import { FacilitatorClient } from "../../src/facilitatorClient.js";
import { MemoryBudgetStore } from "../../src/budget/memoryBudgetStore.js";
import { SingleRetryGuard } from "../../src/payment/paymentIdentifier.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "../../dist/src/server.js");

const SENTIMENT: FakeResource = {
  resource: "https://api.example.com/mcp", type: "mcp", x402Version: 2, lastUpdated: "2026-01-01T00:00:00.000Z",
  description: "Runs sentiment analysis.",
  accepts: [{ scheme: "exact", network: "stellar:testnet", asset: "CASSET", amount: "10000", payTo: "GPAYTO", maxTimeoutSeconds: 60, extra: { areFeesSponsored: true } }],
  extensions: { bazaar: { info: { input: { type: "mcp", toolName: "sentiment", inputSchema: { type: "object" } } } } },
};

describe("stdio transport smoke test", () => {
  let facilitator: FakeFacilitator;
  let configDir: string;
  let configPath: string;

  beforeAll(async () => {
    facilitator = new FakeFacilitator();
    await facilitator.start();
    facilitator.resources = [SENTIMENT];
    configDir = await mkdtemp(join(tmpdir(), "mcp-server-stdio-"));
    configPath = join(configDir, "config.yaml");
    await writeFile(configPath, `
facilitator:
  base_url: ${facilitator.baseUrl}
  request_timeout_ms: 5000
transport: stdio
signer:
  mode: none
networks:
  stellar:testnet:
    enabled: true
  stellar:pubnet:
    enabled: false
budget:
  store: memory
network_security:
  allow_insecure_local: true
`);
  });
  afterAll(async () => {
    await facilitator.stop();
    await rm(configDir, { recursive: true, force: true });
  });

  it("discovery-only stdio server: initializes, lists two tools, and finds a cataloged resource", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      env: { ...(process.env as Record<string, string>), MCP_SERVER_CONFIG: configPath },
    });
    const client = new MCPClient({ name: "smoke-test", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport as Parameters<typeof client.connect>[0]);

    const tools = await client.listTools();
    expect(tools.tools.map(t => t.name).sort()).toEqual(["x402_get_resource", "x402_search_resources"]);

    const result = await client.callTool({ name: "x402_search_resources", arguments: { query: "sentiment" } });
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as { resources: unknown[] };
    expect(payload.resources).toHaveLength(1);

    await client.close();
  }, 15_000);
});

describe("Streamable HTTP transport smoke test", () => {
  let facilitator: FakeFacilitator;
  let app: import("express").Express;
  let httpServer: import("node:http").Server;
  let baseUrl: string;

  beforeEach(async () => {
    facilitator = new FakeFacilitator();
    await facilitator.start();
    facilitator.resources = [SENTIMENT];

    // AppConfig is a plain interface -- built directly here rather than
    // through loadConfig()'s YAML+env path, since this test only needs a
    // discovery-only (no signer) HTTP deployment.
    const config: AppConfig = {
      facilitatorBaseUrl: facilitator.baseUrl, facilitatorTimeoutMs: 5000, transport: "streamable-http",
      httpPort: 0, httpApiKeys: [], signer: { mode: "none" },
      networks: { testnet: true, pubnet: false },
      budget: { store: "memory", defaultPerCallMaxAtomic: 1_000_000n, defaultSessionOrDayMaxAtomic: 1_000_000n },
      networkSecurity: { allowInsecureLocal: true, maxResponseBytes: 1_048_576, timeoutMs: 5000, maxRedirects: 3, maxConcurrentConnections: 5, resolvedMcpEndpoints: {} },
    };

    app = createHttpApp(config, {
      facilitatorClient: new FacilitatorClient(config.facilitatorBaseUrl, config.facilitatorTimeoutMs),
      budgetStore: new MemoryBudgetStore(),
      config,
      retryGuard: new SingleRetryGuard(),
      mcpConnectionConfig: config.networkSecurity,
    });
    await new Promise<void>(resolve => {
      httpServer = app.listen(0, "127.0.0.1", () => resolve());
    });
    const address = httpServer!.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    httpServer.closeAllConnections();
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
    await facilitator.stop();
  });

  it("exposes /healthz distinguishing discovery-only from payment-ready", async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    const body = await response.json();
    expect(body).toMatchObject({ status: "ok", discovery: "ready", payments: "disabled" });
  });

  it("serves tools/list and x402_search_resources over Streamable HTTP with no auth required (discovery-only)", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    const client = new MCPClient({ name: "smoke-test-http", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport as Parameters<typeof client.connect>[0]);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map(t => t.name).sort()).toEqual(["x402_get_resource", "x402_search_resources"]);

      const result = await client.callTool({ name: "x402_search_resources", arguments: { query: "sentiment" } });
      const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as { resources: unknown[] };
      expect(payload.resources).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  it("rejects invalid discovery arguments at the schema layer", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    const client = new MCPClient({ name: "smoke-test-invalid-args", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport as Parameters<typeof client.connect>[0]);
    try {
      const result = await client.callTool({
        name: "x402_search_resources",
        arguments: { query: "sentiment", limit: 0 },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0]!.text;
      expect(text).toMatch(/greater than 0|positive/i);
    } finally {
      await client.close();
    }
  });
});
