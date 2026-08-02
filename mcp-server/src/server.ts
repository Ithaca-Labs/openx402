import pg from "pg";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { FacilitatorClient } from "./facilitatorClient.js";
import { registerTools, type ToolDeps } from "./tools/index.js";
import { MemoryBudgetStore } from "./budget/memoryBudgetStore.js";
import { PostgresBudgetStore } from "./budget/postgresBudgetStore.js";
import { EncryptedKeyProvider, EnvSecretSignerProvider, ExternalSignerProvider, type SignerProvider } from "./payment/signerProvider.js";
import { SingleRetryGuard } from "./payment/paymentIdentifier.js";
import { migrate } from "./db/migrate.js";
import { createHttpApp } from "./http/server.js";
import type { McpConnectionConfig } from "./network/mcpConnection.js";

const SERVER_INFO = { name: "openx402-mcp-server", version: "0.1.0" };

function buildSignerProvider(config: ReturnType<typeof loadConfig>): SignerProvider | undefined {
  switch (config.signer.mode) {
    case "none":
      return undefined;
    case "env-secret":
      return new EnvSecretSignerProvider(config.signer.secret_env);
    case "external": {
      const authHeader = config.signer.auth_header_env ? process.env[config.signer.auth_header_env] : undefined;
      return new ExternalSignerProvider(config.signer.base_url, authHeader);
    }
    case "encrypted-key":
      return new EncryptedKeyProvider(config.signer.keystore_path, config.signer.encryption_key_env);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const facilitatorClient = new FacilitatorClient(config.facilitatorBaseUrl, config.facilitatorTimeoutMs);
  const signerProvider = buildSignerProvider(config);

  let budgetStore;
  if (config.budget.store === "postgres") {
    const pool = new pg.Pool({ connectionString: config.budget.databaseUrl });
    await migrate(pool);
    budgetStore = new PostgresBudgetStore(pool);
  } else {
    budgetStore = new MemoryBudgetStore();
  }

  const mcpConnectionConfig: McpConnectionConfig = {
    allowInsecureLocal: config.networkSecurity.allowInsecureLocal,
    maxResponseBytes: config.networkSecurity.maxResponseBytes,
    timeoutMs: config.networkSecurity.timeoutMs,
    maxRedirects: config.networkSecurity.maxRedirects,
    resolvedMcpEndpoints: config.networkSecurity.resolvedMcpEndpoints,
  };

  const deps: ToolDeps = {
    facilitatorClient,
    budgetStore,
    config,
    retryGuard: new SingleRetryGuard(),
    mcpConnectionConfig,
    ...(signerProvider ? { signerProvider } : {}),
  };

  if (config.transport === "stdio") {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    registerTools(server, deps, { agentId: "stdio-local" });
    await server.connect(new StdioServerTransport());
    return;
  }

  const app = createHttpApp(config, deps);
  app.listen(config.httpPort, "::", () => {
    console.log(`openx402 mcp-server listening on :${config.httpPort} (transport=${config.transport})`);
  });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
