#!/usr/bin/env node
/** One-off repair: regenerate pass-1 manifest/packs against the queries file with owner-review
 * status intact (merge-queries.ts always regenerates queries as pending from raw shards).
 *
 * The pseudorandom candidate ordering is seeded from a hash of the *entire* queries/catalog/
 * sidecars content, so changing review_status on the queries file reshuffles which candidates
 * are selected per query, not just the opaque ids -- remapping old judgments 1:1 is not possible.
 * This just regenerates fresh packs; grading is redone from scratch against the new pack content. */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { CatalogRecordSchema, QueryRecordSchema, RELEASE_COUNTS, SidecarRecordSchema } from "../schema/schema-v2.js";
import { finalizePass1Seed, preparePass1Seed, validatePass1SeedImport } from "./query-pass1.js";

const ROOT = resolve(import.meta.dirname, "..");
const SEALED = "/home/soumy/.claude/jobs/6e0348e9/tmp/pass1-sealed";
const NEW_IMPORTS_DIR = resolve(SEALED, "imports");
const createdAt = "2026-08-08T00:00:00.000Z";

async function jsonl(path: string) {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
}

async function main(): Promise<void> {
  const [queriesRaw, catalogRaw, sidecarRaw] = await Promise.all([
    jsonl(resolve(ROOT, "queries/queries-v2.jsonl")),
    jsonl(resolve(ROOT, "catalog/catalog-v2.jsonl")),
    jsonl(resolve(ROOT, "catalog/sidecar-v2.jsonl")),
  ]);
  const queries = z.array(QueryRecordSchema).length(RELEASE_COUNTS.queries.total).parse(queriesRaw);
  const catalog = z.array(CatalogRecordSchema).length(RELEASE_COUNTS.resources.total).parse(catalogRaw);
  const sidecars = z.array(SidecarRecordSchema).length(RELEASE_COUNTS.resources.total).parse(sidecarRaw);

  const seed = preparePass1Seed(queries, catalog, sidecars, createdAt, NEW_IMPORTS_DIR);

  const PASS1_STAGING = resolve(ROOT, "staging/query-pass1");
  await mkdir(PASS1_STAGING, { recursive: true });
  await mkdir(NEW_IMPORTS_DIR, { recursive: true });
  await Promise.all([
    writeFile(resolve(SEALED, "manifest.json"), `${JSON.stringify(seed.manifest, null, 2)}\n`),
    ...seed.packs.map((pack, index) => writeFile(resolve(PASS1_STAGING, `grader-${String(index + 1).padStart(2, "0")}.json`), `${JSON.stringify(pack, null, 2)}\n`)),
    ...seed.prompts.map((prompt, index) => writeFile(resolve(PASS1_STAGING, `grader-${String(index + 1).padStart(2, "0")}.md`), prompt)),
  ]);
  console.log(`prepared fresh pass-1 packs against the owner-reviewed queries file: ${seed.manifest.pair_count} pairs in 10 packs`);

  if (process.argv[2] !== "--finalize") return;

  const importFiles = (await readdir(NEW_IMPORTS_DIR)).filter(name => name.endsWith(".json")).sort();
  const rawImports = await Promise.all(importFiles.map(async name => {
    const parsed = JSON.parse(await readFile(resolve(NEW_IMPORTS_DIR, name), "utf8"));
    validatePass1SeedImport(parsed, seed.manifest);
    return parsed;
  }));
  const finalized = finalizePass1Seed(rawImports, seed.manifest, createdAt);
  await writeFile(resolve(SEALED, "raw-qrels.jsonl"), `${finalized.qrels.map(r => JSON.stringify(r)).join("\n")}\n`);
  await writeFile(resolve(PASS1_STAGING, "report-v2.json"), `${JSON.stringify(finalized.report, null, 2)}\n`);
  console.log(`finalized pass-1: ${finalized.qrels.length} qrels, report status ${finalized.report.status}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
