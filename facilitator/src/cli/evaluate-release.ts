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
import { lift, type EvalSuite } from "../search/evaluate.js";
import type { ProviderKind, SearchConfig } from "../types.js";
import { evaluateEligibility } from "../search/release/eligibility.js";
import { evaluateReleaseGates, type ReleaseProfileGateInput } from "../search/release/gates.js";
import { validateReleaseDataset } from "../search/release/validate.js";
import type { CatalogRecord, QueryRecord, SidecarRecord } from "../search/release/schema.js";

const root = resolve(process.argv[2] ?? "eval-dataset");
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required for an isolated release benchmark schema");
const dataset = await validateReleaseDataset(root);
const pending = dataset.qrels.filter(value => value.judge === "pending");
if (pending.length > 0) throw new Error(`${pending.length} eligible qrels remain pending; run benchmark:judge before release evaluation`);
const provisionalMode = process.env.BENCHMARK_ALLOW_PROVISIONAL === "1";
if (dataset.qrels.some(value => value.provisional) && !provisionalMode) {
  throw new Error("release qrels remain provisional; import human calibration and pass the agreement gate first, or set BENCHMARK_ALLOW_PROVISIONAL=1 for a non-release measurement");
}
const rerankerUrl = process.env.FACILITATOR_RERANKER_URL;
const minimumRelevanceScoreRaw = process.env.BENCHMARK_MIN_RELEVANCE_SCORE;
const hybridP95LimitRaw = process.env.BENCHMARK_HYBRID_P95_LIMIT_MS;
const rerankerP95LimitRaw = process.env.BENCHMARK_RERANKER_P95_LIMIT_MS;

function requiredPositiveNumber(name: string, raw: string | undefined): number {
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be set to a positive number before the frozen release run`);
  }
  return value;
}

const hybridP95LimitMs = requiredPositiveNumber("BENCHMARK_HYBRID_P95_LIMIT_MS", hybridP95LimitRaw);
const rerankerP95LimitMs = requiredPositiveNumber("BENCHMARK_RERANKER_P95_LIMIT_MS", rerankerP95LimitRaw);
const minimumRelevanceScore = Number(minimumRelevanceScoreRaw);
if (!minimumRelevanceScoreRaw || !Number.isFinite(minimumRelevanceScore) || minimumRelevanceScore <= 0) {
  throw new Error("BENCHMARK_MIN_RELEVANCE_SCORE must be fixed from development-query tuning before the frozen release run");
}
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
    lexical: { enabled: true, language: "simple", weight: 0.7, candidateCount: 300 },
    semantic: {
      enabled: true, provider: remoteEmbedding ? "remote" : "local",
      modelId: "BAAI/bge-m3", repo: "Xenova/bge-m3", revision: "4de13258303883538bd53b696b452bf8099f0858",
      dimension: 1024, pooling: "cls", normalization: "l2", weight: 0.3, timeoutMs: 60_000, candidateCount: 300, maxDistance: 0.9,
      ...(embeddingUrl ? { remoteUrl: embeddingUrl } : {}),
      ...(process.env.FACILITATOR_EMBEDDING_API_KEY ? { remoteApiKey: process.env.FACILITATOR_EMBEDDING_API_KEY } : {}),
    },
    reranking: {
      enabled: false, provider: rerankerUrl ? "remote" : "disabled", modelId: "BAAI/bge-reranker-v2-m3", repo: "",
      revision: "953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e", topK: 30, timeoutMs: 20_000, fallbackToHybrid: true,
      ...(rerankerUrl ? { remoteUrl: rerankerUrl } : {}),
      ...(process.env.FACILITATOR_RERANKER_API_KEY ? { remoteApiKey: process.env.FACILITATOR_RERANKER_API_KEY } : {}),
    },
    rrfK: 20, minimumRelevanceScore, defaultResultLimit: 20, maximumResultLimit: 50,
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
    let activeVersionId: number | undefined;
    for (const rawRequirements of record.wire.accepts) {
      const requirements = rawRequirements as PaymentRequirements;
      const payload = {
        x402Version: 2, resource: record.wire.resource, accepted: requirements,
        payload: { transaction: "AAAA" }, extensions: record.wire.extensions,
      } as unknown as PaymentPayload;
      const extracted = extractCandidate(payload, requirements, catalogConfig);
      if (extracted.kind !== "candidate") throw new Error(`${record.resource_id} rejected during seed: ${JSON.stringify(extracted)}`);
      const observed = await catalog.observe(extracted.candidate, { stage: "verified", activate: true, duplicateChanged: "version_and_verify" });
      if (!observed.versionId) throw new Error(`${record.resource_id} did not create an active version`);
      activeVersionId = observed.versionId;
      keys.set(record.resource_id, extracted.candidate.resourceKey);
    }
    // Evaluation fixtures are active for ranking mechanics but explicitly not
    // evidence of payment. This mutation occurs only inside the proven-random schema.
    await pool.query("UPDATE catalog_resource_versions SET verification = 'unverified' WHERE id = $1", [activeVersionId]);
  }
  return keys;
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
  let returned = 0, gradeZero = 0, hardViolations = 0, sidecarViolations = 0;
  let adversarialTop1 = 0, adversarialResisted = 0, rerankerEligible = 0, rerankerUsed = 0;
  const providers = new Map<string, number>();
  for (const row of profile.perQuery) {
    const query = queryByText.get(row.query)!;
    for (const [rank, id] of row.returned.entries()) {
      returned += 1;
      if ((qrel.get(`${query.query_id}\0${id}`) ?? 0) === 0) gradeZero += 1;
      const record = catalogById.get(id)!; const sidecar = sidecarById.get(id)!;
      const eligibility = evaluateEligibility(query, record, sidecar);
      if (!eligibility.wireEligible) hardViolations += 1;
      if (eligibility.wireEligible && !eligibility.evaluationEligible) sidecarViolations += 1;
      if (rank < 5) providers.set(sidecar.provider_id, (providers.get(sidecar.provider_id) ?? 0) + 1);
    }
    if (query.query_class === "adversarial") {
      const first = row.returned[0];
      if (first && sidecarById.get(first)?.adversarial === true) adversarialTop1 += 1;
      if (first && sidecarById.get(first)?.adversarial === false && (qrel.get(`${query.query_id}\0${first}`) ?? 0) >= 2) adversarialResisted += 1;
    }
    if (row.returned.length > 0) {
      rerankerEligible += 1;
      if (row.degraded.reranking === "used") rerankerUsed += 1;
    }
  }
  const subsets = (predicate: (query: QueryRecord) => boolean) => {
    const rows = profile.perQuery.filter(row => predicate(queryByText.get(row.query)!));
    const rankingRows = rows.filter(row => {
      const query = queryByText.get(row.query)!;
      return dataset.qrels.some(value => value.query_id === query.query_id && value.grade >= 2);
    });
    return {
      queries: rows.length,
      ranking_queries: rankingRows.length,
      precision_at_5: bootstrap(rankingRows.map(row => row.metrics.precision[5] ?? 0)),
      recall_at_20: bootstrap(rankingRows.map(row => row.metrics.recall[20] ?? 0)),
      mrr: bootstrap(rankingRows.map(row => row.metrics.mrr)),
      ndcg_at_5: bootstrap(rankingRows.map(row => row.metrics.ndcg[5] ?? 0)),
      no_result_accuracy: bootstrap(rows.map(row => row.metrics.noResultCorrect ? 1 : 0)),
    };
  };
  const freshnessRecall = (freshness: SidecarRecord["freshness"]) => {
    const values: number[] = [];
    for (const row of profile.perQuery) {
      const query = queryByText.get(row.query)!;
      const relevant = dataset.qrels.filter(value => value.query_id === query.query_id && value.grade >= 2
        && sidecarById.get(value.resource_id)?.freshness === freshness);
      if (relevant.length === 0) continue;
      const ids = new Set(relevant.map(value => value.resource_id));
      values.push(row.returned.slice(0, 20).filter(id => ids.has(id)).length / relevant.length);
    }
    return { queries: values.length, recall_at_20: bootstrap(values) };
  };
  const fallbackCount = Object.values(profile.metrics.fallbacks).reduce((sum, value) => sum + value, 0);
  return {
    name, metrics: profile.metrics,
    confidence_intervals: subsets(() => true),
    by_split: { development: subsets(query => query.split === "development"), release: subsets(query => query.split === "release") },
    by_class: Object.fromEntries([...new Set(dataset.queries.map(value => value.query_class))].map(queryClass => [queryClass, subsets(query => query.query_class === queryClass)])),
    warm_cold: {
      warm: freshnessRecall("warm"),
      cold: freshnessRecall("cold"),
      warm_return_share: returned === 0 ? 0 : profile.perQuery.flatMap(row => row.returned).filter(id => sidecarById.get(id)?.freshness === "warm").length / returned,
      cold_return_share: returned === 0 ? 0 : profile.perQuery.flatMap(row => row.returned).filter(id => sidecarById.get(id)?.freshness === "cold").length / returned,
    },
    semantic_grade_0_rate: name === "semantic-only" ? gradeZero / Math.max(1, returned) : null,
    hard_filter_violation_rate: hardViolations / Math.max(1, returned),
    evaluation_sidecar_constraint_violation_rate: sidecarViolations / Math.max(1, returned),
    adversarial_top1_rate: adversarialTop1 / dataset.queries.filter(value => value.query_class === "adversarial").length,
    adversarial_resistance_rate: adversarialResisted / dataset.queries.filter(value => value.query_class === "adversarial").length,
    reranker_execution_rate: rerankerEligible === 0 ? 0 : rerankerUsed / rerankerEligible,
    provider_fallback_count: fallbackCount,
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
    await runProfile(options, "lexical", { minimumRelevanceScore: 0, semantic: { ...config.semantic, enabled: false }, reranking: { ...config.reranking, enabled: false } }),
    await runProfile(options, "semantic-only", { minimumRelevanceScore: 0, lexical: { ...config.lexical, enabled: false }, reranking: { ...config.reranking, enabled: false } }),
    await runProfile(options, "hybrid-rrf", { reranking: { ...config.reranking, enabled: false } }),
  ];
  const unavailableProfiles: Record<string, string> = {};
  if (rerankerUrl) profiles.push(await runProfile(options, "hybrid+reranker", { reranking: { ...config.reranking, enabled: true, provider: "remote" as ProviderKind } }));
  else unavailableProfiles["hybrid+reranker"] = "FACILITATOR_RERANKER_URL is not configured; fake rerankers are forbidden in release mode";
  const reports = profiles.map(profile => enrich(profile, profile.name));
  const hybrid = profiles.find(value => value.name === "hybrid-rrf")!;
  const reranked = profiles.find(value => value.name === "hybrid+reranker");
  const calibration = await readFile(resolve(root, "reports/calibration-v1.json"), "utf8").then(JSON.parse).catch(() => null) as { passes?: boolean } | null;
  const gateProfiles: ReleaseProfileGateInput[] = reports.map((report, index) => {
    const releaseRows = profiles[index]!.perQuery.filter(row =>
      dataset.queries.find(query => query.query === row.query)?.split === "release");
    const releaseNoResultRows = releaseRows.filter(row =>
      dataset.queries.find(query => query.query === row.query)?.query_class === "no_result");
    const latencies = releaseRows.map(row => row.metrics.latencyMs).sort((left, right) => left - right);
    return {
      name: report.name,
      reranked: profiles[index]!.reranked,
      rerankerExecutionRate: report.reranker_execution_rate,
      hardFilterViolationRate: report.hard_filter_violation_rate,
      evaluationConstraintViolationRate: report.evaluation_sidecar_constraint_violation_rate,
      adversarialTop1Rate: report.adversarial_top1_rate,
      providerFallbacks: report.provider_fallback_count,
      release: {
        recallAt20: report.by_split.release.recall_at_20.mean,
        ndcgAt5: report.by_split.release.ndcg_at_5.mean,
        noResultAccuracy: releaseNoResultRows.length === 0 ? 0
          : releaseNoResultRows.filter(row => row.metrics.noResultCorrect).length / releaseNoResultRows.length,
        p95LatencyMs: latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? Number.POSITIVE_INFINITY,
      },
    };
  });
  const gates = evaluateReleaseGates({
    profiles: gateProfiles,
    indexedEmbeddings: index.coverage.indexed,
    expectedEmbeddings: dataset.catalog.length,
    embeddingFailures: index.status?.deadLettered ?? 0,
    humanCalibrationPassed: calibration?.passes === true,
    releaseQueriesCurated: dataset.queries.filter(value => value.split === "release").every(value => value.derived_from.kind === "curated"),
    minimumRelevanceScoreConfigured: minimumRelevanceScore > 0,
    hybridP95LimitMs,
    rerankerP95LimitMs,
  });
  const report = {
    benchmark: provisionalMode ? "stellar-bazaar-provisional-v1" : "stellar-bazaar-release-v1",
    evaluation_mode: provisionalMode ? "provisional" : "release",
    generated_at: new Date().toISOString(), isolated_schema: schema,
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu_count: (await import("node:os")).cpus().length },
    database: (await pool.query<{ version: string }>("SHOW server_version")).rows[0]?.version,
    embedding: {
      provider: config.semantic.provider, model: config.semantic.modelId, revision: config.semantic.revision,
      indexed: index.coverage.indexed, expected: index.coverage.expected, coverage: index.coverage,
      status: index.status,
    },
    reranker: { configured: Boolean(rerankerUrl), model: config.reranking.modelId, revision: config.reranking.revision },
    thresholds: { minimum_relevance_score: minimumRelevanceScore, hybrid_p95_limit_ms: hybridP95LimitMs, reranker_p95_limit_ms: rerankerP95LimitMs },
    unavailable_profiles: unavailableProfiles, profiles: reports,
    reranker_lift: reranked ? lift(hybrid.metrics, reranked.metrics) : null,
    gates, release_ready: !provisionalMode && Object.values(gates).every(value => value === true),
    limitations: ["The benchmark is intentionally exact-only in v1.", "CDP records supply sampling shape and provenance hashes; committed fixture descriptions and schemas are deterministic synthetic metadata, not copied source prose.", "Release queries are curated, frozen, and this command exposes no tuning controls."],
  };
  await mkdir(resolve(root, "reports"), { recursive: true }); await mkdir(resolve(root, "runs"), { recursive: true });
  const outputName = provisionalMode ? "provisional-v1.json" : "release-v1.json";
  await writeFile(resolve(root, `reports/${outputName}`), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(root, `runs/${outputName}`), `${JSON.stringify({ generated_at: report.generated_at, profiles: profiles.map(value => ({ name: value.name, per_query: value.perQuery })) }, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!provisionalMode && !report.release_ready) process.exitCode = 1;
} finally {
  if (pool) await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
