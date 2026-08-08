#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SEALED = "/home/soumy/.claude/jobs/6e0348e9/tmp/release-grading-sealed";
const QUERIES_PER_SHARD = 5;

async function jsonl(path: string) {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
}

async function main(): Promise<void> {
  const [queries, pool] = await Promise.all([
    jsonl(resolve(ROOT, "queries/queries-v2.jsonl")),
    jsonl(resolve(ROOT, "pool/pool-v2.jsonl")),
  ]);
  const releaseQueries = (queries as Array<{ query_id: string; split: string }>)
    .filter(q => q.split === "release").sort((a, b) => a.query_id.localeCompare(b.query_id));
  const outDir = resolve(SEALED, "shard-sources");
  await mkdir(outDir, { recursive: true });

  for (let i = 0; i < releaseQueries.length; i += QUERIES_PER_SHARD) {
    const shardIndex = i / QUERIES_PER_SHARD + 1;
    const shardId = `release-${String(shardIndex).padStart(2, "0")}`;
    const shardQueries = releaseQueries.slice(i, i + QUERIES_PER_SHARD);
    const shardQuerySet = new Set(shardQueries.map(q => q.query_id));
    const shardPool = (pool as Array<{ query_id: string }>).filter(record => shardQuerySet.has(record.query_id));
    await writeFile(resolve(outDir, `${shardId}-queries.jsonl`), `${shardQueries.map(r => JSON.stringify(r)).join("\n")}\n`);
    await writeFile(resolve(outDir, `${shardId}-pool.jsonl`), `${shardPool.map(r => JSON.stringify(r)).join("\n")}\n`);
    console.log(`${shardId}: ${shardQueries.length} queries, ${shardPool.length} pool rows`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
