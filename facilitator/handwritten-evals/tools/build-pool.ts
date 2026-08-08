#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { POOL_BUILD_SYSTEMS } from "../schema/schema-v2.js";
import {
  SYSTEM_RUN_FILENAMES,
  buildPool,
  encodeJsonl,
  generateBm25Run,
  loadSystemRuns,
  loadV2Dataset,
} from "./pool.js";
import { POOL_SNAPSHOT_PATH, createPoolSnapshot } from "./pool-snapshot-v2.js";
import { verifyFrozenDataset } from "./release-run-ledger-v2.js";

const poolRunId = process.argv[2];
if (!poolRunId) {
  throw new Error("usage: tsx tools/build-pool.ts <pool-run-id> [dataset-root]");
}
const root = resolve(process.argv[3] ?? resolve(import.meta.dirname, ".."));
const generatedAt = process.env.BENCHMARK_RUN_AT ?? new Date().toISOString();
const runDirectory = resolve(root, "runs");
const poolDirectory = resolve(root, "pool");

// Validate the immutable freeze before running retrieval. A changed catalog or query file
// cannot be silently re-pooled under the old dataset identity.
await verifyFrozenDataset(root);
const dataset = await loadV2Dataset(root);
const bm25 = generateBm25Run(dataset, {
  runId: `${poolRunId}-bm25`,
  generatedAt,
});
const queryIds = new Set(dataset.queries.map(query => query.query_id));
const resourceIds = new Set(dataset.catalog.map(record => record.resource_id));
// Only the three pool-build systems are required here (ninth revision): production
// SCORED_SYSTEMS runs (lexical/semantic/hybrid) are produced and scored later, never
// needed to build the pool itself.
const runs = await loadSystemRuns(runDirectory, queryIds, resourceIds, { bm25 }, POOL_BUILD_SYSTEMS);
const pool = buildPool(dataset, runs, { runId: poolRunId, pooledAt: generatedAt });

// Nothing is written until all three pool-build runs and all hard filters validate.
await mkdir(runDirectory, { recursive: true });
await mkdir(poolDirectory, { recursive: true });
await writeFile(resolve(runDirectory, SYSTEM_RUN_FILENAMES.bm25), encodeJsonl(bm25));
await writeFile(resolve(poolDirectory, "pool-v2.jsonl"), encodeJsonl(pool));

console.log(`BM25: ${bm25.length} queries -> runs/${SYSTEM_RUN_FILENAMES.bm25}`);
console.log(`BM25 latency: ${bm25.reduce((sum, record) => sum + record.latency_ms, 0).toFixed(3)} ms total`);
console.log(`Pool: ${pool.length} unique query/resource pairs -> pool/pool-v2.jsonl`);

// The full freshness binding covers all six run systems, including production
// SCORED_SYSTEMS, which are produced and scored after the pool, not before. Deferred
// here rather than treated as a pool-build failure.
try {
  const snapshot = await createPoolSnapshot(root, generatedAt);
  await writeFile(resolve(root, POOL_SNAPSHOT_PATH), `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Freshness binding: dataset + profiles + implementations + 6 runs -> ${POOL_SNAPSHOT_PATH}`);
} catch (error) {
  console.log(
    `Freshness binding deferred: ${error instanceof Error ? error.message : String(error)} `
    + "(expected until production lexical/semantic/hybrid runs exist)",
  );
}
