import { describe, expect, it } from "vitest";
import { FORBIDDEN_CAPABILITIES, QUERY_ASSIGNMENTS } from "../query-config.js";
import { POOL_BUILD_SYSTEMS, RELEASE_COUNTS, TESTNET_USDC, type CatalogRecord, type QueryRecord, type SidecarRecord } from "../schema/schema-v2.js";
import { finalizePass1Seed, Pass1SeedReportSchema, preparePass1Seed, validatePass1SeedImport } from "./query-pass1.js";

const now = "2026-08-07T00:00:00.000Z";
const payTo = "GAOH2NR3A3R2VS6TUE6L75A3OMJ4UKJWEHHNL5GIIEQTS5RVZEK5LAP4";
const generation = (run: string) => ({ provider: "anthropic" as const, model: "test-revision",
  prompt_hash: "sha256:test", run_id: run, shard_id: `${run}-shard`, generated_at: now });

function fixtures() {
  const catalog: CatalogRecord[] = [];
  const sidecars: SidecarRecord[] = [];
  for (let index = 1; index <= RELEASE_COUNTS.resources.total; index += 1) {
    const id = `res-${String(index).padStart(4, "0")}`;
    catalog.push({ resource_id: id, wire: { x402Version: 2, resource: { url: `https://item-${index}.example/api`,
      serviceName: `Item ${index}`, description: `Independent service ${index}`, tags: ["fixture"] }, accepts: [{ scheme: "exact",
      network: "stellar:testnet", asset: TESTNET_USDC, amount: "10000", payTo, maxTimeoutSeconds: 60,
      extra: { areFeesSponsored: false } }], extensions: { bazaar: {} } } });
    sidecars.push({ resource_id: id, provider_id: `provider-${String(((index - 1) % 120) + 1).padStart(3, "0")}`,
      authorship: "agent", resource_type: "http", is_distractor: true, is_sparse: false,
      adversarial_kind: null, family: null, family_slot: null, category: "fixture", asset_decimals: 7,
      price_usd_snapshot: { value: 0.001, as_of: now, basis: "fixed_fixture_minimum_option_value" },
      is_live: false, settlement_verified: false, generation: generation(`resource-run-${index}`),
      derived_from: { kind: "agent_generated", generation_id: `resource-run-${index}`, rationale: "fixture" },
      review_status: "approved", reviewed_at: now, owner_note: null });
  }
  const queries: QueryRecord[] = QUERY_ASSIGNMENTS.map((assignment, index) => ({
    query_id: assignment.queryId, split: assignment.split, query_class: "capability", query: `buyer need ${index}`,
    filters: {}, evaluation_constraints: {}, expects_no_result: false,
    phrasing_register: assignment.phrasingRegister, family: assignment.family ?? 1,
    generation: generation(assignment.runId), derived_from: { kind: "agent_generated", generation_id: assignment.runId,
      use_case: "fixture buyer use case" }, review_status: "approved", reviewed_at: now, owner_note: null,
  }));
  return { queries, catalog, sidecars };
}

describe("Step 5 frozen assignments", () => {
  it("covers exact counts, splits, families, forbidden capabilities, and MCP subtypes", () => {
    expect(QUERY_ASSIGNMENTS).toHaveLength(100);
    expect(QUERY_ASSIGNMENTS.filter(item => item.split === "development")).toHaveLength(50);
    expect(new Set(QUERY_ASSIGNMENTS.filter(item => item.family !== null).map(item => item.family))).toHaveLength(20);
    expect(QUERY_ASSIGNMENTS.filter(item => item.queryClass === "no_result").map(item => item.forbiddenId))
      .toEqual(FORBIDDEN_CAPABILITIES.map(item => item[0]));
    const mcp = QUERY_ASSIGNMENTS.filter(item => item.queryClass === "mcp");
    expect(mcp).toHaveLength(9);
    expect(new Set(mcp.map(item => item.mcpSubtype))).toEqual(new Set(["tuple_identity", "tool_schema", "transport", "http_vs_mcp"]));
    expect(POOL_BUILD_SYSTEMS).toContain("bm25");

    const structured = QUERY_ASSIGNMENTS.filter(item => item.queryClass === "structured");
    expect(structured).toHaveLength(14);
    expect(structured.every(item => item.filters.extensions === undefined)).toBe(true);
    expect(structured.some(item => item.filters.network !== undefined)).toBe(true);
    expect(structured.some(item => item.filters.scheme !== undefined)).toBe(true);
    expect(structured.some(item => item.filters.type !== undefined)).toBe(true);

    const priceCaps = QUERY_ASSIGNMENTS.filter(item => item.queryClass === "price_category")
      .map(item => item.evaluationConstraints.max_price_usd);
    expect(priceCaps).toHaveLength(9);
    expect(new Set(priceCaps).size).toBeGreaterThan(1);
    expect(priceCaps.every(value => value !== undefined && value < 0.15)).toBe(true);
  });
});

describe("pass-1 seed preparation", () => {
  it("creates ten blind seven-candidate packs and validates exact imports", () => {
    const sealedImports = "/private/tmp/stellar-bazaar-pass1/imports";
    const prepared = preparePass1Seed(
      ...Object.values(fixtures()) as [QueryRecord[], CatalogRecord[], SidecarRecord[]], now, sealedImports,
    );
    expect(prepared.packs).toHaveLength(10);
    expect(prepared.prompts).toHaveLength(10);
    expect(prepared.prompts.every((prompt, index) => prompt.includes(`run-query-pass1-grader-${String(index + 1).padStart(2, "0")}`)
      && prompt.includes(`query-pass1-seed-${String(index + 1).padStart(2, "0")}`)
      && prompt.includes(`${sealedImports}/grader-${String(index + 1).padStart(2, "0")}.json`)
      && !prompt.includes("<"))).toBe(true);
    expect(prepared.manifest.assignments).toHaveLength(700);
    expect(prepared.packs.every(pack => pack.tasks.length === 10 && pack.tasks.every(task => task.candidates.length === 7))).toBe(true);
    for (const query of fixtures().queries) {
      const anchor = QUERY_ASSIGNMENTS.find(item => item.queryId === query.query_id)!.anchorResourceId;
      if (anchor !== null) {
        expect(prepared.manifest.assignments.some(item => item.query_id === query.query_id && item.resource_id === anchor)).toBe(true);
      }
    }
    const pack = prepared.manifest.packs[0]!;
    const assignments = prepared.manifest.assignments.filter(item => item.grader_run_id === pack.grader_run_id);
    const imported = { version: 1, role: "pass1_seed_grader", pack_id: pack.pack_id,
      grader: {
        provider: "anthropic",
        run_id: pack.grader_run_id,
        shard_id: pack.pack_id,
        model: "grader-revision",
        prompt_hash: pack.prompt_hash,
        generated_at: now,
      },
      judgments: assignments.map(item => ({ task_id: item.task_id, candidate_id: item.candidate_id, grade: 0,
        rationale: "Different capability in the blind seed set.", judged_at: now })) };
    expect(() => validatePass1SeedImport(imported, prepared.manifest)).not.toThrow();
    expect(() => validatePass1SeedImport({
      ...imported,
      judgments: imported.judgments.map(judgment => ({ ...judgment, rationale: undefined })),
    }, prepared.manifest)).toThrow(/requires a rationale/);
    expect(() => validatePass1SeedImport({ ...imported, grader: { ...imported.grader, run_id: "query-author" } }, prepared.manifest))
      .toThrow(/provenance/);

    const imports = prepared.manifest.packs.map(currentPack => {
      const currentAssignments = prepared.manifest.assignments.filter(item => item.grader_run_id === currentPack.grader_run_id);
      return {
        version: 1 as const,
        role: "pass1_seed_grader" as const,
        pack_id: currentPack.pack_id,
        grader: {
          provider: "anthropic" as const,
          run_id: currentPack.grader_run_id,
          shard_id: currentPack.pack_id,
          model: "grader-revision",
          prompt_hash: currentPack.prompt_hash,
          generated_at: now,
        },
        judgments: currentAssignments.map(item => ({
          task_id: item.task_id,
          candidate_id: item.candidate_id,
          grade: 0,
          rationale: "Different capability in the blind seed set.",
          judged_at: now,
        })),
      };
    });
    const finalized = finalizePass1Seed(imports, prepared.manifest, now);
    expect(finalized.qrels).toHaveLength(700);
    expect(finalized.report.grader_run_ids).toHaveLength(10);
    expect(Pass1SeedReportSchema.safeParse(finalized.report).success).toBe(true);
  });
});
