#!/usr/bin/env node
/** Search experiments: tune fusion of bm25 + exact_dense against dev qrels.
 * Compares equal-weight RRF (current hybrid_exact), weighted RRF sweeps,
 * RRF-k sweeps, and min-max normalized score fusion. Reports the best config. */
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

/** Weighted RRF: score = wA / (k + rankA) + wB / (k + rankB), missing ranks excluded. */
function weightedRrf(a: SystemRecord[], b: SystemRecord[], weightA: number, weightB: number, k: number, depth = 20): SystemRecord[] {
  const byQueryB = new Map(b.map(r => [r.query_id, r]));
  return a.map(recordA => {
    const recordB = byQueryB.get(recordA.query_id);
    const scores = new Map<string, number>();
    recordA.results.forEach((r, i) => {
      const rank = i + 1;
      scores.set(r.resource_id, (scores.get(r.resource_id) ?? 0) + weightA / (k + rank));
    });
    (recordB?.results ?? []).forEach((r, i) => {
      const rank = i + 1;
      scores.set(r.resource_id, (scores.get(r.resource_id) ?? 0) + weightB / (k + rank));
    });
    const ranked = [...scores.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    return {
      query_id: recordA.query_id,
      results: ranked.slice(0, depth).map(([resource_id, score], i) => ({ resource_id, rank: i + 1, score })),
    };
  });
}

/** Min-max normalized weighted score fusion: normalize each ranker's raw scores to [0,1] per query, then weighted sum. */
function normalizedScoreFusion(a: SystemRecord[], b: SystemRecord[], weightA: number, weightB: number, depth = 20): SystemRecord[] {
  const byQueryB = new Map(b.map(r => [r.query_id, r]));
  function normalize(results: RankedResult[]): Map<string, number> {
    const scores = results.map(r => r.score ?? 0);
    const min = Math.min(...scores, 0);
    const max = Math.max(...scores, 0);
    const range = max - min || 1;
    return new Map(results.map(r => [r.resource_id, ((r.score ?? 0) - min) / range]));
  }
  return a.map(recordA => {
    const recordB = byQueryB.get(recordA.query_id);
    const normA = normalize(recordA.results);
    const normB = normalize(recordB?.results ?? []);
    const ids = new Set([...normA.keys(), ...normB.keys()]);
    const scores = new Map<string, number>();
    for (const id of ids) {
      scores.set(id, weightA * (normA.get(id) ?? 0) + weightB * (normB.get(id) ?? 0));
    }
    const ranked = [...scores.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    return {
      query_id: recordA.query_id,
      results: ranked.slice(0, depth).map(([resource_id, score], i) => ({ resource_id, rank: i + 1, score })),
    };
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
    queryId: q.query_id,
    queryClass: q.query_class,
    expectsNoResult: q.expects_no_result,
    judgments: judgmentsByQuery.get(q.query_id) ?? [],
  }));

  function evaluate(label: string, records: SystemRecord[]) {
    const results = toResults(records, devQueryIds);
    const { metrics } = scoreRun(evalQueries, results);
    return {
      label,
      mrr: metrics.mrr.value ?? NaN,
      ndcg10: metrics.ndcg[10]?.value ?? NaN,
      recall20: metrics.recall[20]?.value ?? NaN,
      bpref: metrics.bpref.value ?? NaN,
    };
  }

  const rows: ReturnType<typeof evaluate>[] = [];

  rows.push(evaluate("bm25 only", bm25));
  rows.push(evaluate("exact_dense only", dense));
  rows.push(evaluate("hybrid_exact (equal weight RRF, k=20) [CURRENT]", weightedRrf(bm25, dense, 1, 1, 20)));

  // Weighted RRF sweep at k=20
  for (const denseWeight of [0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]) {
    const bm25Weight = 1 - denseWeight;
    rows.push(evaluate(`weighted RRF k=20, dense=${denseWeight}/bm25=${bm25Weight.toFixed(2)}`, weightedRrf(bm25, dense, bm25Weight, denseWeight, 20)));
  }

  // Fine refinement around the best region found in the first sweep
  for (const k of [1, 2, 3, 4, 5, 6, 7, 8, 10, 15]) {
    for (const denseWeight of [0.7, 0.75, 0.8, 0.85, 0.9]) {
      const bm25Weight = 1 - denseWeight;
      rows.push(evaluate(`refine RRF k=${k}, dense=${denseWeight}/bm25=${bm25Weight.toFixed(2)}`, weightedRrf(bm25, dense, bm25Weight, denseWeight, k)));
    }
  }

  // Normalized score fusion sweep
  for (const denseWeight of [0.5, 0.6, 0.7, 0.8, 0.9]) {
    const bm25Weight = 1 - denseWeight;
    rows.push(evaluate(`normalized score fusion, dense=${denseWeight}/bm25=${bm25Weight.toFixed(2)}`, normalizedScoreFusion(bm25, dense, bm25Weight, denseWeight)));
  }

  rows.sort((a, b) => b.mrr - a.mrr);
  console.log(`${"config".padEnd(52)} ${"MRR".padStart(7)} ${"nDCG@10".padStart(8)} ${"Rec@20".padStart(7)} ${"bpref".padStart(7)}`);
  for (const r of rows) {
    console.log(
      `${r.label.padEnd(52)} ${r.mrr.toFixed(4).padStart(7)} ${r.ndcg10.toFixed(4).padStart(8)} ${r.recall20.toFixed(4).padStart(7)} ${r.bpref.toFixed(4).padStart(7)}`,
    );
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
