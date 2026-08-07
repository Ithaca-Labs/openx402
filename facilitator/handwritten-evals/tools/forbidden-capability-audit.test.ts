import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RELEASE_COUNTS } from "../schema/schema-v2.js";
import {
  finalizeForbiddenCapabilityAudit,
  ForbiddenAuditPackSchema,
  ForbiddenCapabilityAuditReportSchema,
  prepareForbiddenCapabilityAudit,
  type ForbiddenAuditManifest,
} from "./forbidden-capability-audit.js";

const FORBIDDEN = readFileSync(resolve(import.meta.dirname, "../forbidden-capabilities.md"), "utf8");
const NOW = "2026-08-07T00:00:00.000Z";
const TESTNET_USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const PAY_TO = "GAOH2NR3A3R2VS6TUE6L75A3OMJ4UKJWEHHNL5GIIEQTS5RVZEK5LAP4";

function generation(run: string) {
  return {
    provider: "anthropic" as const,
    model: "claude-author-revision",
    prompt_hash: `sha256:${run}`,
    run_id: run,
    shard_id: `shard-${run}`,
    generated_at: NOW,
  };
}

function corpus() {
  const catalog = Array.from({ length: RELEASE_COUNTS.resources.total }, (_, index) => {
    const number = index + 1;
    const id = `res-${String(number).padStart(4, "0")}`;
    return {
      resource_id: id,
      wire: {
        x402Version: 2 as const,
        resource: {
          url: `https://fixture-${number}.example/reference`,
          serviceName: `Ceramic Reference ${number}`,
          description: `Reference notes for ceramic firing schedule number ${number}.`,
          tags: ["ceramics", "kiln-reference"],
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
  });
  const sidecars = catalog.map((record, index) => {
    const author = `author-${index % 90}`;
    return {
      resource_id: record.resource_id,
      authorship: "agent" as const,
      resource_type: "http" as const,
      is_distractor: true,
      is_sparse: false,
      adversarial_kind: null,
      provider_id: `provider-${String((index % 120) + 1).padStart(3, "0")}`,
      generation: generation(author),
      derived_from: { kind: "agent_generated" as const, generation_id: author, rationale: "Independent ceramic reference." },
      review_status: "pending" as const,
      reviewed_at: null,
      owner_note: null,
      family: null,
      family_slot: null,
      category: "ceramics",
      is_live: false as const,
      settlement_verified: false as const,
      asset_decimals: 7 as const,
      price_usd_snapshot: { value: 0.001, as_of: NOW, basis: "fixed_fixture_minimum_option_value" as const },
    };
  });
  return { catalog, sidecars };
}

const auditors = Array.from({ length: 10 }, (_, index) => {
  const { prompt_hash: _promptHash, ...auditor } = generation(`auditor-${index + 1}`);
  return auditor;
});

function prepared() {
  const source = corpus();
  const result = prepareForbiddenCapabilityAudit(source.catalog, source.sidecars, FORBIDDEN, {
    auditRunId: "forbidden-audit-1",
    createdAt: NOW,
    seed: "0123456789abcdef",
    auditors,
  });
  return { source, result };
}

function imports(manifest: ForbiddenAuditManifest, oneMatch = true) {
  return manifest.audits.map((audit, auditIndex) => ({
    version: 1 as const,
    role: "forbidden_capability_auditor" as const,
    capability_id: audit.capability_id,
    pack_id: audit.pack_id,
    auditor: audit.auditor,
    audited_at: NOW,
    decisions: audit.assignments.map((assignment, listingIndex) => {
      const match = oneMatch && auditIndex === 0 && listingIndex === 0;
      return {
        listing_id: assignment.listing_id,
        possible_match: match,
        rationale: match ? "This listing may provide the reserved capability." : null,
      };
    }),
  }));
}

function owner(manifest: ForbiddenAuditManifest, confirmed = false) {
  return {
    version: 1 as const,
    capabilities: manifest.audits.map((audit, index) => ({
      capability_id: audit.capability_id,
      status: index === 0 && confirmed ? "blocked_present" as const : "approved_absent" as const,
      reviewer: "benchmark-owner",
      reviewed_at: NOW,
      notes: index === 0 ? "Reviewed possible match." : null,
      match_decisions: index === 0 ? [{
        resource_id: audit.assignments[0]!.resource_id,
        decision: confirmed ? "confirmed_match" as const : "false_positive" as const,
        rationale: confirmed ? "Capability is present." : "Listing does not actually provide the capability.",
      }] : [],
    })),
  };
}

describe("prepareForbiddenCapabilityAudit", () => {
  it("creates ten separate opaque, shuffled full-corpus-listing packs and concrete prompts", () => {
    const { result } = prepared();
    expect(result.packs).toHaveLength(10);
    expect(result.prompts).toHaveLength(10);
    expect(result.manifest.audits).toHaveLength(10);
    expect(result.packs.every(pack => ForbiddenAuditPackSchema.safeParse(pack).success)).toBe(true);
    expect(result.packs.every(pack => pack.listings.length === RELEASE_COUNTS.resources.total)).toBe(true);
    expect(JSON.stringify(result.packs[0])).not.toContain("resource_id");
    expect(JSON.stringify(result.packs[0])).not.toContain("provider-");
    expect(JSON.stringify(result.packs[0])).not.toContain("author-");
    expect(JSON.stringify(result.packs[0])).not.toContain("family");
    expect(result.prompts[0]).toContain("FC-01");
    expect(result.prompts[0]).toContain("auditor-1");
  });

  it("refuses incomplete corpus, deterministic hits, and author/auditor overlap", () => {
    const source = corpus();
    expect(() => prepareForbiddenCapabilityAudit(source.catalog.slice(1), source.sidecars, FORBIDDEN, {
      auditRunId: "x", createdAt: NOW, seed: "0123456789abcdef", auditors,
    })).toThrow(`exactly ${RELEASE_COUNTS.resources.total}`);
    const hit = corpus();
    hit.catalog[0]!.wire.resource.description = "Managed wallet signing for buyers.";
    expect(() => prepareForbiddenCapabilityAudit(hit.catalog, hit.sidecars, FORBIDDEN, {
      auditRunId: "x", createdAt: NOW, seed: "0123456789abcdef", auditors,
    })).toThrow("deterministic forbidden scan failed");
    expect(() => prepareForbiddenCapabilityAudit(source.catalog, source.sidecars, FORBIDDEN, {
      auditRunId: "x", createdAt: NOW, seed: "0123456789abcdef",
      auditors: [{ ...auditors[0]!, run_id: "author-0" }, ...auditors.slice(1)],
    })).toThrow("authored a corpus record");
  });
});

describe("finalizeForbiddenCapabilityAudit", () => {
  it("requires complete imports and explicit owner decisions for every possible match", () => {
    const { source, result } = prepared();
    const auditImports = imports(result.manifest);
    expect(() => finalizeForbiddenCapabilityAudit(
      source.catalog, source.sidecars, FORBIDDEN, result.manifest, auditImports.slice(1), owner(result.manifest), NOW,
    )).toThrow("exactly 10");
    const missingMatchDecision = owner(result.manifest);
    missingMatchDecision.capabilities[0]!.match_decisions = [];
    expect(() => finalizeForbiddenCapabilityAudit(
      source.catalog, source.sidecars, FORBIDDEN, result.manifest, auditImports, missingMatchDecision, NOW,
    )).toThrow("owner must decide every and only reported match");
  });

  it("passes only after owner clears all possible matches", () => {
    const { source, result } = prepared();
    const report = finalizeForbiddenCapabilityAudit(
      source.catalog, source.sidecars, FORBIDDEN, result.manifest, imports(result.manifest), owner(result.manifest), NOW,
    );
    expect(ForbiddenCapabilityAuditReportSchema.safeParse(report).success).toBe(true);
    expect(report.deterministic_scan_passed).toBe(true);
    expect(report.agent_audits_complete).toBe(true);
    expect(report.owner_signoff_complete).toBe(true);
    expect(report.overall_passed).toBe(true);
    expect(report.capabilities[0]!.possible_matches).toHaveLength(1);
  });

  it("reports blocked rather than auto-approving a confirmed capability", () => {
    const { source, result } = prepared();
    const report = finalizeForbiddenCapabilityAudit(
      source.catalog, source.sidecars, FORBIDDEN, result.manifest, imports(result.manifest), owner(result.manifest, true), NOW,
    );
    expect(report.overall_passed).toBe(false);
    expect(report.capabilities[0]!.owner_status).toBe("blocked_present");
  });
});
