/**
 * Unit tests for `significance.ts`.
 *
 * The permutation p-values below are exact combinatorics, computed by hand:
 * with n paired differences there are 2^n sign assignments, and the p-value is
 * the share of them at least as extreme as the observed statistic.
 */

import { describe, expect, it } from "vitest";
import {
  bootstrapMeanCI,
  compareRuns,
  createRandom,
  pairedBootstrapCI,
  pairedPermutationTest,
  selfTest,
} from "../../lib/significance.js";

describe("paired permutation test — exact enumeration", () => {
  it("gives 2/16 for four uniformly positive differences (two-sided)", () => {
    // differences = [+0.1, +0.1, +0.1, +0.1], observed mean = +0.1.
    // Of the 2^4 = 16 sign assignments only all-positive (+0.1) and
    // all-negative (-0.1) reach |mean| >= 0.1, so p = 2/16 = 0.125.
    const result = pairedPermutationTest([0, 0, 0, 0], [0.1, 0.1, 0.1, 0.1]);
    expect(result.exact).toBe(true);
    expect(result.iterations).toBe(16);
    expect(result.observedDiff).toBeCloseTo(0.1, 12);
    expect(result.pValue).toBe(2 / 16);
  });

  it("gives 1/16 for the same data under the one-sided 'greater' alternative", () => {
    // Only the all-positive assignment reaches mean >= +0.1.
    const result = pairedPermutationTest([0, 0, 0, 0], [0.1, 0.1, 0.1, 0.1], { alternative: "greater" });
    expect(result.pValue).toBe(1 / 16);
  });

  it("gives 2/32 for five uniformly positive differences", () => {
    const result = pairedPermutationTest([0, 0, 0, 0, 0], [1, 1, 1, 1, 1]);
    expect(result.iterations).toBe(32);
    expect(result.pValue).toBe(2 / 32);
  });

  it("cannot reach significance at n = 4 — the exact minimum p is 0.125", () => {
    // Worth pinning: at tiny n the test is powerless no matter how large the
    // effect. This is the same phenomenon §10 warns about at n=50.
    const result = pairedPermutationTest([0, 0, 0, 0], [10, 10, 10, 10]);
    expect(result.pValue).toBe(0.125);
    expect(result.pValue).toBeGreaterThan(0.05);
  });

  it("returns p = 1 for identical runs", () => {
    const values = [0.1, 0.5, 0.9, 0.3];
    const result = pairedPermutationTest(values, values);
    expect(result.pValue).toBe(1);
    expect(result.ties).toBe(4);
    expect(result.observedDiff).toBe(0);
  });

  it("counts per-query ties without letting them create signal", () => {
    // Three ties and one +1: differences [0,0,0,1]. Sign flips of the zeros do
    // nothing, so of 16 assignments 8 give mean +0.25 and 8 give -0.25; all 16
    // satisfy |mean| >= 0.25, giving p = 1.
    const result = pairedPermutationTest([0, 0, 0, 0], [0, 0, 0, 1]);
    expect(result.ties).toBe(3);
    expect(result.pValue).toBe(1);
  });

  it("is symmetric under swapping the two runs (two-sided)", () => {
    const a = [0.2, 0.4, 0.1, 0.9, 0.5];
    const b = [0.3, 0.5, 0.0, 0.95, 0.6];
    expect(pairedPermutationTest(a, b).pValue).toBe(pairedPermutationTest(b, a).pValue);
  });

  it("rejects mismatched vector lengths", () => {
    expect(() => pairedPermutationTest([1, 2], [1])).toThrow(RangeError);
  });

  it("returns a neutral result for empty input", () => {
    const result = pairedPermutationTest([], []);
    expect(result.pValue).toBe(1);
    expect(result.n).toBe(0);
  });
});

describe("paired permutation test — Monte Carlo at n = 50", () => {
  const baseline = Array.from({ length: 50 }, (_, index) => 0.40 + (index % 10) / 100);
  const candidateBig = baseline.map(value => value + 0.10);

  it("switches to Monte Carlo above the exact threshold", () => {
    const result = pairedPermutationTest(baseline, candidateBig, { iterations: 5_000, seed: 1 });
    expect(result.exact).toBe(false);
    expect(result.n).toBe(50);
    expect(result.iterations).toBe(5_000);
  });

  it("detects a uniform +0.10 shift at n = 50", () => {
    // Every difference has the same sign and magnitude, so only the all-same-sign
    // assignments are as extreme: true p = 2/2^50, far below any usable alpha.
    const result = pairedPermutationTest(baseline, candidateBig, { iterations: 5_000, seed: 1 });
    expect(result.pValue).toBeLessThan(0.001);
  });

  it("never reports p = 0 — a Monte Carlo test cannot resolve below 1/m", () => {
    const result = pairedPermutationTest(baseline, candidateBig, { iterations: 1_000, seed: 1 });
    expect(result.pValue).toBe(1 / 1_001);
    expect(result.pValue).toBeGreaterThan(0);
  });

  it("does not flag a null difference at n = 50", () => {
    const random = createRandom(99);
    const noisy = baseline.map(value => value + (random() - 0.5) * 0.02);
    const result = pairedPermutationTest(baseline, noisy, { iterations: 5_000, seed: 3 });
    expect(result.pValue).toBeGreaterThan(0.05);
  });

  it("is deterministic for a fixed seed", () => {
    const random = createRandom(11);
    const noisy = baseline.map(value => value + (random() - 0.5) * 0.05);
    const first = pairedPermutationTest(baseline, noisy, { iterations: 2_000, seed: 7 });
    const second = pairedPermutationTest(baseline, noisy, { iterations: 2_000, seed: 7 });
    expect(first).toEqual(second);
  });
});

describe("bootstrap confidence intervals", () => {
  it("collapses to a point when every paired difference is identical", () => {
    // Every resample of a constant vector has the same mean, so the interval
    // has zero width. A useful sanity check on the resampling machinery.
    const baseline = [0.1, 0.2, 0.3, 0.4, 0.5];
    const candidate = baseline.map(value => value + 0.2);
    const interval = pairedBootstrapCI(baseline, candidate, { iterations: 500, seed: 5 });
    expect(interval.point).toBeCloseTo(0.2, 12);
    expect(interval.lower).toBeCloseTo(0.2, 12);
    expect(interval.upper).toBeCloseTo(0.2, 12);
    expect(interval.standardError).toBeCloseTo(0, 12);
  });

  it("brackets the point estimate and excludes 0 for a real effect at n = 50", () => {
    const baseline = Array.from({ length: 50 }, (_, index) => 0.4 + (index % 10) / 100);
    const candidate = baseline.map((value, index) => value + 0.08 + (index % 3) * 0.005);
    const interval = pairedBootstrapCI(baseline, candidate, { iterations: 5_000, seed: 21 });
    expect(interval.lower).toBeLessThanOrEqual(interval.point);
    expect(interval.upper).toBeGreaterThanOrEqual(interval.point);
    expect(interval.lower).toBeGreaterThan(0);
    expect(interval.n).toBe(50);
    expect(interval.level).toBe(0.95);
  });

  it("includes 0 when the two runs are the same", () => {
    const values = Array.from({ length: 50 }, (_, index) => index / 100);
    const interval = pairedBootstrapCI(values, values, { iterations: 1_000, seed: 4 });
    expect(interval.lower).toBe(0);
    expect(interval.upper).toBe(0);
    expect(interval.point).toBe(0);
  });

  it("widens as the confidence level rises", () => {
    const baseline = Array.from({ length: 50 }, (_, index) => (index * 7 % 50) / 50);
    const candidate = baseline.map((value, index) => value + ((index % 5) - 2) * 0.05);
    const narrow = pairedBootstrapCI(baseline, candidate, { iterations: 4_000, seed: 8, level: 0.80 });
    const wide = pairedBootstrapCI(baseline, candidate, { iterations: 4_000, seed: 8, level: 0.99 });
    expect(wide.upper - wide.lower).toBeGreaterThan(narrow.upper - narrow.lower);
  });

  it("resamples queries as paired units, not the two runs independently", () => {
    // Perfectly correlated runs offset by a constant have zero variance in the
    // *difference*. Independent resampling would produce a wide interval; the
    // zero-width result proves the pairing is preserved.
    const baseline = Array.from({ length: 40 }, (_, index) => index / 40);
    const candidate = baseline.map(value => value + 0.05);
    const paired = pairedBootstrapCI(baseline, candidate, { iterations: 2_000, seed: 6 });
    const marginal = bootstrapMeanCI(baseline, { iterations: 2_000, seed: 6 });
    expect(paired.upper - paired.lower).toBeLessThan(1e-12);
    expect(marginal.upper - marginal.lower).toBeGreaterThan(0.1);
  });

  it("gives a single-run mean CI containing the sample mean", () => {
    const values = Array.from({ length: 50 }, (_, index) => 0.3 + (index % 7) / 20);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const interval = bootstrapMeanCI(values, { iterations: 3_000, seed: 12 });
    expect(interval.point).toBeCloseTo(mean, 12);
    expect(interval.lower).toBeLessThan(mean);
    expect(interval.upper).toBeGreaterThan(mean);
    expect(Math.abs(interval.bias)).toBeLessThan(0.02);
  });

  it("is deterministic for a fixed seed", () => {
    const baseline = Array.from({ length: 50 }, (_, index) => (index % 11) / 11);
    const candidate = baseline.map((value, index) => value + ((index % 4) - 1) * 0.03);
    const first = pairedBootstrapCI(baseline, candidate, { iterations: 1_000, seed: 42 });
    const second = pairedBootstrapCI(baseline, candidate, { iterations: 1_000, seed: 42 });
    expect(first).toEqual(second);
  });
});

describe("compareRuns", () => {
  const baseline = Array.from({ length: 50 }, (_, index) => 0.40 + (index % 10) / 100);

  it("reports a p-value AND an interval, and calls a large effect significant", () => {
    const candidate = baseline.map((value, index) => value + 0.08 + (index % 4) * 0.004);
    const report = compareRuns(baseline, candidate, { metric: "nDCG@10", seed: 31, iterations: 5_000 });
    expect(report.n).toBe(50);
    expect(report.permutation.pValue).toBeLessThan(0.05);
    expect(report.difference.lower).toBeGreaterThan(0);
    expect(report.significant).toBe(true);
    expect(report.summary).toContain("nDCG@10");
    expect(report.summary).toContain("95% CI");
    expect(report.summary).toContain("Significant");
  });

  it("says so plainly when a comparison is not significant at n = 50", () => {
    // A ~0.002 mean difference swamped by per-query variance — the §10 case.
    const random = createRandom(77);
    const candidate = baseline.map(value => value + 0.002 + (random() - 0.5) * 0.2);
    const report = compareRuns(baseline, candidate, { metric: "nDCG@10", seed: 31, iterations: 5_000 });
    expect(report.significant).toBe(false);
    expect(report.summary).toContain("NOT significant");
    expect(report.difference.lower).toBeLessThan(0);
    expect(report.difference.upper).toBeGreaterThan(0);
  });

  it("requires both the p-value and the interval to agree before claiming significance", () => {
    const identical = compareRuns(baseline, baseline, { metric: "nDCG@10", seed: 2 });
    expect(identical.permutation.pValue).toBe(1);
    expect(identical.significant).toBe(false);
    expect(identical.summary).toContain("includes 0");
  });

  it("reports separate CIs for each run's own mean", () => {
    const candidate = baseline.map(value => value + 0.08);
    const report = compareRuns(baseline, candidate, { metric: "nDCG@10", seed: 31, iterations: 2_000 });
    expect(report.baselineCI.point).toBeCloseTo(report.baselineMean, 12);
    expect(report.candidateCI.point).toBeCloseTo(report.candidateMean, 12);
    expect(report.candidateMean - report.baselineMean).toBeCloseTo(0.08, 10);
  });

  it("handles an empty comparison without throwing", () => {
    const report = compareRuns([], []);
    expect(report.n).toBe(0);
    expect(report.significant).toBe(false);
    expect(report.summary).toContain("no paired queries");
  });
});

describe("self-test on synthetic data with a known effect", () => {
  const report = selfTest();

  it("passes every synthetic case", () => {
    const failures = report.cases.filter(entry => !entry.passed);
    expect(failures.map(entry => entry.name)).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("detects a planted effect of +0.08 at n = 50", () => {
    const known = report.cases.find(entry => entry.name === "known-large-effect@n50")!;
    expect(known.trueEffect).toBe(0.08);
    // Recovered effect is attenuated slightly by clipping scores into [0,1].
    expect(known.observedDiff).toBeGreaterThan(0.05);
    expect(known.observedDiff).toBeLessThan(0.09);
    expect(known.pValue).toBeLessThan(0.01);
    expect(known.ciLower).toBeGreaterThan(0);
    expect(known.significant).toBe(true);
  });

  it("does not manufacture a result from a true null", () => {
    const nullCase = report.cases.find(entry => entry.name === "true-null@n50")!;
    expect(nullCase.significant).toBe(false);
    expect(nullCase.ciLower).toBeLessThanOrEqual(0);
    expect(nullCase.ciUpper).toBeGreaterThanOrEqual(0);
  });

  it("stays silent on an underpowered tiny effect, as §10 requires", () => {
    const tiny = report.cases.find(entry => entry.name === "underpowered-tiny-effect@n50")!;
    expect(tiny.trueEffect).toBe(0.002);
    expect(tiny.significant).toBe(false);
  });

  it("is deterministic across invocations", () => {
    expect(selfTest()).toEqual(report);
  });
});

describe("createRandom", () => {
  it("is a deterministic uniform generator in [0,1)", () => {
    const a = createRandom(123);
    const b = createRandom(123);
    const c = createRandom(124);
    let differsFromOtherSeed = false;
    for (let index = 0; index < 1_000; index += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      if (value !== c()) differsFromOtherSeed = true;
    }
    expect(differsFromOtherSeed).toBe(true);
  });

  it("has an approximately uniform mean", () => {
    const random = createRandom(2024);
    let total = 0;
    for (let index = 0; index < 100_000; index += 1) total += random();
    expect(total / 100_000).toBeCloseTo(0.5, 2);
  });
});
