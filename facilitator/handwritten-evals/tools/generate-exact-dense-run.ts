#!/usr/bin/env node

/**
 * Step 7 pool-build CLI for `exact_dense` and `hybrid_exact` (BUILD-PLAN §8/§10, ninth revision).
 *
 * `exact_dense` is brute-force cosine similarity over OpenAI `text-embedding-3-large` vectors —
 * exact by construction, no ANN index. `hybrid_exact` is equal-weight reciprocal rank fusion of
 * `bm25` and `exact_dense`, mirroring production's RRF formula (`weight / (rrfK + rank)`) but
 * applied to the two exact rankings so neither pool-build system depends on production code.
 *
 * Embedding vectors are cached to `staging/embeddings/` (gitignored, keyed by a hash of the
 * exact text embedded) so reruns never re-pay or re-wait on the API unless the source text
 * changed. The committed pipeline artifact is the resulting ranked run file, not the cache.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  POOL_DEPTH,
  SYSTEM_RUN_FILENAMES,
  SystemRunRecordSchema,
  deterministicEligibility,
  encodeJsonl,
  generateBm25Run,
  loadV2Dataset,
  type SystemRunRecord,
  type V2Dataset,
} from "./pool.js";
import type { CatalogRecord } from "../schema/schema-v2.js";

const EMBEDDING_MODEL = "text-embedding-3-large";
const RRF_K = 20;

const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, ".."));
const generatedAt = process.env.BENCHMARK_RUN_AT ?? new Date().toISOString();
const runId = process.argv[3] ?? `exact-dense-${generatedAt}`;
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required");

const cachePath = resolve(root, "staging/embeddings", `${EMBEDDING_MODEL}-v2.jsonl`);
const runsDirectory = resolve(root, "runs");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Mirrors `compileSearchDocumentParts`'s Service/Description/Type/Tags structure over our
 * simpler benchmark wire shape (no bazaar extension payload to extract parameters/output from). */
function embedText(record: CatalogRecord, resourceType: "http" | "mcp"): string {
  const resource = record.wire.resource;
  const tags = resource.tags ?? [];
  return [
    `Service: ${resource.serviceName}`,
    `Description: ${resource.description}`,
    `Type: ${resourceType === "mcp" ? "MCP tool" : "HTTP"}`,
    tags.length > 0 ? `Tags: ${tags.join(", ")}` : undefined,
  ].filter((line): line is string => line !== undefined).join(". ");
}

interface CacheEntry {
  key: string;
  model: string;
  text_sha256: string;
  embedding: number[];
}

async function loadCache(): Promise<Map<string, CacheEntry>> {
  const map = new Map<string, CacheEntry>();
  let text: string;
  try {
    text = await readFile(cachePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return map;
    throw error;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as CacheEntry;
    map.set(entry.key, entry);
  }
  return map;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });
  if (!response.ok) throw new Error(`OpenAI embeddings API ${response.status}: ${await response.text()}`);
  const json = await response.json() as { data: { embedding: number[]; index: number }[] };
  return [...json.data].sort((a, b) => a.index - b.index).map(item => item.embedding);
}

/** Embeds whatever `items` aren't already cached under a matching text hash, updating the cache file. */
async function embedWithCache(
  items: Array<{ key: string; text: string }>,
  cache: Map<string, CacheEntry>,
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  const toEmbed: Array<{ key: string; text: string }> = [];
  for (const item of items) {
    const cached = cache.get(item.key);
    if (cached && cached.model === EMBEDDING_MODEL && cached.text_sha256 === sha256(item.text)) {
      result.set(item.key, cached.embedding);
    } else {
      toEmbed.push(item);
    }
  }
  console.log(`embedding cache: ${items.length - toEmbed.length}/${items.length} reused, ${toEmbed.length} to fetch`);
  const BATCH = 100;
  for (let index = 0; index < toEmbed.length; index += BATCH) {
    const batch = toEmbed.slice(index, index + BATCH);
    const vectors = await embedBatch(batch.map(item => item.text));
    batch.forEach((item, offset) => {
      const embedding = vectors[offset]!;
      result.set(item.key, embedding);
      cache.set(item.key, { key: item.key, model: EMBEDDING_MODEL, text_sha256: sha256(item.text), embedding });
    });
    if (toEmbed.length > BATCH) console.log(`  embedded ${Math.min(index + BATCH, toEmbed.length)}/${toEmbed.length}`);
  }
  return result;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function generateExactDenseRun(
  dataset: V2Dataset,
  catalogVectors: Map<string, number[]>,
  queryVectors: Map<string, number[]>,
): SystemRunRecord[] {
  const catalogById = new Map(dataset.catalog.map(record => [record.resource_id, record]));
  const sidecarById = new Map(dataset.sidecars.map(record => [record.resource_id, record]));
  return [...dataset.queries]
    .sort((left, right) => left.query_id.localeCompare(right.query_id))
    .map(query => {
      const startedAt = performance.now();
      const queryVector = queryVectors.get(query.query_id)!;
      const eligibleHits = dataset.catalog
        .map(record => ({ id: record.resource_id, score: cosine(queryVector, catalogVectors.get(record.resource_id)!) }))
        .filter(hit => {
          const catalog = catalogById.get(hit.id)!;
          const sidecar = sidecarById.get(hit.id)!;
          return deterministicEligibility(query, catalog, sidecar).eligible;
        })
        .sort((a, b) => b.score - a.score);
      const results = eligibleHits.slice(0, POOL_DEPTH).map((hit, index) => ({
        resource_id: hit.id, rank: index + 1, score: hit.score,
      }));
      const latencyMs = performance.now() - startedAt;
      return SystemRunRecordSchema.parse({
        system: "exact_dense", query_id: query.query_id, run_id: runId, generated_at: generatedAt,
        latency_ms: latencyMs, requested_depth: POOL_DEPTH, total_results: eligibleHits.length, results,
      });
    });
}

/** Equal-weight RRF over two exact rankings, same formula as production's `fuse()` (`weight / (k + rank)`). */
function generateHybridExactRun(bm25: SystemRunRecord[], exactDense: SystemRunRecord[]): SystemRunRecord[] {
  const denseByQuery = new Map(exactDense.map(record => [record.query_id, record]));
  return bm25.map(bm25Record => {
    const startedAt = performance.now();
    const denseRecord = denseByQuery.get(bm25Record.query_id)!;
    const scores = new Map<string, number>();
    for (const record of [bm25Record, denseRecord]) {
      record.results.forEach((result, index) => {
        const rank = index + 1;
        const contribution = 1 / (RRF_K + rank);
        scores.set(result.resource_id, (scores.get(result.resource_id) ?? 0) + contribution);
      });
    }
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const results = ranked.slice(0, POOL_DEPTH).map(([resourceId, score], index) => ({
      resource_id: resourceId, rank: index + 1, score,
    }));
    const latencyMs = performance.now() - startedAt;
    return SystemRunRecordSchema.parse({
      system: "hybrid_exact", query_id: bm25Record.query_id, run_id: runId, generated_at: generatedAt,
      latency_ms: latencyMs, requested_depth: POOL_DEPTH, total_results: ranked.length, results,
    });
  });
}

async function main(): Promise<void> {
  const dataset = await loadV2Dataset(root);
  const sidecarById = new Map(dataset.sidecars.map(record => [record.resource_id, record]));

  const catalogItems = dataset.catalog.map(record => ({
    key: `resource:${record.resource_id}`,
    text: embedText(record, sidecarById.get(record.resource_id)!.resource_type),
  }));
  const queryItems = dataset.queries.map(query => ({ key: `query:${query.query_id}`, text: query.query }));

  const cache = await loadCache();
  const catalogVectorsByKey = await embedWithCache(catalogItems, cache);
  const queryVectorsByKey = await embedWithCache(queryItems, cache);
  await mkdir(resolve(cachePath, ".."), { recursive: true });
  await writeFile(cachePath, `${[...cache.values()].map(entry => JSON.stringify(entry)).join("\n")}\n`);

  const catalogVectors = new Map(dataset.catalog.map(record => [record.resource_id, catalogVectorsByKey.get(`resource:${record.resource_id}`)!]));
  const queryVectors = new Map(dataset.queries.map(query => [query.query_id, queryVectorsByKey.get(`query:${query.query_id}`)!]));

  const bm25 = generateBm25Run(dataset, { runId: `${runId}-bm25`, generatedAt });
  const exactDense = generateExactDenseRun(dataset, catalogVectors, queryVectors);
  const hybridExact = generateHybridExactRun(bm25, exactDense);

  await mkdir(runsDirectory, { recursive: true });
  await writeFile(resolve(runsDirectory, SYSTEM_RUN_FILENAMES.exact_dense), encodeJsonl(exactDense));
  await writeFile(resolve(runsDirectory, SYSTEM_RUN_FILENAMES.hybrid_exact), encodeJsonl(hybridExact));

  console.log(`exact_dense: ${exactDense.length} queries -> runs/${SYSTEM_RUN_FILENAMES.exact_dense}`);
  console.log(`hybrid_exact: ${hybridExact.length} queries -> runs/${SYSTEM_RUN_FILENAMES.hybrid_exact}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
