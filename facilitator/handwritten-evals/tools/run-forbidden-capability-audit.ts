/** CLI for preparing and finalizing BUILD-PLAN §6 audits. Never launches audit agents. */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  ForbiddenAuditorAssignmentSchema,
  finalizeForbiddenCapabilityAudit,
  loadForbiddenMarkdown,
  prepareForbiddenCapabilityAudit,
} from "./forbidden-capability-audit.js";
import { readJsonl, writeArtifactBundleExclusive } from "./grading-pipeline.js";

const PrepareConfigSchema = z.object({
  audit_run_id: z.string().min(1),
  created_at: z.string().datetime(),
  seed: z.string().min(16),
  inputs: z.object({
    catalog: z.string().min(1),
    sidecars: z.string().min(1),
    forbidden_capabilities: z.string().min(1),
  }).strict(),
  auditors: z.array(ForbiddenAuditorAssignmentSchema).length(10),
  output_directory: z.string().min(1),
}).strict();

const FinalizeConfigSchema = z.object({
  generated_at: z.string().datetime(),
  inputs: z.object({
    catalog: z.string().min(1),
    sidecars: z.string().min(1),
    forbidden_capabilities: z.string().min(1),
    withheld_manifest: z.string().min(1),
    audit_imports: z.array(z.string().min(1)).length(10),
    owner_signoff: z.string().min(1),
  }).strict(),
  output_report: z.string().min(1),
}).strict();

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function prepare(configPath: string): Promise<void> {
  const config = PrepareConfigSchema.parse(await json(configPath));
  const [catalog, sidecars, markdown] = await Promise.all([
    readJsonl(resolve(config.inputs.catalog)),
    readJsonl(resolve(config.inputs.sidecars)),
    loadForbiddenMarkdown(resolve(config.inputs.forbidden_capabilities)),
  ]);
  const result = prepareForbiddenCapabilityAudit(catalog, sidecars, markdown, {
    auditRunId: config.audit_run_id,
    createdAt: config.created_at,
    seed: config.seed,
    auditors: config.auditors,
  });
  const output = resolve(config.output_directory);
  const artifacts = result.packs.flatMap((pack, index) => {
    const slug = pack.capability.id.toLowerCase();
    return [
      { path: resolve(output, "packs", `${slug}.json`), value: pack },
      { path: resolve(output, "prompts", `${slug}.md`), value: result.prompts[index], text: true },
    ];
  });
  await writeArtifactBundleExclusive([
    ...artifacts,
    { path: resolve(output, "withheld-manifest.json"), value: result.manifest },
  ]);
  console.log("prepared 10 isolated forbidden-capability audit packs covering 1,000 listings each");
}

async function finalize(configPath: string): Promise<void> {
  const config = FinalizeConfigSchema.parse(await json(configPath));
  const [catalog, sidecars, markdown, manifest, owner, ...imports] = await Promise.all([
    readJsonl(resolve(config.inputs.catalog)),
    readJsonl(resolve(config.inputs.sidecars)),
    loadForbiddenMarkdown(resolve(config.inputs.forbidden_capabilities)),
    json(config.inputs.withheld_manifest),
    json(config.inputs.owner_signoff),
    ...config.inputs.audit_imports.map(path => json(path)),
  ]);
  const report = finalizeForbiddenCapabilityAudit(
    catalog,
    sidecars,
    markdown,
    manifest,
    imports,
    owner,
    config.generated_at,
  );
  await writeArtifactBundleExclusive([{ path: resolve(config.output_report), value: report }]);
  console.log(`forbidden-capability audit complete; overall_passed=${report.overall_passed}`);
}

async function main(): Promise<void> {
  const [command, configPath] = process.argv.slice(2);
  if (!command || !configPath || !["prepare", "finalize"].includes(command)) {
    throw new Error("usage: tsx tools/run-forbidden-capability-audit.ts <prepare|finalize> <config.json>");
  }
  if (command === "prepare") await prepare(configPath);
  else await finalize(configPath);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
