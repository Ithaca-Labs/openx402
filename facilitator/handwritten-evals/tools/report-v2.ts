/** Deterministic BUILD-PLAN §10 report composition over already-validated artifacts. */

import { z } from "zod";
import {
  NDCG_GAINS,
  POOL_SYSTEMS,
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

export const EvaluationReportV2Schema = z.object({
  schema_version: z.literal("2.0.0"),
  status: z.literal("draft_pending_owner_review"),
  generated_at: z.string().datetime(),
  split: z.enum(["development", "release"]),
  dataset_manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/),
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
  systems: z.object(Object.fromEntries(POOL_SYSTEMS.map(system => [system, z.unknown()])) as {
    [K in PoolSystem]: z.ZodUnknown;
  }).strict(),
  significance: z.record(z.record(z.unknown())),
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
  complete_metrics: RunMetrics;
}

export interface EvaluationReportV2 {
  schema_version: "2.0.0";
  status: "draft_pending_owner_review";
  generated_at: string;
  split: "development" | "release";
  dataset_manifest_sha256: string;
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
    complete_metrics: metrics,
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
): EvaluationReportV2 {
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

  const report: EvaluationReportV2 = {
    schema_version: "2.0.0",
    status: "draft_pending_owner_review",
    generated_at: options.generatedAt,
    split: options.split,
    dataset_manifest_sha256: options.datasetManifestSha256,
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
  EvaluationReportV2Schema.parse(report);
  return report;
}
