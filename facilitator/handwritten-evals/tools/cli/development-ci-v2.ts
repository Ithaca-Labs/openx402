#!/usr/bin/env node

/** Development-only benchmark execution for BUILD-PLAN §12.1. */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { QrelRecordSchema, type QrelRecord } from "../../schema/schema-v2.js";
import { OwnerReviewPublicSummarySchema } from "../lib/grading-pipeline.js";
import { DATASET_MANIFEST_PATH } from "../lib/manifest-v2.js";
import { loadSystemRuns, loadV2Dataset } from "../lib/pool.js";
import { verifyPoolSnapshot } from "../lib/pool-snapshot-v2.js";
import {
  EvaluationReportDraftV2Schema,
  LimitationsEvidenceSchema,
  buildEvaluationReport,
  scoringRunsFromPoolRuns,
} from "../lib/report-v2.js";
import { verifyFrozenDataset } from "../lib/release-run-ledger-v2.js";

export const DevelopmentCiNotReadyV2Schema = z.object({
  schema_version: z.literal("2.0.0"),
  contract: z.literal("stellar-bazaar-development-ci-v2"),
  status: z.literal("not_ready"),
  query_count: z.literal(0),
  reason: z.literal("frozen dataset manifest is not present; development benchmark activates automatically after Step 6"),
}).strict();

export const DevelopmentCiResultV2Schema = z.union([
  DevelopmentCiNotReadyV2Schema,
  EvaluationReportDraftV2Schema.refine(report => report.split === "development", {
    message: "CI report must be development split",
  }),
]);

export type DevelopmentCiResultV2 = z.infer<typeof DevelopmentCiResultV2Schema>;

async function qrels(path: string): Promise<QrelRecord[]> {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      return [QrelRecordSchema.parse(JSON.parse(line))];
    } catch (error) {
      throw new Error(`${path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Executes and scores exactly the 50 development queries; no holdout path is accepted. */
export async function runDevelopmentCi(rootInput: string): Promise<DevelopmentCiResultV2> {
  const root = resolve(rootInput);
  if (!await exists(resolve(root, DATASET_MANIFEST_PATH))) {
    return DevelopmentCiNotReadyV2Schema.parse({
      schema_version: "2.0.0",
      contract: "stellar-bazaar-development-ci-v2",
      status: "not_ready",
      query_count: 0,
      reason: "frozen dataset manifest is not present; development benchmark activates automatically after Step 6",
    });
  }

  const frozen = await verifyFrozenDataset(root);
  await verifyPoolSnapshot(root);
  const [dataset, developmentQrels, ownerReview, limitations] = await Promise.all([
    loadV2Dataset(root),
    qrels(resolve(root, "qrels/development-v2.jsonl")),
    readFile(resolve(root, "reports/owner-review-v2.json"), "utf8")
      .then(text => OwnerReviewPublicSummarySchema.parse(JSON.parse(text))),
    readFile(resolve(root, "reports/limitations-v2.json"), "utf8")
      .then(text => LimitationsEvidenceSchema.parse(JSON.parse(text))),
  ]);
  const developmentIds = new Set(dataset.queries
    .filter(query => query.split === "development")
    .map(query => query.query_id));
  if (developmentIds.size !== 50) throw new Error(`development CI requires exactly 50 query IDs, found ${developmentIds.size}`);
  if (developmentQrels.some(qrel => !developmentIds.has(qrel.query_id))) {
    throw new Error("development qrels contain a judgment outside the development split");
  }
  const judgedQueryIds = new Set(developmentQrels.map(qrel => qrel.query_id));
  const missingJudgments = [...developmentIds].filter(queryId => !judgedQueryIds.has(queryId));
  if (missingJudgments.length > 0) {
    throw new Error(`development qrels omit queries: ${missingJudgments.slice(0, 10).join(", ")}`);
  }

  const queryIds = new Set(dataset.queries.map(query => query.query_id));
  const resourceIds = new Set(dataset.catalog.map(record => record.resource_id));
  const runs = await loadSystemRuns(resolve(root, "runs"), queryIds, resourceIds);
  const pairRates = ownerReview.development.pairs;
  return DevelopmentCiResultV2Schema.parse(buildEvaluationReport(
    dataset.queries,
    developmentQrels,
    scoringRunsFromPoolRuns(runs, developmentIds),
    {
      split: "development",
      generatedAt: process.env.BENCHMARK_RUN_AT ?? new Date().toISOString(),
      datasetManifestSha256: frozen.manifestSha256,
      ownerRates: {
        reviewed: pairRates.total,
        corrected: pairRates.corrected,
        rejected: pairRates.rejected,
        correction_rate: pairRates.correction_rate,
        rejection_rate: pairRates.rejection_rate,
      },
      limitations: limitations.limitations,
      plantedNegativeResourceIds: new Set(dataset.sidecars
        .filter(record => record.adversarial_kind !== null)
        .map(record => record.resource_id)),
    },
  ));
}

export async function runDevelopmentCiCli(argv: string[]): Promise<void> {
  const root = resolve(argv[0] ?? resolve(import.meta.dirname, "../.."));
  const output = resolve(argv[1] ?? resolve(root, "reports/development-ci-v2.json"));
  const result = await runDevelopmentCi(root);
  if (result.status === "not_ready") {
    console.log(`development benchmark: 0 records (${result.reason})`);
    return;
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`development benchmark: ${result.query_count} queries, 5 systems -> ${output}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runDevelopmentCiCli(process.argv.slice(2)).catch(error => {
    console.error(error);
    process.exit(1);
  });
}
