/**
 * Retrieval evaluation CLI.
 *
 * Seeds a golden suite into a scratch schema, builds the index with the
 * configured provider, then runs the same request path three ways —
 * lexical-only, hybrid, and hybrid plus reranking — and reports recall@k, MRR,
 * nDCG@k, must-not-rank violations, latency, fallback rates and cold-start
 * coverage. Every profile is a `SearchConfig` override, so nothing here is a
 * parallel implementation of search.
 *
 *   npm run evaluate -- --suite tests/fixtures/search/golden-v1.json
 *   npm run evaluate -- --provider local --json reports/search.json
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { migrate } from "../db/migrate.js";
import { CatalogStore } from "../db/catalog.js";
import { SearchStore } from "../db/search.js";
import type { ProviderKind, SearchConfig } from "../types.js";
import { buildIndex, runProfile, seedSuite } from "../search/harness.js";
import { lift, type EvalSuite } from "../search/evaluate.js";
import { DEFAULT_CUTOFFS } from "../search/evaluate.js";

interface Options {
  suite: string;
  databaseUrl: string;
  provider: ProviderKind;
  reranker: ProviderKind;
  limit: number;
  json?: string;
  keep: boolean;
}

function parseArgs(argv: string[]): Options {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) continue;
    const [name, inline] = arg.slice(2).split("=", 2);
    flags.set(name!, inline ?? (argv[index + 1]?.startsWith("--") === false ? argv[++index]! : "true"));
  }
  return {
    suite: flags.get("suite") ?? "tests/fixtures/search/golden-v1.json",
    databaseUrl: flags.get("database-url")
      ?? process.env.TEST_DATABASE_URL
      ?? process.env.DATABASE_URL
      ?? "postgresql://postgres:test@127.0.0.1:55432/facilitator_test",
    provider: (flags.get("provider") ?? "fake") as ProviderKind,
    reranker: (flags.get("reranker") ?? "fake") as ProviderKind,
    limit: Number(flags.get("limit") ?? 10),
    ...(flags.get("json") ? { json: flags.get("json")! } : {}),
    keep: flags.get("keep") === "true",
  };
}

function baseSearchConfig(options: Options): SearchConfig {
  const localDefaults = {
    modelId: "BAAI/bge-m3", repo: "Xenova/bge-m3",
    revision: "4de13258303883538bd53b696b452bf8099f0858", dimension: 1024,
    pooling: "cls" as const, normalization: "l2" as const,
  };
  const fakeDefaults = {
    modelId: "fake/deterministic-hash", repo: "", revision: "v1", dimension: 64,
    pooling: "mean" as const, normalization: "l2" as const,
  };
  const semantic = options.provider === "local" ? localDefaults : fakeDefaults;
  return {
    lexical: { enabled: true, language: "simple", weight: 0.7, candidateCount: 250 },
    semantic: {
      enabled: options.provider !== "disabled",
      provider: options.provider,
      ...semantic,
      weight: 0.3,
      timeoutMs: options.provider === "local" ? 30_000 : 2_000,
      candidateCount: 250,
      maxDistance: 0.9,
      ...(process.env.FACILITATOR_EMBEDDING_URL ? { remoteUrl: process.env.FACILITATOR_EMBEDDING_URL } : {}),
      ...(process.env.FACILITATOR_EMBEDDING_API_KEY ? { remoteApiKey: process.env.FACILITATOR_EMBEDDING_API_KEY } : {}),
    },
    reranking: {
      enabled: false,
      provider: options.reranker,
      modelId: options.reranker === "fake" ? "fake/token-overlap" : "BAAI/bge-reranker-v2-m3",
      repo: "",
      revision: options.reranker === "fake" ? "v1" : "953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e",
      topK: 30, timeoutMs: 5_000, fallbackToHybrid: true,
      ...(process.env.FACILITATOR_RERANKER_URL ? { remoteUrl: process.env.FACILITATOR_RERANKER_URL } : {}),
      ...(process.env.FACILITATOR_RERANKER_API_KEY ? { remoteApiKey: process.env.FACILITATOR_RERANKER_API_KEY } : {}),
    },
    rrfK: 20,
    minimumRelevanceScore: 0,
    defaultResultLimit: options.limit,
    maximumResultLimit: Math.max(options.limit, 50),
    originDiversityLimit: 3,
    impressions: { enabled: false, retainQueryText: false, retentionDays: 1 },
    models: { cacheDir: ".models", offline: false, dtype: "q8", requirePinnedRevision: false },
    indexing: {
      batchSize: 16, workerConcurrency: 1, pollMs: 50, leaseMs: 30_000,
      maxAttempts: 3, backoffBaseMs: 50, backoffMaxMs: 500, reindexSchedule: "manual",
    },
  };
}

const CATALOG_CONFIG = {
  autoCatalog: true, indexOn: "verified" as const, requireValidSchema: true,
  duplicateChanged: "version_and_verify" as const, staleAfterHours: 168,
  maxMetadataBytes: 131_072, maxDescriptionLength: 4_000, maxSchemaBytes: 65_536,
  maxExampleBytes: 16_384, maxJsonDepth: 32, maxTags: 5, maxTagLength: 32,
  maxIconUrlLength: 2_048, maxServiceNameLength: 32, maxRouteTemplateLength: 512,
  fetchIcons: false as const, requireHttpsOrigins: true, allowLocalOrigins: false,
  inactiveVersionRetentionDays: 365, observationRetentionDays: 90,
};

const TABLES = `catalog_index_jobs, catalog_search_documents,
  search_impressions, catalog_observations, catalog_payment_options,
  catalog_resource_versions, catalog_resources`;

/** Per-generation vector tables are created on demand, so they are dropped by name. */
async function resetCatalog(pool: pg.Pool): Promise<void> {
  const storage = await pool.query<{ relname: string }>(
    "SELECT relname FROM pg_class WHERE relkind = 'r' AND relname LIKE 'catalog_embeddings_g%'",
  );
  for (const row of storage.rows) {
    await pool.query(`DROP TABLE IF EXISTS ${row.relname} CASCADE`);
  }
  await pool.query(`TRUNCATE ${TABLES}, search_model_generations RESTART IDENTITY CASCADE`);
  await pool.query("UPDATE catalog_state SET last_version = 0 WHERE id = 1");
}

function table(values: Array<Record<string, string | number>>, columns: string[]): string {
  const widths = columns.map(column =>
    Math.max(column.length, ...values.map(row => String(row[column] ?? "").length)));
  const line = (cells: string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index]!)).join("  ");
  return [
    line(columns),
    line(widths.map(width => "-".repeat(width))),
    ...values.map(row => line(columns.map(column => String(row[column] ?? "")))),
  ].join("\n");
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const suite = JSON.parse(await readFile(resolve(options.suite), "utf8")) as EvalSuite;
  const pool = new pg.Pool({ connectionString: options.databaseUrl });
  const catalog = new CatalogStore(pool);
  const searchStore = new SearchStore(pool);

  await migrate(pool);
  if (!options.keep) await resetCatalog(pool);

  const config = baseSearchConfig(options);
  const keys = await seedSuite(catalog, suite, CATALOG_CONFIG);
  const vectorSupport = await searchStore.hasVectorSupport();
  const index = config.semantic.enabled && vectorSupport
    ? await buildIndex(searchStore, config, "evaluate-cli")
    : { stored: 0, status: undefined, coverage: undefined };

  const runnerOptions = {
    suite, pool, catalog, searchStore,
    searchConfig: config, catalogConfig: CATALOG_CONFIG,
    limit: options.limit, keys,
  };

  const profiles = [
    await runProfile(runnerOptions, "lexical-only", {
      semantic: { ...config.semantic, enabled: false },
      reranking: { ...config.reranking, enabled: false },
    }),
    await runProfile(runnerOptions, "hybrid", {
      reranking: { ...config.reranking, enabled: false },
    }),
    await runProfile(runnerOptions, "hybrid+rerank", {
      reranking: { ...config.reranking, enabled: options.reranker !== "disabled" },
    }),
  ];

  const [lexical, hybrid, reranked] = profiles as [
    typeof profiles[number], typeof profiles[number], typeof profiles[number],
  ];

  const report = {
    suite: suite.name,
    generatedAt: new Date().toISOString(),
    catalogSize: suite.resources.length,
    queries: suite.queries.length,
    provider: options.provider,
    reranker: options.reranker,
    vectorSupport,
    indexedVectors: index.stored,
    indexStatus: index.status ?? null,
    indexCoverage: index.coverage ?? null,
    profiles: profiles.map(profile => ({
      name: profile.name,
      effectiveMode: profile.mode,
      reranked: profile.reranked,
      metrics: profile.metrics,
    })),
    lift: {
      "hybrid over lexical": lift(lexical.metrics, hybrid.metrics),
      "rerank over hybrid": lift(hybrid.metrics, reranked.metrics),
    },
    perQuery: Object.fromEntries(profiles.map(profile => [profile.name, profile.perQuery])),
  };

  const summary = profiles.map(profile => ({
    profile: profile.name,
    mode: profile.mode,
    reranked: String(profile.reranked),
    ...Object.fromEntries(DEFAULT_CUTOFFS.map(k => [`recall@${k}`, round(profile.metrics.recall[k] ?? 0)])),
    mrr: round(profile.metrics.mrr),
    "ndcg@10": round(profile.metrics.ndcg[10] ?? 0),
    "viol@5": profile.metrics.violations[5] ?? 0,
    "no-result": round(profile.metrics.noResultRate),
    "p95ms": profile.metrics.latency.p95,
  }));

  console.log(`\nSuite: ${suite.name}`);
  console.log(`Catalog: ${suite.resources.length} resources, ${suite.queries.length} queries`);
  console.log(`Embedding provider: ${options.provider} | reranker: ${options.reranker} | pgvector: ${vectorSupport} | vectors indexed: ${index.stored}`);
  if (index.coverage) {
    console.log(`Embedding coverage: ${index.coverage.indexed}/${index.coverage.expected} ready | pending: ${index.coverage.pending} | failed: ${index.coverage.failed}`);
  }
  if (index.status?.provider.status !== "ready" && config.semantic.enabled) {
    console.log(`Embedding degraded: ${index.status?.provider.detail ?? "unknown"}`);
  }
  console.log("");
  console.log(table(summary, [
    "profile", "mode", "reranked",
    ...DEFAULT_CUTOFFS.map(k => `recall@${k}`),
    "mrr", "ndcg@10", "viol@5", "no-result", "p95ms",
  ]));

  console.log("\nLift");
  console.log(table(
    Object.entries(report.lift).map(([name, values]) => ({
      comparison: name,
      "recall@1": round(values["recall@1"] ?? 0),
      "recall@5": round(values["recall@5"] ?? 0),
      "recall@10": round(values["recall@10"] ?? 0),
      mrr: round(values.mrr ?? 0),
      "ndcg@10": round(values["ndcg@10"] ?? 0),
    })),
    ["comparison", "recall@1", "recall@5", "recall@10", "mrr", "ndcg@10"],
  ));

  console.log("\nRecall@5 by query class (hybrid)");
  console.log(table(
    Object.entries(hybrid.metrics.byClass).map(([name, bucket]) => ({
      class: name, queries: bucket.queries,
      "recall@5": round(bucket.recall[5] ?? 0), mrr: round(bucket.mrr),
    })),
    ["class", "queries", "recall@5", "mrr"],
  ));

  const fallbacks = Object.entries(hybrid.metrics.fallbacks);
  console.log(`\nProvider fallbacks (hybrid): ${fallbacks.length === 0 ? "none" : fallbacks.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(
    "Cold start: coverage is reported beside ranking quality so a high score on a "
    + `small catalog is not mistaken for ecosystem utility (${suite.resources.length} resources).`,
  );

  if (options.json) {
    const path = resolve(options.json);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nWrote ${path}`);
  }

  if (!options.keep) await resetCatalog(pool);
  await pool.end();
}

await main();
