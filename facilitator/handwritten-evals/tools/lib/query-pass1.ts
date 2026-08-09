/** Blind, deterministic Step 5 seed grading preparation. Produces no judgments. */

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { GraderRefSchema, QrelRecordSchema, RELEASE_COUNTS, type CatalogRecord, type QrelRecord, type QueryRecord, type SidecarRecord } from "../../schema/schema-v2.js";
import { PASS1_CANDIDATES_PER_QUERY, queryAssignment } from "../../query-config.js";
import { BlindGradingPackSchema, JudgmentImportSchema } from "./grading-pipeline.js";
import { deterministicEligibility } from "./pool.js";

const OpaqueIdSchema = z.string().regex(/^(task|candidate)-[a-f0-9]{16}$/);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const opaque = (kind: "task" | "candidate", ...parts: string[]) => `${kind}-${sha256(parts.join("\0")).slice(0, 16)}`;

export function pass1SourceHash(
  queries: readonly QueryRecord[],
  catalog: readonly CatalogRecord[],
  sidecars: readonly SidecarRecord[],
): string {
  return `sha256:${sha256(JSON.stringify({ queries, catalog, sidecars }))}`;
}

export const Pass1SeedAssignmentSchema = z.object({
  task_id: OpaqueIdSchema,
  candidate_id: OpaqueIdSchema,
  query_id: z.string().regex(/^qry-\d{3}$/),
  resource_id: z.string().regex(/^res-\d{4}$/),
  query_author_run_id: z.string().min(1),
  resource_author_run_id: z.string().min(1),
  grader_run_id: z.string().min(1),
}).strict();

export const Pass1SeedManifestSchema = z.object({
  version: z.literal(1),
  created_at: z.string().datetime(),
  source_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  candidates_per_query: z.literal(PASS1_CANDIDATES_PER_QUERY),
  query_count: z.literal(100),
  pair_count: z.literal(100 * PASS1_CANDIDATES_PER_QUERY),
  packs: z.array(z.object({
    pack_id: z.string().min(1),
    grader_run_id: z.string().min(1),
    prompt_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    query_ids: z.array(z.string().regex(/^qry-\d{3}$/)).length(10),
  }).strict()).length(10),
  assignments: z.array(Pass1SeedAssignmentSchema).length(100 * PASS1_CANDIDATES_PER_QUERY),
}).strict().superRefine((value, context) => {
  const packIds = value.packs.map(pack => pack.pack_id);
  const graderRuns = value.packs.map(pack => pack.grader_run_id);
  if (new Set(packIds).size !== packIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["packs"], message: "pack_id values must be unique" });
  }
  if (new Set(graderRuns).size !== graderRuns.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["packs"], message: "every pass-1 shard requires a fresh grader run" });
  }
  const opaque = value.assignments.map(item => `${item.task_id}\0${item.candidate_id}`);
  const source = value.assignments.map(item => `${item.query_id}\0${item.resource_id}`);
  if (new Set(opaque).size !== opaque.length || new Set(source).size !== source.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["assignments"], message: "assignments must be unique by opaque and source pair" });
  }
});

export const Pass1SeedImportSchema = z.object({
  version: z.literal(1),
  role: z.literal("pass1_seed_grader"),
  pack_id: z.string().min(1),
  grader: GraderRefSchema,
  judgments: z.array(JudgmentImportSchema),
}).strict();

const HashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const Pass1SeedReportSchema = z.object({
  version: z.literal(1),
  artifact: z.literal("pass1-seed-report-v2"),
  status: z.literal("pass"),
  generated_at: z.string().datetime(),
  source_hash: HashSchema,
  manifest_hash: HashSchema,
  import_hashes: z.record(z.string().min(1), HashSchema),
  query_count: z.literal(100),
  candidates_per_query: z.literal(PASS1_CANDIDATES_PER_QUERY),
  pair_count: z.literal(100 * PASS1_CANDIDATES_PER_QUERY),
  grader_run_ids: z.array(z.string().min(1)).length(10),
  checks: z.object({
    exact_pack_coverage: z.literal(true),
    exact_pair_coverage: z.literal(true),
    all_rationales_present: z.literal(true),
    graders_are_distinct_non_authors: z.literal(true),
  }).strict(),
}).strict();

function listing(catalog: CatalogRecord, sidecar: SidecarRecord) {
  const resource = catalog.wire.resource;
  return {
    resource_type: sidecar.resource_type,
    ...(resource.serviceName === undefined ? {} : { serviceName: resource.serviceName }),
    ...(resource.description === undefined ? {} : { description: resource.description }),
    ...(resource.tags === undefined ? {} : { tags: resource.tags }),
    ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
    ...(sidecar.mcp === undefined ? {} : { mcp: sidecar.mcp }),
  };
}

export function preparePass1Seed(
  queries: readonly QueryRecord[], catalog: readonly CatalogRecord[], sidecars: readonly SidecarRecord[], createdAt: string,
  sealedImportDirectory: string,
) {
  z.string().datetime().parse(createdAt);
  if (!sealedImportDirectory.trim()) throw new Error("sealed pass-1 import directory is required");
  if (queries.length !== RELEASE_COUNTS.queries.total || catalog.length !== RELEASE_COUNTS.resources.total
    || sidecars.length !== RELEASE_COUNTS.resources.total) {
    throw new Error(`pass-1 seed requires ${RELEASE_COUNTS.queries.total} queries and ${RELEASE_COUNTS.resources.total} paired resources; got ${queries.length}/${catalog.length}/${sidecars.length}`);
  }
  const catalogById = new Map(catalog.map(item => [item.resource_id, item]));
  const sidecarById = new Map(sidecars.map(item => [item.resource_id, item]));
  const sourceHash = pass1SourceHash(queries, catalog, sidecars);
  const assignments: z.infer<typeof Pass1SeedAssignmentSchema>[] = [];
  const packRows: Array<{ pack_id: string; grader_run_id: string; prompt_hash: string; query_ids: string[] }> = [];
  const packs: Array<z.infer<typeof BlindGradingPackSchema>> = [];
  const prompts: string[] = [];

  for (let shard = 1; shard <= 10; shard += 1) {
    const shardQueries = queries.slice((shard - 1) * 10, shard * 10);
    const graderRunId = `run-query-pass1-grader-${String(shard).padStart(2, "0")}`;
    if (shardQueries.some(query => query.generation.run_id === graderRunId)) throw new Error("grader must be independent of query author");
    const packId = `query-pass1-seed-${String(shard).padStart(2, "0")}`;
    const tasks = shardQueries.map(query => {
      const eligible = catalog.filter(record => {
        const sidecar = sidecarById.get(record.resource_id);
        return sidecar && deterministicEligibility(query, record, sidecar).eligible;
      }).sort((left, right) => sha256(`${sourceHash}\0${query.query_id}\0${left.resource_id}`)
        .localeCompare(sha256(`${sourceHash}\0${query.query_id}\0${right.resource_id}`)));
      if (eligible.length < PASS1_CANDIDATES_PER_QUERY) throw new Error(`${query.query_id}: fewer than seven hard-filter-eligible candidates`);
      const frozen = queryAssignment(query.query_id);
      let selected: CatalogRecord[];
      if (frozen.anchorResourceId === null) {
        selected = eligible.slice(0, PASS1_CANDIDATES_PER_QUERY);
      } else {
        const anchor = catalogById.get(frozen.anchorResourceId);
        if (!anchor || !eligible.some(record => record.resource_id === anchor.resource_id)) {
          throw new Error(`${query.query_id}: frozen anchor ${frozen.anchorResourceId} does not satisfy its hard filters`);
        }
        const sameFamily = eligible.filter(record => {
          const sidecar = sidecarById.get(record.resource_id)!;
          return record.resource_id !== anchor.resource_id && sidecar.family === query.family;
        }).slice(0, 2);
        const already = new Set([anchor.resource_id, ...sameFamily.map(record => record.resource_id)]);
        const background = eligible.filter(record => !already.has(record.resource_id));
        selected = [anchor, ...sameFamily, ...background].slice(0, PASS1_CANDIDATES_PER_QUERY);
      }
      const taskId = opaque("task", sourceHash, graderRunId, query.query_id);
      return {
        task_id: taskId,
        query: query.query,
        candidates: selected.map(record => {
          const sidecar = sidecarById.get(record.resource_id)!;
          const candidateId = opaque("candidate", sourceHash, graderRunId, query.query_id, record.resource_id);
          assignments.push({ task_id: taskId, candidate_id: candidateId, query_id: query.query_id,
            resource_id: record.resource_id, query_author_run_id: query.generation.run_id,
            resource_author_run_id: sidecar.generation.run_id, grader_run_id: graderRunId });
          return { candidate_id: candidateId, listing: listing(record, sidecar) };
        }),
      };
    });
    const pack = BlindGradingPackSchema.parse({ version: 1, role: "grader", pack_id: packId,
      instructions: "Independently grade capability relevance 0–3. Candidates passed hard filters. Return one judgment per candidate; do not infer source identity.", tasks });
    const promptHash = `sha256:${sha256(JSON.stringify(pack))}`;
    packs.push(pack);
    packRows.push({ pack_id: packId, grader_run_id: graderRunId, prompt_hash: promptHash,
      query_ids: shardQueries.map(query => query.query_id) });
    prompts.push(`# Step 5 pass-1 seed grader ${String(shard).padStart(2, "0")}

You are a fresh isolated grading context. Read only:

1. \`handwritten-evals/staging/query-pass1/grader-${String(shard).padStart(2, "0")}.json\`
2. BUILD-PLAN §7 (the 0–3 relevance rubric)

Run id: \`${graderRunId}\`
Pack id: \`${packId}\`
Prompt/task-pack hash: \`${promptHash}\`
Output: \`${resolve(sealedImportDirectory, `grader-${String(shard).padStart(2, "0")}.json`)}\`

Return one \`Pass1SeedImportSchema\` JSON object covering every opaque candidate exactly once.
Use role \`pass1_seed_grader\`, the exact pack/run/hash above, provider \`anthropic\`, and actual
model revision, shard id, sampling temperature, and generation timestamp. Grade only the visible
buyer query and listing under §7. Do not access source mappings, query/resource authors, ids,
families, catalog/sidecars, retrieval systems, ranks, scores, another grader, or sibling output.
Include a concise rationale for every judgment. Stop after the one import file and discard context.
`);
  }
  const manifest = Pass1SeedManifestSchema.parse({ version: 1, created_at: createdAt, source_hash: sourceHash,
    candidates_per_query: PASS1_CANDIDATES_PER_QUERY, query_count: 100,
    pair_count: 100 * PASS1_CANDIDATES_PER_QUERY, packs: packRows, assignments });
  return { packs, prompts, manifest };
}

export function validatePass1SeedImport(raw: unknown, manifest: z.infer<typeof Pass1SeedManifestSchema>) {
  const imported = Pass1SeedImportSchema.parse(raw);
  const pack = manifest.packs.find(item => item.pack_id === imported.pack_id);
  if (!pack) throw new Error(`unknown pass-1 pack ${imported.pack_id}`);
  if (imported.grader.run_id !== pack.grader_run_id || imported.grader.prompt_hash !== pack.prompt_hash) {
    throw new Error(`${imported.pack_id}: grader provenance does not match manifest`);
  }
  const expected = manifest.assignments.filter(item => item.grader_run_id === pack.grader_run_id)
    .map(item => `${item.task_id}\0${item.candidate_id}`).sort();
  const actual = imported.judgments.map(item => `${item.task_id}\0${item.candidate_id}`).sort();
  if (new Set(actual).size !== actual.length || actual.join("\n") !== expected.join("\n")) {
    throw new Error(`${imported.pack_id}: judgments must cover every assigned candidate exactly once`);
  }
  const assignmentByOpaque = new Map(manifest.assignments.map(item => [`${item.task_id}\0${item.candidate_id}`, item]));
  for (const judgment of imported.judgments) {
    const assignment = assignmentByOpaque.get(`${judgment.task_id}\0${judgment.candidate_id}`)!;
    if (!judgment.rationale?.trim()) throw new Error(`${imported.pack_id}: every pass-1 judgment requires a rationale`);
    if (imported.grader.run_id === assignment.query_author_run_id || imported.grader.run_id === assignment.resource_author_run_id) {
      throw new Error(`${imported.pack_id}: grader authored an assigned query or resource`);
    }
  }
  return imported;
}

export function finalizePass1Seed(
  rawImports: readonly unknown[],
  rawManifest: unknown,
  generatedAt: string,
): { qrels: QrelRecord[]; report: z.infer<typeof Pass1SeedReportSchema> } {
  z.string().datetime().parse(generatedAt);
  const manifest = Pass1SeedManifestSchema.parse(rawManifest);
  const imports = rawImports.map(raw => validatePass1SeedImport(raw, manifest));
  const expectedPackIds = manifest.packs.map(pack => pack.pack_id).sort();
  const actualPackIds = imports.map(record => record.pack_id).sort();
  if (imports.length !== manifest.packs.length || new Set(actualPackIds).size !== actualPackIds.length
      || actualPackIds.join("\n") !== expectedPackIds.join("\n")) {
    throw new Error(`pass-1 finalization requires exactly one valid import for each of ${manifest.packs.length} packs`);
  }

  const assignmentByOpaque = new Map(manifest.assignments.map(item => [`${item.task_id}\0${item.candidate_id}`, item]));
  const qrels = imports.flatMap(imported => imported.judgments.map(judgment => {
    const assignment = assignmentByOpaque.get(`${judgment.task_id}\0${judgment.candidate_id}`)!;
    return QrelRecordSchema.parse({
      query_id: assignment.query_id,
      resource_id: assignment.resource_id,
      grade: judgment.grade,
      eligible: true,
      judge: "agent",
      rationale: judgment.rationale,
      annotator: imported.grader.run_id,
      judged_at: judgment.judged_at,
      generation: imported.grader,
      review_status: "pending",
      reviewed_at: null,
      reviewed_by: null,
      owner_note: null,
    });
  })).sort((left, right) => `${left.query_id}\0${left.resource_id}`.localeCompare(`${right.query_id}\0${right.resource_id}`));
  if (qrels.length !== manifest.pair_count || new Set(qrels.map(item => `${item.query_id}\0${item.resource_id}`)).size !== qrels.length) {
    throw new Error("pass-1 resolved qrels do not cover every source pair exactly once");
  }
  const hash = (value: unknown) => `sha256:${sha256(JSON.stringify(value))}`;
  const importHashes = Object.fromEntries(imports
    .sort((left, right) => left.pack_id.localeCompare(right.pack_id))
    .map(imported => [imported.pack_id, hash(imported)]));
  const report = Pass1SeedReportSchema.parse({
    version: 1,
    artifact: "pass1-seed-report-v2",
    status: "pass",
    generated_at: generatedAt,
    source_hash: manifest.source_hash,
    manifest_hash: hash(manifest),
    import_hashes: importHashes,
    query_count: 100,
    candidates_per_query: PASS1_CANDIDATES_PER_QUERY,
    pair_count: qrels.length,
    grader_run_ids: imports.map(record => record.grader.run_id).sort(),
    checks: {
      exact_pack_coverage: true,
      exact_pair_coverage: true,
      all_rationales_present: true,
      graders_are_distinct_non_authors: true,
    },
  });
  return { qrels, report };
}
