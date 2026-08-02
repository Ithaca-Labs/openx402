/**
 * Significance testing for run comparisons — BUILD-PLAN §10 ("Significance").
 *
 * "Paired permutation test or bootstrap CI over per-query scores. Report *p*
 * and the interval, never bare point estimates. At n=50 some comparisons will
 * be non-significant — say so."
 *
 * Both are implemented, because they answer different questions:
 *
 *   - The **paired permutation test** answers "could this difference have come
 *     from a system that is genuinely no different?" It is exact under the
 *     sharp null (per-query differences are sign-exchangeable) and makes no
 *     distributional assumption. This is the right primary test for IR runs
 *     evaluated on the same topics.
 *   - The **paired bootstrap CI** answers "how large is the difference, and how
 *     precisely do we know it?" A p-value alone hides effect size.
 *
 * Both operate on paired per-query scores, so both are only valid when the two
 * runs were evaluated on the same query set — use `pairedVectors` from
 * `scoring.ts` to build the inputs.
 *
 * Everything is seeded and deterministic. A significance number that moves
 * between runs of the report generator is not evidence of anything.
 *
 * No dependencies.
 */

/** Deterministic 32-bit PRNG (mulberry32). Fast, adequate for resampling. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Alternative = "two-sided" | "greater" | "less";

export interface PermutationOptions {
  /** Monte Carlo resamples when exact enumeration is not used. Default 100,000. */
  iterations?: number;
  seed?: number;
  alternative?: Alternative;
  /**
   * Enumerate all 2^n sign flips when n is at or below this. Default 20
   * (1,048,576 permutations). Above it the test is Monte Carlo.
   */
  exactThreshold?: number;
}

export interface PermutationResult {
  /** mean(candidate) - mean(baseline). */
  observedDiff: number;
  meanBaseline: number;
  meanCandidate: number;
  pValue: number;
  n: number;
  /** True when all 2^n sign assignments were enumerated. */
  exact: boolean;
  iterations: number;
  alternative: Alternative;
  /** Queries whose paired difference is exactly 0 — they carry no signal. */
  ties: number;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function assertPaired(baseline: readonly number[], candidate: readonly number[]): void {
  if (baseline.length !== candidate.length) {
    throw new RangeError(`paired vectors must be equal length: ${baseline.length} vs ${candidate.length}`);
  }
}

function exceedsUnderAlternative(statistic: number, observed: number, alternative: Alternative): boolean {
  // `>=` throughout: the observed arrangement is itself a valid permutation, so
  // ties must count toward the tail. Using `>` produces anti-conservative p.
  if (alternative === "two-sided") return Math.abs(statistic) >= Math.abs(observed) - 1e-12;
  if (alternative === "greater") return statistic >= observed - 1e-12;
  return statistic <= observed + 1e-12;
}

/**
 * Paired (one-sample-on-differences) permutation test.
 *
 * Statistic: mean of the per-query differences `candidate - baseline`.
 * Null hypothesis: each difference is equally likely to have carried the
 * opposite sign, i.e. the systems are exchangeable on every query.
 *
 * Exact enumeration for small n; Monte Carlo above `exactThreshold`, where the
 * p-value uses the (b+1)/(m+1) estimator so it is never reported as 0 — a
 * Monte Carlo test cannot distinguish p = 0 from p < 1/m.
 */
export function pairedPermutationTest(
  baseline: readonly number[],
  candidate: readonly number[],
  options: PermutationOptions = {},
): PermutationResult {
  assertPaired(baseline, candidate);
  const n = baseline.length;
  const alternative = options.alternative ?? "two-sided";
  const exactThreshold = options.exactThreshold ?? 20;
  const iterations = options.iterations ?? 100_000;

  if (n === 0) {
    return {
      observedDiff: 0, meanBaseline: 0, meanCandidate: 0, pValue: 1, n: 0,
      exact: true, iterations: 0, alternative, ties: 0,
    };
  }

  const differences = candidate.map((value, index) => value - baseline[index]!);
  const ties = differences.filter(value => value === 0).length;
  const observed = mean(differences);
  const meanBaseline = mean(baseline);
  const meanCandidate = mean(candidate);

  // All differences zero: the runs are identical on every query. No permutation
  // can produce anything else, so p = 1 exactly.
  if (ties === n) {
    return {
      observedDiff: 0, meanBaseline, meanCandidate, pValue: 1, n,
      exact: true, iterations: 0, alternative, ties,
    };
  }

  if (n <= exactThreshold) {
    const total = 2 ** n;
    let extreme = 0;
    for (let mask = 0; mask < total; mask += 1) {
      let sum = 0;
      for (let index = 0; index < n; index += 1) {
        sum += (mask & (1 << index)) === 0 ? differences[index]! : -differences[index]!;
      }
      if (exceedsUnderAlternative(sum / n, observed, alternative)) extreme += 1;
    }
    return {
      observedDiff: observed, meanBaseline, meanCandidate,
      pValue: extreme / total, n, exact: true, iterations: total, alternative, ties,
    };
  }

  const random = createRandom(options.seed ?? 0x5eed);
  let extreme = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    for (let index = 0; index < n; index += 1) {
      sum += random() < 0.5 ? differences[index]! : -differences[index]!;
    }
    if (exceedsUnderAlternative(sum / n, observed, alternative)) extreme += 1;
  }
  return {
    observedDiff: observed, meanBaseline, meanCandidate,
    pValue: (extreme + 1) / (iterations + 1),
    n, exact: false, iterations, alternative, ties,
  };
}

export interface BootstrapOptions {
  /** Resamples. Default 10,000. */
  iterations?: number;
  seed?: number;
  /** Two-sided confidence level. Default 0.95. */
  level?: number;
}

export interface ConfidenceInterval {
  point: number;
  lower: number;
  upper: number;
  level: number;
  iterations: number;
  n: number;
  /** Mean of the bootstrap distribution minus the point estimate. */
  bias: number;
  /** Standard deviation of the bootstrap distribution. */
  standardError: number;
}

function percentileOf(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  // Nearest-rank on the sorted resample distribution.
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index]!;
}

function bootstrapDistribution(
  values: readonly number[],
  iterations: number,
  seed: number,
): number[] {
  const random = createRandom(seed);
  const n = values.length;
  const distribution: number[] = new Array(iterations);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    for (let draw = 0; draw < n; draw += 1) {
      sum += values[Math.floor(random() * n)]!;
    }
    distribution[iteration] = sum / n;
  }
  distribution.sort((left, right) => left - right);
  return distribution;
}

function intervalFrom(
  distribution: readonly number[],
  point: number,
  level: number,
  n: number,
): ConfidenceInterval {
  const alpha = (1 - level) / 2;
  const distributionMean = mean(distribution);
  const variance = distribution.length < 2
    ? 0
    : distribution.reduce((sum, value) => sum + (value - distributionMean) ** 2, 0) / (distribution.length - 1);
  return {
    point,
    lower: percentileOf(distribution, alpha),
    upper: percentileOf(distribution, 1 - alpha),
    level,
    iterations: distribution.length,
    n,
    bias: distributionMean - point,
    standardError: Math.sqrt(variance),
  };
}

/**
 * Paired bootstrap CI on the mean per-query difference `candidate - baseline`.
 *
 * Queries are resampled with replacement as *units*, keeping each query's pair
 * of scores together. Resampling the two runs independently would destroy the
 * pairing and inflate the interval.
 *
 * Percentile method. BCa would be tighter but needs a jackknife acceleration
 * estimate; at n=50 the percentile interval is the defensible, standard choice
 * and the reported `bias` lets a reader see whether it mattered.
 */
export function pairedBootstrapCI(
  baseline: readonly number[],
  candidate: readonly number[],
  options: BootstrapOptions = {},
): ConfidenceInterval {
  assertPaired(baseline, candidate);
  const iterations = options.iterations ?? 10_000;
  const level = options.level ?? 0.95;
  const n = baseline.length;
  if (n === 0) {
    return { point: 0, lower: Number.NaN, upper: Number.NaN, level, iterations: 0, n: 0, bias: 0, standardError: 0 };
  }
  const differences = candidate.map((value, index) => value - baseline[index]!);
  const distribution = bootstrapDistribution(differences, iterations, options.seed ?? 0xb007);
  return intervalFrom(distribution, mean(differences), level, n);
}

/** Bootstrap CI on a single run's mean score — for reporting a point estimate honestly. */
export function bootstrapMeanCI(
  values: readonly number[],
  options: BootstrapOptions = {},
): ConfidenceInterval {
  const iterations = options.iterations ?? 10_000;
  const level = options.level ?? 0.95;
  if (values.length === 0) {
    return { point: 0, lower: Number.NaN, upper: Number.NaN, level, iterations: 0, n: 0, bias: 0, standardError: 0 };
  }
  const distribution = bootstrapDistribution(values, iterations, options.seed ?? 0xb007);
  return intervalFrom(distribution, mean(values), level, values.length);
}

export interface ComparisonReport {
  metric: string;
  n: number;
  baselineMean: number;
  candidateMean: number;
  baselineCI: ConfidenceInterval;
  candidateCI: ConfidenceInterval;
  difference: ConfidenceInterval;
  permutation: PermutationResult;
  /** p < alpha AND the difference interval excludes 0. */
  significant: boolean;
  alpha: number;
  /** Plain-language line for the report; says "not significant" when it is not. */
  summary: string;
}

export interface CompareOptions extends PermutationOptions, BootstrapOptions {
  metric?: string;
  alpha?: number;
}

function round(value: number, digits = 4): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

/**
 * Full comparison of two runs on one metric: point estimates with their own
 * CIs, the paired difference interval, and the permutation p-value.
 */
export function compareRuns(
  baseline: readonly number[],
  candidate: readonly number[],
  options: CompareOptions = {},
): ComparisonReport {
  assertPaired(baseline, candidate);
  const metric = options.metric ?? "metric";
  const alpha = options.alpha ?? 0.05;
  const seed = options.seed ?? 0xb007;

  const bootstrapOptions: { iterations: number; level: number; seed: number } = {
    iterations: options.iterations ?? 10_000,
    level: options.level ?? 0.95,
    seed,
  };
  const permutation = pairedPermutationTest(baseline, candidate, {
    ...(options.iterations === undefined ? {} : { iterations: options.iterations }),
    ...(options.alternative === undefined ? {} : { alternative: options.alternative }),
    ...(options.exactThreshold === undefined ? {} : { exactThreshold: options.exactThreshold }),
    seed,
  });
  const difference = pairedBootstrapCI(baseline, candidate, bootstrapOptions);
  const baselineCI = bootstrapMeanCI(baseline, { ...bootstrapOptions, seed: seed + 1 });
  const candidateCI = bootstrapMeanCI(candidate, { ...bootstrapOptions, seed: seed + 2 });

  const intervalExcludesZero = difference.lower > 0 || difference.upper < 0;
  const significant = permutation.pValue < alpha && intervalExcludesZero;

  const summary = baseline.length === 0
    ? `${metric}: no paired queries; no comparison possible.`
    : significant
      ? `${metric}: ${round(permutation.meanCandidate)} vs ${round(permutation.meanBaseline)}, `
        + `diff ${round(difference.point)} (${Math.round(difference.level * 100)}% CI `
        + `${round(difference.lower)} to ${round(difference.upper)}), p=${round(permutation.pValue)}, n=${permutation.n}. Significant.`
      : `${metric}: ${round(permutation.meanCandidate)} vs ${round(permutation.meanBaseline)}, `
        + `diff ${round(difference.point)} (${Math.round(difference.level * 100)}% CI `
        + `${round(difference.lower)} to ${round(difference.upper)}), p=${round(permutation.pValue)}, n=${permutation.n}. `
        + `NOT significant at alpha=${alpha}${intervalExcludesZero ? "" : "; the interval includes 0"}.`;

  return {
    metric,
    n: baseline.length,
    baselineMean: permutation.meanBaseline,
    candidateMean: permutation.meanCandidate,
    baselineCI,
    candidateCI,
    difference,
    permutation,
    significant,
    alpha,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Self-test on synthetic data with a known effect.
// ---------------------------------------------------------------------------

export interface SelfTestCase {
  name: string;
  n: number;
  trueEffect: number;
  observedDiff: number;
  pValue: number;
  ciLower: number;
  ciUpper: number;
  significant: boolean;
  /** What the test SHOULD conclude given how the data was constructed. */
  expectSignificant: boolean;
  passed: boolean;
}

export interface SelfTestReport {
  cases: SelfTestCase[];
  passed: boolean;
}

/** Box-Muller from a uniform PRNG, so the synthetic noise is seeded too. */
function gaussian(random: () => number): number {
  const u1 = Math.max(random(), Number.EPSILON);
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Synthetic paired scores: `baseline ~ 0.5 + noise`, clipped to [0,1] like a
 * real nDCG, with `candidate = baseline + effect + noise`.
 */
function synthetic(n: number, effect: number, noise: number, seed: number): { a: number[]; b: number[] } {
  const random = createRandom(seed);
  const a: number[] = [];
  const b: number[] = [];
  const clip = (value: number) => Math.min(1, Math.max(0, value));
  for (let index = 0; index < n; index += 1) {
    const base = clip(0.5 + gaussian(random) * 0.15);
    a.push(base);
    b.push(clip(base + effect + gaussian(random) * noise));
  }
  return { a, b };
}

/**
 * Runs the machinery against data whose answer is known by construction:
 *
 *   1. A large real effect at n=50 must be detected.
 *   2. A true null at n=50 must NOT be called significant.
 *   3. A tiny effect at n=50 must NOT reach significance — this is the case
 *      BUILD-PLAN §10 warns about ("at n=50 some comparisons will be
 *      non-significant — say so"), and the test asserts we report it honestly
 *      rather than manufacturing a result.
 *   4. Identical runs must give p = 1 and a degenerate interval at 0.
 */
export function selfTest(): SelfTestReport {
  const cases: SelfTestCase[] = [];

  const run = (name: string, n: number, effect: number, noise: number, seed: number, expectSignificant: boolean) => {
    const { a, b } = synthetic(n, effect, noise, seed);
    const report = compareRuns(a, b, { metric: name, seed, iterations: 10_000 });
    cases.push({
      name,
      n,
      trueEffect: effect,
      observedDiff: report.difference.point,
      pValue: report.permutation.pValue,
      ciLower: report.difference.lower,
      ciUpper: report.difference.upper,
      significant: report.significant,
      expectSignificant,
      passed: report.significant === expectSignificant,
    });
  };

  run("known-large-effect@n50", 50, 0.08, 0.05, 1234, true);
  run("true-null@n50", 50, 0, 0.05, 3, false);
  run("underpowered-tiny-effect@n50", 50, 0.002, 0.08, 11, false);

  const identical = Array.from({ length: 50 }, (_, index) => 0.4 + (index % 7) / 100);
  const identicalReport = compareRuns(identical, identical, { metric: "identical-runs", seed: 7 });
  cases.push({
    name: "identical-runs",
    n: 50,
    trueEffect: 0,
    observedDiff: identicalReport.difference.point,
    pValue: identicalReport.permutation.pValue,
    ciLower: identicalReport.difference.lower,
    ciUpper: identicalReport.difference.upper,
    significant: identicalReport.significant,
    expectSignificant: false,
    passed: identicalReport.permutation.pValue === 1 && !identicalReport.significant,
  });

  return { cases, passed: cases.every(entry => entry.passed) };
}
