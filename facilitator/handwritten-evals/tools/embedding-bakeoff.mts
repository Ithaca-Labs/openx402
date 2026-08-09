#!/usr/bin/env node
/** Embedding model bakeoff: OpenAI large/small, Qwen3-Embedding-8B, Voyage-4,
 * all via OpenRouter for a consistent proxy layer. Measures both retrieval
 * quality (against dev qrels) and single-item query latency (p50/p95/mean). */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) throw new Error("OPENROUTER_API_KEY is required");

const MODELS = [
  { key: "openai_large", model: "text-embedding-3-large" },
  { key: "openai_small", model: "text-embedding-3-small" },
  { key: "qwen3_embedding_8b", model: "qwen/qwen3-embedding-8b" },
  { key: "voyage_4", model: "voyage-4" },
] as const;

async function readJsonl(path: string): Promise<any[]> {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
}

async function embedBatch(model: string, inputs: string[], retries = 3): Promise<number[][]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: inputs }),
    });
    if (res.ok) {
      const json = await res.json() as { data: { embedding: number[]; index: number }[] };
      return [...json.data].sort((a, b) => a.index - b.index).map(d => d.embedding);
    }
    const errText = await res.text();
    if (attempt === retries - 1) throw new Error(`embeddings ${model} failed: ${res.status} ${errText}`);
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error("unreachable");
}

async function embedSingleTimed(model: string, input: string): Promise<number> {
  const started = performance.now();
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  });
  await res.json();
  return performance.now() - started;
}

function embedText(res: { serviceName: string; description: string; tags?: string[] }, resourceType: string): string {
  const tags = res.tags ?? [];
  return [
    `Service: ${res.serviceName}`,
    `Description: ${res.description}`,
    `Type: ${resourceType === "mcp" ? "MCP tool" : "HTTP"}`,
    tags.length > 0 ? `Tags: ${tags.join(", ")}` : undefined,
  ].filter((line): line is string => line !== undefined).join(". ");
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

async function main(): Promise<void> {
  const [catalogRows, sidecarRows, queryRows] = await Promise.all([
    readJsonl(resolve(ROOT, "catalog/catalog-v2.jsonl")),
    readJsonl(resolve(ROOT, "catalog/sidecar-v2.jsonl")),
    readJsonl(resolve(ROOT, "queries/queries-v2.jsonl")),
  ]);
  const sidecarById = new Map(sidecarRows.map((s: any) => [s.resource_id, s]));
  const catalogTexts = catalogRows.map((c: any) => ({
    id: c.resource_id,
    text: embedText(c.wire.resource, sidecarById.get(c.resource_id).resource_type),
  }));
  const queryTexts = queryRows.map((q: any) => ({ id: q.query_id, text: q.query }));

  const summary: Record<string, any> = {};

  for (const { key, model } of MODELS) {
    console.error(`\n=== ${key} (${model}) ===`);

    console.error(`embedding ${catalogTexts.length} catalog resources...`);
    const catalogVectors: Record<string, number[]> = {};
    const BATCH = 50;
    for (let i = 0; i < catalogTexts.length; i += BATCH) {
      const batch = catalogTexts.slice(i, i + BATCH);
      const vectors = await embedBatch(model, batch.map(b => b.text));
      batch.forEach((b, j) => { catalogVectors[b.id] = vectors[j]!; });
      console.error(`  ${Math.min(i + BATCH, catalogTexts.length)}/${catalogTexts.length}`);
    }

    console.error(`embedding ${queryTexts.length} queries (bulk)...`);
    const queryVectors: Record<string, number[]> = {};
    for (let i = 0; i < queryTexts.length; i += BATCH) {
      const batch = queryTexts.slice(i, i + BATCH);
      const vectors = await embedBatch(model, batch.map(b => b.text));
      batch.forEach((b, j) => { queryVectors[b.id] = vectors[j]!; });
    }

    console.error("measuring single-item query latency (20 samples)...");
    const latencySamples: number[] = [];
    const sampleQueries = queryTexts.slice(0, 20);
    for (const q of sampleQueries) {
      latencySamples.push(await embedSingleTimed(model, q.text));
    }
    latencySamples.sort((a, b) => a - b);

    await writeFile(
      resolve(ROOT, `staging/embeddings/bakeoff-${key}.json`),
      JSON.stringify({ model, catalogVectors, queryVectors }),
    );

    summary[key] = {
      model,
      dimension: Object.values(catalogVectors)[0]?.length ?? null,
      latency_ms: {
        p50: percentile(latencySamples, 0.5),
        p95: percentile(latencySamples, 0.95),
        mean: latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length,
        min: latencySamples[0],
        max: latencySamples[latencySamples.length - 1],
        samples: latencySamples.length,
      },
    };
    console.error(`  latency p50=${summary[key].latency_ms.p50.toFixed(0)}ms p95=${summary[key].latency_ms.p95.toFixed(0)}ms`);
  }

  await writeFile(resolve(ROOT, "staging/embeddings/bakeoff-summary.json"), JSON.stringify(summary, null, 2));
  console.error("\ndone. Vectors in staging/embeddings/bakeoff-*.json, summary in bakeoff-summary.json");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
