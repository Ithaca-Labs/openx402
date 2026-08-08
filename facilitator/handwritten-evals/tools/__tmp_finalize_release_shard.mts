#!/usr/bin/env node
/**
 * One-off: finalize one release-grading shard directly via grading-pipeline.ts's library
 * functions (with an expectedCounts override matching the shard), since run-grading-pipeline.ts's
 * CLI hardcodes full-100-query validation and cannot finalize a sharded prepare.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildGradingProcessAudit, finalizeGrading, parsePrerequisites, readJsonl } from "./grading-pipeline.js";

const ROOT = resolve(import.meta.dirname, "..");
const SEALED = "/home/soumy/.claude/jobs/6e0348e9/tmp/release-grading-sealed";
const shardId = process.argv[2]!;
const createdAt = "2026-08-08T00:00:00.000Z";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main(): Promise<void> {
  const shardSourcesDir = resolve(SEALED, "shard-sources");
  const [queries, catalog, sidecars, pool] = await Promise.all([
    readJsonl(resolve(shardSourcesDir, `${shardId}-queries.jsonl`)),
    readJsonl(resolve(ROOT, "catalog/catalog-v2.jsonl")),
    readJsonl(resolve(ROOT, "catalog/sidecar-v2.jsonl")),
    readJsonl(resolve(shardSourcesDir, `${shardId}-pool.jsonl`)),
  ]);
  const raw = { queries, catalog, sidecars, pool };
  const expectedCounts = { queries: (queries as unknown[]).length, catalog: (catalog as unknown[]).length, sidecars: (sidecars as unknown[]).length };

  const [manifest, graderAPack, graderBPack, graderAImport, graderBImport] = await Promise.all([
    readJson(resolve(SEALED, `release/manifests/${shardId}.json`)),
    readJson(resolve(ROOT, `staging/grading/release/${shardId}-grader-a-pack.json`)),
    readJson(resolve(ROOT, `staging/grading/release/${shardId}-grader-b-pack.json`)),
    readJson(resolve(SEALED, `imports/${shardId}-grader-a-import.json`)),
    readJson(resolve(SEALED, `imports/${shardId}-grader-b-import.json`)),
  ]);

  const sources = parsePrerequisites(raw, expectedCounts);
  const result = finalizeGrading(sources, manifest, graderAImport, graderBImport, null, null, createdAt, expectedCounts);
  const processAudit = buildGradingProcessAudit({
    sources: raw,
    gradingManifest: manifest,
    graderAPack, graderBPack,
    graderAImport, graderBImport,
    adjudicationManifest: null, adjudicationPack: null, adjudicatorImport: null,
  }, createdAt, expectedCounts);

  const finalizedDir = resolve(ROOT, "staging/grading/release-finalized");
  await mkdir(finalizedDir, { recursive: true });
  await writeFile(resolve(SEALED, `${shardId}-qrels.jsonl`), `${result.qrels.map(r => JSON.stringify(r)).join("\n")}\n`);
  await writeFile(resolve(SEALED, `${shardId}-calibration.jsonl`), `${result.calibration.map(r => JSON.stringify(r)).join("\n")}\n`);
  await writeFile(resolve(finalizedDir, `${shardId}-agreement.json`), `${JSON.stringify(result.agreementReport, null, 2)}\n`);
  await writeFile(resolve(finalizedDir, `${shardId}-process-audit.json`), `${JSON.stringify(processAudit, null, 2)}\n`);

  console.log(`${shardId}: merged ${result.qrels.length} judged pairs; ${result.agreementReport.disagreement_count} disagreements; process audit status=${processAudit.status}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
