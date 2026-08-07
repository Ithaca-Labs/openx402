/**
 * Unit tests for `agreement.ts`.
 *
 * The centrepiece is "kappa inflation", which reproduces the exact failure mode
 * BUILD-PLAN §8 describes, with every number derived by hand.
 */

import { describe, expect, it } from "vitest";
import {
  confusionMatrix,
  defaultRelevantFamily,
  formatConfusionMatrix,
  KAPPA_TARGET,
  stratifiedAgreement,
  weightedKappa,
  type AnnotatedPair,
} from "./agreement.js";

let sequence = 0;
function pair(a: number, b: number, queryId = "qry-001"): AnnotatedPair {
  sequence += 1;
  return { queryId, resourceId: `res-${String(sequence).padStart(4, "0")}`, a, b };
}

function repeat(count: number, a: number, b: number, queryId = "qry-001"): AnnotatedPair[] {
  return Array.from({ length: count }, () => pair(a, b, queryId));
}

describe("weightedKappa", () => {
  it("computes a hand-derived quadratic kappa", () => {
    // Pairs: (0,0), (0,0), (2,3), (3,2).  n = 4.
    //   observed disagreement = (0 + 0 + 1/9 + 1/9) / 4 = 1/18
    //   row totals   = [2, 0, 1, 1]; column totals = [2, 0, 1, 1]
    //   expected     = ( (4/9)(2) + (1)(2) + (4/9)(2) + (1/9)(1)
    //                    + (1)(2) + (1/9)(1) ) / 16 = 6/16 = 0.375
    //   kappa        = 1 - (1/18) / (3/8) = 1 - 4/27 = 23/27
    const pairs = [pair(0, 0), pair(0, 0), pair(2, 3), pair(3, 2)];
    const result = weightedKappa(pairs, "quadratic");
    expect(result.observedDisagreement).toBeCloseTo(1 / 18, 12);
    expect(result.expectedDisagreement).toBeCloseTo(0.375, 12);
    expect(result.kappa).toBeCloseTo(23 / 27, 12);
    expect(result.kappa).toBeCloseTo(0.851852, 5);
  });

  it("computes a hand-derived linear kappa on the same data", () => {
    //   observed = (1/3 + 1/3) / 4 = 1/6
    //   expected = (4/3 + 2 + 4/3 + 1/3 + 2 + 1/3) / 16 = (22/3)/16 = 11/24
    //   kappa    = 1 - (1/6) / (11/24) = 1 - 4/11 = 7/11
    const pairs = [pair(0, 0), pair(0, 0), pair(2, 3), pair(3, 2)];
    const result = weightedKappa(pairs, "linear");
    expect(result.observedDisagreement).toBeCloseTo(1 / 6, 12);
    expect(result.expectedDisagreement).toBeCloseTo(11 / 24, 12);
    expect(result.kappa).toBeCloseTo(7 / 11, 12);
  });

  it("is 1 for perfect agreement across a spread of grades", () => {
    const pairs = [pair(0, 0), pair(1, 1), pair(2, 2), pair(3, 3), pair(0, 0)];
    expect(weightedKappa(pairs).kappa).toBeCloseTo(1, 12);
  });

  it("is negative when annotators agree less than chance would predict", () => {
    // Systematic inversion: A says 3 whenever B says 0 and vice versa.
    const pairs = [pair(0, 3), pair(3, 0), pair(0, 3), pair(3, 0)];
    expect(weightedKappa(pairs).kappa).toBeLessThan(0);
  });

  it("is null, not 1, when expected disagreement is 0", () => {
    // Both annotators used one grade for everything: kappa is 0/0. Reporting
    // 1.0 here is exactly the inflation §8 exists to prevent.
    const result = weightedKappa(repeat(20, 0, 0));
    expect(result.kappa).toBeNull();
    expect(result.undefinedReason).toBe("zero-expected-disagreement");
  });

  it("is null for an empty stratum", () => {
    const result = weightedKappa([]);
    expect(result.kappa).toBeNull();
    expect(result.undefinedReason).toBe("no-pairs");
    expect(result.n).toBe(0);
  });

  it("penalises a 0-vs-3 disagreement nine times harder than 0-vs-1 (quadratic)", () => {
    const mild = weightedKappa([...repeat(9, 0, 0), ...repeat(9, 3, 3), pair(0, 1)]);
    const severe = weightedKappa([...repeat(9, 0, 0), ...repeat(9, 3, 3), pair(0, 3)]);
    expect(mild.observedDisagreement).toBeCloseTo(severe.observedDisagreement / 9, 12);
    expect(mild.kappa!).toBeGreaterThan(severe.kappa!);
  });

  it("rejects grades outside 0..3", () => {
    expect(() => weightedKappa([{ queryId: "q", resourceId: "r", a: 4, b: 0 }])).toThrow(RangeError);
  });
});

describe("confusionMatrix", () => {
  it("indexes [annotatorA][annotatorB] over a full 4x4 grid", () => {
    const matrix = confusionMatrix([pair(0, 0), pair(0, 1), pair(2, 3), pair(3, 3)]);
    expect(matrix).toHaveLength(4);
    expect(matrix.every(row => row.length === 4)).toBe(true);
    expect(matrix[0]![0]).toBe(1);
    expect(matrix[0]![1]).toBe(1);
    expect(matrix[2]![3]).toBe(1);
    expect(matrix[3]![3]).toBe(1);
    expect(matrix.flat().reduce((sum, value) => sum + value, 0)).toBe(4);
  });

  it("renders with row, column and grand totals", () => {
    const text = formatConfusionMatrix(confusionMatrix([pair(0, 0), pair(2, 3)]));
    expect(text).toContain("A\\B");
    expect(text.split("\n")).toHaveLength(6); // header + 4 grade rows + totals
    expect(text.trim().endsWith("2")).toBe(true);
  });
});

describe("defaultRelevantFamily", () => {
  it("keeps a candidate either annotator placed at grade >= 1", () => {
    expect(defaultRelevantFamily(pair(0, 1))).toBe(true);
    expect(defaultRelevantFamily(pair(1, 0))).toBe(true);
    expect(defaultRelevantFamily(pair(3, 0))).toBe(true);
  });

  it("excludes a candidate both annotators called grade 0", () => {
    expect(defaultRelevantFamily(pair(0, 0))).toBe(false);
  });
});

describe("stratifiedAgreement — reports all five §8 figures", () => {
  const pairs = [pair(0, 0), pair(0, 0), pair(2, 3), pair(3, 2)];
  const report = stratifiedAgreement(pairs);

  it("1. weighted kappa across all pooled candidates", () => {
    expect(report.overall.kappaQuadratic.kappa).toBeCloseTo(23 / 27, 12);
    expect(report.overall.n).toBe(4);
  });

  it("2. weighted kappa restricted to relevant-family candidates", () => {
    // Restricted stratum is {(2,3), (3,2)}, n = 2.
    //   observed = (1/9 + 1/9) / 2 = 1/9
    //   row = [0,0,1,1], col = [0,0,1,1]
    //   expected = ( (1/9)(1) + (1/9)(1) ) / 4 = 1/18
    //   kappa = 1 - (1/9)/(1/18) = -1
    expect(report.relevantFamily.n).toBe(2);
    expect(report.relevantFamily.kappaQuadratic.kappa).toBeCloseTo(-1, 12);
  });

  it("3. exact agreement rate", () => {
    expect(report.exactAgreement).toBe(0.5);
    expect(report.relevantFamily.exactAgreement).toBe(0);
    expect(report.nonRelevantFamily.exactAgreement).toBe(1);
  });

  it("4. the full 4x4 confusion matrix", () => {
    expect(report.confusionMatrix[0]![0]).toBe(2);
    expect(report.confusionMatrix[2]![3]).toBe(1);
    expect(report.confusionMatrix[3]![2]).toBe(1);
  });

  it("5. disagreement rate among pairs where either annotator gave 2 or 3", () => {
    expect(report.boundary.n).toBe(2);
    expect(report.boundary.disagreements).toBe(2);
    expect(report.boundary.disagreementRate).toBe(1);
    expect(report.boundary.twoVsThree).toEqual({ n: 2, aTwoBThree: 1, aThreeBTwo: 1 });
    expect(report.boundary.relevantVsNotRelevant).toBe(0);
  });

  it("exposes the inflation directly", () => {
    // 0.8519 pooled versus -1.0 restricted: the pooled figure is meaningless.
    expect(report.inflation).toBeCloseTo(23 / 27 + 1, 12);
    expect(report.passes).toBe(false);
  });
});

describe("stratifiedAgreement — the §8 inflation failure mode at realistic scale", () => {
  // A pool dominated by obvious grade 0s, with genuinely bad agreement at the
  // 2-vs-3 boundary. This is the exact situation §8 says a single kappa hides.
  const easy = repeat(800, 0, 0, "qry-010");           // unanimous, trivial
  const boundary = [
    ...repeat(40, 2, 3, "qry-011"),
    ...repeat(40, 3, 2, "qry-011"),
    ...repeat(20, 3, 3, "qry-012"),
    ...repeat(20, 2, 2, "qry-012"),
  ];
  const family = repeat(20, 1, 1, "qry-013");
  const report = stratifiedAgreement([...easy, ...boundary, ...family]);

  it("shows a pooled kappa that looks excellent", () => {
    // 0.94 — anyone reading this single number would sign off on the dataset.
    expect(report.overall.kappaQuadratic.kappa!).toBeGreaterThan(0.9);
    expect(report.exactAgreement!).toBeGreaterThan(0.9);
  });

  it("shows the restricted kappa is far worse and below the §8 target", () => {
    // 0.42 — the annotators do not actually agree about relevance.
    expect(report.relevantFamily.kappaQuadratic.kappa!).toBeLessThan(report.overall.kappaQuadratic.kappa!);
    expect(report.relevantFamily.kappaQuadratic.kappa!).toBeLessThan(KAPPA_TARGET);
    expect(report.relevantFamily.kappaQuadratic.kappa!).toBeCloseTo(0.4167, 3);
  });

  it("blocks on the restricted stratum, not the pooled one", () => {
    expect(report.passes).toBe(false);
    expect(report.summary.some(line => line.startsWith("BLOCKED"))).toBe(true);
  });

  it("quantifies the inflation and the share of the pool responsible", () => {
    expect(report.inflation!).toBeGreaterThan(0.5);
    // 800 unanimous zeros out of 940 pooled pairs.
    expect(report.nonRelevantFamily.share).toBeCloseTo(800 / 940, 12);
    expect(report.nonRelevantFamily.n).toBe(800);
  });

  it("isolates the boundary disagreement rate", () => {
    // 120 boundary pairs (max grade >= 2), 80 of which disagree.
    expect(report.boundary.n).toBe(120);
    expect(report.boundary.disagreementRate).toBeCloseTo(80 / 120, 12);
    expect(report.boundary.twoVsThree.n).toBe(80);
    expect(report.boundary.twoVsThree).toEqual({ n: 80, aTwoBThree: 40, aThreeBTwo: 40 });
  });

  it("counts queries, not just pairs", () => {
    expect(report.pairs).toBe(940);
    expect(report.queries).toBe(4);
  });
});

describe("stratifiedAgreement — a pool that genuinely passes", () => {
  const report = stratifiedAgreement([
    ...repeat(200, 0, 0, "q1"),
    ...repeat(40, 1, 1, "q2"),
    ...repeat(40, 2, 2, "q3"),
    ...repeat(40, 3, 3, "q3"),
    ...repeat(6, 2, 3, "q3"),
    ...repeat(4, 1, 2, "q2"),
  ]);

  it("passes when the restricted kappa clears 0.6", () => {
    expect(report.relevantFamily.kappaQuadratic.kappa!).toBeGreaterThanOrEqual(KAPPA_TARGET);
    expect(report.passes).toBe(true);
    expect(report.summary.some(line => line.startsWith("PASS"))).toBe(true);
  });

  it("still reports the boundary stratum separately", () => {
    // 40 (2,2) + 40 (3,3) + 6 (2,3) + 4 (1,2) = 90 boundary pairs, 10 disagree.
    expect(report.boundary.n).toBe(90);
    expect(report.boundary.disagreementRate).toBeCloseTo(10 / 90, 12);
    expect(report.boundary.relevantVsNotRelevant).toBe(4);
  });
});

describe("stratifiedAgreement — stratum overrides", () => {
  it("honours an explicit per-pair relevantFamily flag over the default predicate", () => {
    const pairs: AnnotatedPair[] = [
      { queryId: "q", resourceId: "r1", a: 0, b: 0, relevantFamily: true },
      { queryId: "q", resourceId: "r2", a: 0, b: 1, relevantFamily: false },
      { queryId: "q", resourceId: "r3", a: 3, b: 3, relevantFamily: true },
    ];
    const report = stratifiedAgreement(pairs);
    expect(report.relevantFamily.n).toBe(2);
    expect(report.nonRelevantFamily.n).toBe(1);
    expect(report.relevantFamily.description).toContain("frozen family label");
    expect(report.relevantFamily.description).not.toContain("either annotator placed");
  });

  it("honours a custom predicate", () => {
    const pairs = [pair(0, 0), pair(1, 1), pair(2, 2), pair(3, 3)];
    const report = stratifiedAgreement(pairs, {
      relevantFamilyPredicate: candidate => Math.max(candidate.a, candidate.b) >= 2,
    });
    expect(report.relevantFamily.n).toBe(2);
    expect(report.relevantFamily.description).toContain("supplied relevant-family predicate");
  });

  it("handles an empty input without throwing", () => {
    const report = stratifiedAgreement([]);
    expect(report.pairs).toBe(0);
    expect(report.overall.kappaQuadratic.kappa).toBeNull();
    expect(report.relevantFamily.kappaQuadratic.kappa).toBeNull();
    expect(report.boundary.disagreementRate).toBeNull();
    expect(report.inflation).toBeNull();
    expect(report.passes).toBe(false);
  });
});
