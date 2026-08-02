/**
 * Benchmark v2 scoring — metrics over *incomplete* judgments.
 *
 * This is the v2 replacement for `src/search/evaluate.ts`. The one structural
 * difference, and the reason this file exists at all:
 *
 *   v1 qrels covered every (query, resource) pair, so "not relevant" and
 *   "nobody looked at it" were the same state. v2 qrels contain **only judged
 *   pairs**. A resource with no qrel entry is UNJUDGED, which is a third state
 *   distinct from an explicit grade 0.
 *
 * Consequences, per BUILD-PLAN §0.3 and §10:
 *
 *   - An explicit grade 0 means "a human read this and determined it
 *     irrelevant". It is a planted negative and counts as a `violations@k`.
 *   - An unjudged result is *not* a violation. It contributes 0 to DCG because
 *     there is no alternative, but it is counted and reported separately via
 *     `judged@k` and `unjudged@k`.
 *   - `bpref` deletes unjudged documents from the ranking entirely rather than
 *     scoring them as 0. That is the whole point of bpref and the reason
 *     BUILD-PLAN §10 asks for it alongside nDCG.
 *
 * Every threshold below is pinned by BUILD-PLAN §10. Do not introduce others.
 *
 *   | metric    | relevance threshold          |
 *   |-----------|------------------------------|
 *   | MRR       | grade >= 2                   |
 *   | Recall@k  | grade >= 2                   |
 *   | bpref     | grade >= 2                   |
 *   | judged@k  | any judgment present (0..3)  |
 *
 * nDCG gain is `2^g - 1` -> `0, 1, 3, 7` for grades 0,1,2,3, matching
 * `src/search/evaluate.ts:52`.
 *
 * infAP is deliberately absent. §10 forbids it without a sampling design with
 * known inclusion probabilities, which this pool does not have.
 */

/** Grades are 0..3 per the §7 rubric. Anything outside that is a data error. */
export type Grade = 0 | 1 | 2 | 3;

/** A judgment at or above this grade is "relevant" for MRR, Recall@k and bpref (§10). */
export const RELEVANT_GRADE = 2;

/** nDCG gain per grade: `2^g - 1`. Index by grade. */
export const GAIN_BY_GRADE: readonly number[] = [0, 1, 3, 7];

export const DEFAULT_CUTOFFS = [1, 3, 5, 10, 20] as const;

/**
 * The state of a (query, resource) pair. `unjudged` is first-class: it is the
 * absence of a qrel row, never a grade.
 */
export type JudgmentState = "judged" | "unjudged";

export interface QrelRecord {
  query_id: string;
  resource_id: string;
  grade: number;
}

/** A single judged pair. Only judged pairs exist; absence means unjudged. */
export interface Judgment {
  resourceId: string;
  grade: number;
}

export interface EvalQuery {
  queryId: string;
  /** `capability` | `structured` | `semantic` | `price_category` | `mcp` | `adversarial` | `no_result` | `cold_start` */
  queryClass: string;
  /** §6: explicit intent. Never inferred from an empty judgment list. */
  expectsNoResult?: boolean;
  /** ONLY judged pairs. A resource absent from this list is unjudged. */
  judgments: readonly Judgment[];
}

/** One system's answer to one query. */
export interface RunResult {
  queryId: string;
  /** Ranked resource ids, best first. */
  ranking: readonly string[];
  latencyMs?: number;
}

export function gain(grade: number): number {
  const value = GAIN_BY_GRADE[grade];
  if (value === undefined) throw new RangeError(`grade out of range 0..3: ${grade}`);
  return value;
}

/**
 * Judged pairs, indexed for lookup. Absence from this structure is the UNJUDGED
 * state — the class deliberately exposes no default grade.
 */
export class Qrels {
  private readonly byQuery = new Map<string, Map<string, number>>();

  static fromRecords(records: Iterable<QrelRecord>): Qrels {
    const qrels = new Qrels();
    for (const record of records) qrels.add(record.query_id, record.resource_id, record.grade);
    return qrels;
  }

  add(queryId: string, resourceId: string, grade: number): void {
    if (!Number.isInteger(grade) || grade < 0 || grade > 3) {
      throw new RangeError(`grade out of range 0..3: ${grade}`);
    }
    let bucket = this.byQuery.get(queryId);
    if (!bucket) {
      bucket = new Map();
      this.byQuery.set(queryId, bucket);
    }
    bucket.set(resourceId, grade);
  }

  /** `undefined` means UNJUDGED. It does not mean grade 0. */
  gradeOf(queryId: string, resourceId: string): number | undefined {
    return this.byQuery.get(queryId)?.get(resourceId);
  }

  stateOf(queryId: string, resourceId: string): JudgmentState {
    return this.byQuery.get(queryId)?.has(resourceId) ? "judged" : "unjudged";
  }

  judgmentsFor(queryId: string): Judgment[] {
    const bucket = this.byQuery.get(queryId);
    if (!bucket) return [];
    return [...bucket].map(([resourceId, grade]) => ({ resourceId, grade }));
  }

  get queryCount(): number {
    return this.byQuery.size;
  }

  get pairCount(): number {
    let total = 0;
    for (const bucket of this.byQuery.values()) total += bucket.size;
    return total;
  }
}

/**
 * Metrics for one query.
 *
 * `null` means "undefined for this query", never zero. A query with no
 * relevant judgment has no meaningful nDCG, recall, MRR or bpref, and folding a
 * 0 or a 1 into the mean would silently bias the run score. Aggregation skips
 * nulls and reports how many queries actually contributed.
 */
export interface QueryScore {
  queryId: string;
  queryClass: string;
  expectsNoResult: boolean;
  returned: number;

  /** Judged pairs for this query (the qrel rows, not the corpus). */
  judgedTotal: number;
  /** Judged with grade >= 2. */
  relevantTotal: number;
  /** Judged with grade < 2 — the bpref "N" set. */
  nonRelevantJudgedTotal: number;

  ndcg: Record<number, number | null>;
  recall: Record<number, number | null>;
  /** Standard precision@k, denominator always k. Understated under incomplete judgments. */
  precision: Record<number, number | null>;
  /** Fraction of the returned top-k carrying ANY judgment, grades 0..3 (§10). */
  judged: Record<number, number | null>;
  /** Count of returned top-k with no qrel row at all. */
  unjudged: Record<number, number>;
  /** Count of returned top-k explicitly judged grade 0. Distinct from `unjudged`. */
  explicitZero: Record<number, number>;
  /** Alias of `explicitZero`: planted grade-0 documents surfaced in top-k (§10). */
  violations: Record<number, number>;

  mrr: number | null;
  bpref: number | null;

  hasResult: boolean;
  /** Only defined for `expects_no_result` queries; null otherwise. */
  noResultCorrect: boolean | null;
  latencyMs: number | null;
}

export interface ScoreOptions {
  cutoffs?: readonly number[];
}

function dcgOf(gains: readonly number[]): number {
  let total = 0;
  for (let index = 0; index < gains.length; index += 1) {
    total += gains[index]! / Math.log2(index + 2);
  }
  return total;
}

/**
 * bpref, Buckley & Voorhees (2004), in the trec_eval formulation:
 *
 *     bpref = (1/R) * sum over retrieved relevant r of
 *               ( 1 - min(|nonrelevant judged ranked above r|, R) / min(R, N) )
 *
 * Unjudged documents are removed from the ranking before the walk — they
 * neither earn credit nor apply a penalty. Relevant documents that were never
 * retrieved contribute 0 to the sum but still count in the R denominator.
 *
 * `min(R, N)` in the denominator keeps the term in [0,1] when N < R. With
 * N = 0 there is nothing to penalize and each retrieved relevant scores 1.
 */
function bprefOf(
  ranking: readonly string[],
  gradeOf: (resourceId: string) => number | undefined,
  relevantTotal: number,
  nonRelevantTotal: number,
): number | null {
  if (relevantTotal === 0) return null;
  const denominator = Math.min(relevantTotal, nonRelevantTotal);
  let nonRelevantSeen = 0;
  let sum = 0;
  for (const resourceId of ranking) {
    const grade = gradeOf(resourceId);
    if (grade === undefined) continue; // UNJUDGED: invisible to bpref by design.
    if (grade >= RELEVANT_GRADE) {
      sum += denominator === 0 ? 1 : 1 - Math.min(nonRelevantSeen, relevantTotal) / denominator;
    } else {
      nonRelevantSeen += 1;
    }
  }
  return sum / relevantTotal;
}

export function scoreQuery(
  query: EvalQuery,
  result: RunResult,
  options: ScoreOptions = {},
): QueryScore {
  const cutoffs = options.cutoffs ?? DEFAULT_CUTOFFS;
  const graded = new Map<string, number>();
  for (const judgment of query.judgments) {
    if (!Number.isInteger(judgment.grade) || judgment.grade < 0 || judgment.grade > 3) {
      throw new RangeError(`grade out of range 0..3 for ${query.queryId}/${judgment.resourceId}: ${judgment.grade}`);
    }
    graded.set(judgment.resourceId, judgment.grade);
  }
  // Deduplicate the ranking defensively: a duplicated id would double-count.
  const ranking: string[] = [];
  const seen = new Set<string>();
  for (const resourceId of result.ranking) {
    if (seen.has(resourceId)) continue;
    seen.add(resourceId);
    ranking.push(resourceId);
  }

  const relevantKeys = new Set(
    [...graded].filter(([, grade]) => grade >= RELEVANT_GRADE).map(([resourceId]) => resourceId),
  );
  const relevantTotal = relevantKeys.size;
  const judgedTotal = graded.size;
  const nonRelevantJudgedTotal = judgedTotal - relevantTotal;

  // Ideal ranking is drawn from the judged pool only — there is nothing else to
  // draw from. This makes nDCG optimistic exactly to the degree that pooling is
  // shallow, which is why judged@k must be read next to it.
  const idealGrades = [...graded.values()].sort((left, right) => right - left);

  const ndcg: Record<number, number | null> = {};
  const recall: Record<number, number | null> = {};
  const precision: Record<number, number | null> = {};
  const judged: Record<number, number | null> = {};
  const unjudged: Record<number, number> = {};
  const explicitZero: Record<number, number> = {};

  for (const k of cutoffs) {
    const head = ranking.slice(0, k);

    const observedDcg = dcgOf(head.map(resourceId => {
      const grade = graded.get(resourceId);
      // UNJUDGED contributes 0 gain. Unavoidable, and reported via judged@k.
      return grade === undefined ? 0 : gain(grade);
    }));
    const idealDcg = dcgOf(idealGrades.slice(0, k).map(gain));
    // idealDcg === 0 means no judged document has any gain (all judged 0).
    // nDCG is 0/0 there; report undefined rather than inventing 1.0.
    ndcg[k] = idealDcg === 0 ? null : observedDcg / idealDcg;

    const hits = head.filter(resourceId => relevantKeys.has(resourceId)).length;
    recall[k] = relevantTotal === 0 ? null : hits / relevantTotal;
    precision[k] = hits / k;

    const denominator = Math.min(k, ranking.length);
    const judgedHead = head.filter(resourceId => graded.has(resourceId)).length;
    // 0 results means there is nothing whose judgment status could be measured.
    judged[k] = denominator === 0 ? null : judgedHead / denominator;
    unjudged[k] = head.length - judgedHead;
    explicitZero[k] = head.filter(resourceId => graded.get(resourceId) === 0).length;
  }

  const firstRelevant = ranking.findIndex(resourceId => relevantKeys.has(resourceId));
  const expectsNoResult = query.expectsNoResult === true;

  return {
    queryId: query.queryId,
    queryClass: query.queryClass,
    expectsNoResult,
    returned: ranking.length,
    judgedTotal,
    relevantTotal,
    nonRelevantJudgedTotal,
    ndcg,
    recall,
    precision,
    judged,
    unjudged,
    explicitZero,
    violations: { ...explicitZero },
    mrr: relevantTotal === 0 ? null : firstRelevant === -1 ? 0 : 1 / (firstRelevant + 1),
    bpref: bprefOf(ranking, resourceId => graded.get(resourceId), relevantTotal, nonRelevantJudgedTotal),
    hasResult: ranking.length > 0,
    noResultCorrect: expectsNoResult ? ranking.length === 0 : null,
    latencyMs: result.latencyMs ?? null,
  };
}

/** Mean over defined values, with the contributing count so a reader can see coverage. */
export interface MeanWithSupport {
  value: number | null;
  /** Queries that contributed a defined value. */
  support: number;
}

function meanDefined(values: ReadonlyArray<number | null>): MeanWithSupport {
  const defined = values.filter((value): value is number => value !== null);
  if (defined.length === 0) return { value: null, support: 0 };
  const total = defined.reduce((sum, value) => sum + value, 0);
  return { value: total / defined.length, support: defined.length };
}

function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index]!;
}

export interface RunMetrics {
  queries: number;
  /** Queries with at least one grade >= 2 judgment — the ones nDCG/MRR/bpref can score. */
  rankingQueries: number;

  ndcg: Record<number, MeanWithSupport>;
  recall: Record<number, MeanWithSupport>;
  precision: Record<number, MeanWithSupport>;
  /** Macro mean of per-query judged@k (§10: report next to every nDCG figure). */
  judged: Record<number, MeanWithSupport>;
  /** Micro rate: total unjudged returned / total returned, over the top-k. */
  unjudgedRate: Record<number, number | null>;
  /** Total planted grade-0 documents surfaced across all queries. */
  violations: Record<number, number>;
  violationsPerQuery: Record<number, number>;

  mrr: MeanWithSupport;
  bpref: MeanWithSupport;

  noResult: {
    queries: number;
    correct: number;
    /** Accuracy restricted to `expects_no_result` queries. Null when there are none. */
    accuracy: number | null;
  };
  /** Queries that expect results and returned at least one. */
  hasResultRate: number | null;

  latency: { p50: number | null; p95: number | null; p99: number | null; mean: number | null };

  byClass: Record<string, ClassMetrics>;
}

export interface ClassMetrics {
  queries: number;
  rankingQueries: number;
  ndcg: Record<number, MeanWithSupport>;
  recall: Record<number, MeanWithSupport>;
  judged: Record<number, MeanWithSupport>;
  violations: Record<number, number>;
  mrr: MeanWithSupport;
  bpref: MeanWithSupport;
  noResultAccuracy: number | null;
}

function classMetrics(scores: readonly QueryScore[], cutoffs: readonly number[]): ClassMetrics {
  const ndcg: Record<number, MeanWithSupport> = {};
  const recall: Record<number, MeanWithSupport> = {};
  const judged: Record<number, MeanWithSupport> = {};
  const violations: Record<number, number> = {};
  for (const k of cutoffs) {
    ndcg[k] = meanDefined(scores.map(score => score.ndcg[k] ?? null));
    recall[k] = meanDefined(scores.map(score => score.recall[k] ?? null));
    judged[k] = meanDefined(scores.map(score => score.judged[k] ?? null));
    violations[k] = scores.reduce((sum, score) => sum + (score.violations[k] ?? 0), 0);
  }
  const noResultScores = scores.filter(score => score.expectsNoResult);
  return {
    queries: scores.length,
    rankingQueries: scores.filter(score => score.relevantTotal > 0).length,
    ndcg,
    recall,
    judged,
    violations,
    mrr: meanDefined(scores.map(score => score.mrr)),
    bpref: meanDefined(scores.map(score => score.bpref)),
    noResultAccuracy: noResultScores.length === 0
      ? null
      : noResultScores.filter(score => score.noResultCorrect === true).length / noResultScores.length,
  };
}

export function aggregate(
  scores: readonly QueryScore[],
  options: ScoreOptions = {},
): RunMetrics {
  const cutoffs = options.cutoffs ?? DEFAULT_CUTOFFS;

  const ndcg: Record<number, MeanWithSupport> = {};
  const recall: Record<number, MeanWithSupport> = {};
  const precision: Record<number, MeanWithSupport> = {};
  const judged: Record<number, MeanWithSupport> = {};
  const unjudgedRate: Record<number, number | null> = {};
  const violations: Record<number, number> = {};
  const violationsPerQuery: Record<number, number> = {};

  for (const k of cutoffs) {
    ndcg[k] = meanDefined(scores.map(score => score.ndcg[k] ?? null));
    recall[k] = meanDefined(scores.map(score => score.recall[k] ?? null));
    precision[k] = meanDefined(scores.map(score => score.precision[k] ?? null));
    judged[k] = meanDefined(scores.map(score => score.judged[k] ?? null));
    const returned = scores.reduce((sum, score) => sum + Math.min(k, score.returned), 0);
    const unjudged = scores.reduce((sum, score) => sum + (score.unjudged[k] ?? 0), 0);
    unjudgedRate[k] = returned === 0 ? null : unjudged / returned;
    violations[k] = scores.reduce((sum, score) => sum + (score.violations[k] ?? 0), 0);
    violationsPerQuery[k] = scores.length === 0 ? 0 : violations[k]! / scores.length;
  }

  const noResultScores = scores.filter(score => score.expectsNoResult);
  const noResultCorrect = noResultScores.filter(score => score.noResultCorrect === true).length;
  const expectsResultScores = scores.filter(score => !score.expectsNoResult);

  const latencies = scores
    .map(score => score.latencyMs)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);

  const byClass: Record<string, ClassMetrics> = {};
  for (const queryClass of new Set(scores.map(score => score.queryClass))) {
    byClass[queryClass] = classMetrics(scores.filter(score => score.queryClass === queryClass), cutoffs);
  }

  return {
    queries: scores.length,
    rankingQueries: scores.filter(score => score.relevantTotal > 0).length,
    ndcg,
    recall,
    precision,
    judged,
    unjudgedRate,
    violations,
    violationsPerQuery,
    mrr: meanDefined(scores.map(score => score.mrr)),
    bpref: meanDefined(scores.map(score => score.bpref)),
    noResult: {
      queries: noResultScores.length,
      correct: noResultCorrect,
      accuracy: noResultScores.length === 0 ? null : noResultCorrect / noResultScores.length,
    },
    hasResultRate: expectsResultScores.length === 0
      ? null
      : expectsResultScores.filter(score => score.hasResult).length / expectsResultScores.length,
    latency: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      mean: latencies.length === 0 ? null : latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
    },
    byClass,
  };
}

/**
 * Score a whole run. Queries with no corresponding result are scored as an
 * empty ranking rather than dropped, so a system cannot improve its mean by
 * failing to answer.
 */
export function scoreRun(
  queries: readonly EvalQuery[],
  results: readonly RunResult[],
  options: ScoreOptions = {},
): { perQuery: QueryScore[]; metrics: RunMetrics } {
  const byId = new Map(results.map(result => [result.queryId, result]));
  const perQuery = queries.map(query =>
    scoreQuery(query, byId.get(query.queryId) ?? { queryId: query.queryId, ranking: [] }, options));
  return { perQuery, metrics: aggregate(perQuery, options) };
}

/** Selector for the per-query vectors that `significance.ts` consumes. */
export type MetricSelector = (score: QueryScore) => number | null;

export const metricSelectors = {
  ndcgAt: (k: number): MetricSelector => score => score.ndcg[k] ?? null,
  recallAt: (k: number): MetricSelector => score => score.recall[k] ?? null,
  judgedAt: (k: number): MetricSelector => score => score.judged[k] ?? null,
  mrr: (): MetricSelector => score => score.mrr,
  bpref: (): MetricSelector => score => score.bpref,
} as const;

/**
 * Align two runs on the queries where BOTH produced a defined value for the
 * metric. Significance tests are paired; dropping unmatched queries from only
 * one side would break the pairing.
 */
export function pairedVectors(
  baseline: readonly QueryScore[],
  candidate: readonly QueryScore[],
  selector: MetricSelector,
): { queryIds: string[]; a: number[]; b: number[] } {
  const candidateById = new Map(candidate.map(score => [score.queryId, score]));
  const queryIds: string[] = [];
  const a: number[] = [];
  const b: number[] = [];
  for (const baselineScore of baseline) {
    const candidateScore = candidateById.get(baselineScore.queryId);
    if (!candidateScore) continue;
    const left = selector(baselineScore);
    const right = selector(candidateScore);
    if (left === null || right === null) continue;
    queryIds.push(baselineScore.queryId);
    a.push(left);
    b.push(right);
  }
  return { queryIds, a, b };
}
