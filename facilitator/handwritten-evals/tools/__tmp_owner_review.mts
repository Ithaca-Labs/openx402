#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyOwnerReview, readJsonl } from "./grading-pipeline.js";

const ROOT = resolve(import.meta.dirname, "..");
const SEALED = "/home/soumy/sealed/stellar-bazaar-v2";
const createdAt = "2026-08-08T14:05:00.000Z";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main(): Promise<void> {
  const [queries, rawQrels, rawCalibration, ownerDecisions] = await Promise.all([
    readJsonl(resolve(ROOT, "queries/queries-v2.jsonl")),
    readJsonl(resolve(SEALED, "raw-agent-v2.jsonl")),
    readJsonl(resolve(SEALED, "calibration-raw-v2.jsonl")),
    readJson(resolve(SEALED, "owner-decisions-v2.json")),
  ]);

  const result = applyOwnerReview(queries, rawQrels, rawCalibration, ownerDecisions, createdAt, (queries as unknown[]).length);

  await mkdir(resolve(ROOT, "reports"), { recursive: true });

  await writeFile(
    resolve(ROOT, "qrels/development-v2.jsonl"),
    `${result.developmentQrels.map(r => JSON.stringify(r)).join("\n")}\n`,
  );
  await writeFile(
    resolve(SEALED, "release-qrels.jsonl"),
    `${result.releaseQrels.map(r => JSON.stringify(r)).join("\n")}\n`,
  );
  await writeFile(
    resolve(SEALED, "calibration-v2.jsonl"),
    `${result.reviewedCalibration.map(r => JSON.stringify(r)).join("\n")}\n`,
  );
  await writeFile(
    resolve(SEALED, "owner-review-full-v2.json"),
    `${JSON.stringify(result.report, null, 2)}\n`,
  );
  await writeFile(
    resolve(ROOT, "reports/owner-review-v2.json"),
    `${JSON.stringify(result.publicSummary, null, 2)}\n`,
  );

  console.log("development qrels:", result.developmentQrels.length);
  console.log("release qrels (sealed):", result.releaseQrels.length);
  console.log("reviewed calibration:", result.reviewedCalibration.length);
  console.log("report pairs:", result.report.pairs);
  console.log("report queries:", result.report.queries);
  console.log("excluded pairs:", result.report.excluded_pairs.length);
  console.log("corrected pairs:", result.report.corrected_pairs.length);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
