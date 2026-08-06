#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  SYSTEM_RUN_FILENAMES,
  buildPool,
  encodeJsonl,
  generateBm25Run,
  loadSystemRuns,
  loadV2Dataset,
} from "./pool.js";

const poolRunId = process.argv[2];
if (!poolRunId) {
  throw new Error("usage: tsx tools/build-pool.ts <pool-run-id> [dataset-root]");
}
const root = resolve(process.argv[3] ?? resolve(import.meta.dirname, ".."));
const generatedAt = process.env.BENCHMARK_RUN_AT ?? new Date().toISOString();
const runDirectory = resolve(root, "runs");
const poolDirectory = resolve(root, "pool");

// Validate the complete frozen corpus and query set before creating artifacts.
const dataset = await loadV2Dataset(root);
const bm25 = generateBm25Run(dataset, {
  runId: `${poolRunId}-bm25`,
  generatedAt,
});
const queryIds = new Set(dataset.queries.map(query => query.query_id));
const resourceIds = new Set(dataset.catalog.map(record => record.resource_id));
const runs = await loadSystemRuns(runDirectory, queryIds, resourceIds, { bm25 });
const pool = buildPool(dataset, runs, { runId: poolRunId, pooledAt: generatedAt });

// Nothing is written until all five complete runs and all hard filters validate.
await mkdir(runDirectory, { recursive: true });
await mkdir(poolDirectory, { recursive: true });
await writeFile(resolve(runDirectory, SYSTEM_RUN_FILENAMES.bm25), encodeJsonl(bm25));
await writeFile(resolve(poolDirectory, "pool-v2.jsonl"), encodeJsonl(pool));

console.log(`BM25: ${bm25.length} queries -> runs/${SYSTEM_RUN_FILENAMES.bm25}`);
console.log(`BM25 latency: ${bm25.reduce((sum, record) => sum + record.latency_ms, 0).toFixed(3)} ms total`);
console.log(`Pool: ${pool.length} unique query/resource pairs -> pool/pool-v2.jsonl`);
