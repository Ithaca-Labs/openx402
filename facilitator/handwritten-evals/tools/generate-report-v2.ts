#!/usr/bin/env node

/** BUILD-PLAN §10 report CLI. Development is the safe default; release requires a started ledger event. */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { QrelRecordSchema, type QrelRecord } from "../schema/schema-v2.js";
import { OwnerReviewPublicSummarySchema, writeArtifactBundleExclusive } from "./grading-pipeline.js";
import { RELEASE_QRELS_ENV_NAME, resolveSealedReleaseQrelsPath } from "./holdout-v2.js";
import { loadSystemRuns, loadV2Dataset } from "./pool.js";
import { verifyPoolSnapshot } from "./pool-snapshot-v2.js";
import {
  buildEvaluationReport,
  LimitationsEvidenceSchema,
  PilotReportEvidenceSchema,
  scoringRunsFromPoolRuns,
} from "./report-v2.js";
import {
  readReleaseRunLedger,
  releaseReportDraftPath,
  verifyFrozenDataset,
  type ReleaseRunLedgerEntryV2,
} from "./release-run-ledger-v2.js";

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

async function assertStartedReleaseRun(
  root: string,
  runId: string,
  manifestSha256: string,
): Promise<ReleaseRunLedgerEntryV2> {
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
  return started[0]!;
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
  await verifyPoolSnapshot(root);
  const releaseStart = split === "release"
    ? await assertStartedReleaseRun(root, releaseRunId!, frozen.manifestSha256)
    : undefined;

  // Release qrels are not resolved or touched until the explicit ledger check above succeeds.
  const qrelPath = split === "release"
    ? await resolveSealedReleaseQrelsPath(root, process.env[RELEASE_QRELS_ENV_NAME])
    : resolve(root, "qrels/development-v2.jsonl");
  const [dataset, qrels, ownerReview, limitations] = await Promise.all([
    loadV2Dataset(root),
    readQrels(qrelPath),
    readJson(resolve(root, "reports/owner-review-v2.json")).then(value => OwnerReviewPublicSummarySchema.parse(value)),
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
  const pairRates = ownerReview[split].pairs;
  const plantedNegativeResourceIds = new Set(dataset.sidecars
    .filter(record => record.adversarial_kind !== null)
    .map(record => record.resource_id));
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
    plantedNegativeResourceIds,
  });
  const relativeOutputs = split === "release"
    ? [releaseReportDraftPath(releaseRunId!, releaseStart!.purpose)]
    : ["reports/development-v2.json"];
  const outputs = relativeOutputs.map(path => resolve(root, path));
  await writeArtifactBundleExclusive(outputs.map(path => ({ path, value: report })));
  console.log(`${split} report: ${report.query_count} queries, 5 systems -> ${outputs.join(", ")}`);
  if (split === "release") {
    console.log(
      `owner review required; finalize the preserved draft with finalize-report-v2.ts ${releaseRunId} <signoff.json>`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
