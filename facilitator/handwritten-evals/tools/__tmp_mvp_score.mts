#!/usr/bin/env node
/** Fastest-path MVP scoring: score whatever run files actually exist against the
 * already-complete, owner-reviewed development qrels. Bypasses the full release-gate
 * ceremony (frozen manifest, pool snapshot, ledger) on purpose. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scoreRun, type EvalQuery, type RunResult } from "./scoring.js";

const ROOT = resolve(import.meta.dirname, "..");

async function readJsonl(path: string): Promise<any[]> {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
}

async function main(): Promise<void> {
  const [queries, sidecars, qrels] = await Promise.all([
    readJsonl(resolve(ROOT, "queries/queries-v2.jsonl")),
    readJsonl(resolve(ROOT, "catalog/sidecar-v2.jsonl")),
    readJsonl(resolve(ROOT, "qrels/development-v2.jsonl")),
  ]);

  const devQueries = queries.filter((q: any) => q.split === "development");
  const devQueryIds = new Set(devQueries.map((q: any) => q.query_id));
  const plantedNegatives = new Set(
    sidecars.filter((s: any) => s.adversarial_kind !== null && s.adversarial_kind !== undefined)
      .map((s: any) => s.resource_id),
  );

  const judgmentsByQuery = new Map<string, { resourceId: string; grade: number; isPlantedNegative: boolean }[]>();
  for (const q of qrels) {
    if (!devQueryIds.has(q.query_id)) continue;
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

  const runFiles: Record<string, string> = {
    bm25_standin: "runs/bm25-v2.jsonl",
    exact_dense_standin: "runs/exact-dense-v2.jsonl",
    hybrid_tuned_standin: "runs/hybrid-v2.jsonl",
    real_lexical: "runs/real-lexical-v2.jsonl",
    real_semantic: "runs/real-semantic-v2.jsonl",
    real_hybrid: "runs/real-hybrid-v2.jsonl",
    real_hybrid_tuned: "runs/real-hybrid-tuned-v2.jsonl",
  };

  console.log(`Scoring ${evalQueries.length} development queries, ${qrels.filter((q: any) => devQueryIds.has(q.query_id)).length} qrels\n`);

  for (const [system, relPath] of Object.entries(runFiles)) {
    const path = resolve(ROOT, relPath);
    let records: any[];
    try {
      records = await readJsonl(path);
    } catch {
      console.log(`[${system}] SKIPPED — ${relPath} not found`);
      continue;
    }
    const byQuery = new Map<string, any>(records.map((r: any) => [r.query_id, r]));
    const results: RunResult[] = devQueries.map((q: any) => {
      const record = byQuery.get(q.query_id);
      if (!record) return { queryId: q.query_id, ranking: [] };
      const ranking = [...record.results].sort((a: any, b: any) => a.rank - b.rank).map((r: any) => r.resource_id);
      return { queryId: q.query_id, ranking, latencyMs: record.latency_ms };
    });

    const { metrics } = scoreRun(evalQueries, results);
    console.log(`=== ${system} (${relPath}) ===`);
    console.log(`  queries scored: ${metrics.queries}, ranking-eligible: ${metrics.rankingQueries}`);
    console.log(`  MRR:        ${metrics.mrr?.value?.toFixed(4) ?? "n/a"} (n=${metrics.mrr?.support ?? 0})`);
    console.log(`  nDCG@10:    ${metrics.ndcg[10]?.value?.toFixed(4) ?? "n/a"} (n=${metrics.ndcg[10]?.support ?? 0})`);
    console.log(`  Recall@20:  ${metrics.recall[20]?.value?.toFixed(4) ?? "n/a"} (n=${metrics.recall[20]?.support ?? 0})`);
    console.log(`  bpref:      ${metrics.bpref?.value?.toFixed(4) ?? "n/a"} (n=${metrics.bpref?.support ?? 0})`);
    console.log(`  judged@10:  ${metrics.judged[10]?.value?.toFixed(4) ?? "n/a"}`);
    console.log();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
