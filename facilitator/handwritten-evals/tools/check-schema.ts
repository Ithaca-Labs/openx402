/**
 * Syntax-only smoke check for `schema/schema-v2.ts`.
 *
 * Verifies that the v2 schema accepts a well-formed record of each kind and rejects the specific
 * v1 mistakes v2 exists to remove. It asserts nothing about relevance — see README "syntax only".
 *
 *   npx tsc --noEmit -p tsconfig.json      # types
 *   npx tsx tools/check-schema.ts          # runtime refinements
 */

import {
  assertReleaseCounts,
  axisDifferences,
  CatalogRecordSchema,
  HumanCalibrationSchema,
  PoolRecordSchema,
  PUBNET_USDC,
  QrelRecordSchema,
  QueryRecordSchema,
  RELEASE_COUNTS,
  SidecarRecordSchema,
  TESTNET_USDC,
  unjudgedPooledPairs,
  type Axes,
} from "../schema/schema-v2.js";

const PAY_TO = "GAOH2NR3A3R2VS6TUE6L75A3OMJ4UKJWEHHNL5GIIEQTS5RVZEK5LAP4";

let failures = 0;

function ok(label: string, condition: boolean): void {
  if (!condition) {
    failures += 1;
    console.error(`FAIL  ${label}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

function accepts(scheme: "exact" | "upto", network: "stellar:testnet" | "stellar:pubnet", amount: string) {
  return {
    scheme,
    network,
    asset: network === "stellar:testnet" ? TESTNET_USDC : PUBNET_USDC,
    amount,
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: { areFeesSponsored: false },
  };
}

const catalogRecord = {
  resource_id: "res-0001",
  wire: {
    x402Version: 2 as const,
    resource: {
      url: "https://provider-001.stellar-bazaar.example/v1/ledger/entry",
      serviceName: "Ledger entry lookup",
      description: "Returns a single ledger entry by key.",
      tags: ["ledger", "stellar"],
    },
    accepts: [accepts("exact", "stellar:testnet", "20000"), accepts("upto", "stellar:testnet", "50000")],
    extensions: { bazaar: {} },
  },
};

const axes: Axes = {
  capability: "ledger_entry_lookup",
  resource_type: "http",
  input_method: "GET",
  input_shape: "query_params",
  output_shape: "json",
  coverage: "single_chain",
  freshness: "live",
  price_tier: 0.002,
  networks: ["stellar:testnet"],
  scheme_set: "exact_and_upto",
  attestation: "unsigned",
};

const sidecarRecord = {
  resource_id: "res-0001",
  authorship: "human" as const,
  resource_type: "http" as const,
  is_distractor: false,
  is_sparse: false,
  adversarial_kind: null,
  provider_id: "provider-001",
  derived_from: { kind: "curated" as const, generation_id: "handwritten-v2", rationale: "family 1 slot 1" },
  family: 1,
  family_slot: 1,
  category: "onchain-state",
  is_live: false as const,
  settlement_verified: false as const,
  asset_decimals: 7 as const,
  price_usd_snapshot: { value: 0.002, as_of: "2026-01-01T00:00:00.000Z", basis: "fixed_fixture_minimum_option_value" as const },
  axes,
};

// --- identifier widths (§0.1) -------------------------------------------------------------------
ok("res-0001 accepted", CatalogRecordSchema.safeParse(catalogRecord).success);
ok("res-001 rejected (v1 width)", !CatalogRecordSchema.safeParse({ ...catalogRecord, resource_id: "res-001" }).success);
ok("provider-001 accepted", SidecarRecordSchema.safeParse(sidecarRecord).success);
ok(
  "provider-01 rejected (v1 width)",
  !SidecarRecordSchema.safeParse({ ...sidecarRecord, provider_id: "provider-01" }).success,
);

// --- scheme enum (§0.2) -------------------------------------------------------------------------
ok("upto accepted on the wire", CatalogRecordSchema.safeParse(catalogRecord).success);

// --- wire constraints (§5) ----------------------------------------------------------------------
ok(
  "non-.example hostname rejected",
  !CatalogRecordSchema.safeParse({
    ...catalogRecord,
    wire: { ...catalogRecord.wire, resource: { ...catalogRecord.wire.resource, url: "https://example.com/x" } },
  }).success,
);
ok(
  "wrong-network USDC rejected",
  !CatalogRecordSchema.safeParse({
    ...catalogRecord,
    wire: {
      ...catalogRecord.wire,
      accepts: [{ ...accepts("exact", "stellar:testnet", "20000"), asset: PUBNET_USDC }],
    },
  }).success,
);
ok(
  "four accepts entries rejected",
  !CatalogRecordSchema.safeParse({
    ...catalogRecord,
    wire: { ...catalogRecord.wire, accepts: Array.from({ length: 4 }, () => accepts("exact", "stellar:testnet", "20000")) },
  }).success,
);
ok(
  "six tags rejected",
  !CatalogRecordSchema.safeParse({
    ...catalogRecord,
    wire: {
      ...catalogRecord.wire,
      resource: { ...catalogRecord.wire.resource, tags: ["a", "b", "c", "d", "e", "f"] },
    },
  }).success,
);

// --- orthogonal fields (§0.2b) ------------------------------------------------------------------
ok(
  "source_class rejected",
  !SidecarRecordSchema.safeParse({ ...sidecarRecord, source_class: "cdp" }).success,
);
ok(
  "adversarial boolean rejected",
  !SidecarRecordSchema.safeParse({ ...sidecarRecord, adversarial: true }).success,
);
const mcpAxes = { ...axes, resource_type: "mcp" as const, input_method: "not_applicable" as const, input_shape: "tool_arguments" as const };
const mcpTool = {
  server_name: "ledger-tools",
  tool_name: "get_entry",
  transport: "stdio" as const,
  tool_count: 3,
  input_schema_shape: "flat_scalars" as const,
};
ok(
  "mcp + adversarial + sparse coexist",
  SidecarRecordSchema.safeParse({
    ...sidecarRecord,
    resource_type: "mcp",
    is_sparse: true,
    adversarial_kind: "capability_spoof",
    axes: mcpAxes,
    mcp: mcpTool,
  }).success,
);
ok(
  "labeled mcp without mcp axes rejected",
  !SidecarRecordSchema.safeParse({ ...sidecarRecord, resource_type: "mcp", axes: mcpAxes }).success,
);
ok(
  "mcp with a GET verb rejected",
  !SidecarRecordSchema.safeParse({
    ...sidecarRecord,
    resource_type: "mcp",
    axes: { ...axes, resource_type: "mcp" },
    mcp: mcpTool,
  }).success,
);
ok(
  "http with tool_arguments rejected",
  !SidecarRecordSchema.safeParse({
    ...sidecarRecord,
    axes: { ...axes, input_shape: "tool_arguments" },
  }).success,
);

// --- axis differentiation (§3) ------------------------------------------------------------------
ok("identical axes differ on nothing", axisDifferences(axes, axes).length === 0);
ok(
  "two-axis sibling detected",
  axisDifferences(axes, { ...axes, input_method: "POST", output_shape: "score" }).length === 2,
);

// --- queries (§0.2, §6) -------------------------------------------------------------------------
const query = {
  query_id: "qry-001",
  split: "development" as const,
  query_class: "mcp" as const,
  query: "mcp server exposing a get_entry tool over stdio",
  expects_no_result: false,
  phrasing_register: "keyword_only" as const,
  mcp_subtype: "transport" as const,
  family: 1,
  derived_from: { kind: "curated" as const, generation_id: "handwritten-v2", use_case: "agent needs a stdio MCP tool" },
};
ok("query_class mcp accepted", QueryRecordSchema.safeParse(query).success);
ok(
  "mcp query without sub-type rejected",
  !QueryRecordSchema.safeParse({ ...query, mcp_subtype: undefined }).success,
);
ok(
  "no_result without forbidden_capability rejected",
  !QueryRecordSchema.safeParse({
    ...query,
    query_class: "no_result",
    mcp_subtype: undefined,
    expects_no_result: true,
    family: null,
  }).success,
);

// --- qrels (§0.3) -------------------------------------------------------------------------------
const humanQrel = {
  query_id: "qry-001",
  resource_id: "res-0001",
  grade: 3,
  eligible: true,
  judge: "human" as const,
  annotator: "annotator-a",
};
ok("human eligible qrel accepted", QrelRecordSchema.safeParse(humanQrel).success);
ok(
  "deterministic eligible qrel rejected",
  !QrelRecordSchema.safeParse({ ...humanQrel, judge: "deterministic" }).success,
);
ok(
  "openrouter judge rejected",
  !QrelRecordSchema.safeParse({ ...humanQrel, judge: "openrouter" }).success,
);
ok("pending judge rejected", !QrelRecordSchema.safeParse({ ...humanQrel, judge: "pending" }).success);
ok(
  "ineligible must be deterministic grade 0",
  QrelRecordSchema.safeParse({
    query_id: "qry-001",
    resource_id: "res-0002",
    grade: 0,
    eligible: false,
    judge: "deterministic",
    hard_constraint_reason: "network filter: stellar:pubnet",
  }).success &&
  !QrelRecordSchema.safeParse({
    query_id: "qry-001",
    resource_id: "res-0002",
    grade: 1,
    eligible: false,
    judge: "deterministic",
    hard_constraint_reason: "network filter: stellar:pubnet",
  }).success,
);

// --- pool (§0.3) --------------------------------------------------------------------------------
const pooled = {
  query_id: "qry-001",
  resource_id: "res-0001",
  origin: "system_pool" as const,
  contributions: [
    { system: "bm25" as const, rank: 4 },
    { system: "hybrid" as const, rank: 1 },
  ],
  best_rank: 1,
  pool_depth: 20,
  blinded: true as const,
  pooled_at: "2026-01-01T00:00:00.000Z",
  run_id: "pool-2026-01-01",
};
ok("pool record accepted", PoolRecordSchema.safeParse(pooled).success);
ok("best_rank mismatch rejected", !PoolRecordSchema.safeParse({ ...pooled, best_rank: 4 }).success);
ok(
  "contribution deeper than pool_depth rejected",
  !PoolRecordSchema.safeParse({ ...pooled, contributions: [{ system: "bm25", rank: 99 }], best_rank: 99 }).success,
);
ok(
  "unjudged pooled pair detected",
  unjudgedPooledPairs([PoolRecordSchema.parse(pooled)], []).length === 1 &&
  unjudgedPooledPairs([PoolRecordSchema.parse(pooled)], [QrelRecordSchema.parse(humanQrel)]).length === 0,
);

// --- calibration (§0.5) -------------------------------------------------------------------------
const calibration = {
  query_id: "qry-001",
  resource_id: "res-0001",
  annotator_a_grade: 3,
  annotator_b_grade: 2,
  adjudicated_grade: 3,
  annotator_a: "annotator-a",
  annotator_b: "annotator-b",
  reviewed_at: "2026-01-01T00:00:00.000Z",
  boundary_case: true,
  notes: null,
};
ok("calibration record accepted", HumanCalibrationSchema.safeParse(calibration).success);
ok(
  "boundary_case must be true when a grade is 2 or 3",
  !HumanCalibrationSchema.safeParse({ ...calibration, boundary_case: false }).success,
);
ok(
  "agent_grade rejected",
  !HumanCalibrationSchema.safeParse({ ...calibration, agent_grade: 2 }).success,
);
ok(
  "unadjudicated disagreement rejected",
  !HumanCalibrationSchema.safeParse({ ...calibration, adjudicated_grade: null }).success,
);

// --- counts (§0.4) ------------------------------------------------------------------------------
assertReleaseCounts();
ok("labeled_tags overlap and do not sum to 100", RELEASE_COUNTS.labeled_tags.adversarial +
  RELEASE_COUNTS.labeled_tags.sparse + RELEASE_COUNTS.labeled_tags.mcp !== RELEASE_COUNTS.resources.labeled);

console.log(failures === 0 ? "\nschema-v2: all checks passed" : `\nschema-v2: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
