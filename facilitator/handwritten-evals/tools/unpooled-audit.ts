/**
 * BUILD-PLAN §8 Pass 2b: deterministic unpooled-audit sampling and blind import validation.
 *
 * BM25 is used only to define a topically related sampling frame. Its ranks and scores remain in
 * the owner-only manifest and are never interpreted as relevance or shown to audit agents.
 */

import { createHash } from "node:crypto";
import { mkdir, open, unlink, type FileHandle } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import {
  CatalogRecordSchema,
  GraderRefSchema,
  POOL_BUILD_SYSTEMS,
  PoolRecordSchema,
  QrelRecordSchema,
  QueryRecordSchema,
  RELEASE_COUNTS,
  SidecarRecordSchema,
  type CatalogRecord,
  type GraderRef,
  type PoolRecord,
  type QrelRecord,
  type QueryRecord,
  type SidecarRecord,
} from "../schema/schema-v2.js";
import { buildCatalogIndex } from "./bm25.js";
import { OwnerPairDecisionSchema } from "./grading-pipeline.js";
import { deterministicEligibility, validateDatasetCompleteness, type V2Dataset } from "./pool.js";

export const AUDIT_QUERY_BATCH_SIZE = 10;
export const AUDIT_PAIRS_PER_QUERY = 2;
export const AUDIT_PAIRS_PER_BATCH = AUDIT_QUERY_BATCH_SIZE * AUDIT_PAIRS_PER_QUERY;
export const AUDIT_BATCH_COUNT = RELEASE_COUNTS.queries.total / AUDIT_QUERY_BATCH_SIZE;
export const AUDIT_PAIR_COUNT = RELEASE_COUNTS.queries.total * AUDIT_PAIRS_PER_QUERY;
export const RELATED_CANDIDATE_WINDOW = 50;

const GradeSchema = z.number().int().min(0).max(3);
const AuditTaskIdSchema = z.string().regex(/^audit-task-[a-f0-9]{16}$/);
const AuditCandidateIdSchema = z.string().regex(/^audit-candidate-[a-f0-9]{16}$/);
const ACCEPTED_REVIEW = new Set(["approved", "corrected"]);

export const UnpooledAuditListingSchema = z.object({
  resource_type: z.enum(["http", "mcp"]),
  serviceName: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  mimeType: z.string().optional(),
  mcp: z.object({
    server_name: z.string(),
    tool_name: z.string(),
    transport: z.enum(["streamable-http", "sse"]),
    tool_count: z.number().int().positive(),
    input_schema_shape: z.enum(["flat_scalars", "nested_object", "array_input", "enum_union", "no_input"]),
  }).strict().optional(),
}).strict();

export const UnpooledAuditPackSchema = z.object({
  version: z.literal(1),
  role: z.literal("unpooled_auditor"),
  pack_id: z.string().min(1),
  instructions: z.string().min(1),
  tasks: z.array(z.object({
    task_id: AuditTaskIdSchema,
    query: z.string().min(3),
    candidates: z.array(z.object({
      candidate_id: AuditCandidateIdSchema,
      listing: UnpooledAuditListingSchema,
    }).strict()).length(AUDIT_PAIRS_PER_QUERY),
  }).strict()).length(AUDIT_QUERY_BATCH_SIZE),
}).strict();

export const UnpooledAuditJudgmentSchema = z.object({
  task_id: AuditTaskIdSchema,
  candidate_id: AuditCandidateIdSchema,
  grade: GradeSchema,
  rationale: z.string().min(1).max(1_000).optional(),
  judged_at: z.string().datetime(),
}).strict();

export const UnpooledAuditImportSchema = z.object({
  version: z.literal(1),
  role: z.literal("unpooled_auditor"),
  pack_id: z.string().min(1),
  auditor: GraderRefSchema,
  judgments: z.array(UnpooledAuditJudgmentSchema).length(AUDIT_PAIRS_PER_BATCH),
}).strict();

const AuditAssignmentSchema = z.object({
  task_id: AuditTaskIdSchema,
  candidate_id: AuditCandidateIdSchema,
  query_id: z.string().regex(/^qry-\d{3}$/),
  resource_id: z.string().regex(/^res-\d{4}$/),
  split: z.enum(["development", "release"]),
  query_author_run_id: z.string().min(1),
  resource_author_run_id: z.string().min(1),
  bm25_related_rank: z.number().int().positive(),
  bm25_score: z.number().finite().positive(),
}).strict();

const AuditBatchManifestSchema = z.object({
  batch_id: z.string().regex(/^unpooled-batch-\d{2}$/),
  pack_id: z.string().min(1),
  auditor: GraderRefSchema,
  query_ids: z.array(z.string().regex(/^qry-\d{3}$/)).length(AUDIT_QUERY_BATCH_SIZE),
  assignments: z.array(AuditAssignmentSchema).length(AUDIT_PAIRS_PER_BATCH),
}).strict().superRefine((value, context) => {
  const sourcePairs = value.assignments.map(item => pairKey(item.query_id, item.resource_id));
  const opaquePairs = value.assignments.map(item => pairKey(item.task_id, item.candidate_id));
  if (new Set(sourcePairs).size !== sourcePairs.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["assignments"], message: "duplicate source pair" });
  }
  if (new Set(opaquePairs).size !== opaquePairs.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["assignments"], message: "duplicate opaque pair" });
  }
  if (value.assignments.some(item => !value.query_ids.includes(item.query_id))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["assignments"], message: "assignment outside batch query set" });
  }
});

export const UnpooledAuditManifestSchema = z.object({
  version: z.literal(1),
  pipeline_run_id: z.string().min(1),
  created_at: z.string().datetime(),
  source_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  sampling_seed: z.string().min(16),
  sampler: z.object({
    method: z.literal("bm25_related_window_then_seeded_sample"),
    bm25_is_relevance_judgment: z.literal(false),
    related_candidate_window: z.literal(RELATED_CANDIDATE_WINDOW),
    queries_per_batch: z.literal(AUDIT_QUERY_BATCH_SIZE),
    pairs_per_query: z.literal(AUDIT_PAIRS_PER_QUERY),
  }).strict(),
  additional_forbidden_run_ids: z.array(z.string().min(1)),
  batches: z.array(AuditBatchManifestSchema).length(AUDIT_BATCH_COUNT),
}).strict().superRefine((value, context) => {
  const queryIds = value.batches.flatMap(batch => batch.query_ids);
  const assignments = value.batches.flatMap(batch => batch.assignments);
  const auditorRuns = value.batches.map(batch => batch.auditor.run_id);
  if (new Set(queryIds).size !== RELEASE_COUNTS.queries.total) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["batches"], message: "queries must appear in exactly one batch" });
  }
  if (assignments.length !== AUDIT_PAIR_COUNT || new Set(assignments.map(item => pairKey(item.query_id, item.resource_id))).size !== AUDIT_PAIR_COUNT) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["batches"], message: "audit assignments must contain 200 unique source pairs" });
  }
  if (new Set(auditorRuns).size !== AUDIT_BATCH_COUNT) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["batches"], message: "each batch requires a distinct fresh auditor run" });
  }
});

export const UnpooledAuditPendingReportSchema = z.object({
  version: z.literal(1),
  artifact: z.literal("unpooled-audit-v2"),
  status: z.literal("pending_owner_review"),
  owner_review: z.literal("pending"),
  reviewed_at: z.null(),
  pipeline_run_id: z.string().min(1),
  generated_at: z.string().datetime(),
  source_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  sampling_method: z.literal("bm25_related_window_then_seeded_sample"),
  bm25_is_relevance_judgment: z.literal(false),
  batch_count: z.literal(AUDIT_BATCH_COUNT),
  query_count: z.literal(RELEASE_COUNTS.queries.total),
  audited_pair_count: z.literal(AUDIT_PAIR_COUNT),
  relevant_pair_count: z.number().int().min(0).max(AUDIT_PAIR_COUNT),
  audited_relevance_rate: z.number().min(0).max(1),
  grade_counts: z.object({
    "0": z.number().int().nonnegative(),
    "1": z.number().int().nonnegative(),
    "2": z.number().int().nonnegative(),
    "3": z.number().int().nonnegative(),
  }).strict(),
  auditors: z.array(GraderRefSchema).length(AUDIT_BATCH_COUNT),
  materiality_threshold: z.null(),
  pooling_assessment: z.literal("owner_review_required"),
}).strict().superRefine((value, context) => {
  const gradeTotal = Object.values(value.grade_counts).reduce((sum, count) => sum + count, 0);
  if (gradeTotal !== value.audited_pair_count) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["grade_counts"], message: "grade counts must sum to audited pairs" });
  }
  if (value.relevant_pair_count !== value.grade_counts["2"] + value.grade_counts["3"]) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["relevant_pair_count"], message: "relevant means grade >= 2" });
  }
  if (Math.abs(value.audited_relevance_rate - value.relevant_pair_count / value.audited_pair_count) > 1e-12) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["audited_relevance_rate"], message: "rate must equal relevant/audited" });
  }
});

const ArtifactHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

/** Append-only owner decisions over every raw unpooled-audit judgment. */
export const UnpooledAuditOwnerDecisionSchema = z.object({
  version: z.literal(1),
  pipeline_run_id: z.string().min(1),
  source_hash: ArtifactHashSchema,
  raw_report_hash: ArtifactHashSchema,
  reviewer: z.string().min(1),
  reviewed_at: z.string().datetime(),
  materiality_threshold: z.number().min(0).max(1),
  pooling_decision: z.enum(["approved", "repool_required"]),
  rationale: z.string().min(1).max(2_000),
  pair_decisions: z.array(OwnerPairDecisionSchema).length(AUDIT_PAIR_COUNT),
}).strict().superRefine((value, context) => {
  if (value.pair_decisions.some(decision => decision.reviewer !== value.reviewer)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["pair_decisions"], message: "every pair reviewer must match reviewer" });
  }
  if (value.pair_decisions.some(decision => decision.reviewed_at !== value.reviewed_at)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["pair_decisions"], message: "every pair timestamp must match reviewed_at" });
  }
});

export const UnpooledAuditFinalReportSchema = z.object({
  version: z.literal(1),
  artifact: z.literal("unpooled-audit-v2"),
  status: z.enum(["approved", "repool_required"]),
  owner_review: z.enum(["approved", "repool_required"]),
  reviewed_at: z.string().datetime(),
  reviewed_by: z.string().min(1),
  pipeline_run_id: z.string().min(1),
  generated_at: z.string().datetime(),
  source_hash: ArtifactHashSchema,
  raw_report_hash: ArtifactHashSchema,
  owner_decision_hash: ArtifactHashSchema,
  reviewed_qrels_hash: ArtifactHashSchema,
  sampling_method: z.literal("bm25_related_window_then_seeded_sample"),
  bm25_is_relevance_judgment: z.literal(false),
  batch_count: z.literal(AUDIT_BATCH_COUNT),
  query_count: z.literal(RELEASE_COUNTS.queries.total),
  audited_pair_count: z.literal(AUDIT_PAIR_COUNT),
  relevant_pair_count: z.number().int().min(0).max(AUDIT_PAIR_COUNT),
  audited_relevance_rate: z.number().min(0).max(1),
  grade_counts: z.object({
    "0": z.number().int().nonnegative(),
    "1": z.number().int().nonnegative(),
    "2": z.number().int().nonnegative(),
    "3": z.number().int().nonnegative(),
  }).strict(),
  corrected_pair_count: z.number().int().min(0).max(AUDIT_PAIR_COUNT),
  materiality_threshold: z.number().min(0).max(1),
  pooling_assessment: z.enum(["acceptable_unjudged_rate", "repool_required"]),
  owner_rationale: z.string().min(1).max(2_000),
}).strict().superRefine((value, context) => {
  const gradeTotal = Object.values(value.grade_counts).reduce((sum, count) => sum + count, 0);
  if (gradeTotal !== value.audited_pair_count) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["grade_counts"], message: "grade counts must sum to audited pairs" });
  }
  if (value.relevant_pair_count !== value.grade_counts["2"] + value.grade_counts["3"]) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["relevant_pair_count"], message: "relevant means grade >= 2" });
  }
  if (Math.abs(value.audited_relevance_rate - value.relevant_pair_count / value.audited_pair_count) > 1e-12) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["audited_relevance_rate"], message: "rate must equal relevant/audited" });
  }
  const requiresRepool = value.audited_relevance_rate > value.materiality_threshold;
  const expected = requiresRepool ? "repool_required" : "approved";
  if (value.status !== expected || value.owner_review !== expected) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: `status must be ${expected} at this rate/threshold` });
  }
  const expectedAssessment = requiresRepool ? "repool_required" : "acceptable_unjudged_rate";
  if (value.pooling_assessment !== expectedAssessment) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["pooling_assessment"], message: `assessment must be ${expectedAssessment}` });
  }
});

export type UnpooledAuditPack = z.infer<typeof UnpooledAuditPackSchema>;
export type UnpooledAuditImport = z.infer<typeof UnpooledAuditImportSchema>;
export type UnpooledAuditManifest = z.infer<typeof UnpooledAuditManifestSchema>;
export type UnpooledAuditPendingReport = z.infer<typeof UnpooledAuditPendingReportSchema>;
export type UnpooledAuditOwnerDecision = z.infer<typeof UnpooledAuditOwnerDecisionSchema>;
export type UnpooledAuditFinalReport = z.infer<typeof UnpooledAuditFinalReportSchema>;

export interface UnpooledAuditPrerequisites {
  dataset: V2Dataset;
  pool: PoolRecord[];
}

export interface PrepareUnpooledAuditOptions {
  pipelineRunId: string;
  createdAt: string;
  seed: string;
  auditors: readonly GraderRef[];
  additionalForbiddenRunIds?: readonly string[];
}

export interface UnpooledAuditPreparation {
  packs: UnpooledAuditPack[];
  /** Withheld from audit agents. Store under an owner-only path. */
  manifest: UnpooledAuditManifest;
}

export interface FinalizedUnpooledAudit {
  report: UnpooledAuditPendingReport;
  qrels: QrelRecord[];
  poolRecords: PoolRecord[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function unpooledArtifactHash(value: unknown): string {
  return `sha256:${sha256(JSON.stringify(value))}`;
}

function pairKey(left: string, right: string): string {
  return `${left}\0${right}`;
}

function opaque(prefix: "task" | "candidate", seed: string, ...parts: string[]): string {
  return `audit-${prefix}-${sha256([seed, ...parts].join("\0")).slice(0, 16)}`;
}

function shuffled<T>(values: readonly T[], seed: string, key: (value: T) => string): T[] {
  return [...values].sort((left, right) => {
    const leftHash = sha256(`${seed}\0${key(left)}`);
    const rightHash = sha256(`${seed}\0${key(right)}`);
    return leftHash.localeCompare(rightHash) || key(left).localeCompare(key(right));
  });
}

function parseAll<TSchema extends z.ZodTypeAny>(schema: TSchema, values: readonly unknown[], label: string): Array<z.output<TSchema>> {
  return values.map((value, index) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`${label}[${index}]: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    }
    return parsed.data;
  });
}

function sourceHash(input: UnpooledAuditPrerequisites): string {
  return `sha256:${sha256(JSON.stringify({
    queries: input.dataset.queries,
    catalog: input.dataset.catalog,
    sidecars: input.dataset.sidecars,
    pool: input.pool,
  }))}`;
}

/** Strictly validates the complete 1,000/100 corpus and complete five-system pool. */
export function parseUnpooledAuditPrerequisites(raw: {
  queries: readonly unknown[];
  catalog: readonly unknown[];
  sidecars: readonly unknown[];
  pool: readonly unknown[];
}): UnpooledAuditPrerequisites {
  const dataset: V2Dataset = {
    queries: parseAll(QueryRecordSchema, raw.queries, "queries") as QueryRecord[],
    catalog: parseAll(CatalogRecordSchema, raw.catalog, "catalog") as CatalogRecord[],
    sidecars: parseAll(SidecarRecordSchema, raw.sidecars, "sidecars") as SidecarRecord[],
  };
  validateDatasetCompleteness(dataset);
  const pool = parseAll(PoolRecordSchema, raw.pool, "pool") as PoolRecord[];
  if (pool.length === 0) throw new Error("pool-v2 is empty");
  const queryById = new Map(dataset.queries.map(query => [query.query_id, query]));
  const catalogById = new Map(dataset.catalog.map(record => [record.resource_id, record]));
  const sidecarById = new Map(dataset.sidecars.map(record => [record.resource_id, record]));
  const seenPairs = new Set<string>();
  for (const query of dataset.queries) {
    if (!ACCEPTED_REVIEW.has(query.review_status)) throw new Error(`${query.query_id}: query is not owner-reviewed`);
  }
  for (const sidecar of dataset.sidecars) {
    if (!ACCEPTED_REVIEW.has(sidecar.review_status)) throw new Error(`${sidecar.resource_id}: resource is not owner-reviewed`);
  }
  for (const record of pool) {
    const key = pairKey(record.query_id, record.resource_id);
    if (seenPairs.has(key)) throw new Error(`${record.query_id}/${record.resource_id}: duplicate pool pair`);
    seenPairs.add(key);
    const query = queryById.get(record.query_id);
    const catalog = catalogById.get(record.resource_id);
    const sidecar = sidecarById.get(record.resource_id);
    if (!query) throw new Error(`${record.query_id}: pool references unknown query`);
    if (!catalog || !sidecar) throw new Error(`${record.resource_id}: pool references unknown resource`);
    if (record.origin === "unpooled_audit") throw new Error("pool-v2 already contains unpooled-audit rows; use the preserved prior audit");
    if (record.pool_depth !== 20) throw new Error(`${record.query_id}/${record.resource_id}: pool_depth must be 20`);
    const eligibility = deterministicEligibility(query, catalog, sidecar);
    if (!eligibility.eligible) {
      throw new Error(`${record.query_id}/${record.resource_id}: pooled hard-filter violation: ${eligibility.reasons.join(", ")}`);
    }
  }
  for (const query of dataset.queries) {
    const systemRows = pool.filter(record => record.query_id === query.query_id && record.origin === "system_pool");
    const systems = new Set(systemRows.flatMap(record => record.contributions.map(item => item.system)));
    const missing = POOL_BUILD_SYSTEMS.filter(system => !systems.has(system));
    if (missing.length > 0) throw new Error(`${query.query_id}: incomplete pool; missing ${missing.join(", ")}`);
    for (const system of POOL_BUILD_SYSTEMS) {
      const ranks = systemRows.flatMap(record => record.contributions
        .filter(item => item.system === system).map(item => item.rank)).sort((left, right) => left - right);
      if (new Set(ranks).size !== ranks.length) throw new Error(`${query.query_id}/${system}: duplicate pooled rank`);
      if (ranks.some((rank, index) => rank !== index + 1)) {
        throw new Error(`${query.query_id}/${system}: pooled ranks are not contiguous from 1`);
      }
    }
  }
  const systemPoolRunIds = new Set(pool.filter(record => record.origin === "system_pool").map(record => record.run_id));
  if (systemPoolRunIds.size !== 1) throw new Error("system pool must come from exactly one pool run_id");
  return { dataset, pool };
}

/** Recomputes the preparation hash from a final pool by excluding appended audit-origin rows. */
export function currentUnpooledAuditSourceHash(raw: {
  queries: readonly unknown[];
  catalog: readonly unknown[];
  sidecars: readonly unknown[];
  pool: readonly unknown[];
}): string {
  const systemPool = raw.pool.filter(record => (record as { origin?: unknown }).origin !== "unpooled_audit");
  return sourceHash(parseUnpooledAuditPrerequisites({ ...raw, pool: systemPool }));
}

function listing(catalog: CatalogRecord, sidecar: SidecarRecord): z.infer<typeof UnpooledAuditListingSchema> {
  const resource = catalog.wire.resource;
  return UnpooledAuditListingSchema.parse({
    resource_type: sidecar.resource_type,
    ...(resource.serviceName === undefined ? {} : { serviceName: resource.serviceName }),
    ...(resource.description === undefined ? {} : { description: resource.description }),
    ...(resource.tags === undefined ? {} : { tags: resource.tags }),
    ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
    ...(sidecar.mcp === undefined ? {} : { mcp: sidecar.mcp }),
  });
}

const FORBIDDEN_PACK_KEYS = new Set([
  "query_id", "resource_id", "provider_id", "family", "family_slot", "authorship", "generation",
  "derived_from", "review_status", "reviewed_at", "owner_note", "system", "systems", "rank", "score",
  "contributions", "best_rank", "run_id", "model", "prompt_hash", "grade", "rationale", "annotator", "qrel",
]);
const SOURCE_ID_IN_TEXT = /\b(?:qry-\d{3}|res-\d{4}|provider-\d{3})\b/i;

/** Proves a pack cannot reveal withheld mapping, authorship, retrieval, or judgment fields. */
export function assertNoUnpooledAuditPackLeakage(pack: UnpooledAuditPack): void {
  const visit = (value: unknown, path: string): void => {
    if (typeof value === "string" && SOURCE_ID_IN_TEXT.test(value)) {
      throw new Error(`blind audit pack leaks a source identifier at ${path}`);
    }
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, `${path}[${index}]`));
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_PACK_KEYS.has(key)) throw new Error(`blind audit pack leaks forbidden key ${path}.${key}`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(pack, "pack");
}

function assertNoKnownAuthorIdentity(pack: UnpooledAuditPack, input: UnpooledAuditPrerequisites): void {
  const serialized = JSON.stringify(pack);
  const authorRuns = new Set([
    ...input.dataset.queries.map(record => record.generation.run_id),
    ...input.dataset.sidecars.map(record => record.generation.run_id),
  ]);
  for (const runId of authorRuns) {
    if (runId.length >= 6 && serialized.includes(runId)) {
      throw new Error(`blind audit pack leaks author run identity ${runId}`);
    }
  }
}

interface SampledPair {
  query: QueryRecord;
  catalog: CatalogRecord;
  sidecar: SidecarRecord;
  relatedRank: number;
  score: number;
}

function selectPairs(input: UnpooledAuditPrerequisites, seed: string): SampledPair[][] {
  const index = buildCatalogIndex(input.dataset.catalog);
  const catalogById = new Map(input.dataset.catalog.map(record => [record.resource_id, record]));
  const sidecarById = new Map(input.dataset.sidecars.map(record => [record.resource_id, record]));
  const pooled = new Set(input.pool.map(record => pairKey(record.query_id, record.resource_id)));
  const sortedQueries = [...input.dataset.queries].sort((left, right) => left.query_id.localeCompare(right.query_id));
  const batches: SampledPair[][] = [];
  for (let offset = 0; offset < sortedQueries.length; offset += AUDIT_QUERY_BATCH_SIZE) {
    const pairs: SampledPair[] = [];
    for (const query of sortedQueries.slice(offset, offset + AUDIT_QUERY_BATCH_SIZE)) {
      const related = index.search(query.query, index.size).flatMap((hit, hitIndex) => {
        const catalog = catalogById.get(hit.id)!;
        const sidecar = sidecarById.get(hit.id)!;
        if (pooled.has(pairKey(query.query_id, hit.id))) return [];
        if (!deterministicEligibility(query, catalog, sidecar).eligible) return [];
        return [{ query, catalog, sidecar, relatedRank: hitIndex + 1, score: hit.score }];
      }).slice(0, RELATED_CANDIDATE_WINDOW);
      if (related.length < AUDIT_PAIRS_PER_QUERY) {
        throw new Error(`${query.query_id}: only ${related.length} topically related, eligible, unpooled candidates; need ${AUDIT_PAIRS_PER_QUERY}`);
      }
      pairs.push(...shuffled(related, `${seed}\0sample\0${query.query_id}`, value => value.catalog.resource_id)
        .slice(0, AUDIT_PAIRS_PER_QUERY));
    }
    batches.push(pairs);
  }
  return batches;
}

function validateAuditors(input: UnpooledAuditPrerequisites, options: PrepareUnpooledAuditOptions): GraderRef[] {
  if (options.auditors.length !== AUDIT_BATCH_COUNT) {
    throw new Error(`expected ${AUDIT_BATCH_COUNT} fresh audit agents, got ${options.auditors.length}`);
  }
  const auditors = options.auditors.map(value => GraderRefSchema.parse(value));
  const runs = auditors.map(auditor => auditor.run_id);
  if (new Set(runs).size !== runs.length) throw new Error("each audit batch requires a distinct auditor run_id");
  const forbidden = new Set([
    ...input.dataset.queries.map(record => record.generation.run_id),
    ...input.dataset.sidecars.map(record => record.generation.run_id),
    ...(options.additionalForbiddenRunIds ?? []),
  ]);
  for (const runId of runs) if (forbidden.has(runId)) throw new Error(`${runId}: audit agent is not an independent fresh context`);
  return auditors;
}

const AUDIT_INSTRUCTIONS = [
  "Independently grade capability relevance using the frozen 0–3 rubric.",
  "3: exact capability and all stated constraints; 2: usable capability with a secondary mismatch; 1: related but different capability; 0: irrelevant or contradictory.",
  "All candidates already passed hard filters. Return exactly one judgment per candidate. Do not infer source identity.",
].join(" ");

export function prepareUnpooledAudit(
  raw: { queries: readonly unknown[]; catalog: readonly unknown[]; sidecars: readonly unknown[]; pool: readonly unknown[] },
  options: PrepareUnpooledAuditOptions,
): UnpooledAuditPreparation {
  z.string().datetime().parse(options.createdAt);
  if (options.seed.length < 16) throw new Error("sampling seed must contain at least 16 characters");
  const input = parseUnpooledAuditPrerequisites(raw);
  const auditors = validateAuditors(input, options);
  const selectedBatches = selectPairs(input, options.seed);
  const packs: UnpooledAuditPack[] = [];
  const batchManifests: z.infer<typeof AuditBatchManifestSchema>[] = [];

  for (const [batchIndex, selected] of selectedBatches.entries()) {
    const batchNumber = batchIndex + 1;
    const batchId = `unpooled-batch-${String(batchNumber).padStart(2, "0")}`;
    const auditor = auditors[batchIndex]!;
    const packSeed = `${options.seed}\0${batchId}\0${auditor.run_id}`;
    // Do not expose a caller-chosen pipeline/run label: it may encode author or source identity.
    const packId = `unpooled-pack-${sha256(`${packSeed}\0pack`).slice(0, 16)}`;
    const queryIds = [...new Set(selected.map(pair => pair.query.query_id))].sort();
    const assignments: z.infer<typeof AuditAssignmentSchema>[] = [];
    const tasks = shuffled(queryIds, `${packSeed}\0tasks`, value => value).map(queryId => {
      const query = input.dataset.queries.find(record => record.query_id === queryId)!;
      const taskId = opaque("task", packSeed, queryId);
      const candidates = shuffled(
        selected.filter(pair => pair.query.query_id === queryId),
        `${packSeed}\0${queryId}\0candidates`,
        value => value.catalog.resource_id,
      ).map(pair => {
        const candidateId = opaque("candidate", packSeed, queryId, pair.catalog.resource_id);
        assignments.push({
          task_id: taskId,
          candidate_id: candidateId,
          query_id: queryId,
          resource_id: pair.catalog.resource_id,
          split: query.split,
          query_author_run_id: query.generation.run_id,
          resource_author_run_id: pair.sidecar.generation.run_id,
          bm25_related_rank: pair.relatedRank,
          bm25_score: pair.score,
        });
        return { candidate_id: candidateId, listing: listing(pair.catalog, pair.sidecar) };
      });
      return { task_id: taskId, query: query.query, candidates };
    });
    const pack = UnpooledAuditPackSchema.parse({
      version: 1,
      role: "unpooled_auditor",
      pack_id: packId,
      instructions: AUDIT_INSTRUCTIONS,
      tasks,
    });
    assertNoUnpooledAuditPackLeakage(pack);
    assertNoKnownAuthorIdentity(pack, input);
    packs.push(pack);
    batchManifests.push({ batch_id: batchId, pack_id: packId, auditor, query_ids: queryIds, assignments });
  }

  const manifest = UnpooledAuditManifestSchema.parse({
    version: 1,
    pipeline_run_id: options.pipelineRunId,
    created_at: options.createdAt,
    source_hash: sourceHash(input),
    sampling_seed: options.seed,
    sampler: {
      method: "bm25_related_window_then_seeded_sample",
      bm25_is_relevance_judgment: false,
      related_candidate_window: RELATED_CANDIDATE_WINDOW,
      queries_per_batch: AUDIT_QUERY_BATCH_SIZE,
      pairs_per_query: AUDIT_PAIRS_PER_QUERY,
    },
    additional_forbidden_run_ids: [...new Set(options.additionalForbiddenRunIds ?? [])].sort(),
    batches: batchManifests,
  });
  return { packs, manifest };
}

function assertManifestCurrent(input: UnpooledAuditPrerequisites, manifest: UnpooledAuditManifest): void {
  if (manifest.source_hash !== sourceHash(input)) throw new Error("unpooled-audit manifest source_hash does not match current inputs");
  const regenerated = prepareUnpooledAudit({
    queries: input.dataset.queries,
    catalog: input.dataset.catalog,
    sidecars: input.dataset.sidecars,
    pool: input.pool,
  }, {
    pipelineRunId: manifest.pipeline_run_id,
    createdAt: manifest.created_at,
    seed: manifest.sampling_seed,
    auditors: manifest.batches.map(batch => batch.auditor),
    additionalForbiddenRunIds: manifest.additional_forbidden_run_ids,
  }).manifest;
  if (JSON.stringify(regenerated) !== JSON.stringify(manifest)) {
    throw new Error("unpooled-audit manifest does not match deterministic selection and isolation contract");
  }
}

interface ResolvedAuditJudgment extends z.infer<typeof UnpooledAuditJudgmentSchema>, z.infer<typeof AuditAssignmentSchema> {
  auditor: GraderRef;
}

/** Validates every fresh-agent import and resolves every opaque assignment exactly once. */
export function validateUnpooledAuditImports(
  input: UnpooledAuditPrerequisites,
  rawManifest: unknown,
  rawImports: readonly unknown[],
): ResolvedAuditJudgment[] {
  const manifest = UnpooledAuditManifestSchema.parse(rawManifest);
  assertManifestCurrent(input, manifest);
  if (rawImports.length !== AUDIT_BATCH_COUNT) throw new Error(`expected ${AUDIT_BATCH_COUNT} audit imports, got ${rawImports.length}`);
  const imports = rawImports.map(value => UnpooledAuditImportSchema.parse(value));
  const importByPack = new Map<string, UnpooledAuditImport>();
  for (const record of imports) {
    if (importByPack.has(record.pack_id)) throw new Error(`duplicate audit import for ${record.pack_id}`);
    importByPack.set(record.pack_id, record);
  }
  const authorRuns = new Set([
    ...input.dataset.queries.map(record => record.generation.run_id),
    ...input.dataset.sidecars.map(record => record.generation.run_id),
    ...manifest.additional_forbidden_run_ids,
  ]);
  const resolved: ResolvedAuditJudgment[] = [];
  for (const batch of manifest.batches) {
    const imported = importByPack.get(batch.pack_id);
    if (!imported) throw new Error(`${batch.pack_id}: missing audit import`);
    if (JSON.stringify(imported.auditor) !== JSON.stringify(batch.auditor)) {
      throw new Error(`${batch.pack_id}: auditor provenance does not match assignment`);
    }
    if (authorRuns.has(imported.auditor.run_id)) throw new Error(`${imported.auditor.run_id}: self-grading/isolation violation`);
    const assignmentByOpaque = new Map(batch.assignments.map(item => [pairKey(item.task_id, item.candidate_id), item]));
    const seen = new Set<string>();
    for (const judgment of imported.judgments) {
      const key = pairKey(judgment.task_id, judgment.candidate_id);
      if (seen.has(key)) throw new Error(`${batch.pack_id}: duplicate judgment assignment`);
      seen.add(key);
      const assignment = assignmentByOpaque.get(key);
      if (!assignment) throw new Error(`${batch.pack_id}: judgment was not assigned to this audit pack`);
      if (assignment.split === "release" && !judgment.rationale) {
        throw new Error(`${assignment.query_id}/${assignment.resource_id}: release audit judgment requires rationale`);
      }
      resolved.push({ ...assignment, ...judgment, auditor: imported.auditor });
    }
    if (seen.size !== assignmentByOpaque.size) {
      throw new Error(`${batch.pack_id}: expected ${assignmentByOpaque.size} judgments, got ${seen.size}`);
    }
  }
  const expectedPairs = manifest.batches.flatMap(batch => batch.assignments)
    .map(item => pairKey(item.query_id, item.resource_id)).sort();
  const actualPairs = resolved.map(item => pairKey(item.query_id, item.resource_id)).sort();
  if (actualPairs.join("\n") !== expectedPairs.join("\n")) throw new Error("audit imports do not cover every assigned pair exactly once");
  return resolved;
}

/** Produces only pending artifacts. Owner approval is a separate append-only review step. */
export function finalizeUnpooledAudit(
  raw: { queries: readonly unknown[]; catalog: readonly unknown[]; sidecars: readonly unknown[]; pool: readonly unknown[] },
  rawManifest: unknown,
  rawImports: readonly unknown[],
  generatedAt: string,
): FinalizedUnpooledAudit {
  z.string().datetime().parse(generatedAt);
  const input = parseUnpooledAuditPrerequisites(raw);
  const manifest = UnpooledAuditManifestSchema.parse(rawManifest);
  const judgments = validateUnpooledAuditImports(input, manifest, rawImports);
  const gradeCounts = { "0": 0, "1": 0, "2": 0, "3": 0 };
  for (const judgment of judgments) gradeCounts[String(judgment.grade) as keyof typeof gradeCounts]++;
  const relevant = gradeCounts["2"] + gradeCounts["3"];
  const qrels = judgments.map(judgment => QrelRecordSchema.parse({
    query_id: judgment.query_id,
    resource_id: judgment.resource_id,
    grade: judgment.grade,
    eligible: true,
    judge: "agent",
    ...(judgment.rationale === undefined ? {} : { rationale: judgment.rationale }),
    annotator: judgment.auditor.run_id,
    judged_at: judgment.judged_at,
    generation: judgment.auditor,
    review_status: "pending",
    reviewed_at: null,
    reviewed_by: null,
    owner_note: null,
  })).sort((left, right) => pairKey(left.query_id, left.resource_id).localeCompare(pairKey(right.query_id, right.resource_id)));
  const poolRecords = judgments.map(judgment => PoolRecordSchema.parse({
    query_id: judgment.query_id,
    resource_id: judgment.resource_id,
    origin: "unpooled_audit",
    contributions: [],
    best_rank: null,
    pool_depth: 20,
    blinded: true,
    pooled_at: generatedAt,
    run_id: manifest.pipeline_run_id,
  })).sort((left, right) => pairKey(left.query_id, left.resource_id).localeCompare(pairKey(right.query_id, right.resource_id)));
  const report = UnpooledAuditPendingReportSchema.parse({
    version: 1,
    artifact: "unpooled-audit-v2",
    status: "pending_owner_review",
    owner_review: "pending",
    reviewed_at: null,
    pipeline_run_id: manifest.pipeline_run_id,
    generated_at: generatedAt,
    source_hash: manifest.source_hash,
    sampling_method: "bm25_related_window_then_seeded_sample",
    bm25_is_relevance_judgment: false,
    batch_count: AUDIT_BATCH_COUNT,
    query_count: RELEASE_COUNTS.queries.total,
    audited_pair_count: judgments.length,
    relevant_pair_count: relevant,
    audited_relevance_rate: relevant / judgments.length,
    grade_counts: gradeCounts,
    auditors: manifest.batches.map(batch => batch.auditor),
    materiality_threshold: null,
    pooling_assessment: "owner_review_required",
  });
  return { report, qrels, poolRecords };
}

/**
 * Applies complete owner decisions without mutating the raw report/qrels. Rejected judgments are
 * not silently dropped: they require a fresh replacement audit before this phase can succeed.
 */
export function applyUnpooledAuditOwnerReview(
  rawPendingReport: unknown,
  rawQrels: readonly unknown[],
  rawOwnerDecision: unknown,
): { report: UnpooledAuditFinalReport; reviewedQrels: QrelRecord[] } {
  const pending = UnpooledAuditPendingReportSchema.parse(rawPendingReport);
  const qrels = parseAll(QrelRecordSchema, rawQrels, "unpooled qrels");
  const owner = UnpooledAuditOwnerDecisionSchema.parse(rawOwnerDecision);
  if (owner.pipeline_run_id !== pending.pipeline_run_id || owner.source_hash !== pending.source_hash) {
    throw new Error("owner decision does not match the pending audit run/source");
  }
  if (owner.raw_report_hash !== unpooledArtifactHash(pending)) {
    throw new Error("owner decision raw_report_hash does not match the pending report");
  }
  if (qrels.length !== AUDIT_PAIR_COUNT) throw new Error(`expected ${AUDIT_PAIR_COUNT} unpooled qrels, got ${qrels.length}`);
  if (qrels.some(record => record.judge !== "agent" || record.review_status !== "pending" || !record.eligible)) {
    throw new Error("owner review accepts only pending eligible agent unpooled qrels");
  }
  const qrelKeys = qrels.map(record => pairKey(record.query_id, record.resource_id));
  const decisionKeys = owner.pair_decisions.map(record => pairKey(record.query_id, record.resource_id));
  if (new Set(qrelKeys).size !== qrelKeys.length || new Set(decisionKeys).size !== decisionKeys.length
      || [...qrelKeys].sort().join("\n") !== [...decisionKeys].sort().join("\n")) {
    throw new Error("owner pair decisions must cover every unpooled qrel exactly once");
  }
  if (owner.pair_decisions.some(decision => decision.decision === "rejected")) {
    throw new Error("rejected unpooled judgments require a fresh replacement audit");
  }
  const decisions = new Map(owner.pair_decisions.map(record => [pairKey(record.query_id, record.resource_id), record]));
  let corrected = 0;
  const reviewedQrels = qrels.map(raw => {
    const decision = decisions.get(pairKey(raw.query_id, raw.resource_id))!;
    if (decision.decision === "approved" && decision.grade !== raw.grade) {
      throw new Error(`${raw.query_id}/${raw.resource_id}: approved grade must equal raw grade`);
    }
    if (decision.decision === "corrected" && decision.grade === raw.grade) {
      throw new Error(`${raw.query_id}/${raw.resource_id}: corrected grade must change`);
    }
    if (decision.decision === "corrected") corrected += 1;
    const rationale = decision.rationale ?? raw.rationale;
    return QrelRecordSchema.parse({
      ...raw,
      grade: decision.grade,
      judge: "reviewed_agent",
      ...(rationale === undefined ? {} : { rationale }),
      review_status: decision.decision,
      reviewed_at: decision.reviewed_at,
      reviewed_by: decision.reviewer,
      owner_note: decision.notes,
    });
  }).sort((left, right) => pairKey(left.query_id, left.resource_id).localeCompare(pairKey(right.query_id, right.resource_id)));
  const gradeCounts = { "0": 0, "1": 0, "2": 0, "3": 0 };
  for (const qrel of reviewedQrels) gradeCounts[String(qrel.grade) as keyof typeof gradeCounts] += 1;
  const relevant = gradeCounts["2"] + gradeCounts["3"];
  const rate = relevant / reviewedQrels.length;
  const expectedDecision = rate > owner.materiality_threshold ? "repool_required" : "approved";
  if (owner.pooling_decision !== expectedDecision) {
    throw new Error(`owner pooling_decision must be ${expectedDecision} for rate ${rate} and threshold ${owner.materiality_threshold}`);
  }
  const report = UnpooledAuditFinalReportSchema.parse({
    version: 1,
    artifact: "unpooled-audit-v2",
    status: expectedDecision,
    owner_review: expectedDecision,
    reviewed_at: owner.reviewed_at,
    reviewed_by: owner.reviewer,
    pipeline_run_id: pending.pipeline_run_id,
    generated_at: pending.generated_at,
    source_hash: pending.source_hash,
    raw_report_hash: owner.raw_report_hash,
    owner_decision_hash: unpooledArtifactHash(owner),
    reviewed_qrels_hash: unpooledArtifactHash(reviewedQrels),
    sampling_method: pending.sampling_method,
    bm25_is_relevance_judgment: false,
    batch_count: pending.batch_count,
    query_count: pending.query_count,
    audited_pair_count: AUDIT_PAIR_COUNT,
    relevant_pair_count: relevant,
    audited_relevance_rate: rate,
    grade_counts: gradeCounts,
    corrected_pair_count: corrected,
    materiality_threshold: owner.materiality_threshold,
    pooling_assessment: expectedDecision === "approved" ? "acceptable_unjudged_rate" : "repool_required",
    owner_rationale: owner.rationale,
  });
  return { report, reviewedQrels };
}

export interface WrittenAuditPreparation {
  ownerManifestPath: string;
  packPaths: string[];
}

/** Writes the mapping mode 0600 and packs separately, refusing any overwrite or partial bundle. */
export async function writeUnpooledAuditPreparationExclusive(
  outputDirectory: string,
  preparation: UnpooledAuditPreparation,
): Promise<WrittenAuditPreparation> {
  const ownerManifestPath = resolve(outputDirectory, "owner/unpooled-audit-manifest-v2.json");
  const packPaths = preparation.packs.map(pack => resolve(outputDirectory, `packs/${pack.pack_id}.json`));
  const artifacts = [
    { path: ownerManifestPath, value: preparation.manifest, mode: 0o600 },
    ...preparation.packs.map((pack, index) => ({ path: packPaths[index]!, value: pack, mode: 0o644 })),
  ];
  for (const artifact of artifacts) await mkdir(dirname(artifact.path), { recursive: true });
  const opened: Array<{ path: string; handle: FileHandle }> = [];
  try {
    for (const artifact of artifacts) {
      opened.push({ path: artifact.path, handle: await open(artifact.path, "wx", artifact.mode) });
    }
    for (const [index, artifact] of artifacts.entries()) {
      await opened[index]!.handle.writeFile(`${JSON.stringify(artifact.value, null, 2)}\n`, "utf8");
      await opened[index]!.handle.sync();
    }
    await Promise.all(opened.map(item => item.handle.close()));
  } catch (error) {
    await Promise.all(opened.map(async item => {
      await item.handle.close().catch(() => undefined);
      await unlink(item.path).catch(() => undefined);
    }));
    throw error;
  }
  return { ownerManifestPath, packPaths };
}
