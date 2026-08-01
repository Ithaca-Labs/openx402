import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { McpToolError } from "./errors.js";

const transportSchema = z.enum(["stdio", "streamable-http", "sse"]);

const signerSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("env-secret"), secret_env: z.string().default("STELLAR_SECRET_KEY") }),
  z.object({
    mode: z.literal("external"),
    base_url: z.string().url(),
    auth_header_env: z.string().optional(),
  }),
  z.object({
    mode: z.literal("encrypted-key"),
    keystore_path: z.string(),
    encryption_key_env: z.string().default("MCP_SIGNER_ENCRYPTION_KEY"),
  }),
]);

const rawSchema = z.object({
  facilitator: z.object({
    base_url: z.string().url(),
    request_timeout_ms: z.number().int().positive().max(120_000).default(10_000),
  }),
  transport: transportSchema.default("stdio"),
  http: z.object({
    port: z.number().int().min(1).max(65535).default(4522),
    api_keys_env: z.string().default("MCP_SERVER_API_KEYS"),
  }).default({}),
  signer: signerSchema.default({ mode: "none" }),
  networks: z.object({
    "stellar:testnet": z.object({ enabled: z.boolean().default(true) }).default({}),
    "stellar:pubnet": z.object({ enabled: z.boolean().default(false) }).default({}),
  }).default({}),
  budget: z.object({
    store: z.enum(["memory", "postgres"]).default("memory"),
    database_url_env: z.string().default("DATABASE_URL"),
    default_per_call_max_atomic: z.string().default("1000000"),
    default_session_or_day_max_atomic: z.string().default("50000000"),
  }).default({}),
  network_security: z.object({
    allow_insecure_local: z.boolean().default(false),
    max_response_bytes: z.number().int().positive().default(8 * 1024 * 1024),
    timeout_ms: z.number().int().positive().default(15_000),
    max_redirects: z.number().int().min(0).max(10).default(3),
    max_concurrent_connections: z.number().int().positive().default(10),
    resolved_mcp_endpoints: z.record(z.string(), z.string().url()).default({}),
  }).default({}),
});

export type Transport = z.infer<typeof transportSchema>;
export type SignerConfig = z.infer<typeof signerSchema>;

export interface AppConfig {
  facilitatorBaseUrl: string;
  facilitatorTimeoutMs: number;
  transport: Transport;
  httpPort: number;
  httpApiKeys: string[];
  signer: SignerConfig;
  networks: { testnet: boolean; pubnet: boolean };
  budget: {
    store: "memory" | "postgres";
    databaseUrl?: string;
    defaultPerCallMaxAtomic: bigint;
    defaultSessionOrDayMaxAtomic: bigint;
  };
  networkSecurity: {
    allowInsecureLocal: boolean;
    maxResponseBytes: number;
    timeoutMs: number;
    maxRedirects: number;
    maxConcurrentConnections: number;
    resolvedMcpEndpoints: Record<string, string>;
  };
}

export function loadConfig(path = process.env.MCP_SERVER_CONFIG ?? "config/self-hosted.yaml"): AppConfig {
  const raw = rawSchema.parse(YAML.parse(readFileSync(resolve(path), "utf8")));

  const httpApiKeys = (process.env[raw.http.api_keys_env] ?? "").split(",").map(v => v.trim()).filter(Boolean);

  if (raw.transport !== "stdio" && raw.signer.mode === "env-secret") {
    throw new McpToolError(
      "INVALID_ARGUMENT",
      "signer.mode 'env-secret' is stdio-only; remote transports require 'external' or 'encrypted-key' plus authentication",
    );
  }
  if (raw.transport !== "stdio" && httpApiKeys.length === 0 && raw.signer.mode !== "none") {
    throw new McpToolError(
      "INVALID_ARGUMENT",
      `a signer is configured but ${raw.http.api_keys_env} has no keys; a remote transport must never run an anonymously accessible payment tool`,
    );
  }
  if (raw.networks["stellar:pubnet"].enabled) {
    if (raw.signer.mode === "none") {
      throw new McpToolError("INVALID_ARGUMENT", "stellar:pubnet is enabled but no signer is configured");
    }
    if (raw.transport !== "stdio" && httpApiKeys.length === 0) {
      throw new McpToolError("INVALID_ARGUMENT", "stellar:pubnet is enabled but the remote transport has no configured API keys");
    }
    if (raw.budget.store === "memory" && raw.transport !== "stdio") {
      throw new McpToolError("INVALID_ARGUMENT", "stellar:pubnet on a remote transport requires the postgres budget store");
    }
  }

  const databaseUrl = raw.budget.store === "postgres" ? process.env[raw.budget.database_url_env] : undefined;
  if (raw.budget.store === "postgres" && !databaseUrl) {
    throw new McpToolError("INVALID_ARGUMENT", `${raw.budget.database_url_env} is required when budget.store is 'postgres'`);
  }

  return {
    // FACILITATOR_URL overrides the YAML value -- e.g. Docker Compose points
    // it at the `facilitator` service's in-network DNS name.
    facilitatorBaseUrl: process.env.FACILITATOR_URL ?? raw.facilitator.base_url,
    facilitatorTimeoutMs: raw.facilitator.request_timeout_ms,
    transport: raw.transport,
    httpPort: process.env.PORT ? Number(process.env.PORT) : raw.http.port,
    httpApiKeys,
    signer: raw.signer,
    networks: { testnet: raw.networks["stellar:testnet"].enabled, pubnet: raw.networks["stellar:pubnet"].enabled },
    budget: {
      store: raw.budget.store,
      ...(databaseUrl ? { databaseUrl } : {}),
      defaultPerCallMaxAtomic: BigInt(raw.budget.default_per_call_max_atomic),
      defaultSessionOrDayMaxAtomic: BigInt(raw.budget.default_session_or_day_max_atomic),
    },
    networkSecurity: {
      allowInsecureLocal: raw.network_security.allow_insecure_local,
      maxResponseBytes: raw.network_security.max_response_bytes,
      timeoutMs: raw.network_security.timeout_ms,
      maxRedirects: raw.network_security.max_redirects,
      maxConcurrentConnections: raw.network_security.max_concurrent_connections,
      resolvedMcpEndpoints: raw.network_security.resolved_mcp_endpoints,
    },
  };
}
