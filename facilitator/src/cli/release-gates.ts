import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateReleaseDataset } from "../search/release/validate.js";

const root = resolve(process.argv[2] ?? "eval-dataset");
const dataset = await validateReleaseDataset(root);
const calibration = await readFile(resolve(root, "reports/calibration-v1.json"), "utf8").then(JSON.parse).catch(() => null) as { passes?: boolean } | null;
const bge = await readFile(resolve(root, "reports/bge-m3-local-v1.json"), "utf8").then(JSON.parse).catch(() => null) as { status?: string } | null;
const gates = {
  dataset_valid: true,
  wire_validation_errors_zero: true,
  exact_resource_count: dataset.catalog.length === 300,
  exact_query_count: dataset.queries.length === 100,
  exact_qrel_count: dataset.qrels.length === 30_000,
  exact_only: dataset.catalog.every(value => value.wire.accepts.every(option => option.scheme === "exact")),
  release_queries_curated: dataset.queries.filter(value => value.split === "release").every(value => value.derived_from.kind === "curated"),
  qrels_complete: dataset.qrels.every(value => value.judge !== "pending"),
  qrels_final: dataset.qrels.every(value => !value.provisional),
  human_calibration_passed: calibration?.passes === true,
  bge_m3_report_passed: bge?.status === "pass",
  real_reranker_configured: Boolean(process.env.FACILITATOR_RERANKER_URL),
  isolated_database_configured: Boolean(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL),
  minimum_relevance_score_frozen: Number(process.env.BENCHMARK_MIN_RELEVANCE_SCORE) > 0,
  hybrid_latency_limit_frozen: Number(process.env.BENCHMARK_HYBRID_P95_LIMIT_MS) > 0,
  reranker_latency_limit_frozen: Number(process.env.BENCHMARK_RERANKER_P95_LIMIT_MS) > 0,
};
const ready = Object.values(gates).every(value => value === true);
const pendingQrels = dataset.qrels.filter(value => value.judge === "pending").length;
const provisionalQrels = dataset.qrels.filter(value => value.provisional).length;
const report = {
  generated_at: new Date().toISOString(), status: ready ? "ready_for_evaluation" : "blocked",
  ready_for_evaluation: ready, gates,
  blockers: [
    ...(!gates.qrels_complete ? [`${pendingQrels} eligible pairs need OpenRouter judgments`] : []),
    ...(!gates.qrels_final ? [`${provisionalQrels} qrels remain provisional until human calibration passes`] : []),
    ...(!gates.human_calibration_passed ? ["human calibration is incomplete or below threshold"] : []),
    ...(!gates.real_reranker_configured ? ["FACILITATOR_RERANKER_URL is unset; reranked profile unavailable and production reranking stays off"] : []),
    ...(!gates.isolated_database_configured ? ["TEST_DATABASE_URL/DATABASE_URL is unset; PostgreSQL/pgvector release run unavailable"] : []),
    ...(!gates.minimum_relevance_score_frozen ? ["BENCHMARK_MIN_RELEVANCE_SCORE must be fixed from development-query tuning"] : []),
    ...(!gates.hybrid_latency_limit_frozen ? ["BENCHMARK_HYBRID_P95_LIMIT_MS must be fixed before the release run"] : []),
    ...(!gates.reranker_latency_limit_frozen ? ["BENCHMARK_RERANKER_P95_LIMIT_MS must be fixed before the release run"] : []),
  ],
};
await writeFile(resolve(root, "reports/release-gates-v1.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!ready) process.exitCode = 1;
