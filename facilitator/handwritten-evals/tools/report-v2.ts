/** Deterministic BUILD-PLAN §10 report composition over already-validated artifacts. */

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  NDCG_GAINS,
  POOL_SYSTEMS,
  QUERY_CLASSES,
  RELEVANCE_THRESHOLDS,
  type QrelRecord,
  type QueryRecord,
} from "../schema/schema-v2.js";
import {
  metricSelectors,
  pairedVectors,
  scoreRun,
  type QueryScore,
  type RunMetrics,
  type RunResult,
} from "./scoring.js";
import { compareRuns, type ComparisonReport } from "./significance.js";
import type { SystemRuns } from "./pool.js";

export type PoolSystem = typeof POOL_SYSTEMS[number];

const MeasuredAgentCostSchema = z.object({
  agent_runs: z.number().int().positive(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  wall_clock_seconds: z.number().nonnegative(),
  api_cost_usd: z.number().nonnegative(),
}).strict();

export const PilotReportEvidenceSchema = z.object({
  status: z.enum(["approved", "pass"]),
  pilot_scope: z.object({
    resources: z.literal(5),
    distractors: z.literal(10),
    capability_queries: z.literal(5),
    no_result_queries: z.literal(1),
    graders: z.literal(2),
    adjudicators: z.literal(1),
  }).strict(),
  judged_at_10_threshold: z.number().min(0).max(1),
  generation_grading_cost: MeasuredAgentCostSchema.extend({
    rejection_count: z.number().int().nonnegative(),
    regeneration_count: z.number().int().nonnegative(),
    owner_review_seconds: z.number().nonnegative(),
    owner_corrections: z.number().int().nonnegative(),
  }).strict(),
  forbidden_audit_cost: z.object({
    scanner_wall_clock_seconds: z.number().nonnegative(),
    agent_audit: MeasuredAgentCostSchema,
    owner_review_seconds: z.number().nonnegative(),
    projection: z.object({
      catalog_records: z.literal(1_000),
      capabilities: z.literal(10),
      agent_runs: z.number().int().positive(),
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
      api_cost_usd: z.number().nonnegative(),
      owner_review_seconds: z.number().nonnegative(),
    }).strict(),
  }).strict(),
}).strict();

export const LimitationsEvidenceSchema = z.object({
  status: z.enum(["approved", "pass"]),
  limitations: z.array(z.string().trim().min(1)).min(1),
}).strict();

export const OwnerRatesSchema = z.object({
  reviewed: z.number().int().nonnegative(),
  corrected: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  correction_rate: z.number().min(0).max(1),
  rejection_rate: z.number().min(0).max(1),
}).strict();

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const FiniteSchema = z.number().finite();
const RateSchema = FiniteSchema.min(0).max(1);
const MeanWithSupportSchema = z.object({
  value: FiniteSchema.nullable(),
  support: z.number().int().nonnegative(),
}).strict().superRefine((value, context) => {
  if ((value.value === null) !== (value.support === 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "null value must mean zero support" });
  }
});
const CutoffMeansSchema = z.object(Object.fromEntries([1, 3, 5, 10, 20]
  .map(cutoff => [String(cutoff), MeanWithSupportSchema])) as Record<"1" | "3" | "5" | "10" | "20", typeof MeanWithSupportSchema>).strict();
const CutoffCountsSchema = z.object(Object.fromEntries([1, 3, 5, 10, 20]
  .map(cutoff => [String(cutoff), z.number().int().nonnegative()])) as Record<"1" | "3" | "5" | "10" | "20", z.ZodNumber>).strict();
const ClassMetricsSchema = z.object({
  queries: z.number().int().positive(),
  rankingQueries: z.number().int().nonnegative(),
  ndcg: CutoffMeansSchema,
  recall: CutoffMeansSchema,
  judged: CutoffMeansSchema,
  violations: CutoffCountsSchema,
  mrr: MeanWithSupportSchema,
  bpref: MeanWithSupportSchema,
  noResultAccuracy: RateSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.rankingQueries > value.queries) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["rankingQueries"], message: "cannot exceed queries" });
  }
});
const ReportedSystemSchema = z.object({
  primary: z.object({
    ndcg_at_10: MeanWithSupportSchema,
    judged_at_10: MeanWithSupportSchema,
    mrr: MeanWithSupportSchema,
    bpref: MeanWithSupportSchema,
  }).strict(),
  secondary: z.object({
    recall_at_20: MeanWithSupportSchema,
    violations_at_10: z.number().int().nonnegative(),
    no_result_accuracy: RateSchema.nullable(),
    has_result_rate: RateSchema.nullable(),
    latency_ms: z.object({
      p50: FiniteSchema.nonnegative().nullable(),
      p95: FiniteSchema.nonnegative().nullable(),
      p99: FiniteSchema.nonnegative().nullable(),
      mean: FiniteSchema.nonnegative().nullable(),
    }).strict(),
  }).strict(),
  by_query_class: z.record(z.enum(QUERY_CLASSES), ClassMetricsSchema),
}).strict();

const ConfidenceIntervalSchema = z.object({
  point: FiniteSchema,
  lower: FiniteSchema,
  upper: FiniteSchema,
  level: RateSchema,
  iterations: z.number().int().positive(),
  n: z.number().int().positive(),
  bias: FiniteSchema,
  standardError: FiniteSchema.nonnegative(),
}).strict().superRefine((value, context) => {
  if (value.lower > value.upper) context.addIssue({ code: z.ZodIssueCode.custom, path: ["lower"], message: "must not exceed upper" });
});
const ComparisonReportSchema = z.object({
  metric: z.string().min(1),
  n: z.number().int().positive(),
  baselineMean: FiniteSchema,
  candidateMean: FiniteSchema,
  baselineCI: ConfidenceIntervalSchema,
  candidateCI: ConfidenceIntervalSchema,
  difference: ConfidenceIntervalSchema,
  permutation: z.object({
    observedDiff: FiniteSchema,
    meanBaseline: FiniteSchema,
    meanCandidate: FiniteSchema,
    pValue: RateSchema,
    n: z.number().int().positive(),
    exact: z.boolean(),
    iterations: z.number().int().nonnegative(),
    alternative: z.enum(["two-sided", "greater", "less"]),
    ties: z.number().int().nonnegative(),
  }).strict(),
  significant: z.boolean(),
  alpha: RateSchema,
  summary: z.string().min(1),
}).strict().superRefine((value, context) => {
  const supports = [value.baselineCI.n, value.candidateCI.n, value.difference.n, value.permutation.n];
  if (supports.some(support => support !== value.n)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["n"], message: "all paired supports must match" });
  }
  const expectedSignificance = value.permutation.pValue < value.alpha
    && (value.difference.lower > 0 || value.difference.upper < 0);
  if (value.significant !== expectedSignificance) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["significant"], message: `must equal ${expectedSignificance}` });
  }
});
const MetricComparisonsSchema = z.object({
  ndcg_at_10: ComparisonReportSchema,
  mrr: ComparisonReportSchema,
  bpref: ComparisonReportSchema,
}).strict();

const EvaluationReportCoreV2Schema = z.object({
  schema_version: z.literal("2.0.0"),
  generated_at: z.string().datetime(),
  split: z.enum(["development", "release"]),
  dataset_manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  input_hashes: z.object({
    qrels: Sha256Schema,
    system_runs: z.object(Object.fromEntries(POOL_SYSTEMS.map(system => [system, Sha256Schema])) as {
      [K in PoolSystem]: typeof Sha256Schema;
    }).strict(),
  }).strict(),
  query_count: z.literal(50),
  qrel_count: z.number().int().nonnegative(),
  baseline: z.enum(POOL_SYSTEMS),
  relevance_thresholds: z.object({
    mrr: z.literal(RELEVANCE_THRESHOLDS.mrr),
    recall_at_k: z.literal(RELEVANCE_THRESHOLDS.recall_at_k),
    bpref: z.literal(RELEVANCE_THRESHOLDS.bpref),
    judged_at_k: z.literal(RELEVANCE_THRESHOLDS.judged_at_k),
  }).strict(),
  ndcg_gains: z.tuple([
    z.literal(NDCG_GAINS[0]), z.literal(NDCG_GAINS[1]),
    z.literal(NDCG_GAINS[2]), z.literal(NDCG_GAINS[3]),
  ]),
  systems: z.object(Object.fromEntries(POOL_SYSTEMS.map(system => [system, ReportedSystemSchema])) as {
    [K in PoolSystem]: typeof ReportedSystemSchema;
  }).strict(),
  significance: z.record(MetricComparisonsSchema),
  significance_reported: z.literal(true),
  bm25_baseline: z.literal(true),
  judged_at_10: z.object({
    pilot_derived_threshold: z.number().min(0).max(1).nullable(),
    minimum_observed: z.number().min(0).max(1).nullable(),
    gate_passed: z.boolean(),
  }).strict(),
  judged_at_10_gate_passed: z.boolean(),
  owner_rates: OwnerRatesSchema.nullable(),
  owner_rates_reported: z.boolean(),
  limitations: z.array(z.string().trim().min(1)).min(1),
}).strict();

function validateReportContract(value: {
  split: "development" | "release";
  baseline: PoolSystem;
  qrel_count: number;
  systems: Record<string, z.infer<typeof ReportedSystemSchema>>;
  significance: Record<string, z.infer<typeof MetricComparisonsSchema>>;
  judged_at_10: { pilot_derived_threshold: number | null; minimum_observed: number | null; gate_passed: boolean };
  judged_at_10_gate_passed: boolean;
}, context: z.RefinementCtx): void {
  if (value.split === "release" && value.judged_at_10.pilot_derived_threshold === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["judged_at_10", "pilot_derived_threshold"], message: "release report requires pilot threshold" });
  }
  if (value.split === "release" && value.qrel_count === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["qrel_count"], message: "release report requires judged pairs" });
  }
  const expectedComparisons = POOL_SYSTEMS.filter(system => system !== value.baseline).sort();
  if (Object.keys(value.significance).sort().join("\n") !== expectedComparisons.join("\n")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["significance"], message: "must compare every non-baseline system exactly once" });
  }
  for (const [system, report] of Object.entries(value.systems)) {
    for (const [metric, result] of Object.entries(report.primary)) {
      if (result.support === 0) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["systems", system, "primary", metric], message: "primary metric requires positive support" });
      }
    }
  }
  const expected = value.judged_at_10.pilot_derived_threshold !== null
    && value.judged_at_10.minimum_observed !== null
    && value.judged_at_10.minimum_observed >= value.judged_at_10.pilot_derived_threshold;
  if (value.judged_at_10.gate_passed !== expected || value.judged_at_10_gate_passed !== expected) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["judged_at_10_gate_passed"], message: "judged@10 gate must be derived from minimum and pilot threshold" });
  }
}

export const EvaluationReportDraftV2Schema = EvaluationReportCoreV2Schema.extend({
  status: z.literal("draft_pending_owner_review"),
}).strict().superRefine(validateReportContract);

export const EvaluationReportOwnerSignoffSchema = z.object({
  version: z.literal(1),
  decision: z.literal("approved"),
  draft_report_hash: Sha256Schema,
  reviewer: z.string().min(1),
  reviewed_at: z.string().datetime(),
  rationale: z.string().min(1).max(2_000),
  limitations_acknowledged: z.literal(true),
}).strict();

/** Only this owner-approved shape may occupy a completed release-report path. */
export const EvaluationReportV2Schema = EvaluationReportCoreV2Schema.extend({
  status: z.literal("approved"),
  owner_signoff: EvaluationReportOwnerSignoffSchema,
}).strict().superRefine(validateReportContract);

export interface SystemRun {
  system: PoolSystem;
  results: RunResult[];
}

/** Adapts the canonical Step 7 run records to the scorer without changing rank order. */
export function scoringRunsFromPoolRuns(
  runs: SystemRuns,
  queryIds: ReadonlySet<string>,
): SystemRun[] {
  return POOL_SYSTEMS.map(system => ({
    system,
    results: runs[system]
      .filter(record => queryIds.has(record.query_id))
      .sort((left, right) => left.query_id.localeCompare(right.query_id))
      .map(record => ({
        queryId: record.query_id,
        latencyMs: record.latency_ms,
        ranking: [...record.results]
          .sort((left, right) => left.rank - right.rank)
          .map(result => result.resource_id),
      })),
  }));
}

export interface OwnerRates {
  reviewed: number;
  corrected: number;
  rejected: number;
  correction_rate: number;
  rejection_rate: number;
}

export interface BuildReportOptions {
  split: "development" | "release";
  generatedAt: string;
  datasetManifestSha256: string;
  baseline?: PoolSystem;
  pilotJudgedAt10Threshold?: number;
  ownerRates?: OwnerRates;
  limitations: string[];
  /** Resource ids whose sidecars carry a non-null adversarial_kind. */
  plantedNegativeResourceIds: ReadonlySet<string>;
  significanceIterations?: number;
}

export interface ReportedSystem {
  primary: {
    ndcg_at_10: RunMetrics["ndcg"][number];
    judged_at_10: RunMetrics["judged"][number];
    mrr: RunMetrics["mrr"];
    bpref: RunMetrics["bpref"];
  };
  secondary: {
    recall_at_20: RunMetrics["recall"][number];
    violations_at_10: number;
    no_result_accuracy: number | null;
    has_result_rate: number | null;
    latency_ms: RunMetrics["latency"];
  };
  by_query_class: RunMetrics["byClass"];
}

export interface EvaluationReportDraftV2 {
  schema_version: "2.0.0";
  status: "draft_pending_owner_review";
  generated_at: string;
  split: "development" | "release";
  dataset_manifest_sha256: string;
  input_hashes: {
    qrels: string;
    system_runs: Record<PoolSystem, string>;
  };
  query_count: number;
  qrel_count: number;
  baseline: PoolSystem;
  relevance_thresholds: typeof RELEVANCE_THRESHOLDS;
  ndcg_gains: typeof NDCG_GAINS;
  systems: Record<PoolSystem, ReportedSystem>;
  significance: Record<string, Record<string, ComparisonReport>>;
  significance_reported: true;
  bm25_baseline: true;
  judged_at_10: {
    pilot_derived_threshold: number | null;
    minimum_observed: number | null;
    gate_passed: boolean;
  };
  judged_at_10_gate_passed: boolean;
  owner_rates: OwnerRates | null;
  owner_rates_reported: boolean;
  limitations: string[];
}

export type EvaluationReportV2 = Omit<EvaluationReportDraftV2, "status"> & {
  status: "approved";
  owner_signoff: z.infer<typeof EvaluationReportOwnerSignoffSchema>;
};

function canonicalHashValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalHashValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalHashValue(child)]));
  }
  return value;
}

export function reportArtifactHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalHashValue(value))).digest("hex")}`;
}

export function evaluationInputHashes(
  queries: readonly QueryRecord[],
  qrels: readonly QrelRecord[],
  runs: readonly SystemRun[],
  split: "development" | "release",
): EvaluationReportDraftV2["input_hashes"] {
  const selectedIds = new Set(queries.filter(query => query.split === split).map(query => query.query_id));
  const selectedQrels = qrels.filter(qrel => selectedIds.has(qrel.query_id))
    .sort((left, right) => `${left.query_id}\0${left.resource_id}`.localeCompare(`${right.query_id}\0${right.resource_id}`));
  const systemRuns = Object.fromEntries(POOL_SYSTEMS.map(system => {
    const run = runs.find(value => value.system === system);
    const results = (run?.results ?? []).filter(result => selectedIds.has(result.queryId))
      .sort((left, right) => left.queryId.localeCompare(right.queryId));
    return [system, reportArtifactHash(results)];
  })) as Record<PoolSystem, string>;
  return { qrels: reportArtifactHash(selectedQrels), system_runs: systemRuns };
}

/** Converts a preserved draft into a distinct approved artifact; the draft is never overwritten. */
export function finalizeEvaluationReport(
  rawDraft: unknown,
  rawSignoff: unknown,
): EvaluationReportV2 {
  const draft = EvaluationReportDraftV2Schema.parse(rawDraft) as EvaluationReportDraftV2;
  const signoff = EvaluationReportOwnerSignoffSchema.parse(rawSignoff);
  if (signoff.draft_report_hash !== reportArtifactHash(draft)) {
    throw new Error("owner signoff draft_report_hash does not match the preserved draft");
  }
  const { status: _draftStatus, ...core } = draft;
  return EvaluationReportV2Schema.parse({
    ...core,
    status: "approved",
    owner_signoff: signoff,
  }) as EvaluationReportV2;
}

function assertIsoDate(value: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`generatedAt is not an ISO datetime: ${value}`);
}

function assertOwnerRates(value: OwnerRates): void {
  for (const key of ["reviewed", "corrected", "rejected"] as const) {
    if (!Number.isInteger(value[key]) || value[key] < 0) throw new Error(`ownerRates.${key} must be a non-negative integer`);
  }
  if (value.corrected + value.rejected > value.reviewed) {
    throw new Error("ownerRates corrected + rejected cannot exceed reviewed");
  }
  const correctionRate = value.reviewed === 0 ? 0 : value.corrected / value.reviewed;
  const rejectionRate = value.reviewed === 0 ? 0 : value.rejected / value.reviewed;
  if (Math.abs(value.correction_rate - correctionRate) > 1e-12) throw new Error("ownerRates.correction_rate mismatch");
  if (Math.abs(value.rejection_rate - rejectionRate) > 1e-12) throw new Error("ownerRates.rejection_rate mismatch");
}

function validateInputs(
  queries: readonly QueryRecord[],
  qrels: readonly QrelRecord[],
  runs: readonly SystemRun[],
  options: BuildReportOptions,
): QueryRecord[] {
  assertIsoDate(options.generatedAt);
  if (!/^[a-f0-9]{64}$/.test(options.datasetManifestSha256)) {
    throw new Error("datasetManifestSha256 must be a 64-character lowercase SHA-256 digest");
  }
  if (options.limitations.length === 0 || options.limitations.some(value => value.trim().length === 0)) {
    throw new Error("at least one non-empty limitation is required");
  }
  if (options.pilotJudgedAt10Threshold !== undefined
    && (!Number.isFinite(options.pilotJudgedAt10Threshold)
      || options.pilotJudgedAt10Threshold < 0 || options.pilotJudgedAt10Threshold > 1)) {
    throw new Error("pilotJudgedAt10Threshold must be in [0,1]");
  }
  if (options.ownerRates) assertOwnerRates(options.ownerRates);

  const selected = queries.filter(query => query.split === options.split);
  const expectedCount = 50;
  if (selected.length !== expectedCount) {
    throw new Error(`${options.split} report requires exactly ${expectedCount} queries; found ${selected.length}`);
  }
  const queryIds = selected.map(query => query.query_id);
  if (new Set(queryIds).size !== queryIds.length) throw new Error("duplicate query_id in selected split");
  const selectedIds = new Set(queryIds);

  const systems = runs.map(run => run.system);
  if (systems.length !== POOL_SYSTEMS.length || new Set(systems).size !== POOL_SYSTEMS.length
    || POOL_SYSTEMS.some(system => !systems.includes(system))) {
    throw new Error(`runs must contain each system exactly once: ${POOL_SYSTEMS.join(", ")}`);
  }
  for (const run of runs) {
    const ids = run.results.map(result => result.queryId);
    if (ids.length !== selected.length || new Set(ids).size !== ids.length
      || ids.some(id => !selectedIds.has(id)) || queryIds.some(id => !ids.includes(id))) {
      throw new Error(`${run.system} run must contain every ${options.split} query exactly once`);
    }
    for (const result of run.results) {
      if (new Set(result.ranking).size !== result.ranking.length) {
        throw new Error(`${run.system}/${result.queryId}: duplicate resource in ranking`);
      }
    }
  }

  const qrelPairs = new Set<string>();
  for (const qrel of qrels.filter(row => selectedIds.has(row.query_id))) {
    const pair = `${qrel.query_id}\0${qrel.resource_id}`;
    if (qrelPairs.has(pair)) throw new Error(`duplicate qrel pair ${qrel.query_id}/${qrel.resource_id}`);
    qrelPairs.add(pair);
    if (options.split === "release" && (qrel.judge !== "reviewed_agent" || !qrel.rationale?.trim())) {
      throw new Error(`release qrel ${qrel.query_id}/${qrel.resource_id} is not owner-reviewed with a rationale`);
    }
  }
  if (options.split === "release") {
    if (options.pilotJudgedAt10Threshold === undefined) throw new Error("release report requires the pilot-derived judged@10 threshold");
    if (!options.ownerRates || options.ownerRates.reviewed === 0) throw new Error("release report requires non-empty owner review rates");
  }
  return selected;
}

function reportSystem(metrics: RunMetrics): ReportedSystem {
  return {
    primary: {
      ndcg_at_10: metrics.ndcg[10]!,
      judged_at_10: metrics.judged[10]!,
      mrr: metrics.mrr,
      bpref: metrics.bpref,
    },
    secondary: {
      recall_at_20: metrics.recall[20]!,
      violations_at_10: metrics.violations[10]!,
      no_result_accuracy: metrics.noResult.accuracy,
      has_result_rate: metrics.hasResultRate,
      latency_ms: metrics.latency,
    },
    by_query_class: metrics.byClass,
  };
}

function significanceFor(
  baseline: readonly QueryScore[],
  candidate: readonly QueryScore[],
  candidateName: string,
  iterations: number,
): Record<string, ComparisonReport> {
  const selectors = {
    ndcg_at_10: metricSelectors.ndcgAt(10),
    mrr: metricSelectors.mrr(),
    bpref: metricSelectors.bpref(),
  };
  return Object.fromEntries(Object.entries(selectors).map(([metric, selector], index) => {
    const paired = pairedVectors(baseline, candidate, selector);
    return [metric, compareRuns(paired.a, paired.b, {
      metric: `${candidateName} vs baseline ${metric}`,
      iterations,
      seed: 0x5eed + index,
    })];
  }));
}

export function buildEvaluationReport(
  queries: readonly QueryRecord[],
  qrels: readonly QrelRecord[],
  runs: readonly SystemRun[],
  options: BuildReportOptions,
): EvaluationReportDraftV2 {
  const selected = validateInputs(queries, qrels, runs, options);
  const selectedIds = new Set(selected.map(query => query.query_id));
  const selectedQrels = qrels.filter(qrel => selectedIds.has(qrel.query_id));
  const judgments = new Map<string, Array<{ resourceId: string; grade: number }>>();
  for (const qrel of selectedQrels) {
    const bucket = judgments.get(qrel.query_id) ?? [];
    bucket.push({
      resourceId: qrel.resource_id,
      grade: qrel.grade,
      isPlantedNegative: options.plantedNegativeResourceIds.has(qrel.resource_id),
    });
    judgments.set(qrel.query_id, bucket);
  }
  const evalQueries = selected.map(query => ({
    queryId: query.query_id,
    queryClass: query.query_class,
    expectsNoResult: query.expects_no_result,
    judgments: judgments.get(query.query_id) ?? [],
  }));

  const scored = new Map<PoolSystem, ReturnType<typeof scoreRun>>();
  for (const run of runs) scored.set(run.system, scoreRun(evalQueries, run.results));
  const systems = Object.fromEntries(POOL_SYSTEMS.map(system => [
    system,
    reportSystem(scored.get(system)!.metrics),
  ])) as Record<PoolSystem, ReportedSystem>;

  const baseline = options.baseline ?? "lexical";
  const baselineScores = scored.get(baseline)?.perQuery;
  if (!baselineScores) throw new Error(`baseline system is absent: ${baseline}`);
  const significance = Object.fromEntries(POOL_SYSTEMS
    .filter(system => system !== baseline)
    .map(system => [system, significanceFor(
      baselineScores,
      scored.get(system)!.perQuery,
      system,
      options.significanceIterations ?? 10_000,
    )]));

  const observed = POOL_SYSTEMS
    .map(system => systems[system].primary.judged_at_10.value)
    .filter((value): value is number => value !== null);
  const minimumObserved = observed.length === 0 ? null : Math.min(...observed);
  const threshold = options.pilotJudgedAt10Threshold ?? null;
  const judgedGatePassed = threshold !== null && minimumObserved !== null && minimumObserved >= threshold;

  const report: EvaluationReportDraftV2 = {
    schema_version: "2.0.0",
    status: "draft_pending_owner_review",
    generated_at: options.generatedAt,
    split: options.split,
    dataset_manifest_sha256: options.datasetManifestSha256,
    input_hashes: evaluationInputHashes(queries, qrels, runs, options.split),
    query_count: selected.length,
    qrel_count: selectedQrels.length,
    baseline,
    relevance_thresholds: RELEVANCE_THRESHOLDS,
    ndcg_gains: NDCG_GAINS,
    systems,
    significance,
    significance_reported: true,
    bm25_baseline: true,
    judged_at_10: {
      pilot_derived_threshold: threshold,
      minimum_observed: minimumObserved,
      gate_passed: judgedGatePassed,
    },
    judged_at_10_gate_passed: judgedGatePassed,
    owner_rates: options.ownerRates ?? null,
    owner_rates_reported: options.ownerRates !== undefined,
    limitations: [...options.limitations],
  };
  EvaluationReportDraftV2Schema.parse(report);
  return report;
}
