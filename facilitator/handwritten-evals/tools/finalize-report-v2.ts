#!/usr/bin/env node

/** Owner-signoff finalizer for immutable BUILD-PLAN §10 release reports. */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { QrelRecordSchema, type QrelRecord } from "../schema/schema-v2.js";
import { writeArtifactBundleExclusive } from "./grading-pipeline.js";
import { loadSystemRuns, loadV2Dataset } from "./pool.js";
import {
  EvaluationReportDraftV2Schema,
  evaluationInputHashes,
  finalizeEvaluationReport,
  scoringRunsFromPoolRuns,
} from "./report-v2.js";
import {
  readReleaseRunLedger,
  releaseReportCompletionPath,
  releaseReportDraftPath,
  releaseReportOutputPaths,
  verifyFrozenDataset,
} from "./release-run-ledger-v2.js";

async function json(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { throw new Error(`${path}: ${(error as Error).message}`); }
}

async function jsonl(path: string): Promise<QrelRecord[]> {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try { return [QrelRecordSchema.parse(JSON.parse(line))]; }
    catch (error) { throw new Error(`${path}:${index + 1}: ${(error as Error).message}`); }
  });
}

async function main(): Promise<void> {
  const [runId, signoffInput, rootInput] = process.argv.slice(2);
  if (!runId || !signoffInput) {
    throw new Error("usage: tsx tools/finalize-report-v2.ts <release-run-id> <owner-signoff.json> [dataset-root]");
  }
  const root = resolve(rootInput ?? resolve(import.meta.dirname, ".."));
  const frozen = await verifyFrozenDataset(root);
  const ledger = await readReleaseRunLedger(resolve(root, "manifests/release-runs-v2.jsonl"), root);
  const runEntries = ledger.filter(entry => entry.run_id === runId);
  const started = runEntries.filter(entry => entry.phase === "started");
  if (started.length !== 1 || runEntries.length !== 1) {
    throw new Error(`${runId}: finalization requires exactly one unterminated started ledger event`);
  }
  const start = started[0]!;
  if (start.dataset_manifest_sha256 !== frozen.manifestSha256) {
    throw new Error(`${runId}: frozen dataset differs from the started event`);
  }

  // Release qrels remain inaccessible until the ledger authorization above succeeds.
  const draftPath = resolve(root, releaseReportDraftPath(runId, start.purpose));
  const qrelPath = resolve(root, "qrels/release-v2.jsonl");
  const [draftRaw, signoff, dataset, qrels] = await Promise.all([
    json(draftPath),
    json(resolve(signoffInput)),
    loadV2Dataset(root),
    jsonl(qrelPath),
  ]);
  const draft = EvaluationReportDraftV2Schema.parse(draftRaw);
  if (draft.split !== "release" || draft.dataset_manifest_sha256 !== frozen.manifestSha256) {
    throw new Error("draft does not belong to this frozen release dataset");
  }
  const releaseIds = new Set(dataset.queries.filter(query => query.split === "release").map(query => query.query_id));
  if (qrels.some(qrel => !releaseIds.has(qrel.query_id))) throw new Error("release qrel file contains a non-release query");
  const resourceIds = new Set(dataset.catalog.map(record => record.resource_id));
  const allQueryIds = new Set(dataset.queries.map(record => record.query_id));
  const canonicalRuns = await loadSystemRuns(resolve(root, "runs"), allQueryIds, resourceIds);
  const scoringRuns = scoringRunsFromPoolRuns(canonicalRuns, releaseIds);
  const currentHashes = evaluationInputHashes(dataset.queries, qrels, scoringRuns, "release");
  if (JSON.stringify(currentHashes) !== JSON.stringify(draft.input_hashes)) {
    throw new Error("draft inputs are stale relative to current release qrels or system runs");
  }

  const approved = finalizeEvaluationReport(draft, signoff);
  const relativeOutputs = releaseReportOutputPaths(runId, start.purpose);
  await writeArtifactBundleExclusive(relativeOutputs.map(path => ({ path: resolve(root, path), value: approved })));
  console.log(`approved release report -> ${relativeOutputs.join(", ")}`);
  console.log(
    `record completion with release-run-ledger-v2.ts --phase completed --run-id ${runId} `
    + `--purpose ${start.purpose} --report ${releaseReportCompletionPath(runId, start.purpose)}`,
  );
}

main().catch(error => { console.error(error); process.exit(1); });
