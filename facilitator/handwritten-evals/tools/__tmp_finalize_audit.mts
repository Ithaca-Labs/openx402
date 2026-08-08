#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { finalizeUnpooledAudit } from "./unpooled-audit.js";

const ROOT = resolve(import.meta.dirname, "..");
const SEALED = "/home/soumy/.claude/jobs/6e0348e9/tmp/unpooled-audit-sealed";
const createdAt = "2026-08-08T00:00:00.000Z";

async function jsonl(path: string) {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
}

async function main(): Promise<void> {
  const [queries, catalog, sidecars, pool] = await Promise.all([
    jsonl(resolve(ROOT, "queries/queries-v2.jsonl")),
    jsonl(resolve(ROOT, "catalog/catalog-v2.jsonl")),
    jsonl(resolve(ROOT, "catalog/sidecar-v2.jsonl")),
    jsonl(resolve(ROOT, "pool/pool-v2.jsonl")),
  ]);
  const cacheRows = await jsonl(resolve(ROOT, "staging/embeddings/text-embedding-3-large-v2.jsonl"));
  const denseVectors = { queries: new Map<string, number[]>(), catalog: new Map<string, number[]>() };
  for (const row of cacheRows as Array<{ key: string; embedding: number[] }>) {
    if (row.key.startsWith("query:")) denseVectors.queries.set(row.key.slice(6), row.embedding);
    else if (row.key.startsWith("resource:")) denseVectors.catalog.set(row.key.slice(9), row.embedding);
  }

  const manifest = JSON.parse(await readFile(resolve(SEALED, "manifest.json"), "utf8"));
  const importsDir = resolve(SEALED, "imports");
  const importFiles = (await readdir(importsDir)).filter(name => name.endsWith(".json")).sort();
  const rawImports = await Promise.all(importFiles.map(async name => JSON.parse(await readFile(resolve(importsDir, name), "utf8"))));

  const result = finalizeUnpooledAudit({ queries, catalog, sidecars, pool }, manifest, rawImports, createdAt, denseVectors);

  await writeFile(resolve(SEALED, "raw-qrels.jsonl"), `${result.qrels.map(r => JSON.stringify(r)).join("\n")}\n`);
  await writeFile(resolve(SEALED, "raw-pool-records.jsonl"), `${result.poolRecords.map(r => JSON.stringify(r)).join("\n")}\n`);
  await mkdir(resolve(ROOT, "staging/unpooled-audit"), { recursive: true });
  await writeFile(resolve(ROOT, "staging/unpooled-audit/pending-report-v2.json"), `${JSON.stringify(result.report, null, 2)}\n`);

  console.log(`finalized: ${result.report.audited_pair_count} audited pairs, relevant=${result.report.relevant_pair_count} (rate=${result.report.audited_relevance_rate.toFixed(4)})`);
  console.log(`grade counts:`, result.report.grade_counts);
  console.log(`source counts:`, result.report.source_counts);
  console.log(`population_exhausted_query_count: ${result.report.population_exhausted_query_count}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
