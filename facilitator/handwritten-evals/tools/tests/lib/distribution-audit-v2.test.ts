import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASSOCIATION_IDS,
  buildDistributionAuditV2,
  cramersV,
  DISTRIBUTION_AUDIT_POLICY,
  DISTRIBUTION_CHECK_IDS,
  DistributionAuditV2Schema,
} from "../../lib/distribution-audit-v2.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const generatedAt = "2026-08-07T00:00:00.000Z";

async function jsonl(path: string): Promise<unknown[]> {
  return (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

async function currentCore(): Promise<{ catalog: unknown[]; sidecars: unknown[] }> {
  const [catalog, sidecars] = await Promise.all([
    jsonl(resolve(ROOT, "catalog/catalog-v2.jsonl")),
    jsonl(resolve(ROOT, "catalog/sidecar-v2.jsonl")),
  ]);
  return { catalog, sidecars };
}

describe("distribution audit v2", () => {
  it("audits the complete released 500-record corpus and passes every check", async () => {
    const input = await currentCore();
    const report = buildDistributionAuditV2(input.catalog, input.sidecars, generatedAt);

    expect(report.status).toBe("pass");
    expect(report.counts).toEqual({
      catalog: 500, sidecars: 500, labeled: 100, distractors: 400, distractor_upto_bearing: 4,
      distinct_providers: 120,
    });
    expect(report.checks.map(check => check.id)).toEqual(DISTRIBUTION_CHECK_IDS);
    expect(report.associations.map(value => value.id)).toEqual(ASSOCIATION_IDS);
    expect(report.checks.every(check => check.passed)).toBe(true);
    expect(report.associations.every(value => value.passed)).toBe(true);
    expect(report.all_checks_passed).toBe(true);
    expect(report.statistics.scheme_sets).toEqual({ exact_only: 70, exact_and_upto: 22, upto_only: 8 });
    expect(report.statistics.groups.upto.distinct_families).toBe(20);
    expect(report.statistics.mcp_upto_share_absolute_drift).toBeLessThanOrEqual(
      DISTRIBUTION_AUDIT_POLICY.mcp_upto_share_max_absolute_drift,
    );
    expect(DistributionAuditV2Schema.parse(report)).toEqual(report);
  });

  it("detects a shipped sidecar distribution drifting from its wire record and scheme target", async () => {
    const input = await currentCore();
    const sidecars = structuredClone(input.sidecars) as Array<Record<string, unknown>>;
    const first = sidecars[0]!;
    first.axes = { ...(first.axes as Record<string, unknown>), scheme_set: "upto_only" };
    const report = buildDistributionAuditV2(input.catalog, sidecars, generatedAt);

    expect(report.checks.find(check => check.id === "catalog-sidecar-wire")?.passed).toBe(false);
    expect(report.checks.find(check => check.id === "scheme-target")?.passed).toBe(false);
    expect(report.status).toBe("blocked");
  });

  it("blocks a family-correlated upto assignment even before semantic review", async () => {
    const input = await currentCore();
    const sidecars = structuredClone(input.sidecars) as Array<Record<string, unknown>>;
    let labeledIndex = 0;
    sidecars.forEach(record => {
      if (record.is_distractor === true) return;
      record.axes = {
        ...(record.axes as Record<string, unknown>),
        scheme_set: labeledIndex < 30 ? "exact_and_upto" : "exact_only",
      };
      labeledIndex += 1;
    });
    const report = buildDistributionAuditV2(input.catalog, sidecars, generatedAt);
    const association = report.associations.find(value => value.id === "upto-family");

    expect(association?.cramers_v).toBeGreaterThan(DISTRIBUTION_AUDIT_POLICY.association_max_cramers_v);
    expect(association?.passed).toBe(false);
    expect(report.status).toBe("blocked");
  });

  it("uses Cramer's V with known independent and perfectly associated tables", () => {
    expect(cramersV(["a", "a", "b", "b"], ["x", "y", "x", "y"])).toBe(0);
    expect(cramersV(["a", "a", "b", "b"], ["x", "x", "y", "y"])).toBe(1);
    expect(cramersV(["a", "a"], ["x", "y"])).toBeNull();
    expect(() => cramersV(["a"], ["x", "y"])).toThrow(/differ/);
  });

  it("rejects a report whose status or pass summary contradicts its checks", async () => {
    const input = await currentCore();
    const report = buildDistributionAuditV2(input.catalog, input.sidecars, generatedAt);
    const wrongStatus = report.status === "pass" ? "blocked" : "pass";
    expect(DistributionAuditV2Schema.safeParse({ ...report, status: wrongStatus }).success).toBe(false);
    expect(DistributionAuditV2Schema.safeParse({ ...report, all_checks_passed: !report.all_checks_passed }).success).toBe(false);
    expect(DistributionAuditV2Schema.safeParse({ ...report, checks: [...report.checks].reverse() }).success).toBe(false);
  });

  it("hashes canonical record content rather than caller order", async () => {
    const input = await currentCore();
    const forward = buildDistributionAuditV2(input.catalog, input.sidecars, generatedAt);
    const reverse = buildDistributionAuditV2([...input.catalog].reverse(), [...input.sidecars].reverse(), generatedAt);
    expect(reverse.source_hash).toBe(forward.source_hash);
  });
});
