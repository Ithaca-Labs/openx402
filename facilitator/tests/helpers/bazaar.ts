import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { bazaar, type BazaarMetadata } from "@openx402/bazaar-sdk";
import type { AnalyticsConfig, CatalogConfig, DiscoveryConfig, SearchConfig } from "../../src/types.js";

export const SELLER = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
export const RIVAL_SELLER = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
export const ASSET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

export function catalogConfig(overrides: Partial<CatalogConfig> = {}): CatalogConfig {
  return {
    autoCatalog: true,
    indexOn: "verified",
    requireValidSchema: true,
    duplicateChanged: "version_and_verify",
    staleAfterHours: 168,
    maxMetadataBytes: 131_072,
    maxDescriptionLength: 4_000,
    maxSchemaBytes: 65_536,
    maxExampleBytes: 16_384,
    maxJsonDepth: 32,
    maxTags: 5,
    maxTagLength: 32,
    maxIconUrlLength: 2_048,
    maxServiceNameLength: 32,
    maxRouteTemplateLength: 512,
    fetchIcons: false,
    requireHttpsOrigins: true,
    allowLocalOrigins: false,
    inactiveVersionRetentionDays: 365,
    observationRetentionDays: 90,
    ...overrides,
  };
}

export function discoveryConfig(overrides: Partial<DiscoveryConfig> = {}): DiscoveryConfig {
  return {
    enabled: true,
    defaultPageSize: 20,
    maxPageSize: 50,
    cursorTtlMinutes: 15,
    includeStale: false,
    includeUnverified: false,
    cursorHmacKey: Buffer.alloc(32, 7),
    ...overrides,
  };
}

/**
 * Search configuration for tests. Semantic and reranking default to the
 * deterministic fake providers so the whole pipeline is exercised without
 * downloading weights or reaching a network.
 */
export function searchConfig(overrides: Partial<SearchConfig> = {}): SearchConfig {
  return {
    lexical: { enabled: true, language: "simple", weight: 0.35, candidateCount: 100 },
    semantic: {
      enabled: true, provider: "fake", modelId: "fake/deterministic-hash", repo: "",
      revision: "v1", dimension: 64, pooling: "mean", normalization: "l2",
      weight: 0.65, timeoutMs: 500, candidateCount: 100,
    },
    reranking: {
      enabled: false, provider: "fake", modelId: "fake/token-overlap", repo: "",
      revision: "v1", topK: 30, timeoutMs: 800, fallbackToHybrid: true,
    },
    rrfK: 60,
    minimumRelevanceScore: 0,
    defaultResultLimit: 20,
    maximumResultLimit: 50,
    originDiversityLimit: 3,
    impressions: { enabled: true, retainQueryText: true, retentionDays: 90 },
    models: { cacheDir: ".models", offline: true, dtype: "q8", requirePinnedRevision: false },
    indexing: {
      batchSize: 8, workerConcurrency: 1, pollMs: 50, leaseMs: 5_000,
      maxAttempts: 3, backoffBaseMs: 10, backoffMaxMs: 100, reindexSchedule: "manual",
    },
    ...overrides,
  };
}

export function analyticsConfig(overrides: Partial<AnalyticsConfig> = {}): AnalyticsConfig {
  return { enabled: true, defaultPageSize: 50, maxPageSize: 200, redactAddresses: false, ...overrides };
}

export function requirements(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: "stellar:testnet",
    asset: ASSET,
    amount: "10000",
    payTo: SELLER,
    maxTimeoutSeconds: 60,
    extra: {},
    ...overrides,
  } as PaymentRequirements;
}

/** The metadata a well-behaved weather seller declares through the SDK. */
export function weatherMetadata() {
  return bazaar.http({
    description: "Returns the current weather for a city.",
    serviceName: "Weather API",
    tags: ["weather", "forecast"],
    iconUrl: "https://api.example.com/icon.png",
    mimeType: "application/json",
    method: "GET",
    query: {
      city: { type: "string", description: "City to look up.", required: true, example: "Mumbai" },
    },
    output: { type: "json", example: { city: "Mumbai", temperature: 29 } },
  });
}

export function mcpMetadata(toolName: string) {
  return bazaar.mcp({
    toolName,
    description: `Runs ${toolName}.`,
    transport: "streamable-http",
    serviceName: "Finance Tools",
    inputSchema: {
      type: "object",
      properties: { ticker: { type: "string", description: "Ticker symbol." } },
      required: ["ticker"],
    },
    example: { ticker: "AAPL" },
  });
}

export interface PayloadOptions {
  url?: string;
  metadata?: BazaarMetadata;
  extensionOverride?: unknown;
  routeTemplate?: string;
  resourceOverride?: Record<string, unknown>;
  extraExtensions?: Record<string, unknown>;
}

/** Builds the client-echoed PaymentPayload a facilitator actually receives. */
export function payload(options: PayloadOptions = {}): PaymentPayload {
  const metadata = options.metadata ?? weatherMetadata();
  const extension = options.extensionOverride !== undefined
    ? options.extensionOverride
    : options.routeTemplate
      ? { ...(metadata.extensions.bazaar as object), routeTemplate: options.routeTemplate }
      : metadata.extensions.bazaar;
  return {
    x402Version: 2,
    resource: {
      url: options.url ?? "https://api.example.com/weather",
      ...metadata.resource,
      ...options.resourceOverride,
    },
    accepted: requirements(),
    payload: { transaction: "AAAA" },
    extensions: { bazaar: extension, ...options.extraExtensions },
  } as unknown as PaymentPayload;
}
