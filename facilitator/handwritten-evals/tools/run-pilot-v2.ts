#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildAdjudicationPack, derivePilotReport, preparePilot } from "./pilot-v2.js";

const ROOT = resolve(import.meta.dirname, "..");
const PILOT = resolve(ROOT, "pilot");
const GENERATED = resolve(PILOT, "generated");
const command = process.argv[2];
const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const readJsonl = async (path: string) => (await readFile(path, "utf8")).split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
const artifact = (path: string) => resolve(PILOT, "artifacts", path);

async function requireFiles(paths: string[]): Promise<void> {
  const missing: string[] = [];
  for (const path of paths) { try { await access(path); } catch { missing.push(path); } }
  if (missing.length) throw new Error(`pilot evidence missing; no measurements were invented:\n${missing.map(path => `- ${path}`).join("\n")}`);
}

async function inputs() {
  await requireFiles([artifact("resource-author/wire.jsonl"), artifact("resource-author/sidecar.jsonl"),
    artifact("distractor-author/wire.jsonl"), artifact("distractor-author/sidecar.jsonl"), artifact("query-author/queries.jsonl")]);
  const [resourceCatalog, resourceSidecars, distractorCatalog, distractorSidecars, queries] = await Promise.all([
    readJsonl(artifact("resource-author/wire.jsonl")), readJsonl(artifact("resource-author/sidecar.jsonl")),
    readJsonl(artifact("distractor-author/wire.jsonl")), readJsonl(artifact("distractor-author/sidecar.jsonl")),
    readJsonl(artifact("query-author/queries.jsonl")),
  ]);
  return { catalog: [...resourceCatalog, ...distractorCatalog], sidecars: [...resourceSidecars, ...distractorSidecars], queries };
}

async function prepare() {
  const data = await inputs();
  const prepared = preparePilot(data, process.env.BENCHMARK_RUN_AT ?? new Date().toISOString());
  await mkdir(GENERATED, { recursive: true });
  await Promise.all([
    writeFile(resolve(GENERATED, "grader-a-pack.json"), `${JSON.stringify(prepared.packs.a, null, 2)}\n`),
    writeFile(resolve(GENERATED, "grader-b-pack.json"), `${JSON.stringify(prepared.packs.b, null, 2)}\n`),
    writeFile(resolve(GENERATED, "forbidden-audit-pack.json"), `${JSON.stringify(prepared.auditPack, null, 2)}\n`),
    writeFile(resolve(GENERATED, "manifest.json"), `${JSON.stringify(prepared.manifest, null, 2)}\n`),
  ]);
  console.log("pilot prepare passed: 15 records, 6 queries, 180 blind grades, 15-record FC-02 audit pack");
}

async function adjudicate() {
  const data = await inputs();
  const [manifest, a, b, runs] = await Promise.all([
    readJson(resolve(GENERATED, "manifest.json")), readJson(resolve(GENERATED, "grader-a-import.json")),
    readJson(resolve(GENERATED, "grader-b-import.json")), readJsonl(artifact("run-evidence.jsonl")),
  ]);
  const aRun = runs.find((item: { role: string }) => item.role === "grader_a");
  const bRun = runs.find((item: { role: string }) => item.role === "grader_b");
  if (!aRun || !bRun) throw new Error("missing grader run evidence");
  const result = buildAdjudicationPack(manifest, a, b, { a: aRun, b: bRun }, data.catalog, data.sidecars, data.queries);
  await Promise.all([
    writeFile(resolve(GENERATED, "adjudicator-pack.json"), `${JSON.stringify(result.pack, null, 2)}\n`),
    writeFile(resolve(GENERATED, "adjudication-assignments.json"), `${JSON.stringify(result.assignments, null, 2)}\n`),
  ]);
  console.log(`pilot adjudication prepared: ${result.assignments.length} disagreement(s)`);
}

async function gate() {
  await requireFiles([resolve(GENERATED, "manifest.json"), artifact("run-evidence.jsonl"), artifact("owner-review.json"),
    resolve(GENERATED, "forbidden-audit-import.json"), artifact("rankings.jsonl"), artifact("qrels-reviewed.jsonl"),
    resolve(GENERATED, "grader-a-import.json"), resolve(GENERATED, "grader-b-import.json"),
    resolve(GENERATED, "adjudicator-import.json"), resolve(GENERATED, "adjudication-assignments.json"),
    resolve(PILOT, "prompts/manifest.jsonl")]);
  const [manifest, runs, owner, audit, rankings, qrels, graderA, graderB, adjudicator, adjudicationAssignments, promptManifest] = await Promise.all([
    readJson(resolve(GENERATED, "manifest.json")), readJsonl(artifact("run-evidence.jsonl")),
    readJson(artifact("owner-review.json")), readJson(resolve(GENERATED, "forbidden-audit-import.json")),
    readJsonl(artifact("rankings.jsonl")), readJsonl(artifact("qrels-reviewed.jsonl")),
    readJson(resolve(GENERATED, "grader-a-import.json")), readJson(resolve(GENERATED, "grader-b-import.json")),
    readJson(resolve(GENERATED, "adjudicator-import.json")), readJson(resolve(GENERATED, "adjudication-assignments.json")),
    readJsonl(resolve(PILOT, "prompts/manifest.jsonl")),
  ]);
  const report = derivePilotReport({ manifest, runs, owner, audit, rankings, qrels, graderA, graderB, adjudicator, adjudicationAssignments, promptManifest });
  await writeFile(resolve(PILOT, "pilot-report-evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`pilot gate passed; empirical judged@10 threshold=${report.judged_at_10_threshold}`);
}

if (!(["prepare", "adjudicate", "gate"] as const).includes(command as never)) throw new Error("usage: tsx tools/run-pilot-v2.ts <prepare|adjudicate|gate>");
await ({ prepare, adjudicate, gate }[command as "prepare" | "adjudicate" | "gate"])();
