import { aggregate, scoreQuery, type EvalQuery, type QueryMetrics, type SuiteMetrics } from "../evaluate.js";
import type {
  EcosystemJudgment,
  EcosystemOutcome,
  EcosystemQuery,
  EcosystemRecommendationRun,
  EcosystemResource,
} from "./schema.js";

export interface EcosystemQueryEvaluation {
  query_id: string;
  metrics: QueryMetrics;
  selected_resource_id?: string;
  outcome?: EcosystemOutcome;
}

export interface EcosystemOutcomeMetrics {
  attempted: number;
  selected: number;
  payment_verification_rate: number;
  settlement_rate: number;
  invocation_rate: number;
  response_valid_rate: number;
  task_success_rate: number;
  mean_latency_ms: number;
  p95_latency_ms: number;
  mean_cost_usd: number;
  failure_reasons: Record<string, number>;
}

export interface EcosystemEvaluationReport {
  benchmark: "x402-ecosystem-v1";
  catalog_size: number;
  queries: number;
  judgments: number;
  recommendation_rows: number;
  relevance: SuiteMetrics;
  operational: EcosystemOutcomeMetrics;
  hard_constraint_violations: number;
  unsafe_recommendations: number;
  provider_concentration_at_5: number;
  cold_start_top_5_share: number;
  unjudged_top_5: number;
  by_query_class: Record<string, { queries: number; evaluable_queries: number; nDCG_at_5: number; task_success_rate: number }>;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]!;
}

function rate(values: Array<boolean | null | undefined>): number {
  const observed = values.filter((value): value is boolean => value !== null && value !== undefined);
  return observed.length === 0 ? 0 : observed.filter(Boolean).length / observed.length;
}

function toEvalQuery(query: EcosystemQuery, judgments: EcosystemJudgment[]): EvalQuery {
  return {
    query: query.text,
    queryClass: query.query_class,
    filters: Object.fromEntries(Object.entries(query.filters).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : String(value)])),
    notes: query.query_id,
    evidence: judgments.length === 0 && !query.expects_no_result ? "none" : "pooled",
    expectsNoResult: query.expects_no_result,
    judgments: judgments.map(judgment => ({
      resource: judgment.resource_id,
      grade: judgment.relevance_grade,
      ...(judgment.rationale ? { rationale: judgment.rationale } : {}),
    })),
  };
}

function operationalMetrics(outcomes: EcosystemOutcome[]): EcosystemOutcomeMetrics {
  const attempted = outcomes.filter(value => value.attempted);
  const selected = outcomes.filter(value => value.selected);
  const failureReasons: Record<string, number> = {};
  for (const outcome of attempted) {
    if (outcome.failure_reason) failureReasons[outcome.failure_reason] = (failureReasons[outcome.failure_reason] ?? 0) + 1;
  }
  const latencies = attempted.flatMap(value => value.latency_ms === undefined ? [] : [value.latency_ms]);
  const costs = attempted.flatMap(value => value.total_cost_usd === undefined ? [] : [value.total_cost_usd]);
  return {
    attempted: attempted.length,
    selected: selected.length,
    payment_verification_rate: rate(attempted.map(value => value.payment_verification === "pass")),
    settlement_rate: rate(attempted.map(value => value.settlement === "pass")),
    invocation_rate: rate(attempted.map(value => value.invocation === "pass")),
    response_valid_rate: rate(attempted.map(value => value.response_valid)),
    task_success_rate: rate(attempted.map(value => value.task_success)),
    mean_latency_ms: mean(latencies),
    p95_latency_ms: percentile(latencies, 0.95),
    mean_cost_usd: mean(costs),
    failure_reasons: failureReasons,
  };
}

function selectedOutcome(outcomes: EcosystemOutcome[], run: EcosystemRecommendationRun): EcosystemOutcome | undefined {
  const selected = run.selected_resource_id ?? run.ranked_resource_ids[0];
  return selected ? outcomes.find(value => value.query_id === run.query_id && value.resource_id === selected) : undefined;
}

/**
 * Score a recommendation run against partial pooled judgments and observed
 * paid-call outcomes. This is deliberately independent from the database
 * search harness so external catalogs can be evaluated without pretending
 * their foreign wire data is a local verified catalog.
 */
export function evaluateEcosystemRun(
  resources: EcosystemResource[],
  queries: EcosystemQuery[],
  judgments: EcosystemJudgment[],
  runs: EcosystemRecommendationRun[],
  outcomes: EcosystemOutcome[] = [],
): EcosystemEvaluationReport {
  const resourceIds = new Set(resources.map(value => value.resource_id));
  const judgmentsByQuery = new Map<string, EcosystemJudgment[]>();
  for (const judgment of judgments) {
    const bucket = judgmentsByQuery.get(judgment.query_id) ?? [];
    bucket.push(judgment);
    judgmentsByQuery.set(judgment.query_id, bucket);
  }
  const runByQuery = new Map(runs.map(value => [value.query_id, value]));
  const resultRows: Array<{ query: EvalQuery; metrics: QueryMetrics; degraded: Record<string, unknown> }> = [];
  const queryEvaluations: EcosystemQueryEvaluation[] = [];
  for (const query of queries) {
    const run = runByQuery.get(query.query_id) ?? { query_id: query.query_id, ranked_resource_ids: [] };
    const ranked = run.ranked_resource_ids.filter(resourceId => resourceIds.has(resourceId));
    const evalQuery = toEvalQuery(query, judgmentsByQuery.get(query.query_id) ?? []);
    const metrics = scoreQuery(evalQuery, ranked, run.latency_ms ?? 0);
    resultRows.push({ query: evalQuery, metrics, degraded: {} });
    const outcome = selectedOutcome(outcomes, run);
    queryEvaluations.push({
      query_id: query.query_id,
      metrics,
      ...(run.selected_resource_id ? { selected_resource_id: run.selected_resource_id } : {}),
      ...(outcome ? { outcome } : {}),
    });
  }

  const catalogById = new Map(resources.map(value => [value.resource_id, value]));
  const judgmentByPair = new Map(judgments.map(value => [`${value.query_id}\0${value.resource_id}`, value]));
  let hardConstraintViolations = 0;
  let unsafeRecommendations = 0;
  const providers = new Map<string, number>();
  let topFive = 0;
  let coldStartTopFive = 0;
  let unjudgedTopFive = 0;
  for (const evaluation of queryEvaluations) {
    for (const resourceId of runByQuery.get(evaluation.query_id)?.ranked_resource_ids.slice(0, 5) ?? []) {
      const resource = catalogById.get(resourceId);
      if (!resource) continue;
      topFive += 1;
      providers.set(resource.canonical_origin, (providers.get(resource.canonical_origin) ?? 0) + 1);
      if (resource.quality.transaction_volume_30d === undefined || resource.quality.transaction_volume_30d === 0) coldStartTopFive += 1;
      if (resource.status === "unsafe" || resource.operational.safety === "fail") unsafeRecommendations += 1;
      const judgment = judgmentByPair.get(`${evaluation.query_id}\0${resourceId}`);
      if (!judgment) unjudgedTopFive += 1;
      if (judgment && judgment.eligibility !== "eligible") hardConstraintViolations += 1;
    }
  }

  type ClassAccumulator = { queries: number; evaluable: number; nDCG_at_5: number[]; task_success: Array<boolean | null | undefined> };
  const byClass: Record<string, ClassAccumulator> = {};
  for (const query of queries) {
    const current = byClass[query.query_class] ??= { queries: 0, evaluable: 0, nDCG_at_5: [], task_success: [] };
    const evaluation = queryEvaluations.find(value => value.query_id === query.query_id)!;
    current.queries += 1;
    if (evaluation.metrics.evaluable) {
      current.evaluable += 1;
      current.nDCG_at_5.push(evaluation.metrics.ndcg[5] ?? 0);
    }
    current.task_success.push(evaluation.outcome?.task_success);
  }
  const normalizedByClass = Object.fromEntries(Object.entries(byClass).map(([key, value]) => {
    return [key, { queries: value.queries, evaluable_queries: value.evaluable, nDCG_at_5: mean(value.nDCG_at_5), task_success_rate: rate(value.task_success) }];
  }));

  return {
    benchmark: "x402-ecosystem-v1",
    catalog_size: resources.length,
    queries: queries.length,
    judgments: judgments.length,
    recommendation_rows: runs.length,
    relevance: aggregate(resultRows, resources.length),
    operational: operationalMetrics(outcomes),
    hard_constraint_violations: hardConstraintViolations,
    unsafe_recommendations: unsafeRecommendations,
    provider_concentration_at_5: topFive === 0 ? 0 : Math.max(...providers.values()) / topFive,
    cold_start_top_5_share: topFive === 0 ? 0 : coldStartTopFive / topFive,
    unjudged_top_5: unjudgedTopFive,
    by_query_class: normalizedByClass,
  };
}
