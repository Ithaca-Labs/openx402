import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentCalibrationSchema, QrelRecordSchema } from "../schema/schema-v2.js";
import {
  applyOwnerReview,
  assertNoBlindPackLeakage,
  BlindAdjudicationPackSchema,
  BlindGradingPackSchema,
  finalizeGrading,
  prepareBlindAdjudication,
  prepareBlindGrading,
  OwnerReviewReportSchema,
  validateDoubleGrading,
  writeArtifactBundleExclusive,
  writeArtifactExclusive,
  type GraderImport,
  type GradingManifest,
  type OwnerDecisionBundle,
} from "./grading-pipeline.js";

const TESTNET_USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const PAY_TO = "GAOH2NR3A3R2VS6TUE6L75A3OMJ4UKJWEHHNL5GIIEQTS5RVZEK5LAP4";
const NOW = "2026-08-07T00:00:00.000Z";
const COUNTS = { queries: 2, catalog: 3, sidecars: 3 };

function generation(runId: string) {
  return {
    provider: "anthropic" as const,
    model: "claude-test-revision",
    prompt_hash: `sha256:${runId}`,
    run_id: runId,
    shard_id: `shard-${runId}`,
    generated_at: NOW,
  };
}

function query(id: string, split: "development" | "release", author: string) {
  return {
    query_id: id,
    split,
    query_class: "capability" as const,
    query: id === "qry-001" ? "find a lunar calendar conversion" : "find a knitting gauge calculator",
    filters: {},
    evaluation_constraints: {},
    expects_no_result: false,
    phrasing_register: "terse_agent" as const,
    family: 1,
    generation: generation(author),
    derived_from: { kind: "agent_generated" as const, generation_id: author, use_case: "fixture" },
    review_status: "approved" as const,
    reviewed_at: NOW,
    owner_note: null,
  };
}

function catalog(id: string, name: string) {
  return {
    resource_id: id,
    wire: {
      x402Version: 2 as const,
      resource: {
        url: `https://fixture-${id}.example/api`,
        serviceName: name,
        description: `Original description for ${name}.`,
        tags: [name.toLowerCase().replaceAll(" ", "-")],
        mimeType: "application/json",
      },
      accepts: [{
        scheme: "exact" as const,
        network: "stellar:testnet" as const,
        asset: TESTNET_USDC,
        amount: "10000",
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
        extra: { areFeesSponsored: false },
      }],
      extensions: { bazaar: {} },
    },
  };
}

function sidecar(id: string, author: string) {
  return {
    resource_id: id,
    authorship: "agent" as const,
    resource_type: "http" as const,
    is_distractor: true,
    is_sparse: false,
    adversarial_kind: null,
    provider_id: `provider-${id.slice(-3)}`,
    generation: generation(author),
    derived_from: { kind: "agent_generated" as const, generation_id: author, rationale: "fixture distractor" },
    review_status: "approved" as const,
    reviewed_at: NOW,
    owner_note: null,
    family: null,
    family_slot: null,
    category: "fixture",
    is_live: false as const,
    settlement_verified: false as const,
    asset_decimals: 7 as const,
    price_usd_snapshot: { value: 0.001, as_of: NOW, basis: "fixed_fixture_minimum_option_value" as const },
  };
}

function pooled(queryId: string, resourceId: string) {
  return {
    query_id: queryId,
    resource_id: resourceId,
    origin: "system_pool" as const,
    contributions: [{ system: "bm25" as const, rank: 1 }],
    best_rank: 1,
    pool_depth: 20,
    blinded: true as const,
    pooled_at: NOW,
    run_id: "pool-run",
  };
}

function sources() {
  return {
    queries: [query("qry-001", "development", "author-query-1"), query("qry-002", "release", "author-query-2")],
    catalog: [catalog("res-0001", "Moon Calendar"), catalog("res-0002", "Yarn Gauge"), catalog("res-0003", "Needle Sizes")],
    sidecars: [sidecar("res-0001", "author-resource-1"), sidecar("res-0002", "author-resource-2"), sidecar("res-0003", "author-resource-3")],
    pool: [pooled("qry-001", "res-0001"), pooled("qry-002", "res-0002"), pooled("qry-002", "res-0003")],
  };
}

const graderA = generation("grader-a-run");
const graderB = generation("grader-b-run");

function prepared() {
  return prepareBlindGrading(sources(), {
    pipelineRunId: "grading-run-1",
    createdAt: NOW,
    seed: "0123456789abcdef",
    graderA,
    graderB,
    expectedCounts: COUNTS,
  });
}

function imports(manifest: GradingManifest, bDisagrees = true): { a: GraderImport; b: GraderImport } {
  const make = (slot: "a" | "b", gradeFor: (resourceId: string) => number): GraderImport => ({
    version: 1,
    role: `grader_${slot}`,
    pack_id: manifest.packs[slot],
    grader: manifest.graders[slot],
    judgments: manifest.assignments[slot].map(assignment => ({
      task_id: assignment.task_id,
      candidate_id: assignment.candidate_id,
      grade: gradeFor(assignment.resource_id),
      ...(assignment.split === "release" ? { rationale: `${slot} release rationale` } : {}),
      judged_at: NOW,
    })),
  });
  return {
    a: make("a", resourceId => resourceId === "res-0002" ? 2 : 0),
    b: make("b", resourceId => resourceId === "res-0002" && bDisagrees ? 3 : (resourceId === "res-0002" ? 2 : 0)),
  };
}

describe("prepareBlindGrading", () => {
  it("creates two opaque, independently shuffled, leakage-free packs", () => {
    const result = prepared();
    expect(BlindGradingPackSchema.safeParse(result.graderA).success).toBe(true);
    expect(BlindGradingPackSchema.safeParse(result.graderB).success).toBe(true);
    expect(result.manifest.assignments.a).toHaveLength(3);
    expect(result.manifest.assignments.b).toHaveLength(3);
    expect(result.graderA.pack_id).not.toBe(result.graderB.pack_id);
    expect(JSON.stringify(result.graderA)).not.toContain("res-0001");
    expect(JSON.stringify(result.graderA)).not.toContain("provider-");
    expect(JSON.stringify(result.graderA)).not.toContain("contributions");
    expect(() => assertNoBlindPackLeakage(result.graderA)).not.toThrow();
  });

  it("refuses incomplete prerequisites and self-grading", () => {
    expect(() => prepareBlindGrading(sources(), {
      pipelineRunId: "x", createdAt: NOW, seed: "0123456789abcdef", graderA, graderB,
    })).toThrow("expected 100 queries");
    expect(() => prepareBlindGrading(sources(), {
      pipelineRunId: "x", createdAt: NOW, seed: "0123456789abcdef",
      graderA: { ...graderA, run_id: "author-query-1" }, graderB, expectedCounts: COUNTS,
    })).toThrow("authored a query or resource");
  });
});

describe("grader import validation", () => {
  it("requires exact double coverage and release rationales", () => {
    const result = prepared();
    const { a, b } = imports(result.manifest);
    expect(validateDoubleGrading(a, b, result.manifest).pairs).toHaveLength(3);
    const missing = { ...a, judgments: a.judgments.slice(1) };
    expect(() => validateDoubleGrading(missing, b, result.manifest)).toThrow("expected 3 judgments");
    const noRationale = {
      ...a,
      judgments: a.judgments.map(judgment => ({ ...judgment, rationale: undefined })),
    };
    expect(() => validateDoubleGrading(noRationale, b, result.manifest)).toThrow();
  });
});

describe("adjudication and finalization", () => {
  it("packs disagreements only without revealing either prior grade", () => {
    const result = prepared();
    const { a, b } = imports(result.manifest);
    const adjudication = prepareBlindAdjudication(sources(), result.manifest, a, b, generation("adjudicator-run"), {
      pipelineRunId: "grading-run-1", createdAt: NOW, seed: "fedcba9876543210", expectedCounts: COUNTS,
    });
    expect(BlindAdjudicationPackSchema.safeParse(adjudication.pack).success).toBe(true);
    expect(adjudication.pack.tasks).toHaveLength(1);
    expect(JSON.stringify(adjudication.pack)).not.toContain('"grade"');
    expect(JSON.stringify(adjudication.pack)).not.toContain("grader-a-run");
  });

  it("refuses unresolved disagreements, then emits validated qrels/calibration/agreement", () => {
    const result = prepared();
    const { a, b } = imports(result.manifest);
    expect(() => finalizeGrading(sources(), result.manifest, a, b, null, null, NOW, COUNTS)).toThrow("require a complete adjudicator import");
    const adjudication = prepareBlindAdjudication(sources(), result.manifest, a, b, generation("adjudicator-run"), {
      pipelineRunId: "grading-run-1", createdAt: NOW, seed: "fedcba9876543210", expectedCounts: COUNTS,
    });
    const adjudicatorImport = {
      version: 1 as const,
      role: "adjudicator" as const,
      pack_id: adjudication.manifest.pack_id,
      adjudicator: adjudication.manifest.adjudicator,
      judgments: adjudication.manifest.assignments.map(assignment => ({
        task_id: assignment.task_id,
        candidate_id: assignment.candidate_id,
        grade: 2,
        rationale: "Independent release adjudication rationale.",
        judged_at: NOW,
      })),
    };
    const final = finalizeGrading(sources(), result.manifest, a, b, adjudication.manifest, adjudicatorImport, NOW, COUNTS);
    expect(final.qrels).toHaveLength(3);
    expect(final.qrels.every(record => QrelRecordSchema.safeParse(record).success)).toBe(true);
    expect(final.calibration.every(record => AgentCalibrationSchema.safeParse(record).success)).toBe(true);
    expect(final.agreementReport.disagreement_count).toBe(1);
    expect(final.agreementReport.adjudicated_count).toBe(1);
    expect(final.qrels.find(record => record.resource_id === "res-0002")?.grade).toBe(2);
  });

  it("accepts no adjudication artifacts when graders fully agree", () => {
    const result = prepared();
    const { a, b } = imports(result.manifest, false);
    const final = finalizeGrading(sources(), result.manifest, a, b, null, null, NOW, COUNTS);
    expect(final.qrels).toHaveLength(3);
    expect(final.agreementReport.disagreement_count).toBe(0);
  });

  it("refuses finalization when source inputs changed after pack creation", () => {
    const result = prepared();
    const { a, b } = imports(result.manifest, false);
    const changed = sources();
    changed.catalog[0]!.wire.resource.description = "Changed after grading.";
    expect(() => finalizeGrading(changed, result.manifest, a, b, null, null, NOW, COUNTS))
      .toThrow("source_hash does not match current inputs");
  });
});

describe("append-only writes", () => {
  it("never overwrites an existing artifact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grading-pipeline-"));
    const path = join(directory, "artifact.json");
    await writeArtifactExclusive(path, { first: true });
    await expect(writeArtifactExclusive(path, { first: false })).rejects.toMatchObject({ code: "EEXIST" });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ first: true });
  });

  it("does not leave a partial bundle when any target already exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grading-bundle-"));
    const existing = join(directory, "existing.json");
    const fresh = join(directory, "fresh.json");
    await writeArtifactExclusive(existing, { preserved: true });
    await expect(writeArtifactBundleExclusive([
      { path: fresh, value: { partial: true } },
      { path: existing, value: { overwritten: true } },
    ])).rejects.toMatchObject({ code: "EEXIST" });
    await expect(readFile(fresh, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(existing, "utf8"))).toEqual({ preserved: true });
  });
});

describe("owner review", () => {
  function rawFinal() {
    const result = prepared();
    const { a, b } = imports(result.manifest, false);
    return finalizeGrading(sources(), result.manifest, a, b, null, null, NOW, COUNTS);
  }

  function ownerDecisions(): OwnerDecisionBundle {
    return {
      version: 1 as const,
      query_decisions: [
        { query_id: "qry-001", decision: "approved" as const, reviewer: "owner", reviewed_at: NOW, notes: null },
        { query_id: "qry-002", decision: "corrected" as const, reviewer: "owner", reviewed_at: NOW, notes: "Clarified buyer wording." },
      ],
      pair_decisions: [
        {
          query_id: "qry-001", resource_id: "res-0001", decision: "approved" as const, grade: 0,
          reviewer: "owner", reviewed_at: NOW, rationale: null, notes: null,
        },
        {
          query_id: "qry-002", resource_id: "res-0002", decision: "corrected" as const, grade: 3,
          reviewer: "owner", reviewed_at: NOW, rationale: "Exact capability match after owner review.", notes: "Raised 2 to 3.",
        },
        {
          query_id: "qry-002", resource_id: "res-0003", decision: "rejected" as const, grade: null,
          reviewer: "owner", reviewed_at: NOW, rationale: null, notes: "Ambiguous candidate record.",
        },
      ],
    };
  }

  it("emits separate reviewed dev/release qrels and explicit rates without mutating raw grades", () => {
    const raw = rawFinal();
    const rawSnapshot = JSON.stringify(raw);
    const reviewed = applyOwnerReview(
      sources().queries,
      raw.qrels,
      raw.calibration,
      ownerDecisions(),
      NOW,
      COUNTS.queries,
    );
    expect(reviewed.developmentQrels).toHaveLength(1);
    expect(reviewed.releaseQrels).toHaveLength(1);
    expect(reviewed.developmentQrels[0]).not.toHaveProperty("rationale");
    expect(reviewed.releaseQrels[0]).toMatchObject({
      grade: 3,
      judge: "reviewed_agent",
      annotator: "grader-a-run",
      reviewed_by: "owner",
      review_status: "corrected",
    });
    expect(reviewed.releaseQrels[0]!.rationale).toContain("Exact capability");
    expect(reviewed.reviewedCalibration.map(record => record.owner_review)).toEqual(["approved", "corrected", "rejected"]);
    expect(reviewed.report.pairs).toMatchObject({ total: 3, corrected: 1, rejected: 1 });
    expect(reviewed.report.reviewed_qrels_emitted).toEqual({ development: 1, release: 1, total: 2 });
    expect(reviewed.report.excluded_pairs).toEqual([
      { query_id: "qry-002", resource_id: "res-0003", reason: "pair_rejected" },
    ]);
    expect(reviewed.report.corrected_pairs).toEqual([
      { query_id: "qry-002", resource_id: "res-0002", original_grade: 2, final_grade: 3 },
    ]);
    expect(reviewed.report.corrected_queries).toEqual(["qry-002"]);
    expect(reviewed.report.rejected_queries).toEqual([]);
    expect(OwnerReviewReportSchema.safeParse(reviewed.report).success).toBe(true);
    expect(JSON.stringify(raw)).toBe(rawSnapshot);
  });

  it("requires exhaustive decisions and rejects inconsistent approvals", () => {
    const raw = rawFinal();
    const incomplete = ownerDecisions();
    incomplete.pair_decisions.pop();
    expect(() => applyOwnerReview(sources().queries, raw.qrels, raw.calibration, incomplete, NOW, 2))
      .toThrow("every raw qrel exactly once");
    const wrongApproval = ownerDecisions();
    wrongApproval.pair_decisions[0]!.grade = 1;
    expect(() => applyOwnerReview(sources().queries, raw.qrels, raw.calibration, wrongApproval, NOW, 2))
      .toThrow("approved grade must equal raw agent grade");
  });

  it("requires every pair under a rejected query to be explicitly rejected", () => {
    const raw = rawFinal();
    const decisions = ownerDecisions();
    decisions.query_decisions[1] = {
      query_id: "qry-002", decision: "rejected", reviewer: "owner", reviewed_at: NOW, notes: "Reject query.",
    };
    expect(() => applyOwnerReview(sources().queries, raw.qrels, raw.calibration, decisions, NOW, 2))
      .toThrow("rejected query requires rejected pair decision");
  });
});
