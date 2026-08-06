/** Blind, deterministic Step 5 seed grading preparation. Produces no judgments. */

import { createHash } from "node:crypto";
import { z } from "zod";
import { GraderRefSchema, type CatalogRecord, type QueryRecord, type SidecarRecord } from "../schema/schema-v2.js";
import { PASS1_CANDIDATES_PER_QUERY } from "../query-config.js";
import { BlindGradingPackSchema, JudgmentImportSchema } from "./grading-pipeline.js";
import { deterministicEligibility } from "./pool.js";

const OpaqueIdSchema = z.string().regex(/^(task|candidate)-[a-f0-9]{16}$/);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const opaque = (kind: "task" | "candidate", ...parts: string[]) => `${kind}-${sha256(parts.join("\0")).slice(0, 16)}`;

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
}).strict();

export const Pass1SeedImportSchema = z.object({
  version: z.literal(1),
  role: z.literal("pass1_seed_grader"),
  pack_id: z.string().min(1),
  grader: GraderRefSchema,
  judgments: z.array(JudgmentImportSchema),
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
) {
  z.string().datetime().parse(createdAt);
  if (queries.length !== 100 || catalog.length !== 1_000 || sidecars.length !== 1_000) {
    throw new Error(`pass-1 seed requires 100 queries and 1,000 paired resources; got ${queries.length}/${catalog.length}/${sidecars.length}`);
  }
  const catalogById = new Map(catalog.map(item => [item.resource_id, item]));
  const sidecarById = new Map(sidecars.map(item => [item.resource_id, item]));
  const sourceHash = `sha256:${sha256(JSON.stringify({ queries, catalog, sidecars }))}`;
  const assignments: z.infer<typeof Pass1SeedAssignmentSchema>[] = [];
  const packRows: Array<{ pack_id: string; grader_run_id: string; prompt_hash: string; query_ids: string[] }> = [];
  const packs: Array<z.infer<typeof BlindGradingPackSchema>> = [];

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
      const selected = eligible.slice(0, PASS1_CANDIDATES_PER_QUERY);
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
  }
  const manifest = Pass1SeedManifestSchema.parse({ version: 1, created_at: createdAt, source_hash: sourceHash,
    candidates_per_query: PASS1_CANDIDATES_PER_QUERY, query_count: 100,
    pair_count: 100 * PASS1_CANDIDATES_PER_QUERY, packs: packRows, assignments });
  return { packs, manifest };
}

export function validatePass1SeedImport(raw: unknown, manifest: z.infer<typeof Pass1SeedManifestSchema>): void {
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
}
