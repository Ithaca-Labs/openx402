#!/usr/bin/env node

/** BUILD-PLAN §10 report CLI. Development is the safe default; release requires a started ledger event. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { QrelRecordSchema, type QrelRecord } from "../schema/schema-v2.js";
import { OwnerReviewReportSchema } from "./grading-pipeline.js";
import { loadSystemRuns, loadV2Dataset } from "./pool.js";
import {
  buildEvaluationReport,
  LimitationsEvidenceSchema,
  PilotReportEvidenceSchema,
  scoringRunsFromPoolRuns,
} from "./report-v2.js";
import { readReleaseRunLedger, verifyFrozenDataset } from "./release-run-ledger-v2.js";

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: ${(error as Error).message}`);
  }
}

async function readQrels(path: string): Promise<QrelRecord[]> {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new Error(`${path}:${index + 1}: invalid JSON: ${(error as Error).message}`);
    }
    const parsed = QrelRecordSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`${path}:${index + 1}: ${parsed.error.message}`);
    return [parsed.data];
  });
}

async function assertStartedReleaseRun(root: string, runId: string, manifestSha256: string): Promise<void> {
  const ledger = await readReleaseRunLedger(resolve(root, "manifests/release-runs-v2.jsonl"));
  const entries = ledger.filter(entry => entry.run_id === runId);
  const started = entries.filter(entry => entry.phase === "started");
  if (started.length !== 1 || entries.some(entry => entry.phase !== "started")) {
    throw new Error(
      `${runId}: release report requires exactly one unterminated started ledger event; `
      + "record it with release-run-ledger-v2.ts before accessing release qrels",
    );
  }
  if (started[0]!.dataset_manifest_sha256 !== manifestSha256) {
    throw new Error(`${runId}: ledger event references a different frozen manifest`);
  }
}

async function main(): Promise<void> {
  const [splitArg, releaseRunIdArg, rootArg] = process.argv.slice(2);
  if (splitArg !== "development" && splitArg !== "release") {
    throw new Error("usage: tsx tools/generate-report-v2.ts development [dataset-root] | release <release-run-id> [dataset-root]");
  }
  const split = splitArg;
  const releaseRunId = split === "release" ? releaseRunIdArg : undefined;
  const rootInput = split === "release" ? rootArg : releaseRunIdArg;
  if (split === "release" && !releaseRunId) {
    throw new Error("release report requires a recorded release-run-id");
  }
  const root = resolve(rootInput ?? resolve(import.meta.dirname, ".."));
  const frozen = await verifyFrozenDataset(root);
  if (split === "release") await assertStartedReleaseRun(root, releaseRunId!, frozen.manifestSha256);

  // Release qrels are not touched until the explicit ledger check above succeeds.
  const qrelPath = resolve(root, split === "release" ? "qrels/release-v2.jsonl" : "qrels/development-v2.jsonl");
  const [dataset, qrels, ownerReview, limitations] = await Promise.all([
    loadV2Dataset(root),
    readQrels(qrelPath),
    readJson(resolve(root, "reports/owner-review-v2.json")).then(value => OwnerReviewReportSchema.parse(value)),
    readJson(resolve(root, "reports/limitations-v2.json")).then(value => LimitationsEvidenceSchema.parse(value)),
  ]);
  const selectedIds = new Set(dataset.queries.filter(query => query.split === split).map(query => query.query_id));
  if (qrels.some(qrel => !selectedIds.has(qrel.query_id))) {
    throw new Error(`${qrelPath}: contains a qrel outside the ${split} split`);
  }

  const resourceIds = new Set(dataset.catalog.map(record => record.resource_id));
  const allQueryIds = new Set(dataset.queries.map(record => record.query_id));
  const poolRuns = await loadSystemRuns(resolve(root, "runs"), allQueryIds, resourceIds);
  let pilotThreshold: number | undefined;
  if (split === "release") {
    const pilot = PilotReportEvidenceSchema.parse(await readJson(resolve(root, "reports/pilot-v2.json")));
    pilotThreshold = pilot.judged_at_10_threshold;
  }
  const pairRates = ownerReview.pairs;
  const report = buildEvaluationReport(dataset.queries, qrels, scoringRunsFromPoolRuns(poolRuns, selectedIds), {
    split,
    generatedAt: process.env.BENCHMARK_RUN_AT ?? new Date().toISOString(),
    datasetManifestSha256: frozen.manifestSha256,
    ...(pilotThreshold === undefined ? {} : { pilotJudgedAt10Threshold: pilotThreshold }),
    ownerRates: {
      reviewed: pairRates.total,
      corrected: pairRates.corrected,
      rejected: pairRates.rejected,
      correction_rate: pairRates.correction_rate,
      rejection_rate: pairRates.rejection_rate,
    },
    limitations: limitations.limitations,
  });
  const output = resolve(root, split === "release" ? "reports/final-v2.json" : "reports/development-v2.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(`${split} report: ${report.query_count} queries, 5 systems -> ${output}`);
  if (split === "release") {
    console.log(`owner review required; then append a completed ${releaseRunId} ledger event with --report ${output}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
