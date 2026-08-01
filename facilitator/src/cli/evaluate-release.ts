import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { migrate } from "../db/migrate.js";
import { CatalogStore } from "../db/catalog.js";
import { SearchStore } from "../db/search.js";
import { extractCandidate } from "../bazaar/extract.js";
import { buildIndex, runProfile, type ProfileResult } from "../search/harness.js";
import { aggregate, lift, type EvalSuite } from "../search/evaluate.js";
import type { ProviderKind, SearchConfig } from "../types.js";
import { validateReleaseDataset } from "../search/release/validate.js";
import type { CatalogRecord, QueryRecord, SidecarRecord } from "../search/release/schema.js";

const root = resolve(process.argv[2] ?? "eva-datasetl");
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required for an isolated release benchmark schema");
const dataset = await validateReleaseDataset(root);
const pending = dataset.qrels.filter(value => value.judge === "pending");
if (pending.length > 0) throw new Error(`${pending.length} eligible qrels remain pending; run benchmark:judge before release evaluation`);
if (dataset.qrels.some(value => value.provisional)) throw new Error("release qrels remain provisional; import human calibration and pass the agreement gate first");
const rerankerUrl = process.env.FACILITATOR_RERANKER_URL;
const schema = `search_benchmark_${randomBytes(8).toString("hex")}`;
if (!/^search_benchmark_[a-f0-9]{16}$/.test(schema)) throw new Error("failed to construct isolated schema name");

const catalogConfig = {
  autoCatalog: true, indexOn: "verified" as const, requireValidSchema: true,
  duplicateChanged: "version_and_verify" as const, staleAfterHours: 168,
  maxMetadataBytes: 131_072, maxDescriptionLength: 4_000, maxSchemaBytes: 65_536,
  maxExampleBytes: 16_384, maxJsonDepth: 32, maxTags: 5, maxTagLength: 32,
  maxIconUrlLength: 2_048, maxServiceNameLength: 32, maxRouteTemplateLength: 512,
  fetchIcons: false as const, requireHttpsOrigins: true, allowLocalOrigins: false,
  inactiveVersionRetentionDays: 365, observationRetentionDays: 90,
};

function searchConfig(): SearchConfig {
  const embeddingUrl = process.env.FACILITATOR_EMBEDDING_URL;
  const remoteEmbedding = embeddingUrl !== undefined;
  return {
    lexical: { enabled: true, language: "simple", weight: 0.35, candidateCount: 300 },
    semantic: {
      enabled: true, provider: remoteEmbedding ? "remote" : "local",
      modelId: "BAAI/bge-m3", repo: "Xenova/bge-m3", revision: "4de13258303883538bd53b696b452bf8099f0858",
      dimension: 1024, pooling: "cls", normalization: "l2", weight: 0.65, timeoutMs: 60_000, candidateCount: 300,
      ...(embeddingUrl ? { remoteUrl: embeddingUrl } : {}),
      ...(process.env.FACILITATOR_EMBEDDING_API_KEY ? { remoteApiKey: process.env.FACILITATOR_EMBEDDING_API_KEY } : {}),
    },
    reranking: {
      enabled: false, provider: rerankerUrl ? "remote" : "disabled", modelId: "BAAI/bge-reranker-v2-m3", repo: "",
      revision: "953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e", topK: 30, timeoutMs: 20_000, fallbackToHybrid: true,
      ...(rerankerUrl ? { remoteUrl: rerankerUrl } : {}),
      ...(process.env.FACILITATOR_RERANKER_API_KEY ? { remoteApiKey: process.env.FACILITATOR_RERANKER_API_KEY } : {}),
    },
    rrfK: 60, minimumRelevanceScore: 0, defaultResultLimit: 20, maximumResultLimit: 50,
    originDiversityLimit: 3, impressions: { enabled: false, retainQueryText: false, retentionDays: 1 },
    models: { cacheDir: ".models", offline: false, dtype: "q8", requirePinnedRevision: true },
    indexing: { batchSize: 8, workerConcurrency: 1, pollMs: 50, leaseMs: 120_000, maxAttempts: 3, backoffBaseMs: 500, backoffMaxMs: 8_000, reindexSchedule: "manual" },
  };
}

function toSuite(): EvalSuite {
  const byQuery = new Map<string, Array<{ resource: string; grade: number; rationale?: string }>>();
  for (const row of dataset.qrels) {
    const list = byQuery.get(row.query_id) ?? [];
    list.push({ resource: row.resource_id, grade: row.grade, ...(row.rationale ? { rationale: row.rationale } : {}) });
    byQuery.set(row.query_id, list);
  }
  return {
    name: "stellar-bazaar-release-v1", resources: dataset.catalog as unknown as Array<Record<string, unknown>>,
    queries: dataset.queries.map(query => ({
      query: query.query, queryClass: query.query_class,
      filters: Object.fromEntries(Object.entries(query.filters).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      notes: `${query.query_id}:${query.split}`, judgments: byQuery.get(query.query_id) ?? [],
    })),
  };
}

async function seed(catalog: CatalogStore, pool: pg.Pool): Promise<Map<string, string>> {
  const keys = new Map<string, string>();
  for (const record of dataset.catalog) {
    const requirements = record.wire.accepts[0]! as PaymentRequirements;
    const payload = {
      x402Version: 2, resource: record.wire.resource, accepted: requirements,
      payload: { transaction: "AAAA" }, extensions: record.wire.extensions,
    } as unknown as PaymentPayload;
    const extracted = extractCandidate(payload, requirements, catalogConfig);
    if (extracted.kind !== "candidate") throw new Error(`${record.resource_id} rejected during seed: ${JSON.stringify(extracted)}`);
    const observed = await catalog.observe(extracted.candidate, { stage: "verified", activate: true, duplicateChanged: "version_and_verify" });
    if (!observed.versionId) throw new Error(`${record.resource_id} did not create an active version`);
    // Evaluation fixtures are active for ranking mechanics but explicitly not
    // evidence of payment. This mutation occurs only inside the proven-random schema.
    await pool.query("UPDATE catalog_resource_versions SET verification = 'unverified' WHERE id = $1", [observed.versionId]);
    keys.set(record.resource_id, extracted.candidate.resourceKey);
  }
  return keys;
}

function filterViolation(query: QueryRecord, record: CatalogRecord): boolean {
  const option = record.wire.accepts[0]!;
  const input = (record.wire.extensions.bazaar.info as Record<string, unknown>).input as Record<string, unknown>;
  return Object.entries(query.filters).some(([key, wanted]) => {
    if (wanted === undefined) return false;
    const actual = key === "type" ? input.type : key === "extensions" ? (wanted in record.wire.extensions ? wanted : undefined)
      : key === "payTo" ? option.payTo : option[key as keyof typeof option];
    return actual !== wanted;
  });
}

function bootstrap(values: number[], samples = 1_000): { mean: number; low: number; high: number } {
  if (values.length === 0) return { mean: 0, low: 0, high: 0 };
  let state = 0x5eed1234;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const means: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) sum += values[Math.floor(random() * values.length)]!;
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return { mean: values.reduce((a, b) => a + b, 0) / values.length, low: means[Math.floor(samples * 0.025)]!, high: means[Math.floor(samples * 0.975)]! };
}

function enrich(profile: ProfileResult, name: string) {
  const catalogById = new Map(dataset.catalog.map(value => [value.resource_id, value]));
  const sidecarById = new Map(dataset.sidecars.map(value => [value.resource_id, value]));
  const queryByText = new Map(dataset.queries.map(value => [value.query, value]));
  const qrel = new Map(dataset.qrels.map(value => [`${value.query_id}\0${value.resource_id}`, value.grade]));
  let returned = 0, gradeZero = 0, hardViolations = 0, sidecarViolations = 0, adversarialWins = 0;
  const providers = new Map<string, number>();
  for (const row of profile.perQuery) {
    const query = queryByText.get(row.query)!;
    for (const [rank, id] of row.returned.entries()) {
      returned += 1;
      if ((qrel.get(`${query.query_id}\0${id}`) ?? 0) === 0) gradeZero += 1;
      const record = catalogById.get(id)!; const sidecar = sidecarById.get(id)!;
      if (filterViolation(query, record)) hardViolations += 1;
      if ((query.evaluation_constraints.category && query.evaluation_constraints.category !== sidecar.category)
        || (query.evaluation_constraints.max_price_usd !== undefined && sidecar.price_usd_snapshot.value > query.evaluation_constraints.max_price_usd)) sidecarViolations += 1;
      if (rank < 5) providers.set(sidecar.provider_id, (providers.get(sidecar.provider_id) ?? 0) + 1);
    }
    if (query.query_class === "adversarial") {
      const first = row.returned[0];
      if (first && sidecarById.get(first)?.adversarial === false && (qrel.get(`${query.query_id}\0${first}`) ?? 0) >= 2) adversarialWins += 1;
    }
  }
  const subsets = (predicate: (query: QueryRecord) => boolean) => {
    const rows = profile.perQuery.filter(row => predicate(queryByText.get(row.query)!));
    return {
      queries: rows.length,
      precision_at_5: bootstrap(rows.map(row => row.metrics.precision[5] ?? 0)),
      recall_at_20: bootstrap(rows.map(row => row.metrics.recall[20] ?? 0)),
      mrr: bootstrap(rows.map(row => row.metrics.mrr)),
      ndcg_at_5: bootstrap(rows.map(row => row.metrics.ndcg[5] ?? 0)),
      no_result_accuracy: bootstrap(rows.map(row => row.metrics.noResultCorrect ? 1 : 0)),
    };
  };
  const hasRelevantFreshness = (query: QueryRecord, freshness: SidecarRecord["freshness"]) => dataset.qrels.some(value =>
    value.query_id === query.query_id && value.grade >= 2 && sidecarById.get(value.resource_id)?.freshness === freshness);
  return {
    name, metrics: profile.metrics,
    confidence_intervals: subsets(() => true),
    by_split: { development: subsets(query => query.split === "development"), release: subsets(query => query.split === "release") },
    by_class: Object.fromEntries([...new Set(dataset.queries.map(value => value.query_class))].map(queryClass => [queryClass, subsets(query => query.query_class === queryClass)])),
    warm_cold: {
      warm: subsets(query => hasRelevantFreshness(query, "warm")),
      cold: subsets(query => hasRelevantFreshness(query, "cold")),
      warm_return_share: returned === 0 ? 0 : profile.perQuery.flatMap(row => row.returned).filter(id => sidecarById.get(id)?.freshness === "warm").length / returned,
      cold_return_share: returned === 0 ? 0 : profile.perQuery.flatMap(row => row.returned).filter(id => sidecarById.get(id)?.freshness === "cold").length / returned,
    },
    semantic_grade_0_rate: name === "semantic-only" ? gradeZero / Math.max(1, returned) : null,
    hard_filter_violation_rate: hardViolations / Math.max(1, returned),
    evaluation_sidecar_constraint_violation_rate: sidecarViolations / Math.max(1, returned),
    adversarial_win_rate: adversarialWins / dataset.queries.filter(value => value.query_class === "adversarial").length,
    provider_concentration_at_5: Math.max(0, ...providers.values()) / Math.max(1, profile.perQuery.length * 5),
  };
}

const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
let pool: pg.Pool | undefined;
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool = new pg.Pool({ connectionString: databaseUrl, max: 2, options: `-c search_path=${schema},public` });
  const current = await pool.query<{ schema: string }>("SELECT current_schema() AS schema");
  if (current.rows[0]?.schema !== schema) throw new Error("schema isolation cannot be proven before migration");
  await migrate(pool);
  const ownership = await pool.query<{ schema: string }>("SELECT table_schema AS schema FROM information_schema.tables WHERE table_name = 'catalog_resources'");
  if (ownership.rows.length !== 1 || ownership.rows[0]?.schema !== schema) throw new Error("catalog tables are not isolated; refusing to seed");

  const catalog = new CatalogStore(pool); const store = new SearchStore(pool); const config = searchConfig();
  const keys = await seed(catalog, pool);
  const vectorSupport = await store.hasVectorSupport();
  if (!vectorSupport) throw new Error("pgvector is required for release evaluation");
  const index = await buildIndex(store, config, `release-${schema}`);
  const suite = toSuite();
  const options = { suite, pool, catalog, searchStore: store, searchConfig: config, catalogConfig, limit: 20, keys, includeUnverified: true };
  const profiles = [
    await runProfile(options, "lexical", { semantic: { ...config.semantic, enabled: false }, reranking: { ...config.reranking, enabled: false } }),
    await runProfile(options, "semantic-only", { lexical: { ...config.lexical, enabled: false }, reranking: { ...config.reranking, enabled: false } }),
    await runProfile(options, "hybrid-rrf", { reranking: { ...config.reranking, enabled: false } }),
  ];
  const unavailableProfiles: Record<string, string> = {};
  if (rerankerUrl) profiles.push(await runProfile(options, "hybrid+reranker", { reranking: { ...config.reranking, enabled: true, provider: "remote" as ProviderKind } }));
  else unavailableProfiles["hybrid+reranker"] = "FACILITATOR_RERANKER_URL is not configured; fake rerankers are forbidden in release mode";
  const reports = profiles.map(profile => enrich(profile, profile.name));
  const hybrid = profiles.find(value => value.name === "hybrid-rrf")!;
  const reranked = profiles.find(value => value.name === "hybrid+reranker");
  const calibration = await readFile(resolve(root, "reports/calibration-v1.json"), "utf8").then(JSON.parse).catch(() => null) as { passes?: boolean } | null;
  const gates = {
    wire_validation_errors: 0,
    pending_qrels: 0,
    openrouter_candidates: dataset.queries.every(value => value.derived_from.kind === "openrouter")
      && dataset.sidecars.filter(value => value.source_class === "generated_mcp").every(value => value.derived_from.kind === "openrouter"),
    hard_filter_violations: reports.reduce((sum, value) => sum + (value.hard_filter_violation_rate > 0 ? 1 : 0), 0),
    embedding_completeness: index.stored / dataset.catalog.length,
    embedding_failures: index.status?.deadLettered ?? 0,
    real_reranker_available: reranked?.reranked === true,
    human_calibration_passed: calibration?.passes === true,
  };
  const report = {
    benchmark: "stellar-bazaar-release-v1", generated_at: new Date().toISOString(), isolated_schema: schema,
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu_count: (await import("node:os")).cpus().length },
    database: (await pool.query<{ version: string }>("SHOW server_version")).rows[0]?.version,
    embedding: { provider: config.semantic.provider, model: config.semantic.modelId, revision: config.semantic.revision, indexed: index.stored, status: index.status },
    reranker: { configured: Boolean(rerankerUrl), model: config.reranking.modelId, revision: config.reranking.revision },
    unavailable_profiles: unavailableProfiles, profiles: reports,
    reranker_lift: reranked ? lift(hybrid.metrics, reranked.metrics) : null,
    gates, release_ready: Object.values(gates).every(value => value === true || value === 0 || value === 1),
    limitations: ["CDP-derived fixtures preserve source capability prose but use reserved .example URLs and Stellar evaluation payment terms.", "Release queries are frozen and this command exposes no tuning controls."],
  };
  await mkdir(resolve(root, "reports"), { recursive: true }); await mkdir(resolve(root, "runs"), { recursive: true });
  await writeFile(resolve(root, "reports/release-v1.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(root, "runs/release-v1.json"), `${JSON.stringify({ generated_at: report.generated_at, profiles: profiles.map(value => ({ name: value.name, per_query: value.perQuery })) }, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.release_ready) process.exitCode = 1;
} finally {
  if (pool) await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
