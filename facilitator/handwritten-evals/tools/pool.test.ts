import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  POOL_SYSTEMS,
  PUBNET_USDC,
  QUERY_CLASS_TARGETS,
  RELEASE_COUNTS,
  TESTNET_USDC,
  type CatalogRecord,
  type PoolSystem,
  type QueryRecord,
  type SidecarRecord,
} from "../schema/schema-v2.js";
import {
  POOL_DEPTH,
  SYSTEM_RUN_FILENAMES,
  SystemRunRecordSchema,
  buildPool,
  deterministicEligibility,
  encodeJsonl,
  generateBm25Run,
  loadSystemRunJsonl,
  loadSystemRuns,
  validateDatasetCompleteness,
  validateRunEligibility,
  validateExactPoolCoverage,
  type SystemRunRecord,
  type SystemRuns,
  type V2Dataset,
} from "./pool.js";

const PAY_TO = "GAOH2NR3A3R2VS6TUE6L75A3OMJ4UKJWEHHNL5GIIEQTS5RVZEK5LAP4";
const GENERATED_AT = "2026-08-07T00:00:00.000Z";
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function generation(runId: string) {
  return {
    provider: "anthropic" as const,
    model: "test-model-revision",
    prompt_hash: "sha256:test",
    run_id: runId,
    shard_id: `${runId}-shard`,
    generated_at: GENERATED_AT,
  };
}

function makeDataset(): V2Dataset {
  const catalog: CatalogRecord[] = [];
  const sidecars: SidecarRecord[] = [];
  for (let index = 1; index <= RELEASE_COUNTS.resources.total; index += 1) {
    const resourceId = `res-${String(index).padStart(4, "0")}`;
    const labeled = index <= 100;
    const mcp = labeled && index > 85;
    const amount = index === 1 ? "10000" : "20000";
    catalog.push({
      resource_id: resourceId,
      wire: {
        x402Version: 2,
        resource: {
          url: `https://resource-${String(index).padStart(4, "0")}.example/api`,
          serviceName: index === 1 ? "Alpha Match" : `Item ${index}`,
          description: index === 1 ? "alpha filtered target" : `catalog filler item ${index}`,
          tags: index === 1 ? ["alpha"] : ["filler"],
        },
        accepts: [{
          scheme: "exact",
          network: "stellar:testnet",
          asset: TESTNET_USDC,
          amount,
          payTo: PAY_TO,
          maxTimeoutSeconds: 60,
          extra: { areFeesSponsored: false },
        }],
        extensions: { bazaar: {} },
      },
    });

    const common = {
      resource_id: resourceId,
      authorship: "agent" as const,
      resource_type: mcp ? "mcp" as const : "http" as const,
      is_distractor: !labeled,
      is_sparse: false,
      adversarial_kind: null,
      provider_id: `provider-${String(((index - 1) % 120) + 1).padStart(3, "0")}`,
      generation: generation("dataset-run"),
      derived_from: { kind: "agent_generated" as const, generation_id: "dataset-run", rationale: "test fixture" },
      review_status: "pending" as const,
      reviewed_at: null,
      owner_note: null,
      family: labeled ? Math.ceil(index / 5) : null,
      family_slot: labeled ? ((index - 1) % 5) + 1 : null,
      category: index === 1 ? "target" : "other",
      is_live: false as const,
      settlement_verified: false as const,
      asset_decimals: 7 as const,
      price_usd_snapshot: {
        value: Number(amount) / 10 ** 7,
        as_of: GENERATED_AT,
        basis: "fixed_fixture_minimum_option_value" as const,
      },
    };
    if (!labeled) {
      sidecars.push(common);
    } else if (mcp) {
      sidecars.push({
        ...common,
        axes: {
          capability: `cap-${index}`,
          resource_type: "mcp",
          input_method: "not_applicable",
          input_shape: "tool_arguments",
          output_shape: "json",
          coverage: "global",
          freshness: "daily",
          price_tier: 0.002,
          networks: ["stellar:testnet"],
          scheme_set: "exact_only",
          attestation: "unsigned",
        },
        mcp: {
          server_name: `server-${index}`,
          tool_name: `tool-${index}`,
          transport: "streamable-http",
          tool_count: 1,
          input_schema_shape: "flat_scalars",
        },
      });
    } else {
      sidecars.push({
        ...common,
        axes: {
          capability: `cap-${index}`,
          resource_type: "http",
          input_method: "GET",
          input_shape: "query_params",
          output_shape: "json",
          coverage: "global",
          freshness: index === 1 ? "live" : "daily",
          price_tier: index === 1 ? 0.001 : 0.002,
          networks: ["stellar:testnet"],
          scheme_set: "exact_only",
          attestation: "unsigned",
        },
      });
    }
  }

  const classes = Object.entries(QUERY_CLASS_TARGETS).flatMap(([queryClass, count]) =>
    Array.from({ length: count }, () => queryClass as QueryRecord["query_class"]));
  const mcpSubtypes = ["tuple_identity", "tool_schema", "transport", "http_vs_mcp"] as const;
  let mcpIndex = 0;
  const queries: QueryRecord[] = classes.map((queryClass, index) => {
    const queryId = `qry-${String(index + 1).padStart(3, "0")}`;
    const noResult = queryClass === "no_result";
    const filters = queryClass === "structured" ? { network: "stellar:testnet" as const } : {};
    const evaluationConstraints = queryClass === "price_category" ? { max_price_usd: 0.01 } : {};
    const mcpSubtype = queryClass === "mcp" ? mcpSubtypes[mcpIndex++ % mcpSubtypes.length] : undefined;
    return {
      query_id: queryId,
      split: index < 50 ? "development" : "release",
      query_class: queryClass,
      query: index === 0 ? "alpha target" : `catalog item ${index + 1}`,
      filters,
      evaluation_constraints: evaluationConstraints,
      expects_no_result: noResult,
      phrasing_register: "terse_agent",
      ...(mcpSubtype ? { mcp_subtype: mcpSubtype } : {}),
      family: noResult ? null : 1,
      ...(noResult ? { forbidden_capability: `absent capability ${index}` } : {}),
      generation: generation("query-run"),
      derived_from: { kind: "agent_generated", generation_id: "query-run", use_case: "test query" },
      review_status: "pending",
      reviewed_at: null,
      owner_note: null,
    };
  });
  return { catalog, sidecars, queries };
}

function runRecord(
  system: PoolSystem,
  queryId: string,
  resourceIds: string[] = ["res-0001"],
): SystemRunRecord {
  return SystemRunRecordSchema.parse({
    system,
    query_id: queryId,
    run_id: `run-${system}`,
    generated_at: GENERATED_AT,
    latency_ms: 10,
    requested_depth: POOL_DEPTH,
    total_results: resourceIds.length,
    results: resourceIds.map((resourceId, index) => ({ resource_id: resourceId, rank: index + 1, score: 1 - index / 10 })),
  });
}

function completeRuns(dataset: V2Dataset, resourceIds = ["res-0001"]): SystemRuns {
  return Object.fromEntries(POOL_SYSTEMS.map(system => [
    system,
    dataset.queries.map(query => runRecord(system, query.query_id, resourceIds)),
  ])) as SystemRuns;
}

describe("SystemRunRecordSchema", () => {
  it("accepts one complete explicit top-20 contract", () => {
    const ids = Array.from({ length: 20 }, (_, index) => `res-${String(index + 1).padStart(4, "0")}`);
    expect(runRecord("lexical", "qry-001", ids).results).toHaveLength(20);
  });

  it("rejects rank gaps, duplicate ids, and truncated output", () => {
    const base = runRecord("lexical", "qry-001", ["res-0001", "res-0002"]);
    expect(SystemRunRecordSchema.safeParse({ ...base, results: [{ ...base.results[0], rank: 2 }, base.results[1]!] }).success).toBe(false);
    expect(SystemRunRecordSchema.safeParse({ ...base, results: [base.results[0], { ...base.results[1], resource_id: "res-0001" }] }).success).toBe(false);
    expect(SystemRunRecordSchema.safeParse({ ...base, total_results: 3 }).success).toBe(false);
  });

  it("requires a finite non-negative per-query latency", () => {
    const base = runRecord("lexical", "qry-001");
    const { latency_ms: _latency, ...missing } = base;
    expect(SystemRunRecordSchema.safeParse(missing).success).toBe(false);
    expect(SystemRunRecordSchema.safeParse({ ...base, latency_ms: -1 }).success).toBe(false);
    expect(SystemRunRecordSchema.safeParse({ ...base, latency_ms: Number.POSITIVE_INFINITY }).success).toBe(false);
    expect(SystemRunRecordSchema.safeParse({ ...base, latency_ms: 0 }).success).toBe(true);
  });
});

describe("run JSONL ingestion", () => {
  it("validates the named system, query set, resource set, and one run id", async () => {
    const root = await mkdtemp(join(tmpdir(), "pool-run-"));
    temporary.push(root);
    const path = join(root, "lexical-v2.jsonl");
    await writeFile(path, encodeJsonl([
      runRecord("lexical", "qry-001"),
      runRecord("lexical", "qry-002", ["res-0002"]),
    ]));
    const loaded = await loadSystemRunJsonl(
      path, "lexical", new Set(["qry-001", "qry-002"]), new Set(["res-0001", "res-0002"]),
    );
    expect(loaded).toHaveLength(2);
    await expect(loadSystemRunJsonl(
      path, "semantic", new Set(["qry-001", "qry-002"]), new Set(["res-0001", "res-0002"]),
    )).rejects.toThrow("expected system semantic");
  });

  it("requires all five fixed filenames", async () => {
    const root = await mkdtemp(join(tmpdir(), "pool-runs-"));
    temporary.push(root);
    const queries = new Set(["qry-001"]);
    const resources = new Set(["res-0001"]);
    for (const system of POOL_SYSTEMS.filter(system => system !== "bm25")) {
      await writeFile(join(root, SYSTEM_RUN_FILENAMES[system]), encodeJsonl([runRecord(system, "qry-001")]));
    }
    await expect(loadSystemRuns(root, queries, resources)).rejects.toThrow("bm25-v2.jsonl");
  });
});

describe("dataset completeness", () => {
  it("accepts exact v2 counts and refuses a partial corpus or query set", () => {
    const dataset = makeDataset();
    expect(() => validateDatasetCompleteness(dataset)).not.toThrow();
    expect(() => validateDatasetCompleteness({ ...dataset, catalog: dataset.catalog.slice(1) }))
      .toThrow(`expected ${RELEASE_COUNTS.resources.total} catalog records`);
    expect(() => validateDatasetCompleteness({ ...dataset, queries: dataset.queries.slice(1) }))
      .toThrow("expected 100 queries");
  });
});

describe("deterministic hard filters", () => {
  it("applies every supported wire filter and evaluation constraint", () => {
    const dataset = makeDataset();
    const catalog = dataset.catalog[0]!;
    const sidecar = dataset.sidecars[0]!;
    const base = dataset.queries[0]!;
    const query: QueryRecord = {
      ...base,
      filters: {
        type: "http",
        network: "stellar:testnet",
        scheme: "exact",
        payTo: PAY_TO,
        asset: TESTNET_USDC,
        extensions: "bazaar",
      },
      evaluation_constraints: {
        max_price_usd: 0.001,
        category: "target",
        freshness: "live",
        resource_type: "http",
      },
    };
    expect(deterministicEligibility(query, catalog, sidecar)).toEqual({ eligible: true, reasons: [] });

    const failures: Array<[string, QueryRecord]> = [
      ["filters.type", { ...query, filters: { ...query.filters, type: "mcp" } }],
      ["filters.extensions", { ...query, filters: { ...query.filters, extensions: "missing" } }],
      ["filters.payment_option", { ...query, filters: { ...query.filters, network: "stellar:pubnet", asset: PUBNET_USDC } }],
      ["evaluation_constraints.max_price_usd", { ...query, evaluation_constraints: { ...query.evaluation_constraints, max_price_usd: 0 } }],
      ["evaluation_constraints.category", { ...query, evaluation_constraints: { ...query.evaluation_constraints, category: "other" } }],
      ["evaluation_constraints.freshness", { ...query, evaluation_constraints: { ...query.evaluation_constraints, freshness: "daily" } }],
      ["evaluation_constraints.resource_type", { ...query, evaluation_constraints: { ...query.evaluation_constraints, resource_type: "mcp" } }],
    ];
    for (const [reason, candidate] of failures) {
      expect(deterministicEligibility(candidate, catalog, sidecar).reasons).toContain(reason);
    }
  });

  it("requires payment predicates to match one accepts option jointly", () => {
    const dataset = makeDataset();
    const catalog: CatalogRecord = {
      ...dataset.catalog[0]!,
      wire: {
        ...dataset.catalog[0]!.wire,
        accepts: [
          dataset.catalog[0]!.wire.accepts[0]!,
          {
            ...dataset.catalog[0]!.wire.accepts[0]!, network: "stellar:pubnet", asset: PUBNET_USDC,
            scheme: "upto",
          },
        ],
      },
    };
    const query: QueryRecord = {
      ...dataset.queries[0]!, filters: { network: "stellar:pubnet", scheme: "exact" },
    };
    expect(deterministicEligibility(query, catalog, dataset.sidecars[0]!).eligible).toBe(false);
  });
});

describe("BM25 run and five-system pool", () => {
  it("produces a complete filter-aware BM25 run", () => {
    const dataset = makeDataset();
    dataset.queries[0] = {
      ...dataset.queries[0]!,
      query: "alpha target",
      filters: { type: "http", network: "stellar:testnet", scheme: "exact", asset: TESTNET_USDC },
      evaluation_constraints: { max_price_usd: 0.001, category: "target", freshness: "live", resource_type: "http" },
    };
    let clock = 0;
    const run = generateBm25Run(dataset, {
      runId: "run-bm25",
      generatedAt: GENERATED_AT,
      now: () => {
        clock += 2.5;
        return clock;
      },
    });
    expect(run).toHaveLength(100);
    expect(run[0]).toMatchObject({
      system: "bm25", query_id: "qry-001", latency_ms: 2.5, requested_depth: 20, total_results: 1,
    });
    expect(run[0]!.results.map(result => result.resource_id)).toEqual(["res-0001"]);
  });

  it("deduplicates pairs and retains every system/rank contribution", () => {
    const dataset = makeDataset();
    const runs = completeRuns(dataset);
    runs.semantic[0] = runRecord("semantic", "qry-001", ["res-0002", "res-0001"]);
    const pool = buildPool(dataset, runs, { runId: "pool-run", pooledAt: GENERATED_AT });
    expect(pool).toHaveLength(101);
    expect(pool[0]).toMatchObject({
      query_id: "qry-001",
      resource_id: "res-0001",
      best_rank: 1,
      pool_depth: 20,
      run_id: "pool-run",
    });
    expect(pool[0]!.contributions).toEqual(POOL_SYSTEMS.map(system => ({
      system,
      rank: system === "semantic" ? 2 : 1,
    })));
    expect(pool[1]).toMatchObject({
      query_id: "qry-001",
      resource_id: "res-0002",
      contributions: [{ system: "semantic", rank: 1 }],
    });
    expect(() => validateExactPoolCoverage(pool, runs)).not.toThrow();
  });

  it("rejects a pool that omits, invents, or changes any top-20 contribution", () => {
    const dataset = makeDataset();
    const runs = completeRuns(dataset);
    const pool = buildPool(dataset, runs, { runId: "pool-run", pooledAt: GENERATED_AT });
    expect(() => validateExactPoolCoverage(pool.slice(1), runs)).toThrow(/pair set differs/);
    expect(() => validateExactPoolCoverage([
      ...pool,
      { ...pool[0]!, resource_id: "res-0002" },
    ], runs)).toThrow(/extra=qry-001\/res-0002/);
    expect(() => validateExactPoolCoverage([
      { ...pool[0]!, contributions: pool[0]!.contributions.map(item =>
        item.system === "semantic" ? { ...item, rank: 2 } : item) },
      ...pool.slice(1),
    ], runs)).toThrow(/semantic contribution expected 1, found 2/);
  });

  it("rejects incomplete system runs and hard-filter violations", () => {
    const dataset = makeDataset();
    const incomplete = completeRuns(dataset);
    incomplete.lexical = incomplete.lexical.slice(1);
    expect(() => buildPool(dataset, incomplete, { runId: "pool-run", pooledAt: GENERATED_AT }))
      .toThrow("lexical run id set is incomplete");

    const filteredDataset = makeDataset();
    filteredDataset.queries[0] = { ...filteredDataset.queries[0]!, filters: { type: "mcp" } };
    const violating = completeRuns(filteredDataset);
    expect(() => validateRunEligibility(filteredDataset, violating))
      .toThrow("hard-filter violation: filters.type");
  });
});
