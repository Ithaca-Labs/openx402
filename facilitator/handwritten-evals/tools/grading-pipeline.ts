/** Deterministic blind grading/adjudication pipeline — BUILD-PLAN §§1.1, 7–9, 11. */

import { createHash } from "node:crypto";
import { mkdir, open, readFile, unlink, writeFile, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  AgentCalibrationSchema,
  CatalogRecordSchema,
  GraderRefSchema,
  PoolRecordSchema,
  QrelRecordSchema,
  QueryIdSchema,
  QueryRecordSchema,
  RELEASE_COUNTS,
  ResourceIdSchema,
  SidecarRecordSchema,
  type AgentCalibrationRecord,
  type CatalogRecord,
  type PoolRecord,
  type QrelRecord,
  type QueryRecord,
  type SidecarRecord,
} from "../schema/schema-v2.js";
import { formatConfusionMatrix, stratifiedAgreement, type AnnotatedPair } from "./agreement.js";

export { AgentCalibrationSchema, QrelRecordSchema };

const GradeSchema = z.number().int().min(0).max(3);
const OpaqueIdSchema = z.string().regex(/^(task|candidate)-[a-f0-9]{16}$/);

export const BlindListingSchema = z.object({
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

export const BlindCandidateSchema = z.object({
  candidate_id: OpaqueIdSchema,
  listing: BlindListingSchema,
}).strict();

export const BlindGradingTaskSchema = z.object({
  task_id: OpaqueIdSchema,
  query: z.string(),
  candidates: z.array(BlindCandidateSchema).min(1),
}).strict();

export const BlindGradingPackSchema = z.object({
  version: z.literal(1),
  role: z.literal("grader"),
  pack_id: z.string().min(1),
  instructions: z.string().min(1),
  tasks: z.array(BlindGradingTaskSchema).min(1),
}).strict();

export const BlindAdjudicationPackSchema = z.object({
  version: z.literal(1),
  role: z.literal("adjudicator"),
  pack_id: z.string().min(1),
  instructions: z.string().min(1),
  tasks: z.array(z.object({
    task_id: OpaqueIdSchema,
    query: z.string(),
    candidate: BlindCandidateSchema,
  }).strict()),
}).strict();

export const JudgmentImportSchema = z.object({
  task_id: OpaqueIdSchema,
  candidate_id: OpaqueIdSchema,
  grade: GradeSchema,
  rationale: z.string().min(1).max(1_000).optional(),
  judged_at: z.string().datetime(),
}).strict();

export const GraderImportSchema = z.object({
  version: z.literal(1),
  role: z.enum(["grader_a", "grader_b"]),
  pack_id: z.string().min(1),
  grader: GraderRefSchema,
  judgments: z.array(JudgmentImportSchema),
}).strict();

export const AdjudicatorImportSchema = z.object({
  version: z.literal(1),
  role: z.literal("adjudicator"),
  pack_id: z.string().min(1),
  adjudicator: GraderRefSchema,
  judgments: z.array(JudgmentImportSchema),
}).strict();

const SourceAssignmentSchema = z.object({
  task_id: OpaqueIdSchema,
  candidate_id: OpaqueIdSchema,
  query_id: QueryIdSchema,
  resource_id: ResourceIdSchema,
  split: z.enum(["development", "release"]),
  query_author_run_id: z.string(),
  resource_author_run_id: z.string(),
  relevant_family: z.boolean(),
}).strict();

export const GradingManifestSchema = z.object({
  version: z.literal(1),
  pipeline_run_id: z.string().min(1),
  created_at: z.string().datetime(),
  source_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  pair_count: z.number().int().positive(),
  graders: z.object({ a: GraderRefSchema, b: GraderRefSchema }).strict(),
  packs: z.object({ a: z.string().min(1), b: z.string().min(1) }).strict(),
  assignments: z.object({
    a: z.array(SourceAssignmentSchema),
    b: z.array(SourceAssignmentSchema),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.assignments.a.length !== value.pair_count || value.assignments.b.length !== value.pair_count) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["assignments"], message: "both graders must cover pair_count" });
  }
  for (const slot of ["a", "b"] as const) {
    const sourcePairs = value.assignments[slot].map(item => pairKey(item.query_id, item.resource_id));
    const opaquePairs = value.assignments[slot].map(item => pairKey(item.task_id, item.candidate_id));
    if (new Set(sourcePairs).size !== sourcePairs.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["assignments", slot], message: "duplicate source pair" });
    }
    if (new Set(opaquePairs).size !== opaquePairs.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["assignments", slot], message: "duplicate opaque assignment" });
    }
  }
  const aPairs = value.assignments.a.map(item => pairKey(item.query_id, item.resource_id)).sort();
  const bPairs = value.assignments.b.map(item => pairKey(item.query_id, item.resource_id)).sort();
  if (aPairs.join("\n") !== bPairs.join("\n")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["assignments"], message: "grader source-pair sets differ" });
  }
});

export const AdjudicationManifestSchema = z.object({
  version: z.literal(1),
  pipeline_run_id: z.string().min(1),
  created_at: z.string().datetime(),
  pack_id: z.string().min(1),
  adjudicator: GraderRefSchema,
  assignments: z.array(SourceAssignmentSchema),
}).strict();

const ConfusionMatrixSchema = z.array(z.array(z.number().int().nonnegative()).length(4)).length(4);
const KappaResultArtifactSchema = z.object({
  weighting: z.enum(["quadratic", "linear"]),
  kappa: z.number().nullable(),
  n: z.number().int().nonnegative(),
  observedDisagreement: z.number().nonnegative(),
  expectedDisagreement: z.number().nonnegative(),
  undefinedReason: z.enum(["no-pairs", "zero-expected-disagreement"]).optional(),
}).strict();
const StratumArtifactSchema = z.object({
  name: z.string(),
  description: z.string(),
  n: z.number().int().nonnegative(),
  share: z.number().min(0).max(1),
  exactAgreement: z.number().min(0).max(1).nullable(),
  withinOneAgreement: z.number().min(0).max(1).nullable(),
  severeDisagreementRate: z.number().min(0).max(1).nullable(),
  kappaQuadratic: KappaResultArtifactSchema,
  kappaLinear: KappaResultArtifactSchema,
  confusionMatrix: ConfusionMatrixSchema,
}).strict();

export const StratifiedAgreementReportSchema = z.object({
  pairs: z.number().int().nonnegative(),
  queries: z.number().int().nonnegative(),
  exactAgreement: z.number().min(0).max(1).nullable(),
  confusionMatrix: ConfusionMatrixSchema,
  overall: StratumArtifactSchema,
  relevantFamily: StratumArtifactSchema,
  nonRelevantFamily: StratumArtifactSchema,
  boundary: z.object({
    n: z.number().int().nonnegative(),
    disagreements: z.number().int().nonnegative(),
    disagreementRate: z.number().min(0).max(1).nullable(),
    twoVsThree: z.object({
      n: z.number().int().nonnegative(),
      aTwoBThree: z.number().int().nonnegative(),
      aThreeBTwo: z.number().int().nonnegative(),
    }).strict(),
    relevantVsNotRelevant: z.number().int().nonnegative(),
  }).strict(),
  inflation: z.number().nullable(),
  target: z.object({ kappa: z.number(), stratum: z.literal("relevant-family") }).strict(),
  passes: z.boolean(),
  summary: z.array(z.string()),
}).strict();

export const AgreementArtifactSchema = z.object({
  version: z.literal(1),
  pipeline_run_id: z.string().min(1),
  generated_at: z.string().datetime(),
  pair_count: z.number().int().nonnegative(),
  disagreement_count: z.number().int().nonnegative(),
  adjudicated_count: z.number().int().nonnegative(),
  agreement: StratifiedAgreementReportSchema,
  confusion_matrix_text: z.string(),
}).strict();

const GradingArtifactHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

/**
 * Immutable proof that the exact packs consumed by the graders were complete, blinded, and bound
 * to the current catalog/query/pool snapshot. Release gates consume this instead of accepting a
 * self-asserted `status: pass` document.
 */
export const GradingProcessAuditSchema = z.object({
  version: z.literal(1),
  artifact: z.literal("grading-process-audit-v2"),
  status: z.literal("pass"),
  pipeline_run_id: z.string().min(1),
  generated_at: z.string().datetime(),
  source_hash: GradingArtifactHashSchema,
  input_hashes: z.object({
    grading_manifest: GradingArtifactHashSchema,
    grader_a_pack: GradingArtifactHashSchema,
    grader_b_pack: GradingArtifactHashSchema,
    grader_a_import: GradingArtifactHashSchema,
    grader_b_import: GradingArtifactHashSchema,
    adjudication_manifest: GradingArtifactHashSchema.nullable(),
    adjudication_pack: GradingArtifactHashSchema.nullable(),
    adjudicator_import: GradingArtifactHashSchema.nullable(),
  }).strict(),
  run_ids: z.object({
    author: z.array(z.string().min(1)).min(1),
    grader_a: z.string().min(1),
    grader_b: z.string().min(1),
    adjudicator: z.string().min(1).nullable(),
  }).strict(),
  agent_provenance: z.object({
    grader_a: GraderRefSchema,
    grader_b: GraderRefSchema,
    adjudicator: GraderRefSchema.nullable(),
  }).strict(),
  counts: z.object({
    pairs: z.number().int().positive(),
    grader_a_judgments: z.number().int().positive(),
    grader_b_judgments: z.number().int().positive(),
    disagreements: z.number().int().nonnegative(),
    adjudications: z.number().int().nonnegative(),
  }).strict(),
  checks: z.object({
    source_current: z.literal(true),
    packs_match_withheld_manifest: z.literal(true),
    packs_contain_no_provenance_or_ranking_leakage: z.literal(true),
    graders_are_distinct_fresh_contexts: z.literal(true),
    double_grading_complete: z.literal(true),
    adjudication_is_third_context_and_disagreement_only: z.literal(true),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.counts.grader_a_judgments !== value.counts.pairs || value.counts.grader_b_judgments !== value.counts.pairs) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["counts"], message: "both graders must cover every pair" });
  }
  if (value.counts.adjudications !== value.counts.disagreements) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["counts", "adjudications"], message: "every disagreement must be adjudicated" });
  }
  const adjudicationHashes = [
    value.input_hashes.adjudication_manifest,
    value.input_hashes.adjudication_pack,
    value.input_hashes.adjudicator_import,
  ];
  const hasAdjudication = value.counts.disagreements > 0;
  if (adjudicationHashes.some(hash => (hash === null) === hasAdjudication)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["input_hashes"], message: "adjudication hashes must be all present exactly when disagreements exist" });
  }
  if ((value.run_ids.adjudicator === null) === hasAdjudication) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["run_ids", "adjudicator"], message: "adjudicator run must be present exactly when disagreements exist" });
  }
  if (value.run_ids.grader_a !== value.agent_provenance.grader_a.run_id
      || value.run_ids.grader_b !== value.agent_provenance.grader_b.run_id
      || value.run_ids.adjudicator !== (value.agent_provenance.adjudicator?.run_id ?? null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["agent_provenance"], message: "agent references must match recorded run ids" });
  }
});

export const OWNER_DECISIONS = ["approved", "corrected", "rejected"] as const;
export const OwnerPairDecisionSchema = z.object({
  query_id: QueryIdSchema,
  resource_id: ResourceIdSchema,
  decision: z.enum(OWNER_DECISIONS),
  grade: GradeSchema.nullable(),
  reviewer: z.string().min(1),
  reviewed_at: z.string().datetime(),
  rationale: z.string().min(1).max(1_000).nullable(),
  notes: z.string().min(1).max(2_000).nullable(),
}).strict().superRefine((value, context) => {
  if (value.decision === "rejected" && value.grade !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["grade"], message: "rejected pair must not carry a final grade" });
  }
  if (value.decision !== "rejected" && value.grade === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["grade"], message: "approved/corrected pair requires final grade" });
  }
  if ((value.decision === "corrected" || value.decision === "rejected") && value.notes === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["notes"], message: "corrected/rejected pair requires notes" });
  }
});

export const OwnerQueryDecisionSchema = z.object({
  query_id: QueryIdSchema,
  decision: z.enum(OWNER_DECISIONS),
  reviewer: z.string().min(1),
  reviewed_at: z.string().datetime(),
  notes: z.string().min(1).max(2_000).nullable(),
}).strict().superRefine((value, context) => {
  if ((value.decision === "corrected" || value.decision === "rejected") && value.notes === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["notes"], message: "corrected/rejected query requires notes" });
  }
});

export const OwnerDecisionBundleSchema = z.object({
  version: z.literal(1),
  pair_decisions: z.array(OwnerPairDecisionSchema),
  query_decisions: z.array(OwnerQueryDecisionSchema),
}).strict();

const DecisionCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  approved: z.number().int().nonnegative(),
  corrected: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  correction_rate: z.number().min(0).max(1),
  rejection_rate: z.number().min(0).max(1),
}).strict();

export const OwnerReviewReportSchema = z.object({
  version: z.literal(1),
  generated_at: z.string().datetime(),
  source_hashes: z.object({
    queries: GradingArtifactHashSchema,
    raw_qrels: GradingArtifactHashSchema,
    raw_calibration: GradingArtifactHashSchema,
    owner_decisions: GradingArtifactHashSchema,
  }).strict(),
  output_hashes: z.object({
    development_qrels: GradingArtifactHashSchema,
    release_qrels: GradingArtifactHashSchema,
    reviewed_calibration: GradingArtifactHashSchema,
  }).strict(),
  reviewers: z.array(z.string().min(1)).min(1),
  pairs: DecisionCountsSchema,
  queries: DecisionCountsSchema,
  reviewed_qrels_emitted: z.object({
    development: z.number().int().nonnegative(),
    release: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }).strict(),
  excluded_pairs: z.array(z.object({
    query_id: QueryIdSchema,
    resource_id: ResourceIdSchema,
    reason: z.enum(["pair_rejected", "query_rejected"]),
  }).strict()),
  corrected_pairs: z.array(z.object({
    query_id: QueryIdSchema,
    resource_id: ResourceIdSchema,
    original_grade: GradeSchema,
    final_grade: GradeSchema,
  }).strict()),
  corrected_queries: z.array(QueryIdSchema),
  rejected_queries: z.array(QueryIdSchema),
}).strict();

const PublicSplitReviewSchema = z.object({
  query_count: z.number().int().nonnegative(),
  qrel_count: z.number().int().nonnegative(),
  qrels_hash: GradingArtifactHashSchema,
  pair_set_hash: GradingArtifactHashSchema,
  all_qrels_reviewed: z.literal(true),
  all_release_rationales_present: z.boolean(),
  pairs: DecisionCountsSchema,
  queries: DecisionCountsSchema,
}).strict().superRefine((value, context) => {
  if (value.qrel_count !== value.pairs.total - value.pairs.rejected) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["qrel_count"], message: "must equal non-rejected pair decisions" });
  }
});

/** Safe to expose to CI: proves review coverage with hashes/counts but contains no pair ids or grades. */
export const OwnerReviewPublicSummarySchema = z.object({
  version: z.literal(1),
  artifact: z.literal("owner-review-public-summary-v2"),
  generated_at: z.string().datetime(),
  full_report_hash: GradingArtifactHashSchema,
  source_hashes: z.object({
    queries: GradingArtifactHashSchema,
    raw_qrels: GradingArtifactHashSchema,
    raw_calibration: GradingArtifactHashSchema,
    owner_decisions: GradingArtifactHashSchema,
  }).strict(),
  reviewers: z.array(z.string().min(1)).min(1),
  development: PublicSplitReviewSchema,
  release: PublicSplitReviewSchema,
  reviewed_calibration: z.object({
    count: z.number().int().nonnegative(),
    artifact_hash: GradingArtifactHashSchema,
    all_rows_reviewed: z.literal(true),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.reviewed_calibration.count !== value.development.pairs.total + value.release.pairs.total) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reviewed_calibration", "count"], message: "must cover every split pair decision" });
  }
});

export type BlindGradingPack = z.infer<typeof BlindGradingPackSchema>;
export type BlindAdjudicationPack = z.infer<typeof BlindAdjudicationPackSchema>;
export type GraderImport = z.infer<typeof GraderImportSchema>;
export type AdjudicatorImport = z.infer<typeof AdjudicatorImportSchema>;
export type GradingManifest = z.infer<typeof GradingManifestSchema>;
export type AdjudicationManifest = z.infer<typeof AdjudicationManifestSchema>;
export type AgreementArtifact = z.infer<typeof AgreementArtifactSchema>;
export type GradingProcessAudit = z.infer<typeof GradingProcessAuditSchema>;
export type OwnerDecisionBundle = z.infer<typeof OwnerDecisionBundleSchema>;
export type OwnerReviewReport = z.infer<typeof OwnerReviewReportSchema>;
export type OwnerReviewPublicSummary = z.infer<typeof OwnerReviewPublicSummarySchema>;

export interface PipelinePrerequisites {
  queries: readonly QueryRecord[];
  catalog: readonly CatalogRecord[];
  sidecars: readonly SidecarRecord[];
  pool: readonly PoolRecord[];
}

export interface ExpectedCounts {
  queries: number;
  catalog: number;
  sidecars: number;
}

export interface PrepareGradingOptions {
  pipelineRunId: string;
  createdAt: string;
  seed: string;
  graderA: z.infer<typeof GraderRefSchema>;
  graderB: z.infer<typeof GraderRefSchema>;
  expectedCounts?: ExpectedCounts;
}

const DEFAULT_COUNTS: ExpectedCounts = {
  queries: RELEASE_COUNTS.queries.total,
  catalog: RELEASE_COUNTS.resources.total,
  sidecars: RELEASE_COUNTS.resources.total,
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function gradingArtifactHash(value: unknown): string {
  return `sha256:${sha256(JSON.stringify(value))}`;
}

export function gradingSourceHash(input: PipelinePrerequisites): string {
  return gradingArtifactHash({
    queries: input.queries,
    catalog: input.catalog,
    sidecars: input.sidecars,
    pool: input.pool,
  });
}

export function gradingPairSetHash(values: readonly { query_id: string; resource_id: string }[]): string {
  return gradingArtifactHash(values.map(value => pairKey(value.query_id, value.resource_id)).sort());
}

function opaque(prefix: "task" | "candidate", seed: string, ...parts: string[]): string {
  return `${prefix}-${sha256([seed, ...parts].join("\0")).slice(0, 16)}`;
}

function pairKey(queryId: string, resourceId: string): string {
  return `${queryId}\0${resourceId}`;
}

function assertUnique(values: readonly string[], label: string): void {
  const duplicate = values.find((value, index) => values.indexOf(value) !== index);
  if (duplicate) throw new Error(`duplicate ${label}: ${duplicate}`);
}

function parseAll<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  values: readonly unknown[],
  label: string,
): Array<z.output<TSchema>> {
  return values.map((value, index) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`${label}[${index}]: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    }
    return parsed.data;
  });
}

function verifyPrerequisites(input: PipelinePrerequisites, expected: ExpectedCounts): void {
  if (input.queries.length !== expected.queries) throw new Error(`expected ${expected.queries} queries, got ${input.queries.length}`);
  if (input.catalog.length !== expected.catalog) throw new Error(`expected ${expected.catalog} catalog records, got ${input.catalog.length}`);
  if (input.sidecars.length !== expected.sidecars) throw new Error(`expected ${expected.sidecars} sidecars, got ${input.sidecars.length}`);
  if (input.pool.length === 0) throw new Error("pool is empty");

  assertUnique(input.queries.map(record => record.query_id), "query_id");
  assertUnique(input.catalog.map(record => record.resource_id), "catalog resource_id");
  assertUnique(input.sidecars.map(record => record.resource_id), "sidecar resource_id");
  assertUnique(input.pool.map(record => pairKey(record.query_id, record.resource_id)), "pool pair");

  const queryById = new Map(input.queries.map(record => [record.query_id, record]));
  const catalogIds = new Set(input.catalog.map(record => record.resource_id));
  const sidecarById = new Map(input.sidecars.map(record => [record.resource_id, record]));
  for (const query of input.queries) {
    if (query.review_status !== "approved" && query.review_status !== "corrected") {
      throw new Error(`${query.query_id}: query must be owner-reviewed before pooled grading`);
    }
  }
  for (const resource of input.catalog) {
    const sidecar = sidecarById.get(resource.resource_id);
    if (!sidecar) throw new Error(`${resource.resource_id}: missing sidecar`);
    if (sidecar.review_status !== "approved" && sidecar.review_status !== "corrected") {
      throw new Error(`${resource.resource_id}: resource must be owner-reviewed before pooled grading`);
    }
  }
  for (const record of input.pool) {
    if (!queryById.has(record.query_id)) throw new Error(`${record.query_id}: pool references unknown query`);
    if (!catalogIds.has(record.resource_id)) throw new Error(`${record.resource_id}: pool references unknown resource`);
  }
  for (const query of input.queries) {
    if (!query.expects_no_result && !input.pool.some(record => record.query_id === query.query_id)) {
      throw new Error(`${query.query_id}: non-no-result query has no pooled candidates`);
    }
  }
}

export function parsePrerequisites(raw: {
  queries: readonly unknown[];
  catalog: readonly unknown[];
  sidecars: readonly unknown[];
  pool: readonly unknown[];
}, expectedCounts: ExpectedCounts = DEFAULT_COUNTS): PipelinePrerequisites {
  const input: PipelinePrerequisites = {
    queries: parseAll(QueryRecordSchema, raw.queries, "queries"),
    catalog: parseAll(CatalogRecordSchema, raw.catalog, "catalog"),
    sidecars: parseAll(SidecarRecordSchema, raw.sidecars, "sidecars"),
    pool: parseAll(PoolRecordSchema, raw.pool, "pool"),
  };
  verifyPrerequisites(input, expectedCounts);
  return input;
}

function listing(record: CatalogRecord, sidecar: SidecarRecord): z.infer<typeof BlindListingSchema> {
  const source = record.wire.resource;
  return BlindListingSchema.parse({
    resource_type: sidecar.resource_type,
    ...(source.serviceName === undefined ? {} : { serviceName: source.serviceName }),
    ...(source.description === undefined ? {} : { description: source.description }),
    ...(source.tags === undefined ? {} : { tags: source.tags }),
    ...(source.mimeType === undefined ? {} : { mimeType: source.mimeType }),
    ...(sidecar.mcp === undefined ? {} : { mcp: sidecar.mcp }),
  });
}

function shuffled<T>(values: readonly T[], seed: string, key: (value: T) => string): T[] {
  return [...values].sort((left, right) => {
    const a = sha256(`${seed}\0${key(left)}`);
    const b = sha256(`${seed}\0${key(right)}`);
    return a.localeCompare(b);
  });
}

const FORBIDDEN_GRADER_KEYS = new Set([
  "query_id", "resource_id", "provider_id", "family", "family_slot", "authorship", "generation",
  "derived_from", "review_status", "reviewed_at", "owner_note", "system", "systems", "rank", "score",
  "contributions", "best_rank", "run_id", "model", "prompt_hash", "grade", "rationale", "annotator",
]);

export function assertNoBlindPackLeakage(pack: BlindGradingPack | BlindAdjudicationPack): void {
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) return value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_GRADER_KEYS.has(key)) throw new Error(`blind pack leaks forbidden key ${path}.${key}`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(pack, "pack");
}

function assertIndependentGrader(
  grader: z.infer<typeof GraderRefSchema>,
  other: z.infer<typeof GraderRefSchema>,
  input: PipelinePrerequisites,
): void {
  if (grader.run_id === other.run_id) throw new Error("grader A and B require distinct run_id values");
  const authorRuns = new Set([
    ...input.queries.map(record => record.generation.run_id),
    ...input.sidecars.map(record => record.generation.run_id),
  ]);
  if (authorRuns.has(grader.run_id)) throw new Error(`${grader.run_id}: grader authored a query or resource in this corpus`);
}

function assertManifestMatchesPrerequisites(manifest: GradingManifest, input: PipelinePrerequisites): void {
  const actualSourceHash = gradingSourceHash(input);
  if (manifest.source_hash !== actualSourceHash) throw new Error("grading manifest source_hash does not match current inputs");
  const queryById = new Map(input.queries.map(record => [record.query_id, record]));
  const sidecarById = new Map(input.sidecars.map(record => [record.resource_id, record]));
  const expectedPairs = input.pool.map(record => pairKey(record.query_id, record.resource_id)).sort();
  if (manifest.pair_count !== expectedPairs.length) throw new Error("grading manifest pair_count does not match pool");
  for (const slot of ["a", "b"] as const) {
    const assignments = manifest.assignments[slot];
    const actualPairs = assignments.map(item => pairKey(item.query_id, item.resource_id)).sort();
    if (actualPairs.join("\n") !== expectedPairs.join("\n")) {
      throw new Error(`grading manifest ${slot} assignments do not match the complete pool`);
    }
    for (const assignment of assignments) {
      const query = queryById.get(assignment.query_id)!;
      const sidecar = sidecarById.get(assignment.resource_id)!;
      if (
        assignment.split !== query.split ||
        assignment.query_author_run_id !== query.generation.run_id ||
        assignment.resource_author_run_id !== sidecar.generation.run_id ||
        assignment.relevant_family !== (query.family !== null && query.family === sidecar.family)
      ) {
        throw new Error(`${assignment.query_id}/${assignment.resource_id}: withheld provenance mismatch`);
      }
    }
  }
}

export function prepareBlindGrading(
  raw: { queries: readonly unknown[]; catalog: readonly unknown[]; sidecars: readonly unknown[]; pool: readonly unknown[] },
  options: PrepareGradingOptions,
): { graderA: BlindGradingPack; graderB: BlindGradingPack; manifest: GradingManifest } {
  const input = parsePrerequisites(raw, options.expectedCounts ?? DEFAULT_COUNTS);
  const graderARef = GraderRefSchema.parse(options.graderA);
  const graderBRef = GraderRefSchema.parse(options.graderB);
  z.string().datetime().parse(options.createdAt);
  assertIndependentGrader(graderARef, graderBRef, input);
  assertIndependentGrader(graderBRef, graderARef, input);

  const queryById = new Map(input.queries.map(record => [record.query_id, record]));
  const catalogById = new Map(input.catalog.map(record => [record.resource_id, record]));
  const sidecarById = new Map(input.sidecars.map(record => [record.resource_id, record]));
  const poolsByQuery = new Map<string, PoolRecord[]>();
  for (const record of input.pool) {
    const bucket = poolsByQuery.get(record.query_id) ?? [];
    bucket.push(record);
    poolsByQuery.set(record.query_id, bucket);
  }
  const sourceHash = gradingSourceHash(input);

  const build = (slot: "a" | "b", grader: z.infer<typeof GraderRefSchema>) => {
    const seed = `${options.seed}\0${slot}\0${grader.run_id}`;
    const packId = `grading-${options.pipelineRunId}-${slot}`;
    const assignments: z.infer<typeof SourceAssignmentSchema>[] = [];
    const tasks = shuffled(
      [...poolsByQuery.keys()],
      `${seed}\0queries`,
      value => value,
    ).map(queryId => {
      const query = queryById.get(queryId)!;
      const taskId = opaque("task", seed, queryId);
      const candidates = shuffled(poolsByQuery.get(queryId)!, `${seed}\0${queryId}`, value => value.resource_id)
        .map(record => {
          const candidateId = opaque("candidate", seed, queryId, record.resource_id);
          const catalog = catalogById.get(record.resource_id)!;
          const sidecar = sidecarById.get(record.resource_id)!;
          assignments.push({
            task_id: taskId,
            candidate_id: candidateId,
            query_id: queryId,
            resource_id: record.resource_id,
            split: query.split,
            query_author_run_id: query.generation.run_id,
            resource_author_run_id: sidecar.generation.run_id,
            relevant_family: query.family !== null && query.family === sidecar.family,
          });
          return { candidate_id: candidateId, listing: listing(catalog, sidecar) };
        });
      return { task_id: taskId, query: query.query, candidates };
    });
    const pack = BlindGradingPackSchema.parse({
      version: 1,
      role: "grader",
      pack_id: packId,
      instructions: "Grade capability relevance only using the frozen 0–3 rubric. Candidates already passed hard filters. Do not infer source identity. Return one judgment per candidate.",
      tasks,
    });
    assertNoBlindPackLeakage(pack);
    return { pack, packId, assignments };
  };

  const a = build("a", graderARef);
  const b = build("b", graderBRef);
  const manifest = GradingManifestSchema.parse({
    version: 1,
    pipeline_run_id: options.pipelineRunId,
    created_at: options.createdAt,
    source_hash: sourceHash,
    pair_count: input.pool.length,
    graders: { a: graderARef, b: graderBRef },
    packs: { a: a.packId, b: b.packId },
    assignments: { a: a.assignments, b: b.assignments },
  });
  return { graderA: a.pack, graderB: b.pack, manifest };
}

type ResolvedJudgment = z.infer<typeof JudgmentImportSchema> & z.infer<typeof SourceAssignmentSchema>;

function resolveImport(
  raw: unknown,
  slot: "a" | "b",
  manifest: GradingManifest,
): { importRecord: GraderImport; judgments: Map<string, ResolvedJudgment> } {
  const parsed = GraderImportSchema.parse(raw);
  if (parsed.role !== `grader_${slot}`) throw new Error(`expected grader_${slot} import, got ${parsed.role}`);
  if (parsed.pack_id !== manifest.packs[slot]) throw new Error(`grader ${slot} pack_id mismatch`);
  if (JSON.stringify(parsed.grader) !== JSON.stringify(manifest.graders[slot])) throw new Error(`grader ${slot} provenance mismatch`);

  const assignmentByOpaque = new Map(manifest.assignments[slot].map(item => [pairKey(item.task_id, item.candidate_id), item]));
  assertUnique(parsed.judgments.map(item => pairKey(item.task_id, item.candidate_id)), `grader ${slot} judgment`);
  if (parsed.judgments.length !== assignmentByOpaque.size) {
    throw new Error(`grader ${slot}: expected ${assignmentByOpaque.size} judgments, got ${parsed.judgments.length}`);
  }
  const resolved = new Map<string, ResolvedJudgment>();
  for (const judgment of parsed.judgments) {
    const assignment = assignmentByOpaque.get(pairKey(judgment.task_id, judgment.candidate_id));
    if (!assignment) throw new Error(`grader ${slot}: judgment is not assigned to this pack`);
    if (assignment.split === "release" && !judgment.rationale) {
      throw new Error(`${assignment.query_id}/${assignment.resource_id}: release judgment requires rationale`);
    }
    if (parsed.grader.run_id === assignment.query_author_run_id || parsed.grader.run_id === assignment.resource_author_run_id) {
      throw new Error(`${parsed.grader.run_id}: self-grading ${assignment.query_id}/${assignment.resource_id}`);
    }
    resolved.set(pairKey(assignment.query_id, assignment.resource_id), { ...judgment, ...assignment });
  }
  return { importRecord: parsed, judgments: resolved };
}

export function validateDoubleGrading(
  rawA: unknown,
  rawB: unknown,
  rawManifest: unknown,
): { a: GraderImport; b: GraderImport; pairs: Array<{ a: ResolvedJudgment; b: ResolvedJudgment }> } {
  const manifest = GradingManifestSchema.parse(rawManifest);
  const a = resolveImport(rawA, "a", manifest);
  const b = resolveImport(rawB, "b", manifest);
  if (a.importRecord.grader.run_id === b.importRecord.grader.run_id) throw new Error("grader imports use the same run_id");
  const aKeys = [...a.judgments.keys()].sort();
  const bKeys = [...b.judgments.keys()].sort();
  if (aKeys.join("\n") !== bKeys.join("\n")) throw new Error("grader imports do not cover identical source pairs");
  return {
    a: a.importRecord,
    b: b.importRecord,
    pairs: aKeys.map(key => ({ a: a.judgments.get(key)!, b: b.judgments.get(key)! })),
  };
}

function assertGradingPackMatchesManifest(
  rawPack: unknown,
  slot: "a" | "b",
  manifest: GradingManifest,
  input: PipelinePrerequisites,
): BlindGradingPack {
  const pack = BlindGradingPackSchema.parse(rawPack);
  if (pack.pack_id !== manifest.packs[slot]) throw new Error(`grader ${slot} pack_id does not match withheld manifest`);
  assertNoBlindPackLeakage(pack);
  assertUnique(pack.tasks.map(task => task.task_id), `grader ${slot} pack task_id`);

  const assignments = manifest.assignments[slot];
  const assignmentByOpaque = new Map(assignments.map(assignment => [pairKey(assignment.task_id, assignment.candidate_id), assignment]));
  const queryById = new Map(input.queries.map(record => [record.query_id, record]));
  const catalogById = new Map(input.catalog.map(record => [record.resource_id, record]));
  const sidecarById = new Map(input.sidecars.map(record => [record.resource_id, record]));
  const seen: string[] = [];

  for (const task of pack.tasks) {
    const taskAssignments = assignments.filter(assignment => assignment.task_id === task.task_id);
    if (taskAssignments.length === 0) throw new Error(`grader ${slot} pack contains an unassigned task`);
    const queryIds = new Set(taskAssignments.map(assignment => assignment.query_id));
    if (queryIds.size !== 1) throw new Error(`grader ${slot} task maps to multiple source queries`);
    const queryId = taskAssignments[0]!.query_id;
    if (task.query !== queryById.get(queryId)!.query) throw new Error(`grader ${slot} pack query text does not match current source`);
    if (task.candidates.length !== taskAssignments.length) throw new Error(`grader ${slot} pack task candidate count mismatch`);

    for (const candidate of task.candidates) {
      const opaqueKey = pairKey(task.task_id, candidate.candidate_id);
      const assignment = assignmentByOpaque.get(opaqueKey);
      if (!assignment) throw new Error(`grader ${slot} pack contains an unassigned candidate`);
      const expectedListing = listing(catalogById.get(assignment.resource_id)!, sidecarById.get(assignment.resource_id)!);
      if (JSON.stringify(candidate.listing) !== JSON.stringify(expectedListing)) {
        throw new Error(`grader ${slot} pack listing does not match current source`);
      }
      seen.push(opaqueKey);
    }
  }

  assertUnique(seen, `grader ${slot} pack assignment`);
  const expected = [...assignmentByOpaque.keys()].sort();
  if (seen.sort().join("\n") !== expected.join("\n")) throw new Error(`grader ${slot} pack does not cover the withheld manifest exactly`);
  return pack;
}

function assertAdjudicationPackMatchesManifest(
  rawPack: unknown,
  manifest: z.infer<typeof AdjudicationManifestSchema>,
  input: PipelinePrerequisites,
): BlindAdjudicationPack {
  const pack = BlindAdjudicationPackSchema.parse(rawPack);
  if (pack.pack_id !== manifest.pack_id) throw new Error("adjudication pack_id does not match withheld manifest");
  assertNoBlindPackLeakage(pack);
  assertUnique(pack.tasks.map(task => pairKey(task.task_id, task.candidate.candidate_id)), "adjudication pack assignment");
  const assignmentByOpaque = new Map(manifest.assignments.map(assignment => [pairKey(assignment.task_id, assignment.candidate_id), assignment]));
  const queryById = new Map(input.queries.map(record => [record.query_id, record]));
  const catalogById = new Map(input.catalog.map(record => [record.resource_id, record]));
  const sidecarById = new Map(input.sidecars.map(record => [record.resource_id, record]));
  const seen: string[] = [];

  for (const task of pack.tasks) {
    const opaqueKey = pairKey(task.task_id, task.candidate.candidate_id);
    const assignment = assignmentByOpaque.get(opaqueKey);
    if (!assignment) throw new Error("adjudication pack contains an unassigned candidate");
    if (task.query !== queryById.get(assignment.query_id)!.query) throw new Error("adjudication pack query text does not match current source");
    const expectedListing = listing(catalogById.get(assignment.resource_id)!, sidecarById.get(assignment.resource_id)!);
    if (JSON.stringify(task.candidate.listing) !== JSON.stringify(expectedListing)) {
      throw new Error("adjudication pack listing does not match current source");
    }
    seen.push(opaqueKey);
  }

  const expected = [...assignmentByOpaque.keys()].sort();
  if (seen.sort().join("\n") !== expected.join("\n")) throw new Error("adjudication pack does not cover the withheld manifest exactly");
  return pack;
}

export interface GradingProcessAuditInputs {
  sources: { queries: readonly unknown[]; catalog: readonly unknown[]; sidecars: readonly unknown[]; pool: readonly unknown[] };
  gradingManifest: unknown;
  graderAPack: unknown;
  graderBPack: unknown;
  graderAImport: unknown;
  graderBImport: unknown;
  adjudicationManifest: unknown | null;
  adjudicationPack: unknown | null;
  adjudicatorImport: unknown | null;
}

export function buildGradingProcessAudit(
  raw: GradingProcessAuditInputs,
  generatedAt: string,
  expectedCounts: ExpectedCounts = DEFAULT_COUNTS,
): GradingProcessAudit {
  z.string().datetime().parse(generatedAt);
  const sources = parsePrerequisites(raw.sources, expectedCounts);
  const manifest = GradingManifestSchema.parse(raw.gradingManifest);
  assertManifestMatchesPrerequisites(manifest, sources);
  assertGradingPackMatchesManifest(raw.graderAPack, "a", manifest, sources);
  assertGradingPackMatchesManifest(raw.graderBPack, "b", manifest, sources);
  const double = validateDoubleGrading(raw.graderAImport, raw.graderBImport, manifest);
  const disagreements = double.pairs.filter(pair => pair.a.grade !== pair.b.grade);
  const final = finalizeGrading(
    sources,
    manifest,
    raw.graderAImport,
    raw.graderBImport,
    raw.adjudicationManifest,
    raw.adjudicatorImport,
    generatedAt,
    expectedCounts,
  );

  let adjudicatorRunId: string | null = null;
  if (disagreements.length > 0) {
    if (raw.adjudicationManifest === null || raw.adjudicationPack === null || raw.adjudicatorImport === null) {
      throw new Error("complete adjudication manifest, pack, and import are required for process audit");
    }
    const adjudicationManifest = AdjudicationManifestSchema.parse(raw.adjudicationManifest);
    if (adjudicationManifest.pipeline_run_id !== manifest.pipeline_run_id) throw new Error("adjudication pipeline_run_id mismatch");
    assertAdjudicationPackMatchesManifest(raw.adjudicationPack, adjudicationManifest, sources);
    adjudicatorRunId = adjudicationManifest.adjudicator.run_id;
  } else if (raw.adjudicationManifest !== null || raw.adjudicationPack !== null || raw.adjudicatorImport !== null) {
    throw new Error("adjudication artifacts supplied when graders have no disagreements");
  }

  const authorRuns = [...new Set([
    ...sources.queries.map(record => record.generation.run_id),
    ...sources.sidecars.map(record => record.generation.run_id),
  ])].sort();
  return GradingProcessAuditSchema.parse({
    version: 1,
    artifact: "grading-process-audit-v2",
    status: "pass",
    pipeline_run_id: manifest.pipeline_run_id,
    generated_at: generatedAt,
    source_hash: gradingSourceHash(sources),
    input_hashes: {
      grading_manifest: gradingArtifactHash(manifest),
      grader_a_pack: gradingArtifactHash(raw.graderAPack),
      grader_b_pack: gradingArtifactHash(raw.graderBPack),
      grader_a_import: gradingArtifactHash(raw.graderAImport),
      grader_b_import: gradingArtifactHash(raw.graderBImport),
      adjudication_manifest: raw.adjudicationManifest === null ? null : gradingArtifactHash(raw.adjudicationManifest),
      adjudication_pack: raw.adjudicationPack === null ? null : gradingArtifactHash(raw.adjudicationPack),
      adjudicator_import: raw.adjudicatorImport === null ? null : gradingArtifactHash(raw.adjudicatorImport),
    },
    run_ids: {
      author: authorRuns,
      grader_a: double.a.grader.run_id,
      grader_b: double.b.grader.run_id,
      adjudicator: adjudicatorRunId,
    },
    agent_provenance: {
      grader_a: double.a.grader,
      grader_b: double.b.grader,
      adjudicator: disagreements.length === 0
        ? null
        : AdjudicationManifestSchema.parse(raw.adjudicationManifest).adjudicator,
    },
    counts: {
      pairs: manifest.pair_count,
      grader_a_judgments: double.a.judgments.length,
      grader_b_judgments: double.b.judgments.length,
      disagreements: final.agreementReport.disagreement_count,
      adjudications: final.agreementReport.adjudicated_count,
    },
    checks: {
      source_current: true,
      packs_match_withheld_manifest: true,
      packs_contain_no_provenance_or_ranking_leakage: true,
      graders_are_distinct_fresh_contexts: true,
      double_grading_complete: true,
      adjudication_is_third_context_and_disagreement_only: true,
    },
  });
}

export function prepareBlindAdjudication(
  input: PipelinePrerequisites,
  rawManifest: unknown,
  rawA: unknown,
  rawB: unknown,
  adjudicator: z.infer<typeof GraderRefSchema>,
  options: { pipelineRunId: string; createdAt: string; seed: string; expectedCounts?: ExpectedCounts },
): { pack: BlindAdjudicationPack; manifest: AdjudicationManifest } {
  const sources = parsePrerequisites(input, options.expectedCounts ?? DEFAULT_COUNTS);
  const gradingManifest = GradingManifestSchema.parse(rawManifest);
  assertManifestMatchesPrerequisites(gradingManifest, sources);
  if (options.pipelineRunId !== gradingManifest.pipeline_run_id) throw new Error("adjudication pipeline_run_id must match grading pipeline");
  const double = validateDoubleGrading(rawA, rawB, gradingManifest);
  const adjudicatorRef = GraderRefSchema.parse(adjudicator);
  z.string().datetime().parse(options.createdAt);
  const forbiddenRuns = new Set([
    double.a.grader.run_id,
    double.b.grader.run_id,
    ...sources.queries.map(record => record.generation.run_id),
    ...sources.sidecars.map(record => record.generation.run_id),
  ]);
  if (forbiddenRuns.has(adjudicatorRef.run_id)) throw new Error(`${adjudicatorRef.run_id}: adjudicator is not an independent fresh context`);

  const queryById = new Map(sources.queries.map(record => [record.query_id, record]));
  const catalogById = new Map(sources.catalog.map(record => [record.resource_id, record]));
  const sidecarById = new Map(sources.sidecars.map(record => [record.resource_id, record]));
  const disagreements = double.pairs.filter(pair => pair.a.grade !== pair.b.grade);
  const seed = `${options.seed}\0adjudication\0${adjudicatorRef.run_id}`;
  const assignments: z.infer<typeof SourceAssignmentSchema>[] = [];
  const tasks = shuffled(disagreements, seed, pair => pairKey(pair.a.query_id, pair.a.resource_id)).map(pair => {
    const source = pair.a;
    const taskId = opaque("task", seed, source.query_id, source.resource_id);
    const candidateId = opaque("candidate", seed, source.query_id, source.resource_id);
    assignments.push({
      task_id: taskId,
      candidate_id: candidateId,
      query_id: source.query_id,
      resource_id: source.resource_id,
      split: source.split,
      query_author_run_id: source.query_author_run_id,
      resource_author_run_id: source.resource_author_run_id,
      relevant_family: source.relevant_family,
    });
    return {
      task_id: taskId,
      query: queryById.get(source.query_id)!.query,
      candidate: {
        candidate_id: candidateId,
        listing: listing(catalogById.get(source.resource_id)!, sidecarById.get(source.resource_id)!),
      },
    };
  });
  const packId = `adjudication-${options.pipelineRunId}`;
  const pack = BlindAdjudicationPackSchema.parse({
    version: 1,
    role: "adjudicator",
    pack_id: packId,
    instructions: "Independently grade each disagreement candidate using the frozen 0–3 rubric. Prior grades and grader identities are intentionally withheld.",
    tasks,
  });
  assertNoBlindPackLeakage(pack);
  const manifest = AdjudicationManifestSchema.parse({
    version: 1,
    pipeline_run_id: options.pipelineRunId,
    created_at: options.createdAt,
    pack_id: packId,
    adjudicator: adjudicatorRef,
    assignments,
  });
  return { pack, manifest };
}

function resolveAdjudication(raw: unknown, manifest: AdjudicationManifest): Map<string, ResolvedJudgment> {
  const parsed = AdjudicatorImportSchema.parse(raw);
  if (parsed.pack_id !== manifest.pack_id) throw new Error("adjudicator pack_id mismatch");
  if (JSON.stringify(parsed.adjudicator) !== JSON.stringify(manifest.adjudicator)) throw new Error("adjudicator provenance mismatch");
  const assignmentByOpaque = new Map(manifest.assignments.map(item => [pairKey(item.task_id, item.candidate_id), item]));
  assertUnique(parsed.judgments.map(item => pairKey(item.task_id, item.candidate_id)), "adjudicator judgment");
  if (parsed.judgments.length !== assignmentByOpaque.size) {
    throw new Error(`adjudicator: expected ${assignmentByOpaque.size} judgments, got ${parsed.judgments.length}`);
  }
  const resolved = new Map<string, ResolvedJudgment>();
  for (const judgment of parsed.judgments) {
    const assignment = assignmentByOpaque.get(pairKey(judgment.task_id, judgment.candidate_id));
    if (!assignment) throw new Error("adjudicator judgment is not assigned to this pack");
    if (assignment.split === "release" && !judgment.rationale) {
      throw new Error(`${assignment.query_id}/${assignment.resource_id}: release adjudication requires rationale`);
    }
    if (parsed.adjudicator.run_id === assignment.query_author_run_id || parsed.adjudicator.run_id === assignment.resource_author_run_id) {
      throw new Error(`${parsed.adjudicator.run_id}: adjudicator authored ${assignment.query_id}/${assignment.resource_id}`);
    }
    resolved.set(pairKey(assignment.query_id, assignment.resource_id), { ...judgment, ...assignment });
  }
  return resolved;
}

export function finalizeGrading(
  input: PipelinePrerequisites,
  rawManifest: unknown,
  rawA: unknown,
  rawB: unknown,
  rawAdjudicationManifest: unknown | null,
  rawAdjudicatorImport: unknown | null,
  generatedAt: string,
  expectedCounts: ExpectedCounts = DEFAULT_COUNTS,
): {
  qrels: QrelRecord[];
  calibration: AgentCalibrationRecord[];
  agreementReport: AgreementArtifact;
} {
  z.string().datetime().parse(generatedAt);
  const sources = parsePrerequisites(input, expectedCounts);
  const manifest = GradingManifestSchema.parse(rawManifest);
  assertManifestMatchesPrerequisites(manifest, sources);
  const double = validateDoubleGrading(rawA, rawB, manifest);
  const disagreements = double.pairs.filter(pair => pair.a.grade !== pair.b.grade);
  let adjudication = new Map<string, ResolvedJudgment>();
  let adjudicatorRef: z.infer<typeof GraderRefSchema> | null = null;
  if (disagreements.length > 0) {
    if (rawAdjudicationManifest === null || rawAdjudicatorImport === null) {
      throw new Error(`${disagreements.length} disagreements require a complete adjudicator import`);
    }
    const adjudicationManifest = AdjudicationManifestSchema.parse(rawAdjudicationManifest);
    if (adjudicationManifest.pipeline_run_id !== manifest.pipeline_run_id) {
      throw new Error("adjudication pipeline_run_id does not match grading pipeline");
    }
    const authorRuns = new Set([
      ...sources.queries.map(record => record.generation.run_id),
      ...sources.sidecars.map(record => record.generation.run_id),
    ]);
    if (
      adjudicationManifest.adjudicator.run_id === double.a.grader.run_id ||
      adjudicationManifest.adjudicator.run_id === double.b.grader.run_id ||
      authorRuns.has(adjudicationManifest.adjudicator.run_id)
    ) {
      throw new Error("adjudicator must use a third fresh-context run_id distinct from all authors and graders");
    }
    const expected = disagreements.map(pair => pairKey(pair.a.query_id, pair.a.resource_id)).sort();
    const assigned = adjudicationManifest.assignments.map(item => pairKey(item.query_id, item.resource_id)).sort();
    if (expected.join("\n") !== assigned.join("\n")) throw new Error("adjudication manifest is not disagreement-only and complete");
    adjudication = resolveAdjudication(rawAdjudicatorImport, adjudicationManifest);
    adjudicatorRef = adjudicationManifest.adjudicator;
  } else if (rawAdjudicationManifest !== null || rawAdjudicatorImport !== null) {
    throw new Error("adjudication artifacts supplied when graders have no disagreements");
  }

  const qrels: QrelRecord[] = [];
  const calibration: AgentCalibrationRecord[] = [];
  const agreementPairs: AnnotatedPair[] = [];
  for (const pair of double.pairs) {
    const key = pairKey(pair.a.query_id, pair.a.resource_id);
    const disagrees = pair.a.grade !== pair.b.grade;
    const adjudicated = disagrees ? adjudication.get(key) : undefined;
    if (disagrees && !adjudicated) throw new Error(`${pair.a.query_id}/${pair.a.resource_id}: missing adjudication`);
    const selected = adjudicated ?? pair.a;
    const selectedGeneration = disagrees ? adjudicatorRef! : double.a.grader;
    const qrel = QrelRecordSchema.parse({
      query_id: pair.a.query_id,
      resource_id: pair.a.resource_id,
      grade: selected.grade,
      eligible: true,
      judge: "agent",
      ...(selected.rationale === undefined ? {} : { rationale: selected.rationale }),
      annotator: selectedGeneration.run_id,
      judged_at: selected.judged_at,
      generation: selectedGeneration,
      review_status: "pending",
      reviewed_at: null,
      reviewed_by: null,
      owner_note: null,
    });
    const calibrationRecord = AgentCalibrationSchema.parse({
      query_id: pair.a.query_id,
      resource_id: pair.a.resource_id,
      grader_a_grade: pair.a.grade,
      grader_b_grade: pair.b.grade,
      adjudicated_grade: disagrees ? selected.grade : null,
      grader_a: double.a.grader,
      grader_b: double.b.grader,
      adjudicator: disagrees ? adjudicatorRef : null,
      owner_review: "pending",
      reviewed_at: null,
      boundary_case: pair.a.grade >= 2 || pair.b.grade >= 2,
      notes: null,
    });
    qrels.push(qrel);
    calibration.push(calibrationRecord);
    agreementPairs.push({
      queryId: pair.a.query_id,
      resourceId: pair.a.resource_id,
      a: pair.a.grade,
      b: pair.b.grade,
      relevantFamily: pair.a.relevant_family,
    });
  }
  qrels.sort((a, b) => pairKey(a.query_id, a.resource_id).localeCompare(pairKey(b.query_id, b.resource_id)));
  calibration.sort((a, b) => pairKey(a.query_id, a.resource_id).localeCompare(pairKey(b.query_id, b.resource_id)));
  const agreement = stratifiedAgreement(agreementPairs);
  const agreementReport = AgreementArtifactSchema.parse({
    version: 1,
    pipeline_run_id: manifest.pipeline_run_id,
    generated_at: generatedAt,
    pair_count: double.pairs.length,
    disagreement_count: disagreements.length,
    adjudicated_count: adjudication.size,
    agreement,
    confusion_matrix_text: formatConfusionMatrix(agreement.confusionMatrix),
  });
  return { qrels, calibration, agreementReport };
}

function decisionCounts<T extends { decision: (typeof OWNER_DECISIONS)[number] }>(values: readonly T[]) {
  const total = values.length;
  const approved = values.filter(value => value.decision === "approved").length;
  const corrected = values.filter(value => value.decision === "corrected").length;
  const rejected = values.filter(value => value.decision === "rejected").length;
  return {
    total,
    approved,
    corrected,
    rejected,
    correction_rate: total === 0 ? 0 : corrected / total,
    rejection_rate: total === 0 ? 0 : rejected / total,
  };
}

export function applyOwnerReview(
  rawQueries: readonly unknown[],
  rawQrels: readonly unknown[],
  rawCalibration: readonly unknown[],
  rawDecisions: unknown,
  generatedAt: string,
  expectedQueryCount: number = RELEASE_COUNTS.queries.total,
): {
  developmentQrels: QrelRecord[];
  releaseQrels: QrelRecord[];
  reviewedCalibration: AgentCalibrationRecord[];
  report: OwnerReviewReport;
  publicSummary: OwnerReviewPublicSummary;
} {
  z.string().datetime().parse(generatedAt);
  const queries = parseAll(QueryRecordSchema, rawQueries, "queries");
  const qrels = parseAll(QrelRecordSchema, rawQrels, "qrels");
  const calibration = parseAll(AgentCalibrationSchema, rawCalibration, "calibration");
  const decisions = OwnerDecisionBundleSchema.parse(rawDecisions);
  if (queries.length !== expectedQueryCount) throw new Error(`expected ${expectedQueryCount} queries, got ${queries.length}`);
  if (qrels.length === 0) throw new Error("owner review requires non-empty raw qrels");
  if (calibration.length !== qrels.length) throw new Error("calibration must cover every raw qrel exactly once");

  const queryIds = queries.map(query => query.query_id);
  const qrelKeys = qrels.map(qrel => pairKey(qrel.query_id, qrel.resource_id));
  const calibrationKeys = calibration.map(record => pairKey(record.query_id, record.resource_id));
  assertUnique(queryIds, "query_id");
  assertUnique(qrelKeys, "raw qrel pair");
  assertUnique(calibrationKeys, "calibration pair");
  assertUnique(decisions.query_decisions.map(value => value.query_id), "owner query decision");
  assertUnique(decisions.pair_decisions.map(value => pairKey(value.query_id, value.resource_id)), "owner pair decision");
  if ([...qrelKeys].sort().join("\n") !== [...calibrationKeys].sort().join("\n")) {
    throw new Error("calibration pair set does not match raw qrels");
  }
  if ([...queryIds].sort().join("\n") !== decisions.query_decisions.map(value => value.query_id).sort().join("\n")) {
    throw new Error("owner query decisions must cover every query exactly once");
  }
  if ([...qrelKeys].sort().join("\n") !== decisions.pair_decisions.map(value => pairKey(value.query_id, value.resource_id)).sort().join("\n")) {
    throw new Error("owner pair decisions must cover every raw qrel exactly once");
  }
  if (qrels.some(qrel => qrel.judge !== "agent" || !qrel.eligible)) {
    throw new Error("owner phase accepts only raw eligible agent qrels from finalizeGrading");
  }
  if (calibration.some(record => record.owner_review !== "pending" || record.reviewed_at !== null)) {
    throw new Error("owner phase accepts only pending raw calibration records");
  }

  const queryById = new Map(queries.map(query => [query.query_id, query]));
  const queryDecisionById = new Map(decisions.query_decisions.map(value => [value.query_id, value]));
  const pairDecisionByKey = new Map(decisions.pair_decisions.map(value => [pairKey(value.query_id, value.resource_id), value]));
  const qrelByKey = new Map(qrels.map(value => [pairKey(value.query_id, value.resource_id), value]));

  const developmentQrels: QrelRecord[] = [];
  const releaseQrels: QrelRecord[] = [];
  const reviewedCalibration: AgentCalibrationRecord[] = [];
  const excludedPairs: OwnerReviewReport["excluded_pairs"] = [];
  const correctedPairs: OwnerReviewReport["corrected_pairs"] = [];
  for (const record of calibration) {
    const key = pairKey(record.query_id, record.resource_id);
    const rawQrel = qrelByKey.get(key)!;
    const pairDecision = pairDecisionByKey.get(key)!;
    const queryDecision = queryDecisionById.get(record.query_id)!;
    if (queryDecision.decision === "rejected" && pairDecision.decision !== "rejected") {
      throw new Error(`${record.query_id}/${record.resource_id}: rejected query requires rejected pair decision`);
    }
    if (pairDecision.decision === "approved" && pairDecision.grade !== rawQrel.grade) {
      throw new Error(`${record.query_id}/${record.resource_id}: approved grade must equal raw agent grade`);
    }
    if (pairDecision.decision === "corrected" && pairDecision.grade === rawQrel.grade) {
      throw new Error(`${record.query_id}/${record.resource_id}: corrected decision must change the grade`);
    }
    if (pairDecision.decision === "corrected") {
      correctedPairs.push({
        query_id: record.query_id,
        resource_id: record.resource_id,
        original_grade: rawQrel.grade,
        final_grade: pairDecision.grade!,
      });
    }

    const rejected = queryDecision.decision === "rejected" || pairDecision.decision === "rejected";
    if (rejected) {
      excludedPairs.push({
        query_id: record.query_id,
        resource_id: record.resource_id,
        reason: queryDecision.decision === "rejected" ? "query_rejected" : "pair_rejected",
      });
    } else {
      const query = queryById.get(record.query_id)!;
      const rationale = pairDecision.decision === "corrected"
        ? pairDecision.rationale
        : (pairDecision.rationale ?? rawQrel.rationale ?? null);
      if (query.split === "release" && rationale === null) {
        throw new Error(`${record.query_id}/${record.resource_id}: reviewed release qrel requires rationale`);
      }
      const { rationale: _rawRationale, ...rawWithoutRationale } = rawQrel;
      const reviewed = QrelRecordSchema.parse({
        ...rawWithoutRationale,
        grade: pairDecision.grade,
        judge: "reviewed_agent",
        ...(query.split === "release" ? { rationale } : {}),
        review_status: pairDecision.decision,
        reviewed_at: pairDecision.reviewed_at,
        reviewed_by: pairDecision.reviewer,
        owner_note: pairDecision.notes,
      });
      if (query.split === "release") releaseQrels.push(reviewed);
      else developmentQrels.push(reviewed);
    }
    reviewedCalibration.push(AgentCalibrationSchema.parse({
      ...record,
      owner_review: pairDecision.decision,
      reviewed_at: pairDecision.reviewed_at,
      notes: pairDecision.notes,
    }));
  }

  developmentQrels.sort((a, b) => pairKey(a.query_id, a.resource_id).localeCompare(pairKey(b.query_id, b.resource_id)));
  releaseQrels.sort((a, b) => pairKey(a.query_id, a.resource_id).localeCompare(pairKey(b.query_id, b.resource_id)));
  reviewedCalibration.sort((a, b) => pairKey(a.query_id, a.resource_id).localeCompare(pairKey(b.query_id, b.resource_id)));
  excludedPairs.sort((a, b) => pairKey(a.query_id, a.resource_id).localeCompare(pairKey(b.query_id, b.resource_id)));
  correctedPairs.sort((a, b) => pairKey(a.query_id, a.resource_id).localeCompare(pairKey(b.query_id, b.resource_id)));
  const report = OwnerReviewReportSchema.parse({
    version: 1,
    generated_at: generatedAt,
    source_hashes: {
      queries: gradingArtifactHash(queries),
      raw_qrels: gradingArtifactHash(qrels),
      raw_calibration: gradingArtifactHash(calibration),
      owner_decisions: gradingArtifactHash(decisions),
    },
    output_hashes: {
      development_qrels: gradingArtifactHash(developmentQrels),
      release_qrels: gradingArtifactHash(releaseQrels),
      reviewed_calibration: gradingArtifactHash(reviewedCalibration),
    },
    reviewers: [...new Set([
      ...decisions.query_decisions.map(decision => decision.reviewer),
      ...decisions.pair_decisions.map(decision => decision.reviewer),
    ])].sort(),
    pairs: decisionCounts(decisions.pair_decisions),
    queries: decisionCounts(decisions.query_decisions),
    reviewed_qrels_emitted: {
      development: developmentQrels.length,
      release: releaseQrels.length,
      total: developmentQrels.length + releaseQrels.length,
    },
    excluded_pairs: excludedPairs,
    corrected_pairs: correctedPairs,
    corrected_queries: decisions.query_decisions
      .filter(decision => decision.decision === "corrected")
      .map(decision => decision.query_id)
      .sort(),
    rejected_queries: decisions.query_decisions
      .filter(decision => decision.decision === "rejected")
      .map(decision => decision.query_id)
      .sort(),
  });
  const splitSummary = (split: "development" | "release", splitQrels: QrelRecord[]) => {
    const splitQueryIds = new Set(queries.filter(query => query.split === split).map(query => query.query_id));
    const pairDecisions = decisions.pair_decisions.filter(decision => splitQueryIds.has(decision.query_id));
    const queryDecisions = decisions.query_decisions.filter(decision => splitQueryIds.has(decision.query_id));
    return {
      query_count: splitQueryIds.size,
      qrel_count: splitQrels.length,
      qrels_hash: gradingArtifactHash(splitQrels),
      pair_set_hash: gradingPairSetHash(splitQrels),
      all_qrels_reviewed: true as const,
      all_release_rationales_present: split === "development" || splitQrels.every(qrel => Boolean(qrel.rationale?.trim())),
      pairs: decisionCounts(pairDecisions),
      queries: decisionCounts(queryDecisions),
    };
  };
  const publicSummary = OwnerReviewPublicSummarySchema.parse({
    version: 1,
    artifact: "owner-review-public-summary-v2",
    generated_at: generatedAt,
    full_report_hash: gradingArtifactHash(report),
    source_hashes: report.source_hashes,
    reviewers: report.reviewers,
    development: splitSummary("development", developmentQrels),
    release: splitSummary("release", releaseQrels),
    reviewed_calibration: {
      count: reviewedCalibration.length,
      artifact_hash: gradingArtifactHash(reviewedCalibration),
      all_rows_reviewed: true,
    },
  });
  return { developmentQrels, releaseQrels, reviewedCalibration, report, publicSummary };
}

export async function readJsonl(path: string): Promise<unknown[]> {
  const text = await readFile(path, "utf8");
  return text.split("\n").map(line => line.trim()).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${path}:${index + 1}: ${(error as Error).message}`);
    }
  });
}

/** Append-only artifact creation: existing paths are never overwritten. */
export async function writeArtifactExclusive(path: string, value: unknown, jsonl = false): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const content = jsonl
    ? `${(value as readonly unknown[]).map(record => JSON.stringify(record)).join("\n")}\n`
    : `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, content, { flag: "wx" });
}

export interface ArtifactWrite {
  path: string;
  value: unknown;
  jsonl?: boolean;
  text?: boolean;
}

/** Transactional exclusive creation for related artifacts: all paths are new, or none remain. */
export async function writeArtifactBundleExclusive(artifacts: readonly ArtifactWrite[]): Promise<void> {
  const paths = artifacts.map(artifact => artifact.path);
  assertUnique(paths, "artifact output path");
  for (const path of paths) await mkdir(dirname(path), { recursive: true });
  const opened: Array<{ path: string; handle: FileHandle }> = [];
  try {
    for (const artifact of artifacts) opened.push({ path: artifact.path, handle: await open(artifact.path, "wx") });
    for (let index = 0; index < artifacts.length; index++) {
      const artifact = artifacts[index]!;
      const content = artifact.text
        ? String(artifact.value)
        : artifact.jsonl
          ? `${(artifact.value as readonly unknown[]).map(record => JSON.stringify(record)).join("\n")}\n`
          : `${JSON.stringify(artifact.value, null, 2)}\n`;
      await opened[index]!.handle.writeFile(content);
      await opened[index]!.handle.sync();
    }
    await Promise.all(opened.map(item => item.handle.close()));
  } catch (error) {
    await Promise.all(opened.map(async item => {
      try { await item.handle.close(); } catch { /* best-effort cleanup */ }
      try { await unlink(item.path); } catch { /* do not mask the original error */ }
    }));
    throw error;
  }
}
