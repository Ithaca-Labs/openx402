import { describe, expect, it } from "vitest";
import { formatConfusionMatrix, stratifiedAgreement } from "./agreement.js";
import { validateAgreementGate, validateCriticAcceptanceGate, validateGradingProcessGate } from "./release-gates-v2.js";

function agreementArtifact() {
  const agreement = stratifiedAgreement([
    { queryId: "qry-001", resourceId: "res-0001", a: 0, b: 0, relevantFamily: true },
    { queryId: "qry-001", resourceId: "res-0002", a: 1, b: 1, relevantFamily: true },
    { queryId: "qry-001", resourceId: "res-0003", a: 2, b: 2, relevantFamily: true },
    { queryId: "qry-001", resourceId: "res-0004", a: 3, b: 3, relevantFamily: true },
  ]);
  return {
    version: 1 as const,
    pipeline_run_id: "pipeline-release-01",
    generated_at: "2026-08-07T00:00:00.000Z",
    pair_count: 4,
    disagreement_count: 0,
    adjudicated_count: 0,
    agreement,
    confusion_matrix_text: formatConfusionMatrix(agreement.confusionMatrix),
  };
}

describe("validateAgreementGate", () => {
  it("accepts the canonical nested relevant-family kappa artifact", () => {
    expect(validateAgreementGate(agreementArtifact(), 4)).toEqual({
      passes: true,
      kappa: 1,
      error: null,
    });
  });

  it("rejects the old generic calibration evidence shape", () => {
    const result = validateAgreementGate({
      status: "approved",
      relevant_family_weighted_kappa: 0.99,
    }, 4);
    expect(result.passes).toBe(false);
    expect(result.kappa).toBeNull();
    expect(result.error).toContain("version");
  });

  it("requires the pinned nested threshold and complete adjudication", () => {
    const belowTarget = agreementArtifact();
    belowTarget.agreement.relevantFamily.kappaQuadratic.kappa = 0.59;
    belowTarget.agreement.passes = false;
    expect(validateAgreementGate(belowTarget, 4).passes).toBe(false);

    expect(validateAgreementGate({
      ...agreementArtifact(),
      disagreement_count: 1,
      adjudicated_count: 0,
    }, 4)).toMatchObject({
      passes: false,
      error: "adjudicated_count 0 does not match disagreement_count 1",
    });
  });

  it("binds agreement pair_count to reviewed calibration rows", () => {
    expect(validateAgreementGate(agreementArtifact(), 3)).toMatchObject({
      passes: false,
      error: "pair_count 4 does not match reviewed calibration 3",
    });
  });
});

function criticAcceptanceReport(count = 1_000) {
  return {
    version: 1 as const,
    scope: "corpus" as const,
    review_run_id: "review-corpus-001",
    generated_at: "2026-08-07T00:00:00.000Z",
    source_hash: `sha256:${"a".repeat(64)}`,
    reviewer: "benchmark-owner",
    reviewed_at: "2026-08-07T00:00:00.000Z",
    artifacts_reviewed: count,
    findings_reviewed: 0,
    confirmed_findings: 0,
    approved_artifacts: count,
    repair_required_artifacts: 0,
    overall_passed: true,
    finding_decisions: [],
    artifact_decisions: Array.from({ length: count }, (_, index) => ({
      artifact_kind: "resource" as const,
      source_id: `res-${String(index + 1).padStart(4, "0")}`,
      decision: "approved" as const,
      owner_note: null,
    })),
  };
}

describe("validateCriticAcceptanceGate", () => {
  it("accepts exact, current, zero-repair owner evidence", () => {
    expect(validateCriticAcceptanceGate(criticAcceptanceReport(), {
      scope: "corpus",
      sourceHash: `sha256:${"a".repeat(64)}`,
      artifactCount: 1_000,
    })).toEqual({ passes: true, error: null });
  });

  it("rejects stale or incomplete critic evidence", () => {
    const stale = criticAcceptanceReport();
    stale.repair_required_artifacts = 1;
    stale.overall_passed = false;
    const result = validateCriticAcceptanceGate(stale, {
      scope: "corpus",
      sourceHash: `sha256:${"b".repeat(64)}`,
      artifactCount: 1_000,
    });
    expect(result.passes).toBe(false);
    expect(result.error).toContain("source hash is stale");
    expect(result.error).toContain("still require repair");
  });
});

function gradingProcessAudit() {
  const hash = `sha256:${"a".repeat(64)}`;
  return {
    version: 1 as const,
    artifact: "grading-process-audit-v2" as const,
    status: "pass" as const,
    pipeline_run_id: "pipeline-release-01",
    generated_at: "2026-08-07T00:00:00.000Z",
    source_hash: hash,
    input_hashes: {
      grading_manifest: hash,
      grader_a_pack: hash,
      grader_b_pack: hash,
      grader_a_import: hash,
      grader_b_import: hash,
      adjudication_manifest: hash,
      adjudication_pack: hash,
      adjudicator_import: hash,
    },
    run_ids: {
      author: ["author-1"],
      grader_a: "grader-a",
      grader_b: "grader-b",
      adjudicator: "adjudicator",
    },
    agent_provenance: {
      grader_a: { provider: "anthropic" as const, model: "grader-revision-2026-08-07", prompt_hash: hash,
        run_id: "grader-a", shard_id: "grader-a-shard", temperature: 0, generated_at: "2026-08-07T00:00:00.000Z" },
      grader_b: { provider: "anthropic" as const, model: "grader-revision-2026-08-07", prompt_hash: hash,
        run_id: "grader-b", shard_id: "grader-b-shard", temperature: 0, generated_at: "2026-08-07T00:00:00.000Z" },
      adjudicator: { provider: "anthropic" as const, model: "grader-revision-2026-08-07", prompt_hash: hash,
        run_id: "adjudicator", shard_id: "adjudicator-shard", temperature: 0, generated_at: "2026-08-07T00:00:00.000Z" },
    },
    counts: {
      pairs: 3,
      grader_a_judgments: 3,
      grader_b_judgments: 3,
      disagreements: 1,
      adjudications: 1,
    },
    checks: {
      source_current: true,
      packs_match_withheld_manifest: true,
      packs_contain_no_provenance_or_ranking_leakage: true,
      graders_are_distinct_fresh_contexts: true,
      double_grading_complete: true,
      adjudication_is_third_context_and_disagreement_only: true,
    },
  };
}

describe("validateGradingProcessGate", () => {
  it("accepts only a strict process artifact bound to the current system pool", () => {
    const audit = gradingProcessAudit();
    expect(validateGradingProcessGate(audit, { sourceHash: audit.source_hash, pairCount: 3 }))
      .toEqual({ passes: true, error: null });
    expect(validateGradingProcessGate(audit, { sourceHash: `sha256:${"b".repeat(64)}`, pairCount: 4 }))
      .toEqual({ passes: false, error: "grading source hash is stale or unavailable; pair count 3 does not match system pool 4" });
  });

  it("rejects the old generic isolation approval", () => {
    expect(validateGradingProcessGate({ status: "approved" }, { sourceHash: null, pairCount: 0 }).passes).toBe(false);
  });
});
