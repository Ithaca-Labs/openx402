#!/usr/bin/env node
/**
 * One-off: prepare release-split blind grading shards with the grader identity set to reflect
 * personal grading (no subagents), unlike prepare-grading-shards.ts's hardcoded Haiku-subagent
 * identity. Mirrors that script's shard structure exactly (5 queries/shard, 10 shards).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prepareBlindGrading, readJsonl } from "./grading-pipeline.js";

const ROOT = resolve(import.meta.dirname, "..");
const QUERIES_PER_SHARD = 5;
const SEALED = "/home/soumy/.claude/jobs/6e0348e9/tmp/release-grading-sealed";
const createdAt = "2026-08-08T00:00:00.000Z";

async function main(): Promise<void> {
  const [queries, catalog, sidecars, pool] = await Promise.all([
    readJsonl(resolve(ROOT, "queries/queries-v2.jsonl")),
    readJsonl(resolve(ROOT, "catalog/catalog-v2.jsonl")),
    readJsonl(resolve(ROOT, "catalog/sidecar-v2.jsonl")),
    readJsonl(resolve(ROOT, "pool/pool-v2.jsonl")),
  ]) as [Array<{ query_id: string; split: string }>, unknown[], unknown[], Array<{ query_id: string }>];

  const splitQueryIds = queries.filter(query => query.split === "release").map(query => query.query_id).sort();
  if (splitQueryIds.length === 0) throw new Error("no release queries found");

  const shards: string[][] = [];
  for (let index = 0; index < splitQueryIds.length; index += QUERIES_PER_SHARD) {
    shards.push(splitQueryIds.slice(index, index + QUERIES_PER_SHARD));
  }

  const shardsDirectory = resolve(SEALED, "release/manifests");
  const dispatchDirectory = resolve(ROOT, "staging/grading/release");
  await mkdir(shardsDirectory, { recursive: true });
  await mkdir(dispatchDirectory, { recursive: true });

  const index: Array<{ shard: string; queryIds: string[]; pairCount: number }> = [];

  for (const [shardIndex, queryIds] of shards.entries()) {
    const shardId = `release-${String(shardIndex + 1).padStart(2, "0")}`;
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
          provider: "anthropic", model: "claude-sonnet-5", prompt_hash: `sha256:grading-rubric-v1-${shardId}-a`,
          run_id: `run-grading-${shardId}-a`, shard_id: `shard-grading-${shardId}-a`, generated_at: createdAt,
        },
        graderB: {
          provider: "anthropic", model: "claude-sonnet-5", prompt_hash: `sha256:grading-rubric-v1-${shardId}-b`,
          run_id: `run-grading-${shardId}-b`, shard_id: `shard-grading-${shardId}-b`, generated_at: createdAt,
        },
        expectedCounts: { queries: queryIds.length, catalog: (catalog as unknown[]).length, sidecars: (sidecars as unknown[]).length },
      },
    );

    await writeFile(resolve(shardsDirectory, `${shardId}.json`), `${JSON.stringify(result.manifest, null, 2)}\n`);
    await writeFile(resolve(dispatchDirectory, `${shardId}-grader-a-pack.json`), `${JSON.stringify(result.graderA, null, 2)}\n`);
    await writeFile(resolve(dispatchDirectory, `${shardId}-grader-b-pack.json`), `${JSON.stringify(result.graderB, null, 2)}\n`);

    index.push({ shard: shardId, queryIds, pairCount: shardPool.length });
    console.log(`${shardId}: ${queryIds.length} queries, ${shardPool.length} pairs -> ${shardId}-grader-{a,b}-pack.json`);
  }

  await writeFile(resolve(dispatchDirectory, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`\n${shards.length} shards prepared for release split (personal grading identity).`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
