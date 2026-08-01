import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateReleaseDataset } from "../search/release/validate.js";

const root = resolve(process.argv[2] ?? "eva-datasetl");
const dataset = await validateReleaseDataset(root);
const calibration = await readFile(resolve(root, "reports/calibration-v1.json"), "utf8").then(JSON.parse).catch(() => null) as { passes?: boolean } | null;
const bge = await readFile(resolve(root, "reports/bge-m3-local-v1.json"), "utf8").then(JSON.parse).catch(() => null) as { status?: string } | null;
const gates = {
  dataset_valid: true,
  wire_validation_errors: 0,
  exact_resource_count: dataset.catalog.length === 300,
  exact_query_count: dataset.queries.length === 100,
  exact_qrel_count: dataset.qrels.length === 30_000,
  pending_qrels: dataset.qrels.filter(value => value.judge === "pending").length,
  provisional_qrels: dataset.qrels.filter(value => value.provisional).length,
  openrouter_candidates: dataset.queries.every(value => value.derived_from.kind === "openrouter")
    && dataset.sidecars.filter(value => value.source_class === "generated_mcp").every(value => value.derived_from.kind === "openrouter"),
  human_calibration_passed: calibration?.passes === true,
  bge_m3_report_passed: bge?.status === "pass",
  real_reranker_configured: Boolean(process.env.FACILITATOR_RERANKER_URL),
  isolated_database_configured: Boolean(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL),
};
const passed = Object.values(gates).every(value => value === true || value === 0);
const report = {
  generated_at: new Date().toISOString(), status: passed ? "pass" : "blocked", gates,
  blockers: [
    ...(gates.pending_qrels ? [`${gates.pending_qrels} eligible pairs need OpenRouter judgments`] : []),
    ...(gates.provisional_qrels ? [`${gates.provisional_qrels} qrels remain provisional until human calibration passes`] : []),
    ...(!gates.openrouter_candidates ? ["OpenRouter candidate generation has not replaced the curated fallback"] : []),
    ...(!gates.human_calibration_passed ? ["human calibration is incomplete or below threshold"] : []),
    ...(!gates.real_reranker_configured ? ["FACILITATOR_RERANKER_URL is unset; reranked profile unavailable and production reranking stays off"] : []),
    ...(!gates.isolated_database_configured ? ["TEST_DATABASE_URL/DATABASE_URL is unset; PostgreSQL/pgvector release run unavailable"] : []),
  ],
};
await writeFile(resolve(root, "reports/release-gates-v1.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!passed) process.exitCode = 1;
