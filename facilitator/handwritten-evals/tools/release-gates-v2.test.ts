import { describe, expect, it } from "vitest";
import { formatConfusionMatrix, stratifiedAgreement } from "./agreement.js";
import { validateAgreementGate } from "./release-gates-v2.js";

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
