#!/usr/bin/env node
/** 9-config local stability check around the winning region: dense weight in
 * {0.75, 0.80, 0.85} x k in {5, 6, 7}. Not another improvement hunt — just
 * confirming the neighborhood holds. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scoreRun, type EvalQuery, type RunResult } from "./scoring.js";

const ROOT = resolve(import.meta.dirname, "..");

interface RankedResult { resource_id: string; rank: number; score?: number }
interface SystemRecord { query_id: string; results: RankedResult[] }

async function readJsonl(path: string): Promise<any[]> {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
}

function toResults(records: SystemRecord[], queryIds: string[]): RunResult[] {
  const byQuery = new Map(records.map(r => [r.query_id, r]));
  return queryIds.map(qid => {
    const record = byQuery.get(qid);
    if (!record) return { queryId: qid, ranking: [] };
    const ranking = [...record.results].sort((a, b) => a.rank - b.rank).map(r => r.resource_id);
    return { queryId: qid, ranking };
  });
}

function weightedRrf(bm25: SystemRecord[], dense: SystemRecord[], bm25Weight: number, denseWeight: number, k: number, depth = 20): SystemRecord[] {
  const byQueryDense = new Map(dense.map(r => [r.query_id, r]));
  return bm25.map(bm25Record => {
    const denseRecord = byQueryDense.get(bm25Record.query_id);
    const scores = new Map<string, number>();
    bm25Record.results.forEach((r, i) => {
      const rank = i + 1;
      scores.set(r.resource_id, (scores.get(r.resource_id) ?? 0) + bm25Weight / (k + rank));
    });
    (denseRecord?.results ?? []).forEach((r, i) => {
      const rank = i + 1;
      scores.set(r.resource_id, (scores.get(r.resource_id) ?? 0) + denseWeight / (k + rank));
    });
    const ranked = [...scores.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    return { query_id: bm25Record.query_id, results: ranked.slice(0, depth).map(([resource_id, score], i) => ({ resource_id, rank: i + 1, score })) };
  });
}

async function main(): Promise<void> {
  const [queries, sidecars, qrels, bm25, dense] = await Promise.all([
    readJsonl(resolve(ROOT, "queries/queries-v2.jsonl")),
    readJsonl(resolve(ROOT, "catalog/sidecar-v2.jsonl")),
    readJsonl(resolve(ROOT, "qrels/development-v2.jsonl")),
    readJsonl(resolve(ROOT, "runs/bm25-v2.jsonl")),
    readJsonl(resolve(ROOT, "runs/exact-dense-v2.jsonl")),
  ]);

  const devQueries = queries.filter((q: any) => q.split === "development");
  const devQueryIds = devQueries.map((q: any) => q.query_id);
  const devQueryIdSet = new Set(devQueryIds);
  const plantedNegatives = new Set(
    sidecars.filter((s: any) => s.adversarial_kind !== null && s.adversarial_kind !== undefined).map((s: any) => s.resource_id),
  );
  const judgmentsByQuery = new Map<string, { resourceId: string; grade: number; isPlantedNegative: boolean }[]>();
  for (const q of qrels) {
    if (!devQueryIdSet.has(q.query_id)) continue;
    const bucket = judgmentsByQuery.get(q.query_id) ?? [];
    bucket.push({ resourceId: q.resource_id, grade: q.grade, isPlantedNegative: plantedNegatives.has(q.resource_id) });
    judgmentsByQuery.set(q.query_id, bucket);
  }
  const evalQueries: EvalQuery[] = devQueries.map((q: any) => ({
    queryId: q.query_id, queryClass: q.query_class, expectsNoResult: q.expects_no_result,
    judgments: judgmentsByQuery.get(q.query_id) ?? [],
  }));

  function evaluate(records: SystemRecord[]) {
    const { metrics } = scoreRun(evalQueries, toResults(records, devQueryIds));
    return {
      mrr: metrics.mrr.value ?? NaN,
      ndcg10: metrics.ndcg[10]?.value ?? NaN,
      recall20: metrics.recall[20]?.value ?? NaN,
      bpref: metrics.bpref.value ?? NaN,
    };
  }

  console.log(`${"dense/bm25".padEnd(12)} ${"k".padStart(3)} ${"MRR".padStart(7)} ${"nDCG@10".padStart(8)} ${"Rec@20".padStart(7)} ${"bpref".padStart(7)}`);
  for (const denseWeight of [0.75, 0.80, 0.85]) {
    const bm25Weight = 1 - denseWeight;
    for (const k of [5, 6, 7]) {
      const r = evaluate(weightedRrf(bm25, dense, bm25Weight, denseWeight, k));
      console.log(
        `${`${denseWeight.toFixed(2)}/${bm25Weight.toFixed(2)}`.padEnd(12)} ${String(k).padStart(3)} ${r.mrr.toFixed(4).padStart(7)} ${r.ndcg10.toFixed(4).padStart(8)} ${r.recall20.toFixed(4).padStart(7)} ${r.bpref.toFixed(4).padStart(7)}`,
      );
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
