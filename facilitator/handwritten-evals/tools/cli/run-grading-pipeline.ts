/** CLI for grading-pipeline.ts. All outputs use exclusive creation; reruns never overwrite evidence. */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { GraderRefSchema } from "../../schema/schema-v2.js";
import {
  applyOwnerReview,
  buildGradingProcessAudit,
  finalizeGrading,
  parsePrerequisites,
  prepareBlindAdjudication,
  prepareBlindGrading,
  readJsonl,
  writeArtifactBundleExclusive,
} from "../lib/grading-pipeline.js";
import { assertSealedHoldoutArtifactPath, assertSealedReleaseQrelsPath } from "../lib/holdout-v2.js";

const HANDWRITTEN_EVALS_ROOT = resolve(import.meta.dirname, "../..");

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
    grader_a_pack: z.string().min(1),
    grader_b_pack: z.string().min(1),
    grader_a_import: z.string().min(1),
    grader_b_import: z.string().min(1),
    adjudication_manifest: z.string().min(1).nullable(),
    adjudication_pack: z.string().min(1).nullable(),
    adjudicator_import: z.string().min(1).nullable(),
  }).strict(),
  outputs: z.object({
    qrels: z.string().min(1),
    calibration: z.string().min(1),
    agreement_report: z.string().min(1),
    process_audit: z.string().min(1),
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
    owner_review_public_summary: z.string().min(1),
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
  const withheldManifestPath = assertSealedHoldoutArtifactPath(
    HANDWRITTEN_EVALS_ROOT, config.outputs.withheld_manifest, "withheld grading source mapping",
  );
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
    { path: withheldManifestPath, value: result.manifest },
  ]);
  console.log(`prepared ${result.manifest.assignments.a.length} blind judgments for each grader`);
}

async function adjudicate(configPath: string): Promise<void> {
  const config = AdjudicateConfigSchema.parse(await readJson(configPath));
  const gradingManifestPath = assertSealedHoldoutArtifactPath(
    HANDWRITTEN_EVALS_ROOT, config.inputs.grading_manifest, "withheld grading source mapping",
  );
  const graderAImportPath = assertSealedHoldoutArtifactPath(
    HANDWRITTEN_EVALS_ROOT, config.inputs.grader_a_import, "grader A judgments",
  );
  const graderBImportPath = assertSealedHoldoutArtifactPath(
    HANDWRITTEN_EVALS_ROOT, config.inputs.grader_b_import, "grader B judgments",
  );
  const adjudicationManifestPath = assertSealedHoldoutArtifactPath(
    HANDWRITTEN_EVALS_ROOT, config.outputs.withheld_manifest, "withheld adjudication source mapping",
  );
  const sourceRaw = await loadSources(config.inputs);
  const sources = parsePrerequisites(sourceRaw);
  const [gradingManifest, graderA, graderB] = await Promise.all([
    readJson(gradingManifestPath),
    readJson(graderAImportPath),
    readJson(graderBImportPath),
  ]);
  const result = prepareBlindAdjudication(sources, gradingManifest, graderA, graderB, config.adjudicator, {
    pipelineRunId: config.pipeline_run_id,
    createdAt: config.created_at,
    seed: config.seed,
  });
  await writeArtifactBundleExclusive([
    { path: resolve(config.outputs.adjudication_pack), value: result.pack },
    { path: adjudicationManifestPath, value: result.manifest },
  ]);
  console.log(`prepared ${result.manifest.assignments.length} blind disagreement adjudications`);
}

async function finalize(configPath: string): Promise<void> {
  const config = FinalizeConfigSchema.parse(await readJson(configPath));
  const rawQrelsPath = assertSealedHoldoutArtifactPath(HANDWRITTEN_EVALS_ROOT, config.outputs.qrels, "raw mixed-split qrels");
  const rawCalibrationPath = assertSealedHoldoutArtifactPath(HANDWRITTEN_EVALS_ROOT, config.outputs.calibration, "raw mixed-split calibration");
  const gradingManifestPath = assertSealedHoldoutArtifactPath(HANDWRITTEN_EVALS_ROOT, config.inputs.grading_manifest, "withheld grading source mapping");
  const graderAImportPath = assertSealedHoldoutArtifactPath(HANDWRITTEN_EVALS_ROOT, config.inputs.grader_a_import, "grader A judgments");
  const graderBImportPath = assertSealedHoldoutArtifactPath(HANDWRITTEN_EVALS_ROOT, config.inputs.grader_b_import, "grader B judgments");
  const adjudicationManifestPath = config.inputs.adjudication_manifest === null ? null
    : assertSealedHoldoutArtifactPath(HANDWRITTEN_EVALS_ROOT, config.inputs.adjudication_manifest, "withheld adjudication source mapping");
  const adjudicatorImportPath = config.inputs.adjudicator_import === null ? null
    : assertSealedHoldoutArtifactPath(HANDWRITTEN_EVALS_ROOT, config.inputs.adjudicator_import, "adjudicator judgments");
  const sourceRaw = await loadSources(config.inputs);
  const sources = parsePrerequisites(sourceRaw);
  const [manifest, graderAPack, graderBPack, graderA, graderB, adjudicationManifest, adjudicationPack, adjudicator] = await Promise.all([
    readJson(gradingManifestPath),
    readJson(config.inputs.grader_a_pack),
    readJson(config.inputs.grader_b_pack),
    readJson(graderAImportPath),
    readJson(graderBImportPath),
    adjudicationManifestPath === null ? null : readJson(adjudicationManifestPath),
    config.inputs.adjudication_pack === null ? null : readJson(config.inputs.adjudication_pack),
    adjudicatorImportPath === null ? null : readJson(adjudicatorImportPath),
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
  const processAudit = buildGradingProcessAudit({
    sources,
    gradingManifest: manifest,
    graderAPack,
    graderBPack,
    graderAImport: graderA,
    graderBImport: graderB,
    adjudicationManifest,
    adjudicationPack,
    adjudicatorImport: adjudicator,
  }, config.generated_at);
  await writeArtifactBundleExclusive([
    { path: rawQrelsPath, value: result.qrels, jsonl: true },
    { path: rawCalibrationPath, value: result.calibration, jsonl: true },
    { path: resolve(config.outputs.agreement_report), value: result.agreementReport },
    { path: resolve(config.outputs.process_audit), value: processAudit },
  ]);
  console.log(`merged ${result.qrels.length} judged pairs; ${result.agreementReport.disagreement_count} disagreements`);
}

async function ownerReview(configPath: string): Promise<void> {
  const config = OwnerReviewConfigSchema.parse(await readJson(configPath));
  const rawQrelsPath = assertSealedHoldoutArtifactPath(HANDWRITTEN_EVALS_ROOT, config.inputs.raw_qrels, "raw mixed-split qrels");
  const rawCalibrationPath = assertSealedHoldoutArtifactPath(HANDWRITTEN_EVALS_ROOT, config.inputs.raw_calibration, "raw mixed-split calibration");
  const ownerDecisionsPath = assertSealedHoldoutArtifactPath(HANDWRITTEN_EVALS_ROOT, config.inputs.owner_decisions, "owner pair decisions");
  const sealedReleaseQrelsPath = assertSealedReleaseQrelsPath(
    HANDWRITTEN_EVALS_ROOT,
    config.outputs.release_qrels,
  );
  const reviewedCalibrationPath = assertSealedHoldoutArtifactPath(
    HANDWRITTEN_EVALS_ROOT, config.outputs.reviewed_calibration, "reviewed mixed-split calibration",
  );
  const fullOwnerReportPath = assertSealedHoldoutArtifactPath(
    HANDWRITTEN_EVALS_ROOT, config.outputs.owner_review_report, "full owner review report",
  );
  const [queries, qrels, calibration, decisions] = await Promise.all([
    readJsonl(resolve(config.inputs.queries)),
    readJsonl(rawQrelsPath),
    readJsonl(rawCalibrationPath),
    readJson(ownerDecisionsPath),
  ]);
  const result = applyOwnerReview(queries, qrels, calibration, decisions, config.generated_at);
  await writeArtifactBundleExclusive([
    { path: resolve(config.outputs.development_qrels), value: result.developmentQrels, jsonl: true },
    { path: sealedReleaseQrelsPath, value: result.releaseQrels, jsonl: true },
    { path: reviewedCalibrationPath, value: result.reviewedCalibration, jsonl: true },
    { path: fullOwnerReportPath, value: result.report },
    { path: resolve(config.outputs.owner_review_public_summary), value: result.publicSummary },
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
