/**
 * Stratified inter-annotator agreement — BUILD-PLAN §8, Pass 3.
 *
 * §8 is explicit that a single kappa is not an acceptable report:
 *
 *   "Report kappa stratified, not as a single number. A pool dominated by
 *    obvious 0s inflates weighted kappa even when annotators disagree badly at
 *    the boundary."
 *
 * The mechanism is worth stating because it drives every design choice here.
 * A pool where 80% of candidates are unambiguous grade 0 gives both annotators
 * an easy majority of trivial agreements. Weighted kappa corrects for chance
 * using the *marginal* distributions, which those trivial cases also dominate,
 * so the correction is calibrated against the easy stratum and the resulting
 * number describes how well two people can spot an obviously irrelevant
 * document — not whether they agree about relevance. The benchmark lives at the
 * 2-vs-3 boundary (§7), so that stratum needs its own figure.
 *
 * This module therefore reports all five figures §8 requires:
 *
 *   1. weighted kappa across ALL pooled candidates
 *   2. weighted kappa restricted to relevant-family candidates  <- the meaningful one
 *   3. exact agreement rate
 *   4. the full 4x4 grade confusion matrix
 *   5. disagreement rate among pairs where EITHER annotator gave 2 or 3
 *
 * Target per §8: kappa >= 0.6 on the restricted set, not on the full pool.
 *
 * No dependencies.
 */

export const GRADES = [0, 1, 2, 3] as const;
const GRADE_COUNT = GRADES.length;

/** §8 target, stated on the restricted stratum. */
export const KAPPA_TARGET = 0.6;

export interface AnnotatedPair {
  queryId: string;
  resourceId: string;
  /** Annotator A's grade, 0..3. */
  a: number;
  /** Annotator B's grade, 0..3. */
  b: number;
  /**
   * Optional external stratum flag. When present it overrides the default
   * predicate — use it when the family relationship is known from the catalog
   * rather than inferred from the grades.
   */
  relevantFamily?: boolean;
}

/**
 * Which pairs count as "relevant-family candidates".
 *
 * Default: `max(a, b) >= 1`. Per the §7 rubric, grade 1 means "same family,
 * different capability", so a candidate that either annotator placed at 1 or
 * above is in the target family for that query. Everything below is the
 * different-capability / planted-trap stratum whose easy agreements inflate the
 * pooled figure.
 *
 * BUILD-PLAN does not define the term, so this is a stated interpretation, not
 * a derived fact — override via `relevantFamilyPredicate` or the per-pair
 * `relevantFamily` flag if the catalog carries a real family label.
 */
export type StratumPredicate = (pair: AnnotatedPair) => boolean;

export const defaultRelevantFamily: StratumPredicate = pair => Math.max(pair.a, pair.b) >= 1;

/** Weighting for Cohen's weighted kappa. */
export type KappaWeighting = "quadratic" | "linear";

export interface KappaResult {
  weighting: KappaWeighting;
  /** Null when undefined — n = 0, or expected disagreement is 0 (see below). */
  kappa: number | null;
  n: number;
  observedDisagreement: number;
  expectedDisagreement: number;
  /** Present only when `kappa` is null. */
  undefinedReason?: "no-pairs" | "zero-expected-disagreement";
}

function weightOf(left: number, right: number, weighting: KappaWeighting): number {
  const distance = Math.abs(left - right) / (GRADE_COUNT - 1);
  return weighting === "quadratic" ? distance ** 2 : distance;
}

/**
 * Cohen's weighted kappa on a 4x4 grade matrix.
 *
 * kappa = 1 - (sum w_ij * O_ij) / (sum w_ij * E_ij), with disagreement weights
 * normalized to [0,1] so a 0-vs-3 disagreement costs 1 and 0-vs-1 costs 1/9
 * (quadratic) or 1/3 (linear). Quadratic is the default and matches the v1
 * implementation at `src/search/release/agreement.ts`, keeping the two numbers
 * comparable across dataset versions.
 *
 * When expected disagreement is 0 — both annotators used exactly one grade for
 * everything — kappa is 0/0. This returns null rather than 1.0. Reporting a
 * perfect kappa for a degenerate stratum is precisely the inflation §8 exists
 * to prevent.
 */
export function weightedKappa(
  pairs: readonly AnnotatedPair[],
  weighting: KappaWeighting = "quadratic",
): KappaResult {
  const n = pairs.length;
  if (n === 0) {
    return {
      weighting, kappa: null, n: 0, observedDisagreement: 0, expectedDisagreement: 0,
      undefinedReason: "no-pairs",
    };
  }
  const matrix = confusionMatrix(pairs);
  const rowTotals = matrix.map(row => row.reduce((sum, value) => sum + value, 0));
  const columnTotals = GRADES.map(grade => matrix.reduce((sum, row) => sum + row[grade]!, 0));

  let observed = 0;
  let expected = 0;
  for (const i of GRADES) {
    for (const j of GRADES) {
      const weight = weightOf(i, j, weighting);
      observed += weight * (matrix[i]![j]! / n);
      expected += weight * ((rowTotals[i]! * columnTotals[j]!) / (n * n));
    }
  }
  if (expected === 0) {
    return {
      weighting, kappa: null, n, observedDisagreement: observed, expectedDisagreement: 0,
      undefinedReason: "zero-expected-disagreement",
    };
  }
  return {
    weighting,
    kappa: 1 - observed / expected,
    n,
    observedDisagreement: observed,
    expectedDisagreement: expected,
  };
}

/** `matrix[a][b]` = pairs where annotator A gave `a` and annotator B gave `b`. */
export function confusionMatrix(pairs: readonly AnnotatedPair[]): number[][] {
  const matrix = Array.from({ length: GRADE_COUNT }, () => new Array<number>(GRADE_COUNT).fill(0));
  for (const pair of pairs) {
    assertGrade(pair.a, pair);
    assertGrade(pair.b, pair);
    matrix[pair.a]![pair.b]! += 1;
  }
  return matrix;
}

function assertGrade(grade: number, pair: AnnotatedPair): void {
  if (!Number.isInteger(grade) || grade < 0 || grade > 3) {
    throw new RangeError(`grade out of range 0..3 for ${pair.queryId}/${pair.resourceId}: ${grade}`);
  }
}

export interface StratumReport {
  name: string;
  description: string;
  n: number;
  /** Share of all pooled pairs falling in this stratum. */
  share: number;
  exactAgreement: number | null;
  /** |a - b| <= 1. */
  withinOneAgreement: number | null;
  /** |a - b| >= 2 — a substantive disagreement, not a boundary quibble. */
  severeDisagreementRate: number | null;
  kappaQuadratic: KappaResult;
  kappaLinear: KappaResult;
  confusionMatrix: number[][];
}

function stratumReport(
  name: string,
  description: string,
  pairs: readonly AnnotatedPair[],
  totalPairs: number,
): StratumReport {
  const n = pairs.length;
  const rate = (predicate: (pair: AnnotatedPair) => boolean): number | null =>
    n === 0 ? null : pairs.filter(predicate).length / n;
  return {
    name,
    description,
    n,
    share: totalPairs === 0 ? 0 : n / totalPairs,
    exactAgreement: rate(pair => pair.a === pair.b),
    withinOneAgreement: rate(pair => Math.abs(pair.a - pair.b) <= 1),
    severeDisagreementRate: rate(pair => Math.abs(pair.a - pair.b) >= 2),
    kappaQuadratic: weightedKappa(pairs, "quadratic"),
    kappaLinear: weightedKappa(pairs, "linear"),
    confusionMatrix: confusionMatrix(pairs),
  };
}

export interface BoundaryReport {
  /** Pairs where EITHER annotator gave 2 or 3. */
  n: number;
  disagreements: number;
  /** Any difference at all, not just severe. Null when n = 0. */
  disagreementRate: number | null;
  /** The specific 2-vs-3 confusion — "where the benchmark lives" (§7). */
  twoVsThree: {
    /** Pairs where the two grades are exactly {2,3}. */
    n: number;
    /** A=2, B=3. */
    aTwoBThree: number;
    /** A=3, B=2. */
    aThreeBTwo: number;
  };
  /** Pairs where one annotator said 2-or-3 and the other said 0-or-1. */
  relevantVsNotRelevant: number;
}

export interface StratifiedAgreementReport {
  pairs: number;
  queries: number;
  /** Exact agreement over ALL pooled pairs. */
  exactAgreement: number | null;
  /** Full 4x4 matrix over ALL pooled pairs. */
  confusionMatrix: number[][];
  /** Figure 1 of §8: weighted kappa over everything. Inflated by the easy stratum. */
  overall: StratumReport;
  /** Figure 2 of §8: the meaningful figure. */
  relevantFamily: StratumReport;
  /** The complementary stratum, shown so a reader can see the inflation directly. */
  nonRelevantFamily: StratumReport;
  /** Figure 5 of §8. */
  boundary: BoundaryReport;
  /**
   * `overall.kappa - relevantFamily.kappa`. A large positive value is the
   * inflation §8 predicts and is the reason a single number is not reportable.
   */
  inflation: number | null;
  target: { kappa: number; stratum: "relevant-family" };
  passes: boolean;
  /** Human-readable lines suitable for pasting into the calibration report. */
  summary: string[];
}

export interface AgreementOptions {
  relevantFamilyPredicate?: StratumPredicate;
}

export function stratifiedAgreement(
  pairs: readonly AnnotatedPair[],
  options: AgreementOptions = {},
): StratifiedAgreementReport {
  const predicate = options.relevantFamilyPredicate ?? defaultRelevantFamily;
  const inFamily = (pair: AnnotatedPair): boolean =>
    pair.relevantFamily === undefined ? predicate(pair) : pair.relevantFamily;

  const total = pairs.length;
  const relevantFamilyPairs = pairs.filter(inFamily);
  const otherPairs = pairs.filter(pair => !inFamily(pair));
  const usesFrozenFamilyLabels = pairs.length > 0 && pairs.every(pair => pair.relevantFamily !== undefined);
  const relevantFamilyDescription = usesFrozenFamilyLabels
    ? "Candidates whose query and resource share the frozen family label in the withheld grading manifest."
    : options.relevantFamilyPredicate
      ? "Candidates selected by the supplied relevant-family predicate."
      : "Candidates either annotator placed at grade >= 1 (same capability family per the §7 rubric).";
  const nonRelevantFamilyDescription = usesFrozenFamilyLabels
    ? "Candidates whose query and resource have different frozen family labels (including distractors)."
    : options.relevantFamilyPredicate
      ? "Candidates excluded by the supplied relevant-family predicate."
      : "Candidates both annotators placed at grade 0. The easy stratum that inflates the pooled figure.";

  const overall = stratumReport(
    "all-pooled",
    "Every pooled candidate both annotators graded.",
    pairs,
    total,
  );
  const relevantFamily = stratumReport(
    "relevant-family",
    relevantFamilyDescription,
    relevantFamilyPairs,
    total,
  );
  const nonRelevantFamily = stratumReport(
    "non-relevant-family",
    nonRelevantFamilyDescription,
    otherPairs,
    total,
  );

  const boundaryPairs = pairs.filter(pair => Math.max(pair.a, pair.b) >= 2);
  const boundaryDisagreements = boundaryPairs.filter(pair => pair.a !== pair.b).length;
  const twoThree = boundaryPairs.filter(pair =>
    (pair.a === 2 && pair.b === 3) || (pair.a === 3 && pair.b === 2));
  const boundary: BoundaryReport = {
    n: boundaryPairs.length,
    disagreements: boundaryDisagreements,
    disagreementRate: boundaryPairs.length === 0 ? null : boundaryDisagreements / boundaryPairs.length,
    twoVsThree: {
      n: twoThree.length,
      aTwoBThree: twoThree.filter(pair => pair.a === 2).length,
      aThreeBTwo: twoThree.filter(pair => pair.a === 3).length,
    },
    relevantVsNotRelevant: boundaryPairs.filter(pair =>
      Math.min(pair.a, pair.b) <= 1 && Math.max(pair.a, pair.b) >= 2).length,
  };

  const overallKappa = overall.kappaQuadratic.kappa;
  const restrictedKappa = relevantFamily.kappaQuadratic.kappa;
  const inflation = overallKappa === null || restrictedKappa === null ? null : overallKappa - restrictedKappa;
  const passes = restrictedKappa !== null && restrictedKappa >= KAPPA_TARGET;

  const format = (value: number | null, digits = 3): string =>
    value === null ? "undefined" : value.toFixed(digits);

  const summary = [
    `Pooled pairs double-graded: ${total} across ${new Set(pairs.map(pair => pair.queryId)).size} queries.`,
    `Weighted kappa (quadratic), all pooled candidates: ${format(overallKappa)} (n=${overall.n}).`,
    `Weighted kappa (quadratic), relevant-family candidates: ${format(restrictedKappa)} (n=${relevantFamily.n})`
      + ` — this is the figure that matters, target >= ${KAPPA_TARGET}.`,
    `Exact agreement, all pooled: ${format(overall.exactAgreement)}; relevant-family: ${format(relevantFamily.exactAgreement)}.`,
    `Boundary stratum (either annotator gave 2 or 3): n=${boundary.n},`
      + ` disagreement rate ${format(boundary.disagreementRate)},`
      + ` of which ${boundary.twoVsThree.n} are 2-vs-3 and ${boundary.relevantVsNotRelevant} cross the relevance cutoff.`,
    inflation === null
      ? "Kappa inflation from the easy stratum: undefined."
      : `Kappa inflation from the easy stratum: ${format(inflation)}`
        + ` (${format(nonRelevantFamily.share * 100, 1)}% of the pool is unanimous grade 0).`,
    passes
      ? `PASS: relevant-family kappa ${format(restrictedKappa)} >= ${KAPPA_TARGET}.`
      : `BLOCKED: relevant-family kappa ${format(restrictedKappa)} is below the ${KAPPA_TARGET} target (§8).`,
  ];

  return {
    pairs: total,
    queries: new Set(pairs.map(pair => pair.queryId)).size,
    exactAgreement: overall.exactAgreement,
    confusionMatrix: overall.confusionMatrix,
    overall,
    relevantFamily,
    nonRelevantFamily,
    boundary,
    inflation,
    target: { kappa: KAPPA_TARGET, stratum: "relevant-family" },
    passes,
    summary,
  };
}

/** Renders the 4x4 matrix as fixed-width text for the calibration report. */
export function formatConfusionMatrix(matrix: readonly (readonly number[])[]): string {
  const width = Math.max(5, ...matrix.flat().map(value => String(value).length + 1));
  const pad = (text: string) => text.padStart(width);
  const lines = [`${pad("A\\B")}${GRADES.map(grade => pad(String(grade))).join("")}${pad("total")}`];
  for (const a of GRADES) {
    const row = matrix[a] ?? [];
    const total = row.reduce((sum, value) => sum + value, 0);
    lines.push(`${pad(String(a))}${GRADES.map(b => pad(String(row[b] ?? 0))).join("")}${pad(String(total))}`);
  }
  const columnTotals = GRADES.map(b => matrix.reduce((sum, row) => sum + (row[b] ?? 0), 0));
  const grand = columnTotals.reduce((sum, value) => sum + value, 0);
  lines.push(`${pad("total")}${columnTotals.map(value => pad(String(value))).join("")}${pad(String(grand))}`);
  return lines.join("\n");
}
