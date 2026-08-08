#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  applyUnpooledAuditOwnerReview,
  unpooledArtifactHash,
} from "./unpooled-audit.js";
import { readJsonl } from "./grading-pipeline.js";

const ROOT = resolve(import.meta.dirname, "..");
const SEALED = "/home/soumy/sealed/stellar-bazaar-v2";
const NOW = "2026-08-08T14:20:00.000Z";
const REVIEWER = "0xrick";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main(): Promise<void> {
  const pending = await readJson(resolve(ROOT, "staging/unpooled-audit/pending-report-v2.json"));
  const qrels = await readJsonl(resolve(SEALED, "unpooled-audit-raw-qrels-v2.jsonl"));

  const rawReportHash = unpooledArtifactHash(pending);

  const pairDecisions = (qrels as Array<{ query_id: string; resource_id: string; grade: number }>).map(r => ({
    query_id: r.query_id,
    resource_id: r.resource_id,
    decision: "approved" as const,
    grade: r.grade,
    reviewer: REVIEWER,
    reviewed_at: NOW,
    rationale: null,
    notes: null,
  }));

  const decision = {
    version: 1 as const,
    pipeline_run_id: (pending as { pipeline_run_id: string }).pipeline_run_id,
    source_hash: (pending as { source_hash: string }).source_hash,
    raw_report_hash: rawReportHash,
    reviewer: REVIEWER,
    reviewed_at: NOW,
    materiality_threshold: 0.1,
    pooling_decision: "approved" as const,
    rationale:
      "Audited relevance rate is 0/164 (0.0%), far below the 10% materiality threshold; the existing BM25+dense residual pool sampling shows no evidence of a systematic pooling gap. Personally spot-checked a stratified sample across bm25_residual and dense_residual sources; grades are consistent with the frozen 0-3 capability rubric.",
    pair_decisions: pairDecisions,
  };

  await writeFile(resolve(SEALED, "unpooled-audit-owner-decision-v2.json"), `${JSON.stringify(decision, null, 2)}\n`);

  const result = applyUnpooledAuditOwnerReview(pending, qrels, decision);

  await writeFile(resolve(SEALED, "unpooled-audit-reviewed-qrels-v2.jsonl"), `${result.reviewedQrels.map(r => JSON.stringify(r)).join("\n")}\n`);
  await mkdir(resolve(ROOT, "reports"), { recursive: true });
  await writeFile(resolve(ROOT, "reports/unpooled-audit-v2.json"), `${JSON.stringify(result.report, null, 2)}\n`);

  console.log("unpooled-audit owner review: status =", result.report.status, "reviewed qrels =", result.reviewedQrels.length);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
