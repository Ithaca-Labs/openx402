#!/usr/bin/env node
/** Scores each bakeoff model's cosine-similarity ranking against dev qrels,
 * merging in the latency numbers from the bakeoff run. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scoreRun, type EvalQuery, type RunResult } from "./scoring.js";

const ROOT = resolve(import.meta.dirname, "..");

async function readJsonl(path: string): Promise<any[]> {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; normA += a[i]! * a[i]!; normB += b[i]! * b[i]!; }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function main(): Promise<void> {
  const [queries, sidecars, qrels, summary] = await Promise.all([
    readJsonl(resolve(ROOT, "queries/queries-v2.jsonl")),
    readJsonl(resolve(ROOT, "catalog/sidecar-v2.jsonl")),
    readJsonl(resolve(ROOT, "qrels/development-v2.jsonl")),
    readFile(resolve(ROOT, "staging/embeddings/bakeoff-summary.json"), "utf8").then(JSON.parse),
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

  const results: Record<string, any> = {};

  for (const key of Object.keys(summary)) {
    const path = resolve(ROOT, `staging/embeddings/bakeoff-${key}.json`);
    const { catalogVectors, queryVectors } = JSON.parse(await readFile(path, "utf8"));

    const runResults: RunResult[] = devQueries.map((q: any) => {
      const qVec = queryVectors[q.query_id];
      if (!qVec) return { queryId: q.query_id, ranking: [] };
      const scored = Object.entries(catalogVectors as Record<string, number[]>)
        .map(([resourceId, vec]) => ({ resourceId, score: cosine(qVec, vec) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);
      return { queryId: q.query_id, ranking: scored.map(s => s.resourceId) };
    });

    const { metrics } = scoreRun(evalQueries, runResults);
    results[key] = {
      model: summary[key].model,
      dimension: summary[key].dimension,
      latency_ms: summary[key].latency_ms,
      quality: {
        mrr: metrics.mrr.value,
        ndcg_at_10: metrics.ndcg[10]?.value ?? null,
        recall_at_20: metrics.recall[20]?.value ?? null,
        bpref: metrics.bpref.value,
        judged_at_10: metrics.judged[10]?.value ?? null,
      },
    };
    console.error(`${key}: MRR=${metrics.mrr.value?.toFixed(4)} nDCG@10=${metrics.ndcg[10]?.value?.toFixed(4)} p50=${summary[key].latency_ms.p50.toFixed(0)}ms`);
  }

  await writeFile(resolve(ROOT, "reports/embedding-bakeoff-v2.json"), JSON.stringify({
    generated_at: new Date().toISOString(),
    split: "development",
    query_count: devQueries.length,
    models: results,
  }, null, 2));
  console.error("wrote reports/embedding-bakeoff-v2.json");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
