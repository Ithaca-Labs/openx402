import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { McpToolError } from "../errors.js";
import { createSsrfSafeFetch, type SafeFetchConfig, DEFAULT_SAFE_FETCH_CONFIG } from "./safeFetch.js";

export type McpTransportKind = "streamable-http" | "sse";

export interface McpConnectionConfig extends SafeFetchConfig {
  /**
   * Operator-configured map from a seller's symbolic `mcp://...` resource
   * identifier to a manually verified, real HTTPS endpoint. `mcp://`
   * identifiers are not connectable on their own -- the Bazaar extension
   * spec's own example resource is `mcp://tool/financial_analysis`, which
   * names a tool inside an already-established session, not a dialable
   * network address. Without an entry here, such a resource is rejected.
   */
  resolvedMcpEndpoints: Record<string, string>;
}

export const DEFAULT_MCP_CONNECTION_CONFIG: McpConnectionConfig = {
  ...DEFAULT_SAFE_FETCH_CONFIG,
  resolvedMcpEndpoints: {},
};

/**
 * Resolves a cataloged resource's `resource.url` to a physically connectable
 * transport URL. A real `https://` (or, in local dev, `http://`) URL is used
 * directly. A symbolic `mcp://` identifier is rejected unless the operator
 * has explicitly mapped it to a verified HTTPS endpoint.
 */
export function resolveConnectableEndpoint(resourceUrl: string, config: McpConnectionConfig): URL {
  let parsed: URL;
  try {
    parsed = new URL(resourceUrl);
  } catch {
    throw new McpToolError("INVALID_ARGUMENT", `resource url is not a valid URL: ${resourceUrl}`);
  }
  if (parsed.protocol === "https:" || (config.allowInsecureLocal && parsed.protocol === "http:")) {
    return parsed;
  }
  if (parsed.protocol === "mcp:") {
    const resolved = config.resolvedMcpEndpoints[resourceUrl];
    if (!resolved) {
      throw new McpToolError("UNTRUSTED_REDIRECT", `mcp:// logical identifier has no operator-verified HTTPS endpoint: ${resourceUrl}`);
    }
    const resolvedUrl = new URL(resolved);
    if (resolvedUrl.protocol !== "https:" && !(config.allowInsecureLocal && resolvedUrl.protocol === "http:")) {
      throw new McpToolError("UNTRUSTED_REDIRECT", `configured endpoint for ${resourceUrl} is not HTTPS`);
    }
    return resolvedUrl;
  }
  throw new McpToolError("UNTRUSTED_REDIRECT", `unsupported resource url scheme: ${parsed.protocol}`);
}

export interface BoundMcpClient {
  client: Client;
  close(): Promise<void>;
}

/**
 * Connects to a cataloged MCP endpoint over Streamable HTTP or SSE, with
 * every underlying request routed through the SSRF-hardened fetch. Only
 * `initialize` (performed by `connect`) and `tools/list` are ever invoked
 * here -- callers must never issue `tools/call` through this helper for a
 * liveness/catalog check, since a broken payment guard could execute the
 * tool for real.
 */
export async function connectMcpClient(
  endpoint: URL,
  transportKind: McpTransportKind,
  config: McpConnectionConfig,
  clientInfo: { name: string; version: string } = { name: "openx402-mcp-server", version: "0.1.0" },
): Promise<BoundMcpClient> {
  const fetchImpl = createSsrfSafeFetch(config);
  const transport = transportKind === "sse"
    ? new SSEClientTransport(endpoint, { fetch: fetchImpl })
    : new StreamableHTTPClientTransport(endpoint, { fetch: fetchImpl });

  const client = new Client({ name: clientInfo.name, version: clientInfo.version }, { capabilities: {} });
  try {
    // The SDK's own transport classes predate `exactOptionalPropertyTypes`
    // and don't satisfy it structurally against their own `Transport`
    // interface; the cast only works around that type-checker friction, not
    // a runtime mismatch.
    await client.connect(transport as Parameters<typeof client.connect>[0]);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new McpToolError("UPSTREAM_TIMEOUT", `connecting to ${endpoint.hostname} timed out`);
    }
    if (error instanceof McpToolError) throw error;
    throw new McpToolError("UPSTREAM_PROTOCOL_ERROR", `failed to connect to ${endpoint.hostname}: ${(error as Error).message}`);
  }
  return { client, close: () => client.close() };
}

/** `tools/list` only -- proves the tool and its input schema exist, never executes it. */
export async function listTools(bound: BoundMcpClient): Promise<Array<{ name: string; inputSchema?: unknown }>> {
  const result = await bound.client.listTools();
  return result.tools.map(tool => ({ name: tool.name, inputSchema: tool.inputSchema }));
}
