import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEcosystemSources } from "../../src/search/ecosystem/fetch.js";
import { refreshEcosystemDataset } from "../../src/search/ecosystem/dataset.js";
import { evaluateEcosystemRun } from "../../src/search/ecosystem/evaluate.js";
import { judgeEcosystemWithOpenRouter } from "../../src/search/ecosystem/judge.js";
import { mergeEcosystemResources, normalizeExternalRecord } from "../../src/search/ecosystem/normalize.js";
import { applyEcosystemProbes, probeEcosystemResources } from "../../src/search/ecosystem/probe.js";
import { EcosystemOutcomeSchema, EcosystemQuerySchema, EcosystemJudgmentSchema } from "../../src/search/ecosystem/schema.js";
import { validateEcosystemDataset } from "../../src/search/ecosystem/validate.js";
import { encodeJsonl, sha256 } from "../../src/search/release/io.js";

const observedAt = "2026-08-02T00:00:00.000Z";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENROUTER_API_KEY;
});

describe("ecosystem dataset normalization", () => {
  it("deduplicates equivalent directory records while retaining source evidence", () => {
    const cdp = normalizeExternalRecord({
      resource: "HTTPS://Example.com/weather/?b=2&a=1#fragment",
      type: "http",
      description: "Real-time weather for a city",
      accepts: [{ scheme: "exact", network: "base", asset: "usdc", amount: "1000" }],
      quality: { l30DaysTotalCalls: 12, l30DaysUniquePayers: 4 },
    }, { source: "cdp", sourceUrl: "https://cdp.example/catalog", observedAt, redistribution: "derived_only" });
    const directory = normalizeExternalRecord({
      id: "weather-1",
      url: "https://example.com/weather?a=1&b=2",
      name: "Weather API",
      category: "weather",
      trustScore: 88,
      healthy: true,
    }, { source: "x402.direct", sourceUrl: "https://x402.direct/api/services", observedAt, redistribution: "unknown" });

    expect(cdp).not.toBeNull();
    expect(directory).not.toBeNull();
    expect(cdp!.resource_id).toBe(directory!.resource_id);
    const merged = mergeEcosystemResources([cdp!, directory!]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source_records).toHaveLength(2);
    expect(merged[0]!.canonical_origin).toBe("https://example.com");
    expect(merged[0]!.quality.transaction_volume_30d).toBe(12);
    expect(merged[0]!.quality.trust_score).toBe(88);
    expect(merged[0]!.tags).toEqual([]);
    expect(merged[0]!.categories).toEqual(["weather"]);
  });

  it("rejects records without a usable HTTP(S) resource URL", () => {
    expect(normalizeExternalRecord({ name: "not enough metadata" }, {
      source: "agent-tools", sourceUrl: "https://agent-tools.cloud", observedAt,
    })).toBeNull();
  });

  it("preserves long-lived optional timeouts without aborting the source snapshot", () => {
    const resource = normalizeExternalRecord({
      resource: "https://example.com/slow", type: "http",
      accepts: [{ scheme: "exact", network: "base", asset: "usdc", amount: "1", maxTimeoutSeconds: 604800 }],
    }, { source: "cdp", sourceUrl: "https://cdp.example/catalog", observedAt });
    expect(resource).not.toBeNull();
    expect(resource!.accepts[0]!.max_timeout_seconds).toBe(604800);
  });

  it("does not allow unsafe or unavailable services to receive positive relevance", async () => {
    const { EcosystemJudgmentSchema } = await import("../../src/search/ecosystem/schema.js");
    expect(() => EcosystemJudgmentSchema.parse({
      query_id: "eco-qry-0001", resource_id: "eco-0123456789abcdef", relevance_grade: 2,
      eligibility: "unsafe", judge: "human", provisional: false,
    })).toThrow(/ineligible resources/);
  });
});

describe("ecosystem source fetching", () => {
  it("extracts common catalog containers and keeps source failures isolated", async () => {
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("broken")) return new Response("nope", { status: 503 });
      return new Response(JSON.stringify({ resources: [{ resource: "https://example.com/api" }] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    };
    const result = await fetchEcosystemSources([
      { source: "cdp", url: "https://good.example/catalog" },
      { source: "x402.direct", url: "https://broken.example/catalog" },
    ], fakeFetch);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.records).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.source).toBe("x402.direct");
  });

  it("walks CDP-style paginated catalogs", async () => {
    const fakeFetch: typeof fetch = async input => {
      const url = new URL(String(input));
      const offset = Number(url.searchParams.get("offset"));
      const item = { resource: `https://example.com/api/${offset}`, type: "http" };
      return new Response(JSON.stringify({
        items: offset < 2 ? [item] : [],
        pagination: { limit: 1, offset, total: 2 },
      }), { status: 200 });
    };
    const result = await fetchEcosystemSources([{ source: "cdp", url: "https://good.example/catalog" }], fakeFetch);
    expect(result.errors).toEqual([]);
    expect(result.results[0]!.pages).toBe(2);
    expect(result.results[0]!.records).toHaveLength(2);
  });

  it("builds a validated live-cohort snapshot through the reusable module", async () => {
    const root = await mkdtemp(join(tmpdir(), "openx402-refresh-"));
    try {
      const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
        resources: [{ resource: "https://example.com/api", type: "http" }],
      }), { status: 200 });
      const refreshed = await refreshEcosystemDataset(root, {
        sources: [{ source: "openx402", url: "https://directory.example/catalog" }],
        fetch_impl: fakeFetch,
      });
      const dataset = await validateEcosystemDataset(root);
      expect(refreshed.resources).toBe(1);
      expect(dataset.resources).toHaveLength(1);
      expect(dataset.manifest.hashes["catalog/catalog-v1.jsonl"]).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("ecosystem recommendation evaluation", () => {
  it("separates relevance from paid task outcomes", () => {
    const resource = normalizeExternalRecord({ resource: "https://example.com/weather", type: "http", healthy: true }, {
      source: "openx402", sourceUrl: "https://openx402.example/catalog", observedAt, redistribution: "allowed",
    })!;
    const query = {
      query_id: "eco-qry-0001" as const,
      split: "release" as const,
      query_class: "capability" as const,
      text: "weather API",
      filters: {},
      expects_no_result: false,
      provenance: { kind: "curated" as const, generation_id: "test" },
    };
    const judgment = {
      query_id: query.query_id,
      resource_id: resource.resource_id,
      relevance_grade: 3,
      eligibility: "eligible" as const,
      judge: "human" as const,
      provisional: false,
    };
    const outcome = EcosystemOutcomeSchema.parse({
      query_id: query.query_id,
      resource_id: resource.resource_id,
      selected: true,
      attempted: true,
      payment_verification: "pass",
      settlement: "pass",
      invocation: "pass",
      response_valid: true,
      task_success: true,
      latency_ms: 42,
      total_cost_usd: 0.001,
      observed_at: observedAt,
    });
    const report = evaluateEcosystemRun([resource], [query], [judgment], [{
      query_id: query.query_id, ranked_resource_ids: [resource.resource_id], latency_ms: 10,
    }], [outcome]);
    expect(report.relevance.ndcg[5]).toBe(1);
    expect(report.relevance.recall[20]).toBe(1);
    expect(report.operational.task_success_rate).toBe(1);
    expect(report.operational.payment_verification_rate).toBe(1);
    expect(report.hard_constraint_violations).toBe(0);
  });

  it("marks missing judgments as incomplete evidence instead of a no-result success", () => {
    const resource = normalizeExternalRecord({ resource: "https://example.com/weather", type: "http" }, {
      source: "openx402", sourceUrl: "https://openx402.example/catalog", observedAt, redistribution: "allowed",
    })!;
    const query = EcosystemQuerySchema.parse({
      query_id: "eco-qry-0001", split: "release", query_class: "capability", text: "weather API",
      filters: {}, expects_no_result: false, provenance: { kind: "curated", generation_id: "test" },
    });
    const report = evaluateEcosystemRun([resource], [query], [], [{
      query_id: query.query_id, ranked_resource_ids: [resource.resource_id],
    }]);
    expect(report.relevance.queries).toBe(1);
    expect(report.relevance.evaluableQueries).toBe(0);
    expect(report.relevance.noResultAccuracy).toBe(0);
    expect(report.unjudged_top_5).toBe(1);
    expect(report.by_query_class.capability!.evaluable_queries).toBe(0);
  });
});

describe("ecosystem OpenRouter judging", () => {
  it("generates recommendations, persists pooled judgments, and pins provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "openx402-judge-"));
    try {
      const resource = normalizeExternalRecord({ resource: "https://example.com/weather", type: "http", description: "City weather forecasts" }, {
        source: "agent-tools", sourceUrl: "https://agent-tools.example/catalog", observedAt, redistribution: "derived_only",
      })!;
      const query = EcosystemQuerySchema.parse({
        query_id: "eco-qry-0001", split: "release", query_class: "capability", text: "weather forecast API",
        filters: {}, expects_no_result: false, provenance: { kind: "curated", generation_id: "test" },
      });
      const artifacts = {
        "catalog/catalog-v1.jsonl": encodeJsonl([resource]),
        "queries/queries-v1.jsonl": encodeJsonl([query]),
      };
      for (const [relative, text] of Object.entries(artifacts)) {
        await mkdir(join(root, relative, ".."), { recursive: true });
        await writeFile(join(root, relative), text);
      }
      await mkdir(join(root, "manifests"), { recursive: true });
      await writeFile(join(root, "manifests/dataset-v1.json"), `${JSON.stringify({
        dataset_version: "v1.0.0", generated_at: observedAt,
        hashes: Object.fromEntries(Object.entries(artifacts).map(([relative, text]) => [relative, sha256(text)])),
        counts: { resources: 1, queries: 1, judgments: 0, outcomes: 0 },
        sources: ["agent-tools"], source_errors: [], redistribution: "test fixture",
      }, null, 2)}\n`);
      process.env.OPENROUTER_API_KEY = "test-key";
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
        id: "test-request", model: "test/judge", provider: "test",
        choices: [{ message: { content: JSON.stringify({ judgments: [{ pair_id: "p0", grade: 3, rationale: "Direct match." }] }) } }],
      }), { status: 200 })));
      const result = await judgeEcosystemWithOpenRouter(root, {
        model: "test/judge", poolSize: 1, batchSize: 1, concurrency: 1,
      });
      const dataset = await validateEcosystemDataset(root, { requireJudgments: true });
      expect(result.complete).toBe(true);
      expect(result.openrouter_pairs).toBe(1);
      expect(dataset.judgments[0]).toMatchObject({ relevance_grade: 3, judge: "openrouter", provisional: true });
      expect(dataset.manifest.judging).toMatchObject({ expected_pairs: 1, persisted_pairs: 1, complete: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("ecosystem liveness probes", () => {
  it("treats a payment challenge as reachable without attempting payment", async () => {
    const resource = normalizeExternalRecord({ resource: "https://example.com/paid", type: "http" }, {
      source: "openx402", sourceUrl: "https://openx402.example/catalog", observedAt, redistribution: "allowed",
    })!;
    const fetchImpl: typeof fetch = async (_input, init) => {
      expect(init?.method).toBe("HEAD");
      return new Response("payment required", { status: 402 });
    };
    const probes = await probeEcosystemResources([resource], { fetch_impl: fetchImpl, concurrency: 1 });
    expect(probes[0]!.liveness).toBe("pass");
    expect(applyEcosystemProbes([resource], probes)[0]!.status).toBe("active");
  });

  it("marks server errors unreachable and preserves the failure reason", async () => {
    const resource = normalizeExternalRecord({ resource: "https://example.com/down", type: "http" }, {
      source: "openx402", sourceUrl: "https://openx402.example/catalog", observedAt, redistribution: "allowed",
    })!;
    const fetchImpl: typeof fetch = async () => new Response("down", { status: 503 });
    const probes = await probeEcosystemResources([resource], { fetch_impl: fetchImpl, concurrency: 1 });
    const updated = applyEcosystemProbes([resource], probes)[0]!;
    expect(updated.status).toBe("unreachable");
    expect(updated.operational.failure_reason).toBe("HTTP 503");
  });
});

describe("ecosystem dataset validation", () => {
  it("validates a complete snapshot and its pinned artifact hashes", async () => {
    const root = await mkdtemp(join(tmpdir(), "openx402-ecosystem-"));
    try {
      const resource = normalizeExternalRecord({ resource: "https://example.com/test", type: "http" }, {
        source: "openx402", sourceUrl: "https://openx402.example/catalog", observedAt, redistribution: "allowed",
      })!;
      const query = EcosystemQuerySchema.parse({
        query_id: "eco-qry-0001", split: "release", query_class: "capability", text: "test API",
        filters: {}, expects_no_result: false, provenance: { kind: "curated", generation_id: "test" },
      });
      const judgment = EcosystemJudgmentSchema.parse({
        query_id: query.query_id, resource_id: resource.resource_id, relevance_grade: 3,
        eligibility: "eligible", judge: "human", provisional: false,
      });
      const outcome = EcosystemOutcomeSchema.parse({
        query_id: query.query_id, resource_id: resource.resource_id, selected: true, attempted: true,
        payment_verification: "pass", settlement: "pass", invocation: "pass", response_valid: true,
        task_success: true, observed_at: observedAt,
      });
      const artifacts = {
        "catalog/catalog-v1.jsonl": encodeJsonl([resource]),
        "queries/queries-v1.jsonl": encodeJsonl([query]),
        "judgments/judgments-v1.jsonl": encodeJsonl([judgment]),
        "outcomes/outcomes-v1.jsonl": encodeJsonl([outcome]),
      };
      for (const [relative, text] of Object.entries(artifacts)) {
        await mkdir(join(root, relative, ".."), { recursive: true });
        await writeFile(join(root, relative), text);
      }
      await mkdir(join(root, "manifests"), { recursive: true });
      await writeFile(join(root, "manifests/dataset-v1.json"), `${JSON.stringify({
        dataset_version: "v1.0.0", generated_at: observedAt,
        hashes: Object.fromEntries(Object.entries(artifacts).map(([relative, text]) => [relative, sha256(text)])),
        counts: { resources: 1, queries: 1, judgments: 1, outcomes: 1 },
        sources: ["openx402"], source_errors: [], redistribution: "test fixture",
      }, null, 2)}\n`);
      const dataset = await validateEcosystemDataset(root, { requireJudgments: true });
      expect(dataset.resources).toHaveLength(1);
      expect(dataset.judgments[0]!.relevance_grade).toBe(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
