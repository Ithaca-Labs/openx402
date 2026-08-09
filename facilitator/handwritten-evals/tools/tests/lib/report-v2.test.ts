import { describe, expect, it } from "vitest";
import { SCORED_SYSTEMS, type QrelRecord, type QueryRecord } from "../../../schema/schema-v2.js";
import {
  buildEvaluationReport,
  EvaluationReportDraftV2Schema,
  EvaluationReportV2Schema,
  evaluationInputHashes,
  finalizeEvaluationReport,
  REQUIRED_LIMITATIONS,
  reportArtifactHash,
  scoringRunsFromPoolRuns,
  type SystemRun,
} from "../../lib/report-v2.js";
import type { SystemRuns } from "../../lib/pool.js";

const generatedAt = "2026-08-07T00:00:00.000Z";

function releaseQueries(): QueryRecord[] {
  return Array.from({ length: 50 }, (_, index) => ({
    query_id: `qry-${String(index + 1).padStart(3, "0")}`,
    split: "release",
    query_class: "capability",
    query: `buyer capability ${index + 1}`,
    filters: {},
    evaluation_constraints: {},
    expects_no_result: false,
    phrasing_register: "terse_agent",
    family: (index % 20) + 1,
    generation: {
      provider: "anthropic",
      model: "claude-revision-2026-08-07",
      prompt_hash: `sha256:${"a".repeat(64)}`,
      run_id: `query-run-${index + 1}`,
      shard_id: `query-shard-${index + 1}`,
      temperature: 0,
      generated_at: generatedAt,
    },
    derived_from: {
      kind: "agent_generated",
      generation_id: `query-run-${index + 1}`,
      use_case: `use case ${index + 1}`,
    },
    review_status: "approved",
    reviewed_at: generatedAt,
    owner_note: null,
  }));
}

function releaseQrels(queries: readonly QueryRecord[]): QrelRecord[] {
  return queries.map(query => ({
    query_id: query.query_id,
    resource_id: "res-0001",
    grade: 3,
    eligible: true,
    judge: "reviewed_agent",
    rationale: "Exact capability match reviewed by the owner.",
    annotator: `grader-${query.query_id}`,
    judged_at: generatedAt,
    generation: {
      provider: "anthropic",
      model: "claude-grader-2026-08-07",
      prompt_hash: `sha256:${"c".repeat(64)}`,
      run_id: `grader-${query.query_id}`,
      shard_id: `grader-shard-${query.query_id}`,
      temperature: 0,
      generated_at: generatedAt,
    },
    review_status: "approved",
    reviewed_at: generatedAt,
    reviewed_by: "owner",
    owner_note: null,
  }));
}

function runs(queries: readonly QueryRecord[]): SystemRun[] {
  return SCORED_SYSTEMS.map(system => ({
    system,
    results: queries.map(query => ({
      queryId: query.query_id,
      ranking: ["res-0001", "res-0002"],
      latencyMs: 10,
    })),
  }));
}

const options = {
  split: "release" as const,
  generatedAt,
  datasetManifestSha256: "b".repeat(64),
  judgedAt10Threshold: 0.5,
  ownerRates: { reviewed: 50, corrected: 5, rejected: 0, correction_rate: 0.1, rejection_rate: 0 },
  limitations: [...REQUIRED_LIMITATIONS],
  significanceIterations: 100,
  plantedNegativeResourceIds: new Set<string>(),
};

describe("v2 evaluation report", () => {
  it("rejects a generic limitations placeholder that omits required disclosures", () => {
    expect(() => buildEvaluationReport(releaseQueries(), releaseQrels(releaseQueries()), runs(releaseQueries()), {
      ...options,
      limitations: ["The benchmark has limitations."],
    })).toThrow("missing required BUILD-PLAN limitation");
  });

  it("preserves canonical per-query latency when adapting pool runs", () => {
    const canonical = Object.fromEntries(SCORED_SYSTEMS.map((system, systemIndex) => [system, [{
      system,
      query_id: "qry-001",
      run_id: `run-${system}`,
      generated_at: generatedAt,
      latency_ms: 12.5 + systemIndex,
      requested_depth: 20,
      total_results: 1,
      results: [{ resource_id: "res-0001", rank: 1, score: 1 }],
    }]])) as SystemRuns;

    const adapted = scoringRunsFromPoolRuns(canonical, new Set(["qry-001"]));
    expect(adapted.map(run => run.results[0]!.latencyMs)).toEqual([12.5, 13.5, 14.5, 15.5]);
  });

  it("reports every required system, metric contract, coverage, and significance", () => {
    const queries = releaseQueries();
    const report = buildEvaluationReport(queries, releaseQrels(queries), runs(queries), options);

    expect(EvaluationReportDraftV2Schema.parse(report)).toEqual(report);
    expect(Object.keys(report.systems)).toEqual(SCORED_SYSTEMS);
    expect(report.ndcg_gains).toEqual([0, 1, 3, 7]);
    expect(report.relevance_thresholds).toMatchObject({ mrr: 2, recall_at_k: 2, bpref: 2 });
    expect(report.systems.lexical.primary.ndcg_at_10.value).toBe(1);
    expect(report.systems.lexical.primary.judged_at_10.value).toBe(0.5);
    expect(report.judged_at_10_gate_passed).toBe(true);
    expect(report.significance.semantic!.ndcg_at_10!.summary).toContain("NOT significant");
    expect(report.bm25_baseline).toBe(true);
    expect(report.owner_rates_reported).toBe(true);
    expect(report.input_hashes).toEqual(evaluationInputHashes(queries, releaseQrels(queries), runs(queries), "release"));
  });

  it("requires an exact owner signoff before producing an approved final report", () => {
    const queries = releaseQueries();
    const draft = buildEvaluationReport(queries, releaseQrels(queries), runs(queries), options);
    const signoff = {
      version: 1 as const,
      decision: "approved" as const,
      draft_report_hash: reportArtifactHash(draft),
      reviewer: "benchmark-owner",
      reviewed_at: generatedAt,
      rationale: "Reviewed metrics, significance, coverage, owner rates, and disclosed limitations.",
      limitations_acknowledged: true as const,
    };
    const approved = finalizeEvaluationReport(draft, signoff);
    expect(EvaluationReportV2Schema.parse(approved)).toEqual(approved);
    expect(approved.status).toBe("approved");
    expect(approved.owner_signoff).toEqual(signoff);
    expect(draft.status).toBe("draft_pending_owner_review");
    expect(() => finalizeEvaluationReport(draft, {
      ...signoff, draft_report_hash: `sha256:${"f".repeat(64)}`,
    })).toThrow(/does not match the preserved draft/);
  });

  it("hash-binds reports to the selected qrels and ranked run inputs", () => {
    const queries = releaseQueries();
    const qrels = releaseQrels(queries);
    const systemRuns = runs(queries);
    const initial = evaluationInputHashes(queries, qrels, systemRuns, "release");
    qrels[0] = { ...qrels[0]!, grade: 2 };
    expect(evaluationInputHashes(queries, qrels, systemRuns, "release").qrels).not.toBe(initial.qrels);
    systemRuns[0]!.results[0] = { ...systemRuns[0]!.results[0]!, ranking: ["res-0002", "res-0001"] };
    expect(evaluationInputHashes(queries, qrels, systemRuns, "release").system_runs.lexical)
      .not.toBe(initial.system_runs.lexical);
  });

  it("rejects opaque or self-asserted metric evidence", () => {
    const queries = releaseQueries();
    const draft = buildEvaluationReport(queries, releaseQrels(queries), runs(queries), options);
    expect(EvaluationReportDraftV2Schema.safeParse({
      ...draft, systems: { ...draft.systems, lexical: {} },
    }).success).toBe(false);
    expect(EvaluationReportDraftV2Schema.safeParse({
      ...draft, significance: {},
    }).success).toBe(false);
    expect(EvaluationReportDraftV2Schema.safeParse({
      ...draft, judged_at_10_gate_passed: false,
    }).success).toBe(false);
  });

  it("refuses a release report without a judged@10 threshold and owner evidence", () => {
    const queries = releaseQueries();
    const {
      judgedAt10Threshold: _threshold,
      ownerRates: _ownerRates,
      ...withoutReleaseEvidence
    } = options;
    expect(() => buildEvaluationReport(
      queries,
      releaseQrels(queries),
      runs(queries),
      withoutReleaseEvidence,
    )).toThrow(/judged@10 threshold/);
  });

  it("refuses unreviewed release qrels or incomplete system runs", () => {
    const queries = releaseQueries();
    const qrels = releaseQrels(queries);
    qrels[0] = { ...qrels[0]!, judge: "agent", rationale: undefined };
    expect(() => buildEvaluationReport(queries, qrels, runs(queries), options)).toThrow(/not owner-reviewed/);

    const incomplete = runs(queries);
    incomplete[0] = { ...incomplete[0]!, results: incomplete[0]!.results.slice(1) };
    expect(() => buildEvaluationReport(queries, releaseQrels(queries), incomplete, options)).toThrow(/every release query/);
  });

  it("refuses duplicate resources in a ranking", () => {
    const queries = releaseQueries();
    const duplicated = runs(queries);
    duplicated[0]!.results[0] = {
      ...duplicated[0]!.results[0]!,
      ranking: ["res-0001", "res-0001"],
    };
    expect(() => buildEvaluationReport(queries, releaseQrels(queries), duplicated, options)).toThrow(/duplicate resource/);
  });
});
