/** CLI for grading-pipeline.ts. All outputs use exclusive creation; reruns never overwrite evidence. */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { GraderRefSchema } from "../schema/schema-v2.js";
import {
  applyOwnerReview,
  finalizeGrading,
  parsePrerequisites,
  prepareBlindAdjudication,
  prepareBlindGrading,
  readJsonl,
  writeArtifactBundleExclusive,
} from "./grading-pipeline.js";

const PathsSchema = z.object({
  queries: z.string().min(1),
  catalog: z.string().min(1),
  sidecars: z.string().min(1),
  pool: z.string().min(1),
}).strict();

const PrepareConfigSchema = z.object({
  pipeline_run_id: z.string().min(1),
  created_at: z.string().datetime(),
  seed: z.string().min(16),
  grader_a: GraderRefSchema,
  grader_b: GraderRefSchema,
  inputs: PathsSchema,
  outputs: z.object({
    grader_a_pack: z.string().min(1),
    grader_b_pack: z.string().min(1),
    withheld_manifest: z.string().min(1),
  }).strict(),
}).strict();

const AdjudicateConfigSchema = z.object({
  pipeline_run_id: z.string().min(1),
  created_at: z.string().datetime(),
  seed: z.string().min(16),
  adjudicator: GraderRefSchema,
  inputs: PathsSchema.extend({
    grading_manifest: z.string().min(1),
    grader_a_import: z.string().min(1),
    grader_b_import: z.string().min(1),
  }).strict(),
  outputs: z.object({
    adjudication_pack: z.string().min(1),
    withheld_manifest: z.string().min(1),
  }).strict(),
}).strict();

const FinalizeConfigSchema = z.object({
  generated_at: z.string().datetime(),
  inputs: PathsSchema.extend({
    grading_manifest: z.string().min(1),
    grader_a_import: z.string().min(1),
    grader_b_import: z.string().min(1),
    adjudication_manifest: z.string().min(1).nullable(),
    adjudicator_import: z.string().min(1).nullable(),
  }).strict(),
  outputs: z.object({
    qrels: z.string().min(1),
    calibration: z.string().min(1),
    agreement_report: z.string().min(1),
  }).strict(),
}).strict();

const OwnerReviewConfigSchema = z.object({
  generated_at: z.string().datetime(),
  inputs: z.object({
    queries: z.string().min(1),
    raw_qrels: z.string().min(1),
    raw_calibration: z.string().min(1),
    owner_decisions: z.string().min(1),
  }).strict(),
  outputs: z.object({
    development_qrels: z.string().min(1),
    release_qrels: z.string().min(1),
    reviewed_calibration: z.string().min(1),
    owner_review_report: z.string().min(1),
  }).strict(),
}).strict();

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function loadSources(paths: z.infer<typeof PathsSchema>) {
  const [queries, catalog, sidecars, pool] = await Promise.all([
    readJsonl(resolve(paths.queries)),
    readJsonl(resolve(paths.catalog)),
    readJsonl(resolve(paths.sidecars)),
    readJsonl(resolve(paths.pool)),
  ]);
  return { queries, catalog, sidecars, pool };
}

async function prepare(configPath: string): Promise<void> {
  const config = PrepareConfigSchema.parse(await readJson(configPath));
  const result = prepareBlindGrading(await loadSources(config.inputs), {
    pipelineRunId: config.pipeline_run_id,
    createdAt: config.created_at,
    seed: config.seed,
    graderA: config.grader_a,
    graderB: config.grader_b,
  });
  await writeArtifactBundleExclusive([
    { path: resolve(config.outputs.grader_a_pack), value: result.graderA },
    { path: resolve(config.outputs.grader_b_pack), value: result.graderB },
    { path: resolve(config.outputs.withheld_manifest), value: result.manifest },
  ]);
  console.log(`prepared ${result.manifest.assignments.a.length} blind judgments for each grader`);
}

async function adjudicate(configPath: string): Promise<void> {
  const config = AdjudicateConfigSchema.parse(await readJson(configPath));
  const sourceRaw = await loadSources(config.inputs);
  const sources = parsePrerequisites(sourceRaw);
  const [gradingManifest, graderA, graderB] = await Promise.all([
    readJson(config.inputs.grading_manifest),
    readJson(config.inputs.grader_a_import),
    readJson(config.inputs.grader_b_import),
  ]);
  const result = prepareBlindAdjudication(sources, gradingManifest, graderA, graderB, config.adjudicator, {
    pipelineRunId: config.pipeline_run_id,
    createdAt: config.created_at,
    seed: config.seed,
  });
  await writeArtifactBundleExclusive([
    { path: resolve(config.outputs.adjudication_pack), value: result.pack },
    { path: resolve(config.outputs.withheld_manifest), value: result.manifest },
  ]);
  console.log(`prepared ${result.manifest.assignments.length} blind disagreement adjudications`);
}

async function finalize(configPath: string): Promise<void> {
  const config = FinalizeConfigSchema.parse(await readJson(configPath));
  const sourceRaw = await loadSources(config.inputs);
  const sources = parsePrerequisites(sourceRaw);
  const [manifest, graderA, graderB, adjudicationManifest, adjudicator] = await Promise.all([
    readJson(config.inputs.grading_manifest),
    readJson(config.inputs.grader_a_import),
    readJson(config.inputs.grader_b_import),
    config.inputs.adjudication_manifest === null ? null : readJson(config.inputs.adjudication_manifest),
    config.inputs.adjudicator_import === null ? null : readJson(config.inputs.adjudicator_import),
  ]);
  const result = finalizeGrading(
    sources,
    manifest,
    graderA,
    graderB,
    adjudicationManifest,
    adjudicator,
    config.generated_at,
  );
  await writeArtifactBundleExclusive([
    { path: resolve(config.outputs.qrels), value: result.qrels, jsonl: true },
    { path: resolve(config.outputs.calibration), value: result.calibration, jsonl: true },
    { path: resolve(config.outputs.agreement_report), value: result.agreementReport },
  ]);
  console.log(`merged ${result.qrels.length} judged pairs; ${result.agreementReport.disagreement_count} disagreements`);
}

async function ownerReview(configPath: string): Promise<void> {
  const config = OwnerReviewConfigSchema.parse(await readJson(configPath));
  const [queries, qrels, calibration, decisions] = await Promise.all([
    readJsonl(resolve(config.inputs.queries)),
    readJsonl(resolve(config.inputs.raw_qrels)),
    readJsonl(resolve(config.inputs.raw_calibration)),
    readJson(config.inputs.owner_decisions),
  ]);
  const result = applyOwnerReview(queries, qrels, calibration, decisions, config.generated_at);
  await writeArtifactBundleExclusive([
    { path: resolve(config.outputs.development_qrels), value: result.developmentQrels, jsonl: true },
    { path: resolve(config.outputs.release_qrels), value: result.releaseQrels, jsonl: true },
    { path: resolve(config.outputs.reviewed_calibration), value: result.reviewedCalibration, jsonl: true },
    { path: resolve(config.outputs.owner_review_report), value: result.report },
  ]);
  console.log(
    `owner-reviewed ${result.report.pairs.total} pairs; emitted ` +
    `${result.developmentQrels.length} development and ${result.releaseQrels.length} release qrels`,
  );
}

async function main(): Promise<void> {
  const [command, configPath] = process.argv.slice(2);
  if (!command || !configPath || !["prepare", "adjudicate", "finalize", "owner-review"].includes(command)) {
    throw new Error("usage: tsx tools/run-grading-pipeline.ts <prepare|adjudicate|finalize|owner-review> <config.json>");
  }
  if (command === "prepare") await prepare(configPath);
  if (command === "adjudicate") await adjudicate(configPath);
  if (command === "finalize") await finalize(configPath);
  if (command === "owner-review") await ownerReview(configPath);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
