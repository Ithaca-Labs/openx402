import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type {
  AnalyticsConfig, AppConfig, CatalogConfig, DiscoveryConfig,
  FeeProfile, NetworkConfig, SearchConfig, StellarNetwork,
} from "./types.js";

const feeSchema = z.object({
  max_resource_fee_stroops: z.union([z.string(), z.number().int().positive()]),
  max_inclusion_fee_stroops: z.union([z.string(), z.number().int().positive()]),
  max_total_fee_stroops: z.union([z.string(), z.number().int().positive()]),
});

const networkSchema = z.object({
  enabled: z.boolean().default(false),
  rpc_url: z.string().url(),
  horizon_url: z.string().url(),
  friendbot_url: z.string().url().optional(),
  development_auto_fund: z.boolean().default(false),
  channel_account_count: z.number().int().min(1).max(100).default(10),
  channel_min_balance_stroops: z.union([z.string(), z.number().int().positive()]).default("50000000"),
  sponsor_secret_env: z.string().optional(),
  channel_secrets_env: z.string().optional(),
  upto_contract: z.string().regex(/^C[A-Z2-7]{55}$/).optional(),
  upto_contract_env: z.string().optional(),
  fee_ceilings_calibrated: z.boolean().default(false),
  allowed_settlement_hooks: z.array(z.string().regex(/^C[A-Z2-7]{55}$/)).default([]),
  max_timeout_seconds: z.number().int().positive().max(2_000_000).default(300),
  assets: z.array(z.object({
    contract: z.string().regex(/^C[A-Z2-7]{55}$/),
    symbol: z.string().min(1),
    decimals: z.number().int().min(0).max(18),
    max_payment: z.union([z.string(), z.number().int().positive()]),
  })).min(1),
  fees: z.object({ exact: feeSchema, upto: feeSchema }),
});

const indexingSchema = z.object({
  auto_catalog: z.boolean().default(true),
  index_on: z.enum(["verified", "settled"]).default("verified"),
  require_valid_schema: z.boolean().default(true),
  duplicate_changed: z.enum(["version_and_verify", "reject"]).default("version_and_verify"),
  stale_after_hours: z.number().int().positive().max(87_600).default(168),
  max_metadata_bytes: z.number().int().positive().max(4_194_304).default(131_072),
  max_description_length: z.number().int().positive().max(65_536).default(4_000),
  max_schema_bytes: z.number().int().positive().max(1_048_576).default(65_536),
  max_example_bytes: z.number().int().positive().max(1_048_576).default(16_384),
  max_json_depth: z.number().int().positive().max(64).default(32),
  max_tags: z.number().int().positive().max(5).default(5),
  max_tag_length: z.number().int().positive().max(32).default(32),
  max_icon_url_length: z.number().int().positive().max(2048).default(2048),
  max_service_name_length: z.number().int().positive().max(32).default(32),
  max_route_template_length: z.number().int().positive().max(2048).default(512),
  fetch_icons: z.literal(false).default(false),
  inactive_version_retention_days: z.number().int().positive().default(365),
  catalog_observation_retention_days: z.number().int().positive().default(90),
}).default({});

const catalogSecuritySchema = z.object({
  require_https_origins: z.boolean().default(true),
  allow_local_origins: z.boolean().default(false),
}).default({});

const discoverySchema = z.object({
  enabled: z.boolean().default(true),
  default_page_size: z.number().int().positive().max(200).default(20),
  max_page_size: z.number().int().positive().max(200).default(50),
  cursor_ttl_minutes: z.number().int().positive().max(1440).default(15),
  include_stale: z.boolean().default(false),
  include_unverified: z.boolean().default(false),
  cursor_hmac_key_env: z.string().default("FACILITATOR_CURSOR_HMAC_KEY"),
}).default({});

const providerKind = z.enum(["disabled", "local", "remote", "fake"]);

const searchSchema = z.object({
  lexical: z.object({
    enabled: z.boolean().default(true),
    language: z.string().min(1).default("simple"),
    weight: z.number().min(0).max(1).default(0.7),
    candidate_count: z.number().int().positive().max(1000).default(250),
  }).default({}),
  semantic: z.object({
    enabled: z.boolean().default(true),
    provider: providerKind.default("local"),
    model: z.string().min(1).default("BAAI/bge-m3"),
    repo: z.string().default("Xenova/bge-m3"),
    revision: z.string().default("4de13258303883538bd53b696b452bf8099f0858"),
    dimension: z.number().int().min(1).max(16_000).default(1024),
    pooling: z.enum(["cls", "mean"]).default("cls"),
    normalization: z.enum(["l2", "none"]).default("l2"),
    weight: z.number().min(0).max(1).default(0.3),
    timeout_ms: z.number().int().positive().max(60_000).default(500),
    candidate_count: z.number().int().positive().max(1000).default(250),
    max_distance: z.number().min(0).max(2).default(0.9),
    remote_url_env: z.string().default("FACILITATOR_EMBEDDING_URL"),
    remote_api_key_env: z.string().default("FACILITATOR_EMBEDDING_API_KEY"),
  }).default({}),
  reranking: z.object({
    enabled: z.boolean().default(false),
    provider: providerKind.default("local"),
    model: z.string().min(1).default("BAAI/bge-reranker-v2-m3"),
    // Empty by default: no ONNX export of the default model is published for the
    // local runtime. See docs/SEARCH.md.
    repo: z.string().default(""),
    revision: z.string().default("953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e"),
    top_k: z.number().int().positive().max(500).default(30),
    timeout_ms: z.number().int().positive().max(60_000).default(800),
    fallback_to_hybrid: z.boolean().default(true),
    remote_url_env: z.string().default("FACILITATOR_RERANKER_URL"),
    remote_api_key_env: z.string().default("FACILITATOR_RERANKER_API_KEY"),
  }).default({}),
  rrf_k: z.number().int().positive().max(10_000).default(20),
  minimum_relevance_score: z.number().min(0).default(0),
  // When omitted these inherit the discovery page sizes, so browse and search
  // agree unless an operator deliberately separates them.
  default_result_limit: z.number().int().positive().max(200).optional(),
  maximum_result_limit: z.number().int().positive().max(200).optional(),
  origin_diversity_limit: z.number().int().positive().max(100).default(3),
  impressions: z.object({
    enabled: z.boolean().default(true),
    retain_query_text: z.boolean().default(false),
    retention_days: z.number().int().positive().max(3650).default(90),
  }).default({}),
  models: z.object({
    cache_dir: z.string().default(".models"),
    offline: z.boolean().default(false),
    dtype: z.string().default("q8"),
    require_pinned_revision: z.boolean().default(true),
  }).default({}),
  indexing: z.object({
    batch_size: z.number().int().positive().max(512).default(32),
    worker_concurrency: z.number().int().positive().max(16).default(1),
    poll_ms: z.number().int().positive().max(600_000).default(500),
    lease_ms: z.number().int().positive().max(600_000).default(30_000),
    max_attempts: z.number().int().positive().max(50).default(5),
    backoff_base_ms: z.number().int().positive().max(600_000).default(1_000),
    backoff_max_ms: z.number().int().positive().max(3_600_000).default(300_000),
    reindex_schedule: z.enum(["manual", "startup"]).default("manual"),
  }).default({}),
}).default({});

const analyticsSchema = z.object({
  enabled: z.boolean().default(true),
  default_page_size: z.number().int().positive().max(500).default(50),
  max_page_size: z.number().int().positive().max(500).default(200),
  redact_addresses: z.boolean().default(false),
}).default({});

const rawSchema = z.object({
  server: z.object({ port: z.number().int().min(1).max(65535).default(4022) }).default({}),
  database_url_env: z.string().default("DATABASE_URL"),
  api_keys_env: z.string().default("FACILITATOR_API_KEYS"),
  key_encryption_key_env: z.string().default("FACILITATOR_KEY_ENCRYPTION_KEY"),
  indexing: indexingSchema,
  catalog_security: catalogSecuritySchema,
  discovery: discoverySchema,
  search: searchSchema,
  analytics: analyticsSchema,
  limits: z.object({
    max_request_bytes: z.number().int().positive().default(262_144),
    max_concurrent_simulations: z.number().int().positive().default(20),
    max_simulations_per_key_per_minute: z.number().int().positive().default(30),
    max_sponsored_stroops_per_key_per_day: z.union([z.string(), z.number().int().positive()]).default("5000000"),
    max_global_sponsored_stroops_per_day: z.union([z.string(), z.number().int().positive()]).default("200000000"),
    max_pending_settlements: z.number().int().positive().default(1000),
    channel_lease_ms: z.number().int().positive().default(30_000),
    settle_poll_ms: z.number().int().positive().default(1_000),
    settle_timeout_ms: z.number().int().positive().default(30_000),
  }).default({}),
  networks: z.object({
    "stellar:testnet": networkSchema,
    "stellar:pubnet": networkSchema,
  }),
});

function fee(value: z.infer<typeof feeSchema>): FeeProfile {
  const result = {
    maxResourceFeeStroops: BigInt(value.max_resource_fee_stroops),
    maxInclusionFeeStroops: BigInt(value.max_inclusion_fee_stroops),
    maxTotalFeeStroops: BigInt(value.max_total_fee_stroops),
  };
  if (result.maxTotalFeeStroops < result.maxResourceFeeStroops + result.maxInclusionFeeStroops) {
    throw new Error("max_total_fee_stroops must cover resource plus inclusion ceilings");
  }
  return result;
}

function encryptionKey(envName: string): Buffer {
  const configured = process.env[envName];
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`${envName} is required in production`);
    }
    return createHash("sha256").update("x402-testnet-development-key-only").digest();
  }
  const decoded = Buffer.from(configured, "base64");
  if (decoded.length !== 32) throw new Error(`${envName} must be a base64-encoded 32-byte key`);
  return decoded;
}

function cursorKey(envName: string, encryptionKey: Buffer): Buffer {
  const configured = process.env[envName];
  if (!configured) {
    // Derived from shared key material so every replica signs identical cursors
    // without a second mandatory secret.
    return createHash("sha256").update("x402-discovery-cursor-v1\0").update(encryptionKey).digest();
  }
  const decoded = Buffer.from(configured, "base64");
  if (decoded.length < 32) throw new Error(`${envName} must be a base64-encoded 32-byte key`);
  return decoded;
}

function mapCatalog(
  indexing: z.infer<typeof indexingSchema>,
  security: z.infer<typeof catalogSecuritySchema>,
): CatalogConfig {
  return {
    autoCatalog: indexing.auto_catalog,
    indexOn: indexing.index_on,
    requireValidSchema: indexing.require_valid_schema,
    duplicateChanged: indexing.duplicate_changed,
    staleAfterHours: indexing.stale_after_hours,
    maxMetadataBytes: indexing.max_metadata_bytes,
    maxDescriptionLength: indexing.max_description_length,
    maxSchemaBytes: indexing.max_schema_bytes,
    maxExampleBytes: indexing.max_example_bytes,
    maxJsonDepth: indexing.max_json_depth,
    maxTags: indexing.max_tags,
    maxTagLength: indexing.max_tag_length,
    maxIconUrlLength: indexing.max_icon_url_length,
    maxServiceNameLength: indexing.max_service_name_length,
    maxRouteTemplateLength: indexing.max_route_template_length,
    fetchIcons: false,
    requireHttpsOrigins: security.require_https_origins,
    allowLocalOrigins: security.allow_local_origins,
    inactiveVersionRetentionDays: indexing.inactive_version_retention_days,
    observationRetentionDays: indexing.catalog_observation_retention_days,
  };
}

function mapDiscovery(value: z.infer<typeof discoverySchema>, encryptionKey: Buffer): DiscoveryConfig {
  if (value.default_page_size > value.max_page_size) {
    throw new Error("discovery.default_page_size must not exceed discovery.max_page_size");
  }
  return {
    enabled: value.enabled,
    defaultPageSize: value.default_page_size,
    maxPageSize: value.max_page_size,
    cursorTtlMinutes: value.cursor_ttl_minutes,
    includeStale: value.include_stale,
    includeUnverified: value.include_unverified,
    cursorHmacKey: cursorKey(value.cursor_hmac_key_env, encryptionKey),
  };
}

function mapSearch(value: z.infer<typeof searchSchema>, discovery: DiscoveryConfig): SearchConfig {
  const defaultLimit = value.default_result_limit ?? discovery.defaultPageSize;
  const maximumLimit = value.maximum_result_limit ?? discovery.maxPageSize;
  if (defaultLimit > maximumLimit) {
    throw new Error("search.default_result_limit must not exceed search.maximum_result_limit");
  }
  if (value.lexical.weight === 0 && value.semantic.weight === 0) {
    throw new Error("at least one of search.lexical.weight and search.semantic.weight must be positive");
  }
  const fakeAllowed = process.env.FACILITATOR_ALLOW_FAKE_PROVIDERS === "1";
  for (const [name, provider] of [["semantic", value.semantic.provider], ["reranking", value.reranking.provider]] as const) {
    if (provider === "fake" && !fakeAllowed) {
      throw new Error(`search.${name}.provider "fake" is only allowed when FACILITATOR_ALLOW_FAKE_PROVIDERS=1`);
    }
  }
  if (value.semantic.enabled && value.semantic.provider === "local"
      && value.models.require_pinned_revision && !/^[0-9a-f]{40}$/.test(value.semantic.revision)) {
    throw new Error("search.semantic.revision must be a full 40-character commit sha when models.require_pinned_revision is set");
  }
  const semanticUrl = process.env[value.semantic.remote_url_env];
  const semanticKey = process.env[value.semantic.remote_api_key_env];
  const rerankUrl = process.env[value.reranking.remote_url_env];
  const rerankKey = process.env[value.reranking.remote_api_key_env];
  if (value.semantic.enabled && value.semantic.provider === "remote" && !semanticUrl) {
    throw new Error(`${value.semantic.remote_url_env} is required for a remote embedding provider`);
  }
  if (value.reranking.enabled && value.reranking.provider === "remote" && !rerankUrl) {
    throw new Error(`${value.reranking.remote_url_env} is required for a remote reranker`);
  }
  return {
    lexical: {
      enabled: value.lexical.enabled,
      language: value.lexical.language,
      weight: value.lexical.weight,
      candidateCount: value.lexical.candidate_count,
    },
    semantic: {
      enabled: value.semantic.enabled,
      provider: value.semantic.provider,
      modelId: value.semantic.model,
      repo: value.semantic.repo,
      revision: value.semantic.revision,
      dimension: value.semantic.dimension,
      pooling: value.semantic.pooling,
      normalization: value.semantic.normalization,
      weight: value.semantic.weight,
      timeoutMs: value.semantic.timeout_ms,
      candidateCount: value.semantic.candidate_count,
      maxDistance: value.semantic.max_distance,
      ...(semanticUrl ? { remoteUrl: semanticUrl } : {}),
      ...(semanticKey ? { remoteApiKey: semanticKey } : {}),
    },
    reranking: {
      enabled: value.reranking.enabled,
      provider: value.reranking.provider,
      modelId: value.reranking.model,
      repo: value.reranking.repo,
      revision: value.reranking.revision,
      topK: value.reranking.top_k,
      timeoutMs: value.reranking.timeout_ms,
      fallbackToHybrid: value.reranking.fallback_to_hybrid,
      ...(rerankUrl ? { remoteUrl: rerankUrl } : {}),
      ...(rerankKey ? { remoteApiKey: rerankKey } : {}),
    },
    rrfK: value.rrf_k,
    minimumRelevanceScore: value.minimum_relevance_score,
    defaultResultLimit: defaultLimit,
    maximumResultLimit: maximumLimit,
    originDiversityLimit: value.origin_diversity_limit,
    impressions: {
      enabled: value.impressions.enabled,
      retainQueryText: value.impressions.retain_query_text,
      retentionDays: value.impressions.retention_days,
    },
    models: {
      cacheDir: value.models.cache_dir,
      offline: value.models.offline,
      dtype: value.models.dtype,
      requirePinnedRevision: value.models.require_pinned_revision,
    },
    indexing: {
      batchSize: value.indexing.batch_size,
      workerConcurrency: value.indexing.worker_concurrency,
      pollMs: value.indexing.poll_ms,
      leaseMs: value.indexing.lease_ms,
      maxAttempts: value.indexing.max_attempts,
      backoffBaseMs: value.indexing.backoff_base_ms,
      backoffMaxMs: value.indexing.backoff_max_ms,
      reindexSchedule: value.indexing.reindex_schedule,
    },
  };
}

function mapAnalytics(value: z.infer<typeof analyticsSchema>): AnalyticsConfig {
  if (value.default_page_size > value.max_page_size) {
    throw new Error("analytics.default_page_size must not exceed analytics.max_page_size");
  }
  return {
    enabled: value.enabled,
    defaultPageSize: value.default_page_size,
    maxPageSize: value.max_page_size,
    redactAddresses: value.redact_addresses,
  };
}

function mapNetwork(id: StellarNetwork, value: z.infer<typeof networkSchema>): NetworkConfig {
  if (id === "stellar:pubnet" && value.development_auto_fund) {
    throw new Error("development_auto_fund is forbidden on stellar:pubnet");
  }
  const sponsorSecret = value.sponsor_secret_env ? process.env[value.sponsor_secret_env] : undefined;
  const channelSecrets = value.channel_secrets_env
    ? (process.env[value.channel_secrets_env] ?? "").split(",").map(v => v.trim()).filter(Boolean)
    : [];
  const uptoContract = value.upto_contract
    ?? (value.upto_contract_env ? process.env[value.upto_contract_env] : undefined);
  if (uptoContract && !/^C[A-Z2-7]{55}$/.test(uptoContract)) {
    throw new Error(`${id} upto contract must be a valid Stellar contract address`);
  }
  if (value.enabled && !value.fee_ceilings_calibrated) {
    throw new Error(`${id} fee ceilings must be calibrated from measured p99 settlement costs before enabling`);
  }
  if (id === "stellar:pubnet" && value.enabled && !uptoContract) {
    throw new Error("stellar:pubnet requires an audited upto settlement contract before enabling both schemes");
  }
  return {
    id,
    enabled: value.enabled,
    rpcUrl: value.rpc_url,
    horizonUrl: value.horizon_url,
    ...(value.friendbot_url ? { friendbotUrl: value.friendbot_url } : {}),
    developmentAutoFund: value.development_auto_fund,
    channelAccountCount: value.channel_account_count,
    channelMinBalanceStroops: BigInt(value.channel_min_balance_stroops),
    ...(sponsorSecret ? { sponsorSecret } : {}),
    channelSecrets,
    ...(uptoContract ? { uptoContract } : {}),
    allowedAssets: new Map(value.assets.map(asset => [asset.contract, {
      symbol: asset.symbol,
      decimals: asset.decimals,
      maxPayment: BigInt(asset.max_payment),
    }])),
    allowedSettlementHooks: new Set(value.allowed_settlement_hooks),
    maxTimeoutSeconds: value.max_timeout_seconds,
    exactFee: fee(value.fees.exact),
    uptoFee: fee(value.fees.upto),
  };
}

export function loadConfig(path = process.env.FACILITATOR_CONFIG ?? "config/self-hosted.yaml"): AppConfig {
  const raw = rawSchema.parse(YAML.parse(readFileSync(resolve(path), "utf8")));
  const databaseUrl = process.env[raw.database_url_env];
  if (!databaseUrl) throw new Error(`${raw.database_url_env} is required`);
  const apiKeys = (process.env[raw.api_keys_env] ?? "").split(",").map(v => v.trim()).filter(Boolean);
  const networks = new Map<StellarNetwork, NetworkConfig>([
    ["stellar:testnet", mapNetwork("stellar:testnet", raw.networks["stellar:testnet"])],
    ["stellar:pubnet", mapNetwork("stellar:pubnet", raw.networks["stellar:pubnet"])],
  ]);
  if (![...networks.values()].some(network => network.enabled)) throw new Error("at least one network must be enabled");
  if (networks.get("stellar:pubnet")?.enabled && apiKeys.length === 0) {
    throw new Error("pubnet requires at least one facilitator API key");
  }
  const catalog = mapCatalog(raw.indexing, raw.catalog_security);
  const discovery = mapDiscovery(raw.discovery, encryptionKey(raw.key_encryption_key_env));
  if (networks.get("stellar:pubnet")?.enabled) {
    if (catalog.allowLocalOrigins) {
      throw new Error("catalog_security.allow_local_origins is forbidden while stellar:pubnet is enabled");
    }
    if (!catalog.requireHttpsOrigins) {
      throw new Error("catalog_security.require_https_origins is required while stellar:pubnet is enabled");
    }
    if (discovery.includeUnverified) {
      throw new Error("discovery.include_unverified is forbidden while stellar:pubnet is enabled");
    }
  }
  return {
    port: process.env.PORT ? z.coerce.number().int().min(1).max(65535).parse(process.env.PORT) : raw.server.port,
    databaseUrl,
    apiKeys,
    keyEncryptionKey: encryptionKey(raw.key_encryption_key_env),
    instanceId: process.env.FACILITATOR_INSTANCE_ID ?? `${hostname()}-${process.pid}-${randomBytes(4).toString("hex")}`,
    networks,
    catalog,
    discovery,
    search: mapSearch(raw.search, discovery),
    analytics: mapAnalytics(raw.analytics),
    limits: {
      maxRequestBytes: raw.limits.max_request_bytes,
      maxConcurrentSimulations: raw.limits.max_concurrent_simulations,
      maxSimulationsPerKeyPerMinute: raw.limits.max_simulations_per_key_per_minute,
      maxSponsoredStroopsPerKeyPerDay: BigInt(raw.limits.max_sponsored_stroops_per_key_per_day),
      maxGlobalSponsoredStroopsPerDay: BigInt(raw.limits.max_global_sponsored_stroops_per_day),
      maxPendingSettlements: raw.limits.max_pending_settlements,
      channelLeaseMs: raw.limits.channel_lease_ms,
      settlePollMs: raw.limits.settle_poll_ms,
      settleTimeoutMs: raw.limits.settle_timeout_ms,
    },
  };
}
