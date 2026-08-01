import { describe, expect, it } from "vitest";
import { applyOriginDiversity, fuse } from "../../src/search/fusion.js";
import {
  DEFAULT_CUTOFFS, aggregate, lift, scoreQuery, type EvalQuery,
} from "../../src/search/evaluate.js";

const doc = (resourceId: number) => ({ resourceId, versionId: resourceId * 10 });

describe("weighted reciprocal rank fusion", () => {
  it("uses only rank positions, never the raw branch scores", () => {
    const fused = fuse([
      { name: "lexical", weight: 0.35, candidates: [doc(1), doc(2)] },
      { name: "semantic", weight: 0.65, candidates: [doc(2), doc(1)] },
    ], 60);

    // 0.35/61 + 0.65/62 for doc 1; 0.35/62 + 0.65/61 for doc 2.
    expect(fused[0]!.resourceId).toBe(2);
    expect(fused[0]!.score).toBeCloseTo(0.35 / 62 + 0.65 / 61, 12);
    expect(fused[1]!.score).toBeCloseTo(0.35 / 61 + 0.65 / 62, 12);
    expect(fused[0]!.ranks).toEqual({ lexical: 2, semantic: 1 });
  });

  it("adds nothing for a branch that did not return the document", () => {
    const fused = fuse([
      { name: "lexical", weight: 1, candidates: [doc(1)] },
      { name: "semantic", weight: 1, candidates: [doc(2)] },
    ], 60);
    expect(fused.map(entry => entry.score)).toEqual([1 / 61, 1 / 61]);
    // Equal scores fall back to the deterministic resource-id tie-break.
    expect(fused.map(entry => entry.resourceId)).toEqual([2, 1]);
  });

  it("ignores a branch whose weight is zero", () => {
    const fused = fuse([
      { name: "lexical", weight: 0, candidates: [doc(1)] },
      { name: "semantic", weight: 1, candidates: [doc(2)] },
    ], 60);
    expect(fused.map(entry => entry.resourceId)).toEqual([2]);
  });

  it("is deterministic across repeated runs over the same input", () => {
    const branches = [
      { name: "lexical", weight: 0.35, candidates: [doc(3), doc(1), doc(2)] },
      { name: "semantic", weight: 0.65, candidates: [doc(2), doc(3), doc(1)] },
    ];
    const first = fuse(branches, 60).map(entry => entry.resourceId);
    const second = fuse(branches, 60).map(entry => entry.resourceId);
    expect(first).toEqual(second);
  });

  it("respects the configured rrf constant", () => {
    const branches = [{ name: "lexical", weight: 1, candidates: [doc(1)] }];
    expect(fuse(branches, 0)[0]!.score).toBeCloseTo(1, 12);
    expect(fuse(branches, 60)[0]!.score).toBeCloseTo(1 / 61, 12);
  });
});

describe("origin diversity", () => {
  const origins = new Map([[1, "a.example"], [2, "a.example"], [3, "a.example"], [4, "b.example"]]);

  it("demotes rather than drops over-represented origins", () => {
    const fused = [1, 2, 3, 4].map(id => ({
      resourceId: id, versionId: id * 10, score: 1 - id / 100, ranks: {},
    }));
    const diversified = applyOriginDiversity(fused, origins, 2);
    expect(diversified.map(entry => entry.resourceId)).toEqual([1, 2, 4, 3]);
    expect(diversified).toHaveLength(4);
  });

  it("is a no-op when the limit is not positive", () => {
    const fused = [{ resourceId: 1, versionId: 10, score: 1, ranks: {} }];
    expect(applyOriginDiversity(fused, origins, 0)).toEqual(fused);
  });
});

describe("evaluation metrics", () => {
  const query: EvalQuery = {
    query: "weather",
    queryClass: "lexical",
    judgments: [
      { resource: "ideal", grade: 3 },
      { resource: "relevant", grade: 2 },
      { resource: "marginal", grade: 1 },
      { resource: "forbidden", grade: 0 },
    ],
  };

  it("computes recall, precision, MRR and violations at each cutoff", () => {
    const metrics = scoreQuery(query, ["ideal", "forbidden", "relevant"], 5);
    expect(metrics.recall[1]).toBeCloseTo(0.5);
    expect(metrics.recall[3]).toBeCloseTo(1);
    expect(metrics.precision[1]).toBeCloseTo(1);
    expect(metrics.mrr).toBeCloseTo(1);
    expect(metrics.violations[1]).toBe(0);
    expect(metrics.violations[3]).toBe(1);
    expect(metrics.precision[5]).toBeCloseTo(2 / 5);
  });

  it("scores a perfect ordering as nDCG 1", () => {
    const metrics = scoreQuery(query, ["ideal", "relevant", "marginal", "forbidden"], 1);
    expect(metrics.ndcg[3]).toBeCloseTo(1);
  });

  it("penalises an inverted ordering", () => {
    const perfect = scoreQuery(query, ["ideal", "relevant", "marginal"], 1);
    const inverted = scoreQuery(query, ["marginal", "relevant", "ideal"], 1);
    expect(inverted.ndcg[3]).toBeLessThan(perfect.ndcg[3]!);
    expect(inverted.mrr).toBeCloseTo(0.5);
  });

  it("treats a query with no relevant judgments as satisfied", () => {
    const empty: EvalQuery = { query: "nothing", queryClass: "no-result", judgments: [] };
    const metrics = scoreQuery(empty, [], 1);
    expect(metrics.recall[5]).toBe(1);
    expect(metrics.hasResult).toBe(false);
  });

  it("aggregates latency percentiles, no-result rate and fallback counts", () => {
    const results = [
      { query, metrics: scoreQuery(query, ["ideal"], 10), degraded: { semantic: "used", reranking: "disabled" } },
      { query, metrics: scoreQuery(query, [], 90), degraded: { semantic: "timeout", reranking: "unavailable" } },
    ];
    const suite = aggregate(results, 12);
    expect(suite.queries).toBe(2);
    expect(suite.noResultRate).toBeCloseTo(0.5);
    expect(suite.latency.p50).toBe(10);
    expect(suite.latency.p95).toBe(90);
    expect(suite.fallbacks).toEqual({ semantic_timeout: 1, reranking_unavailable: 1 });
    expect(suite.catalogSize).toBe(12);
    expect(suite.byClass.lexical?.queries).toBe(2);
  });

  it("keeps no-result queries out of aggregate ranking metrics", () => {
    const noResult: EvalQuery = {
      query: "impossible capability",
      queryClass: "no-result",
      judgments: [{ resource: "irrelevant", grade: 0 }],
    };
    const ranked = { query, metrics: scoreQuery(query, ["ideal"], 10), degraded: {} };
    const empty = { query: noResult, metrics: scoreQuery(noResult, [], 10), degraded: {} };
    const suite = aggregate([ranked, empty], 2);

    expect(suite.queries).toBe(2);
    expect(suite.rankingQueries).toBe(1);
    expect(suite.recall[1]).toBe(ranked.metrics.recall[1]);
    expect(suite.precision[5]).toBe(ranked.metrics.precision[5]);
    expect(suite.ndcg[5]).toBe(ranked.metrics.ndcg[5]);
    expect(suite.byClass["no-result"]?.rankingQueries).toBe(0);
    expect(suite.noResultAccuracy).toBe(1);
  });

  it("reports lift as a signed difference so a regression is visible", () => {
    const baseline = aggregate([{ query, metrics: scoreQuery(query, ["marginal", "ideal"], 1), degraded: {} }], 1);
    const candidate = aggregate([{ query, metrics: scoreQuery(query, ["ideal", "relevant"], 1), degraded: {} }], 1);
    const report = lift(baseline, candidate);
    expect(report["recall@1"]).toBeGreaterThan(0);
    expect(report.mrr).toBeGreaterThan(0);
    expect(lift(candidate, baseline).mrr).toBeLessThan(0);
    expect(Object.keys(report)).toEqual(
      expect.arrayContaining(DEFAULT_CUTOFFS.map(k => `recall@${k}`)),
    );
  });
});
