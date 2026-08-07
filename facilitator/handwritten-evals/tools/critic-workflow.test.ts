import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { RELEASE_COUNTS, TESTNET_USDC } from "../schema/schema-v2.js";
import {
  CRITIC_ROLES,
  finalizeCriticOwnerReview,
  prepareCriticOwnerReview,
  prepareCriticReview,
  type CriticImport,
  type CriticManifest,
} from "./critic-workflow.js";

const GENERATED_AT = "2026-08-07T00:00:00.000Z";
const PAY_TO = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
const ORIGINAL_PROSE = "SECRET ORIGINAL PROSE for an independently authored listing.";

function resourceId(index: number): string {
  return `res-${String(index).padStart(4, "0")}`;
}

function sourceRecords() {
  const catalog = Array.from({ length: RELEASE_COUNTS.resources.total }, (_, offset) => {
    const index = offset + 1;
    const id = resourceId(index);
    return {
      resource_id: id,
      wire: {
        x402Version: 2,
        resource: {
          url: `https://critic-fixture-${index}.example/resource`,
          serviceName: `Fixture ${index}`,
          description: index === 1 ? ORIGINAL_PROSE : `Independent fixture listing ${index}.`,
          tags: [`fixture-${index}`],
          mimeType: "application/json",
        },
        accepts: [{
          scheme: "exact",
          network: "stellar:testnet",
          asset: TESTNET_USDC,
          amount: "10000",
          payTo: PAY_TO,
          maxTimeoutSeconds: 60,
          extra: { areFeesSponsored: false },
        }],
        extensions: { bazaar: {} },
      },
    };
  });
  const sidecars = Array.from({ length: RELEASE_COUNTS.resources.total }, (_, offset) => {
    const index = offset + 1;
    const id = resourceId(index);
    const runId = `run-author-${id}`;
    return {
      resource_id: id,
      authorship: "agent",
      resource_type: "http",
      is_distractor: true,
      is_sparse: false,
      adversarial_kind: null,
      provider_id: `provider-${String((offset % 120) + 1).padStart(3, "0")}`,
      generation: {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        prompt_hash: `sha256:${"a".repeat(64)}`,
        run_id: runId,
        shard_id: `shard-${id}`,
        temperature: 0.7,
        generated_at: GENERATED_AT,
      },
      derived_from: {
        kind: "agent_generated",
        generation_id: runId,
        rationale: `Independent fixture rationale ${index}.`,
      },
      review_status: "pending",
      reviewed_at: null,
      owner_note: null,
      family: null,
      family_slot: null,
      category: "fixture",
      is_live: false,
      settlement_verified: false,
      asset_decimals: 7,
      price_usd_snapshot: {
        value: 0.001,
        as_of: GENERATED_AT,
        basis: "fixed_fixture_minimum_option_value",
      },
    };
  });
  return { catalog, sidecars, queries: [] };
}

function critics() {
  return CRITIC_ROLES.map(role => ({
    provider: "anthropic" as const,
    model: "claude-sonnet-4-20250514",
    run_id: `run-critic-${role}`,
    shard_id: `shard-critic-${role}`,
    temperature: 0,
  }));
}

function criticImports(manifest: CriticManifest): CriticImport[] {
  return manifest.critics.map(expected => ({
    version: 1,
    role: expected.role,
    pack_id: expected.pack_id,
    critic: {
      ...expected.assignment,
      prompt_hash: expected.prompt_hash,
      generated_at: GENERATED_AT,
    },
    completed_at: GENERATED_AT,
    assessments: expected.assignments.map((assignment, index) => {
      if (expected.role === "clone_detection" && index === 0) {
        return {
          artifact_id: assignment.artifact_id,
          status: "flagged" as const,
          findings: [{
            finding_id: "finding-near-clone-001",
            code: "near_clone" as const,
            severity: "medium" as const,
            summary: "Repeated structural phrasing.",
            evidence: "The listing closely mirrors another independent listing.",
            rationale: "The repeated frame is too specific to be coincidental.",
            recommendation: "reject_and_repair" as const,
          }],
        };
      }
      return { artifact_id: assignment.artifact_id, status: "pass" as const, findings: [] };
    }),
  }));
}

function ownerDecisions(ownerPack: ReturnType<typeof prepareCriticOwnerReview>, findingDecision: "confirmed" | "false_positive") {
  return {
    version: 1 as const,
    reviewer: "benchmark-owner",
    reviewed_at: GENERATED_AT,
    finding_decisions: ownerPack.artifacts.flatMap(artifact => artifact.findings.map(finding => ({
      finding_id: finding.finding_id,
      decision: findingDecision,
      rationale: findingDecision === "confirmed" ? "The critic evidence is valid." : "Owner inspection disproved the match.",
    }))),
    artifact_decisions: ownerPack.artifacts.map((artifact, index) => ({
      artifact_kind: artifact.artifact_kind,
      source_id: artifact.source_id,
      decision: (findingDecision === "confirmed" && index === 0 ? "repair_required" : "approved") as "repair_required" | "approved",
      owner_note: findingDecision === "confirmed" && index === 0 ? "Create a structurally distinct replacement." : null,
    })),
  };
}

let prepared: ReturnType<typeof prepareCriticReview>;
let imports: CriticImport[];

beforeAll(() => {
  prepared = prepareCriticReview(
    sourceRecords(),
    {
      familiesMarkdown: "# Frozen family boundaries\n\nTwenty frozen family definitions are supplied here.",
      forbiddenMarkdown: readFileSync(resolve(import.meta.dirname, "../forbidden-capabilities.md"), "utf8"),
    },
    {
      scope: "corpus",
      reviewRunId: "review-corpus-001",
      createdAt: GENERATED_AT,
      seed: "critic-fixture-seed-0001",
      critics: critics(),
    },
  );
  imports = criticImports(prepared.manifest);
});

describe("critic workflow", () => {
  it("builds six isolated, opaque, exact-coverage critic packs", () => {
    expect(prepared.packs.map(pack => pack.role)).toEqual(CRITIC_ROLES);
    expect(new Set(prepared.manifest.critics.map(critic => critic.assignment.run_id)).size).toBe(6);
    for (const pack of prepared.packs) {
      expect(pack.artifacts).toHaveLength(RELEASE_COUNTS.resources.total);
      expect(pack.artifacts.every(artifact => /^artifact-[a-f0-9]{16}$/.test(artifact.artifact_id))).toBe(true);
      expect(JSON.stringify(pack)).not.toContain("run-author-");
      expect(JSON.stringify(pack)).not.toContain("provider_id");
    }
  });

  it("requires every critic to assess every assigned artifact exactly once", () => {
    const incomplete = structuredClone(imports);
    incomplete[0]!.assessments.pop();
    expect(() => prepareCriticOwnerReview(prepared.manifest, incomplete)).toThrow("cover every assigned artifact exactly once");
  });

  it("rejects finding codes outside a critic's bounded role", () => {
    const wrongRole = structuredClone(imports);
    const assessment = wrongRole.find(value => value.role === "clone_detection")!.assessments[0]!;
    assessment.findings[0]!.code = "prompt_injection";
    expect(() => prepareCriticOwnerReview(prepared.manifest, wrongRole)).toThrow("belongs to another critic role");
  });

  it("prevents an author run from serving as a critic", () => {
    const source = sourceRecords();
    const assignments = critics();
    assignments[0]!.run_id = source.sidecars[0]!.generation.run_id;
    expect(() => prepareCriticReview(source, {
      familiesMarkdown: "families",
      forbiddenMarkdown: readFileSync(resolve(import.meta.dirname, "../forbidden-capabilities.md"), "utf8"),
    }, {
      scope: "corpus", reviewRunId: "review-reused-author", createdAt: GENERATED_AT,
      seed: "critic-fixture-seed-0002", critics: assignments,
    })).toThrow("critic authored an artifact");
  });

  it("creates fresh repair tasks containing only slot constraints and rejection reasons", () => {
    const ownerPack = prepareCriticOwnerReview(prepared.manifest, imports);
    const result = finalizeCriticOwnerReview(
      prepared.manifest,
      imports,
      ownerDecisions(ownerPack, "confirmed"),
      { generatedAt: GENERATED_AT, repairRound: 1 },
    );
    expect(result.report.overall_passed).toBe(false);
    expect(result.report.repair_required_artifacts).toBe(1);
    expect(result.repairManifest.repairs).toHaveLength(1);
    expect(result.repairPrompts).toHaveLength(1);
    expect(result.repairPrompts[0]!.prompt).toContain("Structural slot brief");
    expect(result.repairPrompts[0]!.prompt).toContain("Repeated structural phrasing");
    expect(result.repairPrompts[0]!.prompt).not.toContain(ORIGINAL_PROSE);
    expect(result.repairPrompts[0]!.prompt).not.toContain("Independent fixture rationale");
  });

  it("accepts a complete owner-reviewed corpus only when every finding is cleared", () => {
    const ownerPack = prepareCriticOwnerReview(prepared.manifest, imports);
    const result = finalizeCriticOwnerReview(
      prepared.manifest,
      imports,
      ownerDecisions(ownerPack, "false_positive"),
      { generatedAt: GENERATED_AT, repairRound: 1 },
    );
    expect(result.report).toMatchObject({
      artifacts_reviewed: RELEASE_COUNTS.resources.total,
      findings_reviewed: 1,
      confirmed_findings: 0,
      approved_artifacts: RELEASE_COUNTS.resources.total,
      repair_required_artifacts: 0,
      overall_passed: true,
    });
    expect(result.repairManifest.repairs).toEqual([]);
  });

  it("forbids owner approval of an artifact with a confirmed finding", () => {
    const ownerPack = prepareCriticOwnerReview(prepared.manifest, imports);
    const decisions = ownerDecisions(ownerPack, "confirmed");
    decisions.artifact_decisions[0]!.decision = "approved";
    decisions.artifact_decisions[0]!.owner_note = null;
    expect(() => finalizeCriticOwnerReview(prepared.manifest, imports, decisions, {
      generatedAt: GENERATED_AT,
      repairRound: 1,
    })).toThrow("cannot approve an artifact with confirmed critic findings");
  });
});
