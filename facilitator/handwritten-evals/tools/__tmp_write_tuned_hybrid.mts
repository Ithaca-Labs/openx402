#!/usr/bin/env node
/** Writes the winning fusion config (weighted RRF, k=6, dense=0.8/bm25=0.2) from the
 * search experiments to runs/hybrid-v2.jsonl — a tuned stand-in for the real
 * production hybrid system (not yet wired to the live facilitator search). */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const K = 6;
const DENSE_WEIGHT = 0.8;
const BM25_WEIGHT = 0.2;
const POOL_DEPTH = 20;

interface RankedResult { resource_id: string; rank: number; score?: number }
interface SystemRecord { query_id: string; run_id: string; results: RankedResult[] }

async function readJsonl(path: string): Promise<SystemRecord[]> {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
}

async function main(): Promise<void> {
  const [bm25, dense] = await Promise.all([
    readJsonl(resolve(ROOT, "runs/bm25-v2.jsonl")),
    readJsonl(resolve(ROOT, "runs/exact-dense-v2.jsonl")),
  ]);
  const denseByQuery = new Map(dense.map(r => [r.query_id, r]));
  const generatedAt = "2026-08-08T15:00:00.000Z";
  const runId = "tuned-hybrid-experiment-v1";

  const records = bm25.map(bm25Record => {
    const denseRecord = denseByQuery.get(bm25Record.query_id);
    const scores = new Map<string, number>();
    bm25Record.results.forEach((r, i) => {
      const rank = i + 1;
      scores.set(r.resource_id, (scores.get(r.resource_id) ?? 0) + BM25_WEIGHT / (K + rank));
    });
    (denseRecord?.results ?? []).forEach((r, i) => {
      const rank = i + 1;
      scores.set(r.resource_id, (scores.get(r.resource_id) ?? 0) + DENSE_WEIGHT / (K + rank));
    });
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const results = ranked.slice(0, POOL_DEPTH).map(([resource_id, score], i) => ({ resource_id, rank: i + 1, score }));
    return {
      system: "hybrid",
      query_id: bm25Record.query_id,
      run_id: runId,
      generated_at: generatedAt,
      latency_ms: 0,
      requested_depth: POOL_DEPTH,
      total_results: ranked.length,
      results,
    };
  });

  await writeFile(resolve(ROOT, "runs/hybrid-v2.jsonl"), records.map(r => JSON.stringify(r)).join("\n") + "\n");
  console.log(`wrote runs/hybrid-v2.jsonl: ${records.length} queries, formula = weighted RRF k=${K}, dense=${DENSE_WEIGHT}/bm25=${BM25_WEIGHT}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
