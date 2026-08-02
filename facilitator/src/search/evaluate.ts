/**
 * Retrieval evaluation.
 *
 * Metrics are computed against a versioned golden set of graded judgments.
 * Recall is the primary gate: an agent picks from the first few results, so a
 * relevant resource that is not in the top k might as well not exist.
 */

export interface Judgment {
  /** Fixture resource id, resolved to a catalog resource key by the harness. */
  resource: string;
  /** 0 = must not rank, 1 = marginal, 2 = relevant, 3 = ideal. */
  grade: number;
  rationale?: string;
}

export interface EvalQuery {
  query: string;
  queryClass: string;
  filters?: Record<string, string>;
  notes?: string;
  judgments: Judgment[];
  /** Whether judgments cover the whole catalog, a candidate pool, or nothing. */
  evidence?: "complete" | "pooled" | "none";
  /** Explicit no-result intent; absence must not be inferred from missing judgments. */
  expectsNoResult?: boolean;
}

export interface EvalSuite {
  name: string;
  description?: string;
  /** Seller declarations to catalog before running the suite. */
  resources: Array<Record<string, unknown>>;
  queries: EvalQuery[];
}

export interface QueryMetrics {
  recall: Record<number, number>;
  precision: Record<number, number>;
  mrr: number;
  ndcg: Record<number, number>;
  /** Grade-0 judgments that appeared in the top k. Lower is better. */
  violations: Record<number, number>;
  returned: number;
  hasResult: boolean;
  /** Correctly returned nothing for a query with no relevant resource, or returned something otherwise. */
  noResultCorrect: boolean;
  latencyMs: number;
  evaluable: boolean;
  unjudgedReturned: Record<number, number>;
}

export const DEFAULT_CUTOFFS = [1, 3, 5, 10, 20] as const;
/** A judgment at or above this grade counts as relevant for recall and MRR. */
export const RELEVANT_GRADE = 2;

function dcg(grades: number[]): number {
  return grades.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
}

export function scoreQuery(
  query: EvalQuery,
  rankedResourceKeys: string[],
  latencyMs: number,
  cutoffs: readonly number[] = DEFAULT_CUTOFFS,
): QueryMetrics {
  const graded = new Map(query.judgments.map(entry => [entry.resource, entry.grade]));
  const relevant = query.judgments.filter(entry => entry.grade >= RELEVANT_GRADE);
  const relevantKeys = new Set(relevant.map(entry => entry.resource));

  const recall: Record<number, number> = {};
  const precision: Record<number, number> = {};
  const ndcg: Record<number, number> = {};
  const violations: Record<number, number> = {};
  const unjudgedReturned: Record<number, number> = {};

  const idealGrades = query.judgments.map(entry => entry.grade).sort((left, right) => right - left);

  for (const k of cutoffs) {
    const head = rankedResourceKeys.slice(0, k);
    const hits = head.filter(key => relevantKeys.has(key)).length;
    recall[k] = relevantKeys.size === 0 ? 1 : hits / relevantKeys.size;
    // Standard precision@k always divides by k. Short result pages do not get
    // an inflated score (in particular Precision@5 always has denominator 5).
    precision[k] = hits / k;
    const idealAtK = dcg(idealGrades.slice(0, k));
    ndcg[k] = idealAtK === 0 ? 1 : dcg(head.map(key => graded.get(key) ?? 0)) / idealAtK;
    // A grade-0 judgment is an explicit "this must not rank for this query".
    violations[k] = head.filter(key => graded.get(key) === 0).length;
    unjudgedReturned[k] = head.filter(key => !graded.has(key)).length;
  }

  const firstRelevant = rankedResourceKeys.findIndex(key => relevantKeys.has(key));
  const expectsResult = query.expectsNoResult === undefined
    ? relevantKeys.size > 0
    : !query.expectsNoResult;
  return {
    recall,
    precision,
    ndcg,
    violations,
    mrr: firstRelevant === -1 ? 0 : 1 / (firstRelevant + 1),
    returned: rankedResourceKeys.length,
    hasResult: rankedResourceKeys.length > 0,
    noResultCorrect: expectsResult ? rankedResourceKeys.length > 0 : rankedResourceKeys.length === 0,
    latencyMs,
    evaluable: (query.evidence ?? "complete") !== "none",
    unjudgedReturned,
  };
}

export interface SuiteMetrics {
  queries: number;
  evaluableQueries: number;
  /** Queries with at least one grade-2-or-higher judgment. */
  rankingQueries: number;
  recall: Record<number, number>;
  precision: Record<number, number>;
  ndcg: Record<number, number>;
  violations: Record<number, number>;
  mrr: number;
  noResultRate: number;
  noResultAccuracy: number;
  latency: { p50: number; p95: number; p99: number; mean: number };
  byClass: Record<string, { queries: number; rankingQueries: number; recall: Record<number, number>; mrr: number }>;
  fallbacks: Record<string, number>;
  catalogSize: number;
  /** Fraction of returned top-k resources absent from the judgment evidence. */
  unjudgedRate: Record<number, number>;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index]!;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function aggregate(
  results: Array<{ query: EvalQuery; metrics: QueryMetrics; degraded: Record<string, unknown> }>,
  catalogSize: number,
  cutoffs: readonly number[] = DEFAULT_CUTOFFS,
): SuiteMetrics {
  // Queries whose expected outcome is an empty result set are evaluated by
  // noResultAccuracy. Including them in retrieval metrics would assign perfect
  // recall/nDCG to returning nothing and zero precision to correct behaviour.
  const evaluatedResults = results.filter(entry => entry.metrics.evaluable);
  const rankingResults = evaluatedResults.filter(entry =>
    entry.query.judgments.some(judgment => judgment.grade >= RELEVANT_GRADE));
  const recall: Record<number, number> = {};
  const precision: Record<number, number> = {};
  const ndcg: Record<number, number> = {};
  const violations: Record<number, number> = {};
  const unjudgedRate: Record<number, number> = {};
  for (const k of cutoffs) {
    recall[k] = mean(rankingResults.map(entry => entry.metrics.recall[k] ?? 0));
    precision[k] = mean(rankingResults.map(entry => entry.metrics.precision[k] ?? 0));
    ndcg[k] = mean(rankingResults.map(entry => entry.metrics.ndcg[k] ?? 0));
    violations[k] = evaluatedResults.reduce((sum, entry) => sum + (entry.metrics.violations[k] ?? 0), 0);
    const returned = evaluatedResults.reduce((sum, entry) => sum + Math.min(k, entry.metrics.returned), 0);
    const unjudged = evaluatedResults.reduce((sum, entry) => sum + (entry.metrics.unjudgedReturned[k] ?? 0), 0);
    unjudgedRate[k] = returned === 0 ? 0 : unjudged / returned;
  }
  const latencies = evaluatedResults.map(entry => entry.metrics.latencyMs).sort((left, right) => left - right);
  const byClass: SuiteMetrics["byClass"] = {};
  for (const entry of evaluatedResults) {
    const bucket = byClass[entry.query.queryClass] ??= {
      queries: 0, rankingQueries: 0, recall: {}, mrr: 0,
    };
    bucket.queries += 1;
    if (entry.query.judgments.some(judgment => judgment.grade >= RELEVANT_GRADE)) {
      bucket.rankingQueries += 1;
    }
  }
  for (const [name, bucket] of Object.entries(byClass)) {
    const subset = rankingResults.filter(entry => entry.query.queryClass === name);
    for (const k of cutoffs) bucket.recall[k] = mean(subset.map(entry => entry.metrics.recall[k] ?? 0));
    bucket.mrr = mean(subset.map(entry => entry.metrics.mrr));
  }
  const fallbacks: Record<string, number> = {};
  for (const entry of results) {
    for (const branch of ["semantic", "reranking"]) {
      const state = String(entry.degraded[branch] ?? "unknown");
      if (["timeout", "error", "unavailable"].includes(state)) {
        fallbacks[`${branch}_${state}`] = (fallbacks[`${branch}_${state}`] ?? 0) + 1;
      }
    }
  }
  return {
    queries: results.length,
    evaluableQueries: evaluatedResults.length,
    rankingQueries: rankingResults.length,
    recall, precision, ndcg, violations,
    mrr: mean(rankingResults.map(entry => entry.metrics.mrr)),
    noResultRate: evaluatedResults.length === 0
      ? 0
      : evaluatedResults.filter(entry => !entry.metrics.hasResult).length / evaluatedResults.length,
    noResultAccuracy: mean(evaluatedResults.map(entry => entry.metrics.noResultCorrect ? 1 : 0)),
    latency: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      mean: mean(latencies),
    },
    byClass,
    fallbacks,
    catalogSize,
    unjudgedRate,
  };
}

/** Reports one profile's lift over a baseline, per cutoff. */
export function lift(
  baseline: SuiteMetrics,
  candidate: SuiteMetrics,
  cutoffs: readonly number[] = DEFAULT_CUTOFFS,
): Record<string, number> {
  const report: Record<string, number> = { mrr: candidate.mrr - baseline.mrr };
  for (const k of cutoffs) {
    report[`recall@${k}`] = (candidate.recall[k] ?? 0) - (baseline.recall[k] ?? 0);
    report[`ndcg@${k}`] = (candidate.ndcg[k] ?? 0) - (baseline.ndcg[k] ?? 0);
  }
  return report;
}
