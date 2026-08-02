/**
 * Unit tests for `scoring.ts`.
 *
 * Every expected value below is hand-derived and the derivation is written out
 * in the test, either as a comment or as the literal arithmetic. A test that
 * asserts whatever the implementation happened to print is not a test.
 *
 * The tests that matter most are the ones separating UNJUDGED from explicit
 * grade 0 — see "unjudged is not grade 0".
 */

import { describe, expect, it } from "vitest";
import {
  aggregate,
  DEFAULT_CUTOFFS,
  GAIN_BY_GRADE,
  gain,
  metricSelectors,
  pairedVectors,
  Qrels,
  RELEVANT_GRADE,
  scoreQuery,
  scoreRun,
  type EvalQuery,
} from "./scoring.js";

const LOG2_3 = Math.log2(3);

function query(overrides: Partial<EvalQuery> & Pick<EvalQuery, "judgments">): EvalQuery {
  return {
    queryId: overrides.queryId ?? "qry-001",
    queryClass: overrides.queryClass ?? "capability",
    ...(overrides.expectsNoResult === undefined ? {} : { expectsNoResult: overrides.expectsNoResult }),
    judgments: overrides.judgments,
  };
}

function score(
  judgments: EvalQuery["judgments"],
  ranking: string[],
  cutoffs: readonly number[] = DEFAULT_CUTOFFS,
) {
  return scoreQuery(query({ judgments }), { queryId: "qry-001", ranking }, { cutoffs });
}

describe("pinned constants (BUILD-PLAN §10)", () => {
  it("uses gain 2^g - 1 -> 0, 1, 3, 7", () => {
    expect(GAIN_BY_GRADE).toEqual([0, 1, 3, 7]);
    expect([0, 1, 2, 3].map(gain)).toEqual([0, 1, 3, 7]);
    expect([0, 1, 2, 3].map(g => 2 ** g - 1)).toEqual([...GAIN_BY_GRADE]);
  });

  it("pins the relevance threshold at grade >= 2", () => {
    expect(RELEVANT_GRADE).toBe(2);
  });

  it("rejects grades outside 0..3", () => {
    expect(() => gain(4)).toThrow(RangeError);
    expect(() => score([{ resourceId: "a", grade: 4 }], ["a"])).toThrow(RangeError);
  });
});

describe("nDCG", () => {
  it("computes a hand-checked value with an unjudged result in the middle", () => {
    // Judged: A=3, B=2, C=0. D is unjudged. Ranking [A, D, B].
    //   DCG@3   = 7/log2(2) + 0/log2(3) + 3/log2(4) = 7 + 0 + 1.5 = 8.5
    //   iDCG@3  = 7/log2(2) + 3/log2(3) + 0/log2(4) = 7 + 3/log2(3)
    const result = score(
      [{ resourceId: "A", grade: 3 }, { resourceId: "B", grade: 2 }, { resourceId: "C", grade: 0 }],
      ["A", "D", "B"],
      [3],
    );
    const expectedDcg = 7 + 0 + 3 / 2;
    const expectedIdeal = 7 + 3 / LOG2_3;
    expect(expectedDcg).toBe(8.5);
    expect(result.ndcg[3]).toBeCloseTo(expectedDcg / expectedIdeal, 12);
    expect(result.ndcg[3]).toBeCloseTo(0.955831, 5);
  });

  it("is 1 for a perfectly ordered ranking", () => {
    const result = score(
      [{ resourceId: "A", grade: 3 }, { resourceId: "B", grade: 2 }, { resourceId: "C", grade: 1 }],
      ["A", "B", "C"],
      [3],
    );
    expect(result.ndcg[3]).toBeCloseTo(1, 12);
  });

  it("is null, not 1, when no judged document carries any gain", () => {
    // Only planted traps judged: iDCG = 0, so nDCG is 0/0.
    const result = score([{ resourceId: "T1", grade: 0 }, { resourceId: "T2", grade: 0 }], ["T1", "U"], [3]);
    expect(result.ndcg[3]).toBeNull();
    expect(result.recall[3]).toBeNull();
    expect(result.mrr).toBeNull();
    expect(result.bpref).toBeNull();
  });

  it("scores an unjudged result identically to an explicit grade 0 in DCG only", () => {
    const judgments = [
      { resourceId: "A", grade: 3 },
      { resourceId: "B", grade: 2 },
      { resourceId: "T", grade: 0 },
    ];
    const withTrap = score(judgments, ["A", "T", "B"], [3]);
    const withUnjudged = score(judgments, ["A", "U", "B"], [3]);
    // Both contribute 0 gain at rank 2, so nDCG cannot tell them apart...
    expect(withTrap.ndcg[3]).toBeCloseTo(withUnjudged.ndcg[3]!, 12);
    // ...which is exactly why judged@k, violations@k and bpref must be reported.
    expect(withTrap.judged[3]).toBe(1);
    expect(withUnjudged.judged[3]).toBeCloseTo(2 / 3, 12);
    expect(withTrap.violations[3]).toBe(1);
    expect(withUnjudged.violations[3]).toBe(0);
  });
});

describe("judged@k — unjudged is a first-class state", () => {
  it("counts every grade 0..3 as judged", () => {
    const result = score(
      [
        { resourceId: "A", grade: 3 },
        { resourceId: "B", grade: 2 },
        { resourceId: "C", grade: 1 },
        { resourceId: "D", grade: 0 },
      ],
      ["A", "B", "C", "D"],
      [4],
    );
    expect(result.judged[4]).toBe(1);
    expect(result.unjudged[4]).toBe(0);
  });

  it("reports judged@k < 1 when the ranking contains unjudged results", () => {
    // Ranking [A, D, B] with D unjudged -> 2 of 3 carry a judgment.
    const result = score(
      [{ resourceId: "A", grade: 3 }, { resourceId: "B", grade: 2 }],
      ["A", "D", "B"],
      [3],
    );
    expect(result.judged[3]).toBeCloseTo(2 / 3, 12);
    expect(result.unjudged[3]).toBe(1);
    expect(result.explicitZero[3]).toBe(0);
  });

  it("separates unjudged from explicit grade 0 in the counts", () => {
    const result = score(
      [{ resourceId: "A", grade: 3 }, { resourceId: "T", grade: 0 }],
      ["A", "T", "U1", "U2"],
      [4],
    );
    expect(result.unjudged[4]).toBe(2);
    expect(result.explicitZero[4]).toBe(1);
    expect(result.violations[4]).toBe(1);
    expect(result.judged[4]).toBe(0.5);
  });

  it("REQUIRED CASE: a run can score a perfect nDCG and a terrible judged@k", () => {
    // One judged relevant document, ranked first, then four unjudged results.
    // nDCG@5 = 1 because the ideal ranking is drawn from the judged pool, which
    // has nothing better than A. judged@5 = 0.2 says: do not trust that 1.0,
    // the pool is too shallow to have ranked these four at all (§10).
    const result = score(
      [{ resourceId: "A", grade: 3 }, { resourceId: "Z", grade: 0 }],
      ["A", "U1", "U2", "U3", "U4"],
      [5],
    );
    expect(result.ndcg[5]).toBeCloseTo(1, 12);
    expect(result.recall[5]).toBe(1);
    expect(result.mrr).toBe(1);
    expect(result.judged[5]).toBeCloseTo(0.2, 12);
    expect(result.unjudged[5]).toBe(4);
    expect(result.violations[5]).toBe(0);
  });

  it("denominates by results actually returned, not by k", () => {
    // Two results at k=10: judged@10 is 1/2, not 1/10.
    const result = score([{ resourceId: "A", grade: 3 }], ["A", "U"], [10]);
    expect(result.judged[10]).toBe(0.5);
  });

  it("is null when nothing was returned", () => {
    const result = score([{ resourceId: "A", grade: 3 }], [], [10]);
    expect(result.judged[10]).toBeNull();
    expect(result.unjudged[10]).toBe(0);
  });
});

describe("MRR (grade >= 2)", () => {
  it("ignores a grade-1 document at rank 1", () => {
    // A=1 is same-family-but-wrong-capability (§7); it is not relevant.
    const result = score([{ resourceId: "A", grade: 1 }, { resourceId: "B", grade: 2 }], ["A", "B"], [3]);
    expect(result.mrr).toBe(0.5);
  });

  it("ignores unjudged documents at rank 1", () => {
    const result = score([{ resourceId: "B", grade: 2 }], ["U", "B"], [3]);
    expect(result.mrr).toBe(0.5);
  });

  it("is 0 when no relevant document is retrieved but relevant documents exist", () => {
    const result = score([{ resourceId: "B", grade: 3 }], ["U1", "U2"], [3]);
    expect(result.mrr).toBe(0);
  });

  it("is null when the query has no relevant judgment at all", () => {
    const result = score([{ resourceId: "T", grade: 0 }], ["T"], [3]);
    expect(result.mrr).toBeNull();
  });
});

describe("Recall@k (grade >= 2)", () => {
  it("counts only grade 2 and 3 in numerator and denominator", () => {
    // Relevant set is {A(3), B(2)}. C(1) and D(0) are judged but not relevant.
    const judgments = [
      { resourceId: "A", grade: 3 },
      { resourceId: "B", grade: 2 },
      { resourceId: "C", grade: 1 },
      { resourceId: "D", grade: 0 },
    ];
    const result = score(judgments, ["C", "A", "D", "B"], [1, 2, 4]);
    expect(result.relevantTotal).toBe(2);
    expect(result.recall[1]).toBe(0);
    expect(result.recall[2]).toBe(0.5);
    expect(result.recall[4]).toBe(1);
  });

  it("never credits an unjudged result as a recall hit", () => {
    const result = score([{ resourceId: "A", grade: 3 }, { resourceId: "B", grade: 2 }], ["U1", "U2"], [20]);
    expect(result.recall[20]).toBe(0);
  });
});

describe("bpref (grade >= 2)", () => {
  const judgments = [
    { resourceId: "A", grade: 3 },
    { resourceId: "B", grade: 2 },
    { resourceId: "X", grade: 0 },
    { resourceId: "Y", grade: 1 },
  ];
  // R = |{A,B}| = 2, N = |{X,Y}| = 2, min(R,N) = 2.

  it("is 1 when both relevant documents precede every judged non-relevant", () => {
    const result = score(judgments, ["A", "B", "X", "Y"], [20]);
    expect(result.bpref).toBe(1);
  });

  it("computes a hand-checked interleaved value", () => {
    // Ranking [X, A, Y, B]:
    //   X non-relevant  -> seen = 1
    //   A relevant      -> 1 - min(1,2)/2 = 0.5
    //   Y non-relevant  -> seen = 2
    //   B relevant      -> 1 - min(2,2)/2 = 0
    //   bpref = (0.5 + 0) / 2 = 0.25
    const result = score(judgments, ["X", "A", "Y", "B"], [20]);
    expect(result.bpref).toBe(0.25);
  });

  it("charges nothing for a relevant document that was never retrieved", () => {
    // Ranking [A, X]: A scores 1, B contributes 0 but stays in the denominator.
    const result = score(judgments, ["A", "X"], [20]);
    expect(result.bpref).toBe(0.5);
  });

  it("REQUIRED CASE: deletes unjudged documents from the ranking entirely", () => {
    // Two planted traps, both grade 0, so both rankings below have the exact
    // same per-position gain sequence [0, 0, 7, 3] and therefore the same nDCG.
    const traps = [
      { resourceId: "A", grade: 3 },
      { resourceId: "B", grade: 2 },
      { resourceId: "X", grade: 0 },
      { resourceId: "Y", grade: 0 },
    ];
    // Two UNJUDGED results at the head cost nothing: bpref skips them.
    const withUnjudged = score(traps, ["U1", "U2", "A", "B"], [20]);
    expect(withUnjudged.bpref).toBe(1);
    // Two explicitly judged grade-0 traps at the head cost everything:
    //   X -> seen 1; Y -> seen 2; A -> 1 - min(2,2)/2 = 0; B -> 0.
    const withTraps = score(traps, ["X", "Y", "A", "B"], [20]);
    expect(withTraps.bpref).toBe(0);
    // nDCG cannot tell the two rankings apart at all — this is precisely the
    // distinction v1 could not express, and why §10 asks for bpref too.
    expect(withUnjudged.ndcg[20]).toBeCloseTo(withTraps.ndcg[20]!, 12);
    expect(withUnjudged.judged[20]).toBe(0.5);
    expect(withTraps.judged[20]).toBe(1);
    expect(withTraps.violations[20]).toBe(2);
    expect(withUnjudged.violations[20]).toBe(0);
  });

  it("scores 1 for every retrieved relevant when there are no judged non-relevant", () => {
    const result = score([{ resourceId: "A", grade: 3 }, { resourceId: "B", grade: 2 }], ["A", "U", "B"], [20]);
    expect(result.bpref).toBe(1);
  });

  it("handles N < R without exceeding 1", () => {
    // R = 3, N = 1, min(R,N) = 1. Ranking [X, A, B, C]:
    //   X -> seen 1; A -> 1 - min(1,3)/1 = 0; B -> 0; C -> 0.
    const result = score(
      [
        { resourceId: "A", grade: 3 },
        { resourceId: "B", grade: 2 },
        { resourceId: "C", grade: 2 },
        { resourceId: "X", grade: 0 },
      ],
      ["X", "A", "B", "C"],
      [20],
    );
    expect(result.bpref).toBe(0);
  });

  it("is null when there is nothing relevant to find", () => {
    expect(score([{ resourceId: "X", grade: 0 }], ["X"], [20]).bpref).toBeNull();
  });
});

describe("violations@k", () => {
  it("counts only explicitly judged grade-0 documents", () => {
    const result = score(
      [{ resourceId: "T1", grade: 0 }, { resourceId: "T2", grade: 0 }, { resourceId: "A", grade: 3 }],
      ["A", "T1", "U", "T2"],
      [1, 2, 4],
    );
    expect(result.violations[1]).toBe(0);
    expect(result.violations[2]).toBe(1);
    expect(result.violations[4]).toBe(2);
    expect(result.violations).toEqual(result.explicitZero);
  });

  it("never counts an unjudged result as a violation", () => {
    const result = score([{ resourceId: "A", grade: 3 }], ["A", "U1", "U2"], [3]);
    expect(result.violations[3]).toBe(0);
    expect(result.unjudged[3]).toBe(2);
  });
});

describe("no-result accuracy", () => {
  it("is correct when an expects_no_result query returns nothing", () => {
    const result = scoreQuery(
      query({ queryId: "qry-090", queryClass: "no_result", expectsNoResult: true, judgments: [] }),
      { queryId: "qry-090", ranking: [] },
    );
    expect(result.noResultCorrect).toBe(true);
    expect(result.hasResult).toBe(false);
  });

  it("is incorrect when an expects_no_result query returns something", () => {
    const result = scoreQuery(
      query({ queryId: "qry-090", queryClass: "no_result", expectsNoResult: true, judgments: [] }),
      { queryId: "qry-090", ranking: ["res-0001"] },
    );
    expect(result.noResultCorrect).toBe(false);
  });

  it("is null for a query that expects results — the metric is scoped to no-result queries", () => {
    const result = score([{ resourceId: "A", grade: 3 }], ["A"], [3]);
    expect(result.noResultCorrect).toBeNull();
  });

  it("never infers no-result intent from an empty judgment list", () => {
    // A query with zero judgments but no explicit flag is NOT a no-result query.
    const result = scoreQuery(query({ judgments: [] }), { queryId: "qry-001", ranking: [] });
    expect(result.expectsNoResult).toBe(false);
    expect(result.noResultCorrect).toBeNull();
  });

  it("aggregates accuracy over the no-result queries only", () => {
    const scores = [
      scoreQuery(query({ queryId: "q1", queryClass: "no_result", expectsNoResult: true, judgments: [] }),
        { queryId: "q1", ranking: [] }),
      scoreQuery(query({ queryId: "q2", queryClass: "no_result", expectsNoResult: true, judgments: [] }),
        { queryId: "q2", ranking: ["x"] }),
      scoreQuery(query({ queryId: "q3", judgments: [{ resourceId: "A", grade: 3 }] }),
        { queryId: "q3", ranking: ["A"] }),
    ];
    const metrics = aggregate(scores);
    expect(metrics.noResult).toEqual({ queries: 2, correct: 1, accuracy: 0.5 });
    expect(metrics.hasResultRate).toBe(1);
  });
});

describe("Qrels — absence means unjudged", () => {
  it("returns undefined rather than 0 for an unjudged pair", () => {
    const qrels = Qrels.fromRecords([
      { query_id: "qry-001", resource_id: "res-0001", grade: 3 },
      { query_id: "qry-001", resource_id: "res-0002", grade: 0 },
    ]);
    expect(qrels.gradeOf("qry-001", "res-0001")).toBe(3);
    expect(qrels.gradeOf("qry-001", "res-0002")).toBe(0);
    expect(qrels.gradeOf("qry-001", "res-0999")).toBeUndefined();
    expect(qrels.stateOf("qry-001", "res-0002")).toBe("judged");
    expect(qrels.stateOf("qry-001", "res-0999")).toBe("unjudged");
    expect(qrels.stateOf("qry-002", "res-0001")).toBe("unjudged");
    expect(qrels.pairCount).toBe(2);
    expect(qrels.queryCount).toBe(1);
  });

  it("rejects out-of-range grades at load time", () => {
    expect(() => Qrels.fromRecords([{ query_id: "q", resource_id: "r", grade: -1 }])).toThrow(RangeError);
  });

  it("round-trips judgments into scoreQuery", () => {
    const qrels = Qrels.fromRecords([
      { query_id: "qry-001", resource_id: "A", grade: 3 },
      { query_id: "qry-001", resource_id: "T", grade: 0 },
    ]);
    const result = scoreQuery(
      query({ judgments: qrels.judgmentsFor("qry-001") }),
      { queryId: "qry-001", ranking: ["A", "T", "U"] },
      { cutoffs: [3] },
    );
    expect(result.judgedTotal).toBe(2);
    expect(result.violations[3]).toBe(1);
    expect(result.unjudged[3]).toBe(1);
  });
});

describe("ranking hygiene", () => {
  it("deduplicates a repeated resource id", () => {
    const result = score([{ resourceId: "A", grade: 3 }, { resourceId: "B", grade: 2 }], ["A", "A", "B"], [2]);
    expect(result.returned).toBe(2);
    expect(result.recall[2]).toBe(1);
  });

  it("scores a missing run result as an empty ranking rather than dropping the query", () => {
    const queries = [
      query({ queryId: "q1", judgments: [{ resourceId: "A", grade: 3 }] }),
      query({ queryId: "q2", judgments: [{ resourceId: "B", grade: 3 }] }),
    ];
    const { perQuery, metrics } = scoreRun(queries, [{ queryId: "q1", ranking: ["A"] }], { cutoffs: [10] });
    expect(perQuery).toHaveLength(2);
    expect(perQuery[1]!.returned).toBe(0);
    expect(perQuery[1]!.ndcg[10]).toBe(0);
    // A system cannot raise its mean by refusing to answer.
    expect(metrics.ndcg[10]!.value).toBe(0.5);
  });
});

describe("aggregation", () => {
  const scores = [
    scoreQuery(
      query({ queryId: "q1", queryClass: "capability", judgments: [{ resourceId: "A", grade: 3 }] }),
      { queryId: "q1", ranking: ["A", "U"], latencyMs: 10 },
      { cutoffs: [2] },
    ),
    scoreQuery(
      query({ queryId: "q2", queryClass: "capability", judgments: [{ resourceId: "B", grade: 3 }] }),
      { queryId: "q2", ranking: ["U", "B"], latencyMs: 30 },
      { cutoffs: [2] },
    ),
    scoreQuery(
      // All judged non-relevant: contributes no nDCG/MRR/bpref value at all.
      query({ queryId: "q3", queryClass: "adversarial", judgments: [{ resourceId: "T", grade: 0 }] }),
      { queryId: "q3", ranking: ["T", "U"], latencyMs: 20 },
      { cutoffs: [2] },
    ),
  ];
  const metrics = aggregate(scores, { cutoffs: [2] });

  it("excludes undefined values from means and reports the support", () => {
    // q1 nDCG@2 = 1; q2 nDCG@2 = (7/log2(3)) / 7; q3 nDCG@2 = null.
    const q2 = (7 / LOG2_3) / 7;
    expect(metrics.ndcg[2]!.support).toBe(2);
    expect(metrics.ndcg[2]!.value).toBeCloseTo((1 + q2) / 2, 12);
    expect(metrics.rankingQueries).toBe(2);
    expect(metrics.queries).toBe(3);
  });

  it("macro-averages judged@k across every query including the unrankable one", () => {
    // Each query returned two results with exactly one judged.
    expect(metrics.judged[2]!.value).toBe(0.5);
    expect(metrics.judged[2]!.support).toBe(3);
  });

  it("reports the micro unjudged rate over all returned results", () => {
    // 3 unjudged out of 6 returned.
    expect(metrics.unjudgedRate[2]).toBe(0.5);
  });

  it("sums violations and reports a per-query rate", () => {
    expect(metrics.violations[2]).toBe(1);
    expect(metrics.violationsPerQuery[2]).toBeCloseTo(1 / 3, 12);
  });

  it("breaks down by query_class", () => {
    expect(Object.keys(metrics.byClass).sort()).toEqual(["adversarial", "capability"]);
    expect(metrics.byClass.capability!.queries).toBe(2);
    expect(metrics.byClass.capability!.rankingQueries).toBe(2);
    expect(metrics.byClass.adversarial!.queries).toBe(1);
    expect(metrics.byClass.adversarial!.rankingQueries).toBe(0);
    expect(metrics.byClass.adversarial!.ndcg[2]!.value).toBeNull();
    expect(metrics.byClass.adversarial!.violations[2]).toBe(1);
    expect(metrics.byClass.capability!.mrr.value).toBeCloseTo((1 + 0.5) / 2, 12);
  });

  it("reports latency percentiles from the supplied per-query latencies", () => {
    expect(metrics.latency.p50).toBe(20);
    expect(metrics.latency.p95).toBe(30);
    expect(metrics.latency.mean).toBe(20);
  });

  it("returns null metrics rather than zeros for an empty run", () => {
    const empty = aggregate([], { cutoffs: [10] });
    expect(empty.queries).toBe(0);
    expect(empty.ndcg[10]!.value).toBeNull();
    expect(empty.noResult.accuracy).toBeNull();
    expect(empty.latency.p50).toBeNull();
  });
});

describe("pairedVectors", () => {
  const build = (queryId: string, ranking: string[]) =>
    scoreQuery(
      query({ queryId, judgments: [{ resourceId: "A", grade: 3 }] }),
      { queryId, ranking },
      { cutoffs: [10] },
    );

  it("aligns two runs on their shared queries", () => {
    const baseline = [build("q1", ["U", "A"]), build("q2", ["A"])];
    const candidate = [build("q1", ["A"]), build("q2", ["A"])];
    const { queryIds, a, b } = pairedVectors(baseline, candidate, metricSelectors.mrr());
    expect(queryIds).toEqual(["q1", "q2"]);
    expect(a).toEqual([0.5, 1]);
    expect(b).toEqual([1, 1]);
  });

  it("drops queries where either side is undefined, keeping the pairing intact", () => {
    const unrankable = scoreQuery(
      query({ queryId: "q3", judgments: [{ resourceId: "T", grade: 0 }] }),
      { queryId: "q3", ranking: ["T"] },
      { cutoffs: [10] },
    );
    const { queryIds, a, b } = pairedVectors(
      [build("q1", ["A"]), unrankable],
      [build("q1", ["A"]), unrankable],
      metricSelectors.ndcgAt(10),
    );
    expect(queryIds).toEqual(["q1"]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});

describe("default cutoffs", () => {
  it("covers the cutoffs BUILD-PLAN §10 reports on", () => {
    expect(DEFAULT_CUTOFFS).toContain(10);
    expect(DEFAULT_CUTOFFS).toContain(20);
  });
});
