#!/usr/bin/env node

/**
 * Step 8 orchestration — shards Pass 2 pooled grading (BUILD-PLAN §8) across isolated agents.
 *
 * `prepareBlindGrading` builds one logical pack per grader covering every pooled pair for the
 * queries handed to it. Grading all ~1,400 development pairs in a single agent turn is not a
 * reliable unit of work, so this script calls it once per query shard with genuinely distinct
 * grader-A/grader-B identities per shard (matching the isolated-shard pattern used everywhere
 * else in this project), rather than splitting one shared identity's workload after the fact.
 *
 * The withheld manifest (opaque_id -> real query/resource identity) is written outside the repo
 * tree — grading agents are given only the pack (blind), never the manifest.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prepareBlindGrading, readJsonl } from "./grading-pipeline.js";
import { assertSealedHoldoutArtifactPath } from "./holdout-v2.js";

const ROOT = resolve(import.meta.dirname, "..");
const QUERIES_PER_SHARD = 5;

const splitArgument = process.argv[2];
const sealedRootInput = process.argv[3];
if (splitArgument !== "development" && splitArgument !== "release") {
  throw new Error("usage: tsx tools/prepare-grading-shards.ts <development|release> <sealed-output-dir>");
}
const split: "development" | "release" = splitArgument;
if (!sealedRootInput) throw new Error("a sealed output directory outside handwritten-evals is required");
const sealedRoot = assertSealedHoldoutArtifactPath(ROOT, sealedRootInput, `${split} grading manifests`);

async function main(): Promise<void> {
  const [queries, catalog, sidecars, pool] = await Promise.all([
    readJsonl(resolve(ROOT, "queries/queries-v2.jsonl")),
    readJsonl(resolve(ROOT, "catalog/catalog-v2.jsonl")),
    readJsonl(resolve(ROOT, "catalog/sidecar-v2.jsonl")),
    readJsonl(resolve(ROOT, "pool/pool-v2.jsonl")),
  ]) as [Array<{ query_id: string; split: string }>, unknown[], unknown[], Array<{ query_id: string }>];

  const splitQueryIds = queries.filter(query => query.split === split).map(query => query.query_id).sort();
  if (splitQueryIds.length === 0) throw new Error(`no ${split} queries found`);

  const shards: string[][] = [];
  for (let index = 0; index < splitQueryIds.length; index += QUERIES_PER_SHARD) {
    shards.push(splitQueryIds.slice(index, index + QUERIES_PER_SHARD));
  }

  const createdAt = process.env.BENCHMARK_RUN_AT ?? new Date().toISOString();
  const shardsDirectory = resolve(sealedRoot, split, "manifests");
  const dispatchDirectory = resolve(ROOT, "staging/grading", split);
  await mkdir(shardsDirectory, { recursive: true });
  await mkdir(dispatchDirectory, { recursive: true });

  const index: Array<{ shard: string; queryIds: string[]; pairCount: number; packHashA: string; packHashB: string }> = [];

  for (const [shardIndex, queryIds] of shards.entries()) {
    const shardId = `${split}-${String(shardIndex + 1).padStart(2, "0")}`;
    const shardQuerySet = new Set(queryIds);
    const shardPool = pool.filter(record => shardQuerySet.has(record.query_id));
    const shardQueries = queries.filter(query => shardQuerySet.has(query.query_id));

    const result = prepareBlindGrading(
      { queries: shardQueries, catalog, sidecars, pool: shardPool },
      {
        pipelineRunId: `grading-${shardId}`,
        createdAt,
        seed: `stellar-bazaar-grading-v2-${shardId}`,
        graderA: {
          provider: "anthropic", model: "claude-haiku-4-5", prompt_hash: `sha256:grading-rubric-v1-${shardId}-a`,
          run_id: `run-grading-${shardId}-a`, shard_id: `shard-grading-${shardId}-a`, generated_at: createdAt,
        },
        graderB: {
          provider: "anthropic", model: "claude-haiku-4-5", prompt_hash: `sha256:grading-rubric-v1-${shardId}-b`,
          run_id: `run-grading-${shardId}-b`, shard_id: `shard-grading-${shardId}-b`, generated_at: createdAt,
        },
        expectedCounts: { queries: queryIds.length, catalog: (catalog as unknown[]).length, sidecars: (sidecars as unknown[]).length },
      },
    );

    await writeFile(resolve(shardsDirectory, `${shardId}.json`), `${JSON.stringify(result.manifest, null, 2)}\n`);
    await writeFile(resolve(dispatchDirectory, `${shardId}-grader-a-pack.json`), `${JSON.stringify(result.graderA, null, 2)}\n`);
    await writeFile(resolve(dispatchDirectory, `${shardId}-grader-b-pack.json`), `${JSON.stringify(result.graderB, null, 2)}\n`);

    index.push({
      shard: shardId,
      queryIds,
      pairCount: shardPool.length,
      packHashA: `pack-a: ${result.graderA.tasks.reduce((sum, task) => sum + task.candidates.length, 0)} candidates`,
      packHashB: `pack-b: ${result.graderB.tasks.reduce((sum, task) => sum + task.candidates.length, 0)} candidates`,
    });
    console.log(`${shardId}: ${queryIds.length} queries, ${shardPool.length} pairs -> ${shardId}-grader-{a,b}-pack.json`);
  }

  await writeFile(resolve(dispatchDirectory, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`\n${shards.length} shards prepared for ${split} split.`);
  console.log(`Sealed manifests: ${shardsDirectory}`);
  console.log(`Dispatch packs: ${dispatchDirectory}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
