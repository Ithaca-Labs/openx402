#!/usr/bin/env node
/** One-off: prepare Pass 2b unpooled-audit packs (BUILD-PLAN §8) for personal grading (no agents). */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prepareUnpooledAudit, AUDIT_BATCH_COUNT } from "./unpooled-audit.js";

const ROOT = resolve(import.meta.dirname, "..");
const SEALED = "/home/soumy/.claude/jobs/6e0348e9/tmp/unpooled-audit-sealed";
const createdAt = "2026-08-08T00:00:00.000Z";

async function jsonl(path: string) {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
}

async function main(): Promise<void> {
  const [queries, catalog, sidecars, pool] = await Promise.all([
    jsonl(resolve(ROOT, "queries/queries-v2.jsonl")),
    jsonl(resolve(ROOT, "catalog/catalog-v2.jsonl")),
    jsonl(resolve(ROOT, "catalog/sidecar-v2.jsonl")),
    jsonl(resolve(ROOT, "pool/pool-v2.jsonl")),
  ]);

  const cacheRows = await jsonl(resolve(ROOT, "staging/embeddings/text-embedding-3-large-v2.jsonl"));
  const denseVectors = {
    queries: new Map<string, number[]>(),
    catalog: new Map<string, number[]>(),
  };
  for (const row of cacheRows as Array<{ key: string; embedding: number[] }>) {
    if (row.key.startsWith("query:")) denseVectors.queries.set(row.key.slice("query:".length), row.embedding);
    else if (row.key.startsWith("resource:")) denseVectors.catalog.set(row.key.slice("resource:".length), row.embedding);
  }
  console.log(`loaded dense vectors: ${denseVectors.queries.size} queries, ${denseVectors.catalog.size} resources`);

  const auditors = Array.from({ length: AUDIT_BATCH_COUNT }, (_, index) => {
    const n = String(index + 1).padStart(2, "0");
    return {
      provider: "anthropic" as const,
      model: "claude-sonnet-5",
      prompt_hash: `sha256:${"0".repeat(63)}${index}`,
      run_id: `run-unpooled-audit-${n}`,
      shard_id: `shard-unpooled-audit-${n}`,
      generated_at: createdAt,
    };
  });

  const { packs, manifest } = prepareUnpooledAudit(
    { queries, catalog, sidecars, pool },
    { pipelineRunId: "unpooled-audit-v2", createdAt, seed: "stellar-bazaar-unpooled-audit-v2", auditors, denseVectors },
  );

  const packsDir = resolve(SEALED, "packs");
  const importsDir = resolve(SEALED, "imports");
  await mkdir(packsDir, { recursive: true });
  await mkdir(importsDir, { recursive: true });
  await writeFile(resolve(SEALED, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await Promise.all(packs.map(pack => writeFile(resolve(packsDir, `${pack.pack_id}.json`), `${JSON.stringify(pack, null, 2)}\n`)));

  console.log(`prepared ${packs.length} unpooled-audit packs (${manifest.batches.reduce((s, b) => s + b.assignments.length, 0)} pairs) -> ${packsDir}`);
  for (const pack of packs) console.log(`  ${pack.pack_id}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
