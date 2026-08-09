#!/usr/bin/env node
/** Step 5 schema/assignment merge plus blind pass-1 seed preparation. Never authors text or grades. */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { QUERY_AGENTS, QUERY_ASSIGNMENTS, QUERIES_PER_AGENT, queryAssignment } from "../../query-config.js";
import { CatalogRecordSchema, QueryRecordSchema, RELEASE_COUNTS, SidecarRecordSchema, type QueryRecord } from "../../schema/schema-v2.js";
import { finalizePass1Seed, preparePass1Seed, validatePass1SeedImport } from "../lib/query-pass1.js";
import { assertSealedHoldoutArtifactPath } from "../lib/holdout-v2.js";

const ROOT = resolve(import.meta.dirname, "../..");
const STAGING = resolve(ROOT, "staging/queries");
const PROMPT_MANIFEST = resolve(ROOT, "staging/query-prompts/manifest.jsonl");
const OUTPUT = resolve(ROOT, "queries/queries-v2.jsonl");
const PASS1 = resolve(ROOT, "staging/query-pass1");
export const PASS1_EVIDENCE_ENV_NAME = "STELLAR_BAZAAR_PASS1_EVIDENCE_DIR";
const mode = process.argv[2] ?? "--finalize";
if (mode !== "--prepare" && mode !== "--finalize") {
  throw new Error("usage: tsx tools/merge-queries.ts [--prepare|--finalize]");
}
const PromptSchema = z.object({ run_id: z.string(), shard_id: z.string(), prompt_hash: z.string(),
  query_ids: z.array(z.string()).length(QUERIES_PER_AGENT) }).passthrough();

async function jsonl(path: string, optional = false): Promise<unknown[]> {
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`${path}:${index + 1}: invalid JSON: ${(error as Error).message}`); }
  });
}

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

async function main(): Promise<void> {
  const promptRows = z.array(PromptSchema).length(QUERY_AGENTS).parse(await jsonl(PROMPT_MANIFEST));
  const prompts = new Map(promptRows.map(item => [item.run_id, item]));
  let dirs: string[] = [];
  try { dirs = (await readdir(STAGING, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (dirs.length === 0) {
    console.log("0 records: no query shards found; validation dry-run complete; wrote nothing");
    return;
  }
  const errors: string[] = [];
  const records: QueryRecord[] = [];
  for (const dir of dirs) {
    const raw = await jsonl(resolve(STAGING, dir, "queries.jsonl"));
    if (raw.length !== QUERIES_PER_AGENT) errors.push(`${dir}: expected ${QUERIES_PER_AGENT} records, got ${raw.length}`);
    for (const value of raw) {
      const parsed = QueryRecordSchema.safeParse(value);
      if (!parsed.success) { errors.push(`${dir}/${(value as { query_id?: string }).query_id ?? "?"}: ${parsed.error.message}`); continue; }
      const record = parsed.data;
      let expected;
      try { expected = queryAssignment(record.query_id); }
      catch (error) { errors.push((error as Error).message); continue; }
      const prompt = prompts.get(expected.runId);
      if (!prompt) errors.push(`${record.query_id}: missing prompt manifest for ${expected.runId}`);
      if (record.generation.run_id !== expected.runId || record.generation.shard_id !== expected.shardId
          || record.generation.prompt_hash !== prompt?.prompt_hash) errors.push(`${record.query_id}: generation provenance mismatch`);
      if (record.derived_from.generation_id !== record.generation.run_id) errors.push(`${record.query_id}: generation_id must equal run_id`);
      if (record.split !== expected.split || record.query_class !== expected.queryClass
          || record.phrasing_register !== expected.phrasingRegister || record.family !== expected.family
          || record.expects_no_result !== expected.expectsNoResult || !same(record.filters, expected.filters)
          || !same(record.evaluation_constraints, expected.evaluationConstraints)) errors.push(`${record.query_id}: frozen assignment mismatch`);
      if (record.mcp_subtype !== expected.mcpSubtype || record.forbidden_capability !== expected.forbiddenCapability) {
        errors.push(`${record.query_id}: optional assignment field mismatch`);
      }
      if (record.review_status !== "pending" || record.reviewed_at !== null || record.owner_note !== null) {
        errors.push(`${record.query_id}: author output review state must be pending/null/null`);
      }
      if (expected.trap && record.derived_from.trap === undefined) errors.push(`${record.query_id}: assigned adversarial trap rationale missing`);
      if (!expected.trap && record.derived_from.trap !== undefined) errors.push(`${record.query_id}: unassigned trap must be omitted`);
      records.push(record);
    }
  }
  const ids = records.map(item => item.query_id);
  if (records.length !== 100 || new Set(ids).size !== 100
      || QUERY_ASSIGNMENTS.some(item => !ids.includes(item.queryId))) errors.push("query coverage must be exactly qry-001..qry-100 once each");
  if (errors.length) throw new Error(`${errors.length} validation failure(s):\n${errors.map(item => `- ${item}`).join("\n")}`);
  records.sort((left, right) => left.query_id.localeCompare(right.query_id));

  const [catalogRaw, sidecarRaw] = await Promise.all([
    jsonl(resolve(ROOT, "catalog/catalog-v2.jsonl")), jsonl(resolve(ROOT, "catalog/sidecar-v2.jsonl")),
  ]);
  const catalog = z.array(CatalogRecordSchema).length(RELEASE_COUNTS.resources.total).parse(catalogRaw);
  const sidecars = z.array(SidecarRecordSchema).length(RELEASE_COUNTS.resources.total).parse(sidecarRaw);
  const createdAt = process.env.BENCHMARK_RUN_AT ?? new Date().toISOString();
  const sealedRootInput = process.env[PASS1_EVIDENCE_ENV_NAME];
  if (!sealedRootInput) throw new Error(`set ${PASS1_EVIDENCE_ENV_NAME} to an absolute directory outside handwritten-evals`);
  const sealedRoot = assertSealedHoldoutArtifactPath(ROOT, sealedRootInput, "pass-1 source mappings and judgments");
  const importDir = resolve(sealedRoot, "imports");
  const seed = preparePass1Seed(records, catalog, sidecars, createdAt, importDir);

  let importFiles: string[] = [];
  try { importFiles = (await readdir(importDir)).filter(name => name.endsWith(".json")).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const importedPackIds: string[] = [];
  const rawImports: unknown[] = [];
  for (const name of importFiles) {
    const imported = JSON.parse(await readFile(resolve(importDir, name), "utf8")) as { pack_id?: string };
    validatePass1SeedImport(imported, seed.manifest);
    rawImports.push(imported);
    if (typeof imported.pack_id === "string") importedPackIds.push(imported.pack_id);
  }
  const pass1Final = mode === "--finalize" ? finalizePass1Seed(rawImports, seed.manifest, createdAt) : null;
  if (mode === "--finalize") {
    const expectedPackIds = seed.manifest.packs.map(pack => pack.pack_id).sort();
    const actualPackIds = [...importedPackIds].sort();
    if (actualPackIds.length !== expectedPackIds.length
        || new Set(actualPackIds).size !== actualPackIds.length
        || actualPackIds.join("\n") !== expectedPackIds.join("\n")) {
      throw new Error(`pass-1 finalization requires exactly one valid import for each of 10 packs; found ${actualPackIds.length}`);
    }
  }

  await mkdir(resolve(OUTPUT, ".."), { recursive: true });
  await mkdir(PASS1, { recursive: true });
  await mkdir(importDir, { recursive: true });
  await Promise.all([
    writeFile(OUTPUT, `${records.map(record => JSON.stringify(record)).join("\n")}\n`),
    writeFile(resolve(sealedRoot, "manifest.json"), `${JSON.stringify(seed.manifest, null, 2)}\n`),
    ...seed.packs.map((pack, index) => writeFile(resolve(PASS1, `grader-${String(index + 1).padStart(2, "0")}.json`), `${JSON.stringify(pack, null, 2)}\n`)),
    ...seed.prompts.map((prompt, index) => writeFile(resolve(PASS1, `grader-${String(index + 1).padStart(2, "0")}.md`), prompt)),
    ...(pass1Final === null ? [] : [
      writeFile(resolve(sealedRoot, "raw-qrels.jsonl"), `${pass1Final.qrels.map(record => JSON.stringify(record)).join("\n")}\n`),
      writeFile(resolve(PASS1, "report-v2.json"), `${JSON.stringify(pass1Final.report, null, 2)}\n`),
    ]),
  ]);
  console.log(`merged 100 queries; prepared ${seed.manifest.pair_count} anchor-aware blind pass-1 pairs in 10 packs; validated ${importFiles.length} imports (${mode.slice(2)})`);
}

main().catch(error => { console.error(error); process.exit(1); });
