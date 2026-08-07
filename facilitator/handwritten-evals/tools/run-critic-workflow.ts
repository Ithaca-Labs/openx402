#!/usr/bin/env node
/** CLI for BUILD-PLAN §1.1 critic/owner/repair evidence. Never launches agents. */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  CRITIC_ROLES,
  CriticAssignmentSchema,
  finalizeCriticOwnerReview,
  prepareCriticOwnerReview,
  prepareCriticReview,
} from "./critic-workflow.js";
import { readJsonl, writeArtifactBundleExclusive } from "./grading-pipeline.js";

const PrepareConfigSchema = z.object({
  scope: z.enum(["corpus", "full"]),
  review_run_id: z.string().min(1),
  created_at: z.string().datetime(),
  seed: z.string().min(16),
  inputs: z.object({
    catalog: z.string().min(1),
    sidecars: z.string().min(1),
    queries: z.string().min(1).nullable(),
    families: z.string().min(1),
    forbidden_capabilities: z.string().min(1),
  }).strict(),
  critics: z.array(CriticAssignmentSchema).length(CRITIC_ROLES.length),
  output_directory: z.string().min(1),
}).strict();

const ConsolidateConfigSchema = z.object({
  inputs: z.object({
    withheld_manifest: z.string().min(1),
    critic_imports: z.array(z.string().min(1)).length(CRITIC_ROLES.length),
  }).strict(),
  output_owner_pack: z.string().min(1),
}).strict();

const FinalizeConfigSchema = z.object({
  generated_at: z.string().datetime(),
  repair_round: z.number().int().positive(),
  inputs: z.object({
    withheld_manifest: z.string().min(1),
    critic_imports: z.array(z.string().min(1)).length(CRITIC_ROLES.length),
    owner_decisions: z.string().min(1),
  }).strict(),
  outputs: z.object({
    owner_acceptance_report: z.string().min(1),
    repair_directory: z.string().min(1),
  }).strict(),
}).strict();

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function prepare(path: string): Promise<void> {
  const config = PrepareConfigSchema.parse(await json(path));
  const [catalog, sidecars, queries, familiesMarkdown, forbiddenMarkdown] = await Promise.all([
    readJsonl(resolve(config.inputs.catalog)),
    readJsonl(resolve(config.inputs.sidecars)),
    config.inputs.queries === null ? [] : readJsonl(resolve(config.inputs.queries)),
    readFile(resolve(config.inputs.families), "utf8"),
    readFile(resolve(config.inputs.forbidden_capabilities), "utf8"),
  ]);
  const prepared = prepareCriticReview(
    { catalog, sidecars, queries },
    { familiesMarkdown, forbiddenMarkdown },
    { scope: config.scope, reviewRunId: config.review_run_id, createdAt: config.created_at,
      seed: config.seed, critics: config.critics },
  );
  const output = resolve(config.output_directory);
  const artifacts = prepared.packs.flatMap((pack, index) => [
    { path: resolve(output, "packs", `${pack.role}.json`), value: pack },
    { path: resolve(output, "prompts", `${pack.role}.md`), value: prepared.prompts[index], text: true },
  ]);
  await writeArtifactBundleExclusive([
    ...artifacts,
    { path: resolve(output, "withheld-manifest.json"), value: prepared.manifest },
  ]);
  console.log(`prepared ${prepared.packs.length} isolated critic packs for ${prepared.manifest.slot_briefs.length} artifacts`);
}

async function consolidate(path: string): Promise<void> {
  const config = ConsolidateConfigSchema.parse(await json(path));
  const [manifest, ...imports] = await Promise.all([
    json(config.inputs.withheld_manifest),
    ...config.inputs.critic_imports.map(value => json(value)),
  ]);
  const ownerPack = prepareCriticOwnerReview(manifest, imports);
  await writeArtifactBundleExclusive([{ path: resolve(config.output_owner_pack), value: ownerPack }]);
  console.log(`prepared owner review for ${ownerPack.artifacts.length} artifacts`);
}

async function finalize(path: string): Promise<void> {
  const config = FinalizeConfigSchema.parse(await json(path));
  const [manifest, owner, ...imports] = await Promise.all([
    json(config.inputs.withheld_manifest),
    json(config.inputs.owner_decisions),
    ...config.inputs.critic_imports.map(value => json(value)),
  ]);
  const finalized = finalizeCriticOwnerReview(manifest, imports, owner, {
    generatedAt: config.generated_at,
    repairRound: config.repair_round,
  });
  const repairDirectory = resolve(config.outputs.repair_directory);
  await writeArtifactBundleExclusive([
    { path: resolve(config.outputs.owner_acceptance_report), value: finalized.report },
    { path: resolve(repairDirectory, "repair-manifest.json"), value: finalized.repairManifest },
    ...finalized.repairPrompts.map(value => ({ path: resolve(repairDirectory, value.path), value: value.prompt, text: true })),
  ]);
  console.log(
    `owner-reviewed ${finalized.report.artifacts_reviewed} artifacts; `
    + `${finalized.report.repair_required_artifacts} fresh repair task(s) prepared`,
  );
}

async function main(): Promise<void> {
  const [command, configPath] = process.argv.slice(2);
  if (!command || !configPath || !["prepare", "consolidate", "finalize"].includes(command)) {
    throw new Error("usage: tsx tools/run-critic-workflow.ts <prepare|consolidate|finalize> <config.json>");
  }
  if (command === "prepare") await prepare(configPath);
  if (command === "consolidate") await consolidate(configPath);
  if (command === "finalize") await finalize(configPath);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
