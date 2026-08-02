import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/migrate.js";
import { CatalogStore } from "../../src/db/catalog.js";
import { SearchStore } from "../../src/db/search.js";
import { AnalyticsStore } from "../../src/db/analytics.js";
import { StateStore } from "../../src/db/state.js";
import { createApp } from "../../src/http/app.js";
import { extractCandidate } from "../../src/bazaar/extract.js";
import { EmbeddingWorker } from "../../src/search/worker.js";
import { ImpressionRecorder, SearchService } from "../../src/search/service.js";
import {
  FailingEmbeddingProvider, FakeEmbeddingProvider, FakeRerankerProvider,
} from "../../src/search/providers/fake.js";
import type { EmbeddingProvider, RerankResult, RerankerProvider } from "../../src/search/types.js";
import type { AppConfig, NetworkConfig, SearchConfig, StellarNetwork } from "../../src/types.js";
import { seedSuite } from "../../src/search/harness.js";
import type { EvalSuite } from "../../src/search/evaluate.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ASSET, analyticsConfig, catalogConfig, discoveryConfig, payload, requirements, searchConfig,
} from "../helpers/bazaar.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/facilitator_test";
const pool = new pg.Pool({ connectionString: databaseUrl });
const replicaB = new pg.Pool({ connectionString: databaseUrl });
const catalog = new CatalogStore(pool);
const searchStore = new SearchStore(pool);
const searchStoreB = new SearchStore(replicaB);
const analytics = new AnalyticsStore(pool);
const state = new StateStore(pool);

const TABLES = `catalog_index_jobs, catalog_search_documents,
  search_impressions, catalog_observations, payment_events, payment_daily_totals,
  catalog_payment_options, catalog_resource_versions, catalog_resources`;

/** Per-generation storage tables are created on demand and dropped with them. */
async function dropGenerationStorage(): Promise<void> {
  const tables = await pool.query<{ relname: string }>(
    "SELECT relname FROM pg_class WHERE relkind = 'r' AND relname LIKE 'catalog_embeddings_g%'",
  );
  for (const row of tables.rows) {
    await pool.query(`DROP TABLE IF EXISTS ${row.relname} CASCADE`);
  }
}

const networks = new Map<StellarNetwork, NetworkConfig>([
  ["stellar:testnet", {
    allowedAssets: new Map([[ASSET, { symbol: "USDC", decimals: 7, maxPayment: 10n ** 9n }]]),
  } as unknown as NetworkConfig],
]);

let suite: EvalSuite;

beforeAll(async () => {
  await migrate(pool);
  suite = JSON.parse(
    await readFile(resolve("tests/fixtures/search/golden-v1.json"), "utf8"),
  ) as EvalSuite;
});

beforeEach(async () => {
  await dropGenerationStorage();
  await pool.query(`TRUNCATE ${TABLES}, search_model_generations RESTART IDENTITY CASCADE`);
  await pool.query("UPDATE catalog_state SET last_version = 0 WHERE id = 1");
});

afterAll(async () => {
  await dropGenerationStorage();
  await pool.query(`TRUNCATE ${TABLES}, search_model_generations RESTART IDENTITY CASCADE`);
  await Promise.all([pool.end(), replicaB.end()]);
});

async function seedGolden(): Promise<Map<string, string>> {
  return seedSuite(catalog, suite, catalogConfig());
}

async function catalogOne(url: string, overrides: Parameters<typeof requirements>[0] = {}) {
  const extracted = extractCandidate(payload({ url }), requirements(overrides), catalogConfig());
  if (extracted.kind !== "candidate") throw new Error("expected candidate");
  return catalog.observe(extracted.candidate, {
    stage: "verified", activate: true, duplicateChanged: "version_and_verify",
  });
}

function worker(config: SearchConfig, provider?: EmbeddingProvider, id = "worker-a"): EmbeddingWorker {
  return new EmbeddingWorker(config, searchStore, id, provider ?? new FakeEmbeddingProvider(64));
}

function service(
  config: SearchConfig,
  provider?: EmbeddingProvider,
  reranker?: RerankerProvider,
): SearchService {
  return new SearchService(config, catalog, searchStore, provider, reranker);
}

async function runSearch(
  svc: SearchService,
  query: string,
  overrides: Partial<Parameters<SearchService["search"]>[0]> = {},
) {
  return svc.search({
    filters: {}, limit: 10, offset: 0, snapshot: await catalog.watermark(),
    includeStale: false, includeUnverified: false, staleAfterHours: 168,
    query, ...overrides,
  });
}

describe("pgvector capability", () => {
  it("reports vector support and an active generation after preparation", async () => {
    expect(await searchStore.hasVectorSupport()).toBe(true);
    const status = await worker(searchConfig()).prepare();
    expect(status.provider.status).toBe("ready");
    expect(status.generation).toMatchObject({
      provider: "fake", modelId: "fake/deterministic-hash", dimension: 64,
      pooling: "mean", normalization: "l2", status: "active",
    });
    const index = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE indexname = $1",
      [`catalog_embeddings_g${status.generation!.id}_hnsw`],
    );
    expect(index.rowCount).toBe(1);
  });
});

describe("indexing pipeline", () => {
  it("embeds every active document without blocking cataloging", async () => {
    await seedGolden();
    // Cataloging enqueued jobs; no vector exists until the worker runs.
    expect(await pool.query("SELECT to_regclass('catalog_embeddings_g1') AS t")
      .then(result => result.rows[0].t)).toBeNull();

    const indexer = worker(searchConfig());
    await indexer.prepare();
    const stored = await indexer.drain();
    expect(stored).toBe(suite.resources.length);

    const rows = await pool.query(
      `SELECT embedding_model_id, embedding_model_version, embedding_dimension, status,
              vector_dims(embedding) AS dims
       FROM catalog_embeddings_g1 LIMIT 1`,
    );
    expect(rows.rows[0]).toMatchObject({
      embedding_model_id: "fake/deterministic-hash",
      embedding_model_version: "v1",
      embedding_dimension: 64,
      status: "ready",
      dims: 64,
    });
    expect(await searchStore.queueDepth((await searchStore.activeGeneration())!.id))
      .toMatchObject({ done: suite.resources.length });
    expect(await searchStore.indexCoverage((await searchStore.activeGeneration())!.id))
      .toMatchObject({ expected: suite.resources.length, indexed: suite.resources.length, complete: true });
  });

  it("embeds a document cataloged after the worker has prepared", async () => {
    const indexer = worker(searchConfig());
    const prepared = await indexer.prepare();
    expect(prepared.generation).toBeDefined();

    await catalogOne("https://api.example.com/after-worker-started");
    const job = await pool.query(
      "SELECT generation, state FROM catalog_index_jobs WHERE kind = 'embedding'",
    );
    expect(job.rows).toEqual([{
      generation: prepared.generation!.id,
      state: "pending",
    }]);

    expect(await indexer.runOnce()).toBe(1);
    expect(await searchStore.queueDepth(prepared.generation!.id)).toMatchObject({ done: 1 });
    expect((await pool.query("SELECT status FROM catalog_embeddings_g1")).rows)
      .toEqual([{ status: "ready" }]);
  });

  it("shares the queue between replicas without double work", async () => {
    await seedGolden();
    const generation = await searchStore.activateGeneration(new FakeEmbeddingProvider(64).identity);
    await searchStore.enqueueMissing(generation.id);

    const claimA = await searchStore.claimJobs({
      generationId: generation.id, workerId: "a", leaseMs: 30_000, batchSize: 5,
    });
    const claimB = await searchStoreB.claimJobs({
      generationId: generation.id, workerId: "b", leaseMs: 30_000, batchSize: 5,
    });
    expect(claimA).toHaveLength(5);
    expect(claimB).toHaveLength(5);
    const overlap = claimA.filter(job => claimB.some(other => other.id === job.id));
    expect(overlap).toHaveLength(0);
    expect(claimA.every(job => job.fencingToken === 1n)).toBe(true);
  });

  it("refuses a write from a worker whose lease was stolen", async () => {
    await catalogOne("https://api.example.com/weather");
    const generation = await searchStore.activateGeneration(new FakeEmbeddingProvider(64).identity);
    await searchStore.enqueueMissing(generation.id);

    const stale = await searchStore.claimJobs({
      generationId: generation.id, workerId: "a", leaseMs: 1, batchSize: 1,
    });
    await new Promise(done => setTimeout(done, 20));
    const fresh = await searchStoreB.claimJobs({
      generationId: generation.id, workerId: "b", leaseMs: 30_000, batchSize: 1,
    });
    expect(fresh[0]!.fencingToken).toBeGreaterThan(stale[0]!.fencingToken);

    const vector = (await new FakeEmbeddingProvider(64).embed(["x"]))[0]!;
    expect(await searchStore.storeEmbeddings(generation, [{ job: stale[0]!, vector }])).toBe(0);
    expect(await searchStore.storeEmbeddings(generation, [{ job: fresh[0]!, vector }])).toBe(1);
  });

  it("retries with exponential backoff and dead-letters an exhausted job", async () => {
    await catalogOne("https://api.example.com/weather");
    const config = searchConfig();
    const failing = new FailingEmbeddingProvider("provider exploded", 64);
    const indexer = worker(config, failing);
    await indexer.prepare();

    for (let attempt = 0; attempt < config.indexing.maxAttempts; attempt += 1) {
      await pool.query("UPDATE catalog_index_jobs SET next_run_at = now() WHERE kind = 'embedding'");
      await indexer.runOnce();
    }
    const job = await pool.query(
      "SELECT state, attempts, last_error, dead_reason, first_failed_at FROM catalog_index_jobs WHERE kind = 'embedding'",
    );
    expect(job.rows[0]).toMatchObject({
      state: "dead", attempts: config.indexing.maxAttempts, last_error: "provider exploded",
      dead_reason: "provider exploded",
    });
    expect(job.rows[0].first_failed_at).toBeInstanceOf(Date);
    expect(indexer.status().deadLettered).toBe(1);

    // The lexical branch is untouched by an embedding failure.
    const results = await runSearch(service(config), "weather");
    expect(results.rows).toHaveLength(1);

    expect(await searchStore.revive((await searchStore.activeGeneration())!.id)).toBe(1);
    expect((await pool.query("SELECT state FROM catalog_index_jobs")).rows[0].state).toBe("pending");
  });

  it("re-embeds when the seller changes the declaration", async () => {
    await catalogOne("https://api.example.com/weather");
    const indexer = worker(searchConfig());
    await indexer.prepare();
    await indexer.drain();
    const before = await pool.query("SELECT source_hash FROM catalog_embeddings_g1");

    const changed = extractCandidate(
      payload({ resourceOverride: { description: "Now returns rainfall radar imagery." } }),
      requirements(), catalogConfig(),
    );
    if (changed.kind !== "candidate") throw new Error("expected candidate");
    await catalog.observe(changed.candidate, {
      stage: "verified", activate: true, duplicateChanged: "version_and_verify",
    });

    const generationId = (await searchStore.activeGeneration())!.id;
    await searchStore.enqueueMissing(generationId);
    await indexer.drain();

    const after = await pool.query(
      "SELECT source_hash, status FROM catalog_embeddings_g1 ORDER BY id DESC LIMIT 1",
    );
    expect(after.rows[0].source_hash).not.toBe(before.rows[0].source_hash);
    expect(after.rows[0].status).toBe("ready");
  });

  it("marks a vector stale when its document text moves on", async () => {
    await catalogOne("https://api.example.com/weather");
    const indexer = worker(searchConfig());
    await indexer.prepare();
    await indexer.drain();
    await pool.query("UPDATE catalog_search_documents SET source_hash = 'moved-on'");
    const generationId = (await searchStore.activeGeneration())!.id;
    expect(await searchStore.propagateStaleness(generationId)).toBe(1);
    expect((await pool.query("SELECT status FROM catalog_embeddings_g1")).rows[0].status).toBe("stale");
  });

  it("creates a new generation for a changed dimension and never mixes vectors", async () => {
    await catalogOne("https://api.example.com/weather");
    const first = worker(searchConfig(), new FakeEmbeddingProvider(64));
    await first.prepare();
    await first.drain();

    const migrated = searchConfig({
      semantic: { ...searchConfig().semantic, dimension: 128 },
    });
    const second = worker(migrated, new FakeEmbeddingProvider(128), "worker-b");
    const status = await second.prepare();
    expect(status.generation!.dimension).toBe(128);
    expect(status.generation!.id).not.toBe(1);

    const generations = await searchStore.generations();
    expect(generations.map(entry => entry.status).sort()).toEqual(["active", "retired"]);
    expect(generations.filter(entry => entry.status === "active")).toHaveLength(1);

    await second.drain();
    const rows = await pool.query(
      `SELECT generation_id, embedding_dimension FROM catalog_embeddings_g1
       UNION ALL SELECT generation_id, embedding_dimension FROM catalog_embeddings_g${status.generation!.id}
       ORDER BY generation_id`,
    );
    expect(rows.rows).toEqual([
      { generation_id: 1, embedding_dimension: 64 },
      { generation_id: status.generation!.id, embedding_dimension: 128 },
    ]);

    // Searching under the new generation must not read the old vectors.
    const results = await runSearch(service(migrated, new FakeEmbeddingProvider(128)), "weather");
    expect(results.degraded.semantic).toBe("used");
    expect(results.generationId).toBe(status.generation!.id);
  });

  it("refuses to store a vector whose dimension disagrees with the generation", async () => {
    await catalogOne("https://api.example.com/weather");
    const generation = await searchStore.activateGeneration(new FakeEmbeddingProvider(64).identity);
    await searchStore.enqueueMissing(generation.id);
    const jobs = await searchStore.claimJobs({
      generationId: generation.id, workerId: "a", leaseMs: 30_000, batchSize: 1,
    });
    await expect(searchStore.storeEmbeddings(generation, [{ job: jobs[0]!, vector: [1, 2, 3] }]))
      .rejects.toThrow(/refusing to store dimension 3/);
  });
});

describe("hybrid retrieval and degradation", () => {
  it("fuses lexical and semantic branches", async () => {
    await seedGolden();
    const indexer = worker(searchConfig());
    await indexer.prepare();
    await indexer.drain();

    const result = await runSearch(service(searchConfig(), new FakeEmbeddingProvider(64)), "current weather for a city");
    expect(result.degraded.effectiveMode).toBe("hybrid");
    expect(result.degraded.lexical).toBe("used");
    expect(result.degraded.semantic).toBe("used");
    expect(result.rows[0]!.resource).toBe("https://weather.example.com/current");
  });

  it("keeps unrelated semantic neighbors out of a genuine no-result query", async () => {
    await seedGolden();
    const indexer = worker(searchConfig());
    await indexer.prepare();
    await indexer.drain();

    const result = await runSearch(
      service(searchConfig(), new FakeEmbeddingProvider(64)),
      "quantum entanglement brokerage settlement",
    );
    expect(result.rows).toEqual([]);
    expect(result.degraded.effectiveMode).toBe("lexical");
    expect(result.degraded.semantic).toBe("empty");
    expect(result.degraded.candidateCounts.lexical).toBe(0);
    expect(result.degraded.candidateCounts.semantic).toBe(0);
    expect(result.degraded.candidateCounts.fused).toBe(0);
  });

  it("falls back to lexical when the embedding provider fails", async () => {
    await seedGolden();
    const indexer = worker(searchConfig());
    await indexer.prepare();
    await indexer.drain();

    const result = await runSearch(
      service(searchConfig(), new FailingEmbeddingProvider("model unavailable", 64)),
      "current weather for a city",
    );
    expect(result.degraded.effectiveMode).toBe("lexical");
    expect(result.degraded.semantic).toBe("error");
    expect(result.degraded.detail).toBe("model unavailable");
    expect(result.partialResults).toBe(true);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("falls back to lexical when no generation has been indexed", async () => {
    await seedGolden();
    const result = await runSearch(service(searchConfig(), new FakeEmbeddingProvider(64)), "weather");
    expect(result.degraded.semantic).toBe("unavailable");
    expect(result.degraded.detail).toContain("no active embedding generation");
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("serves lexical results when semantic search is switched off entirely", async () => {
    await seedGolden();
    const config = searchConfig({ semantic: { ...searchConfig().semantic, enabled: false } });
    const result = await runSearch(service(config), "translate text between languages");
    expect(result.degraded.effectiveMode).toBe("lexical");
    expect(result.degraded.semantic).toBe("disabled");
    expect(result.partialResults).toBe(false);
    expect(result.rows[0]!.resource).toBe("https://lingua.example.com/translate");
  });

  it("handles identifiers and stopword-only input while recording query diagnostics", async () => {
    await seedGolden();
    const config = searchConfig({
      semantic: { ...searchConfig().semantic, enabled: false },
    });
    const lexicalOnly = service(config);

    const identifier = await runSearch(lexicalOnly, "https://weather.example.com/current");
    expect(identifier.rows[0]!.resource).toBe("https://weather.example.com/current");
    expect(identifier.degraded.queryShape.hasUrl).toBe(true);
    expect(identifier.degraded.candidateCounts.lexical).toBeGreaterThan(0);
    expect(identifier.degraded.candidateCounts.fused).toBeGreaterThan(0);

    const stopwords = await runSearch(lexicalOnly, "the and for");
    expect(stopwords.rows).toEqual([]);
    expect(stopwords.degraded.queryShape.stopwordOnly).toBe(true);

    const injection = await runSearch(lexicalOnly, "weather:* | !payments");
    expect(injection.degraded.queryShape.hasPunctuation).toBe(true);
    expect(injection.rows.length).toBeGreaterThan(0);
  });

  it("does not semantically expand empty or stopword-only input", async () => {
    await seedGolden();
    const config = searchConfig();
    const indexer = worker(config);
    await indexer.prepare();
    await indexer.drain();

    const result = await runSearch(service(config, new FakeEmbeddingProvider(64)), "the and for");
    expect(result.rows).toEqual([]);
    expect(result.degraded.semantic).toBe("empty");
    expect(result.degraded.candidateCounts.lexical).toBe(0);
    expect(result.degraded.candidateCounts.semantic).toBe(0);
    expect(result.degraded.queryShape.stopwordOnly).toBe(true);
  });

  it("times out a slow embedding provider and still answers", async () => {
    await seedGolden();
    const indexer = worker(searchConfig());
    await indexer.prepare();
    await indexer.drain();

    const slow: EmbeddingProvider = {
      identity: new FakeEmbeddingProvider(64).identity,
      health: async () => ({ status: "ready" }),
      embed: async (_texts, signal) => new Promise((_ok, fail) => {
        const timer = setTimeout(() => fail(new Error("never")), 5_000);
        signal?.addEventListener("abort", () => { clearTimeout(timer); fail(new Error("aborted")); });
      }),
    };
    const config = searchConfig({ semantic: { ...searchConfig().semantic, timeoutMs: 30 } });
    const result = await runSearch(service(config, slow), "weather");
    expect(result.degraded.semantic).toBe("timeout");
    expect(result.degraded.semanticLatencyMs).toBeLessThan(1_000);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("reranks the configured top k and reports it", async () => {
    await seedGolden();
    const indexer = worker(searchConfig());
    await indexer.prepare();
    await indexer.drain();

    const config = searchConfig({
      reranking: { ...searchConfig().reranking, enabled: true, topK: 5 },
    });
    const result = await runSearch(
      service(config, new FakeEmbeddingProvider(64), new FakeRerankerProvider()),
      "extract text from a scanned document",
    );
    expect(result.degraded.reranking).toBe("used");
    expect(result.rows[0]!.resource).toBe("https://vision.example.com/ocr");
  });

  it("falls back to hybrid when the reranker is unavailable", async () => {
    await seedGolden();
    const indexer = worker(searchConfig());
    await indexer.prepare();
    await indexer.drain();

    const unavailable: RerankerProvider = {
      identity: { modelId: "m", modelRevision: "1", provider: "local" },
      health: async () => ({ status: "degraded", detail: "no ONNX export published" }),
      rerank: async (): Promise<RerankResult[]> => { throw new Error("unreachable"); },
    };
    const config = searchConfig({
      reranking: { ...searchConfig().reranking, enabled: true, fallbackToHybrid: true },
    });
    const result = await runSearch(
      service(config, new FakeEmbeddingProvider(64), unavailable), "current weather for a city",
    );
    expect(result.degraded.reranking).toBe("unavailable");
    expect(result.degraded.detail).toBe("no ONNX export published");
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.partialResults).toBe(true);
  });

  it("returns nothing when reranking is required and fallback is switched off", async () => {
    await seedGolden();
    const failing: RerankerProvider = {
      identity: { modelId: "m", modelRevision: "1", provider: "remote" },
      health: async () => ({ status: "degraded", detail: "endpoint down" }),
      rerank: async (): Promise<RerankResult[]> => { throw new Error("down"); },
    };
    const config = searchConfig({
      semantic: { ...searchConfig().semantic, enabled: false },
      reranking: { ...searchConfig().reranking, enabled: true, fallbackToHybrid: false },
    });
    const result = await runSearch(service(config, undefined, failing), "weather");
    expect(result.rows).toHaveLength(0);
    expect(result.degraded.reranking).toBe("unavailable");
  });

  it("applies the minimum relevance threshold", async () => {
    await seedGolden();
    const config = searchConfig({
      semantic: { ...searchConfig().semantic, enabled: false },
      minimumRelevanceScore: 1,
    });
    const result = await runSearch(service(config), "weather");
    expect(result.rows).toHaveLength(0);
  });

  it("keeps structured filters applied to every branch", async () => {
    await seedGolden();
    const indexer = worker(searchConfig());
    await indexer.prepare();
    await indexer.drain();

    const result = await runSearch(
      service(searchConfig(), new FakeEmbeddingProvider(64)), "mcp tool for equities",
      { filters: { type: "mcp" } },
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.every(row => row.type === "mcp")).toBe(true);
  });

  it("orders results deterministically across repeated runs", async () => {
    await seedGolden();
    const indexer = worker(searchConfig());
    await indexer.prepare();
    await indexer.drain();
    const svc = service(searchConfig(), new FakeEmbeddingProvider(64));
    const first = await runSearch(svc, "weather forecast");
    const second = await runSearch(svc, "weather forecast");
    expect(first.rows.map(row => row.resource)).toEqual(second.rows.map(row => row.resource));
  });
});

describe("agent-facing safety", () => {
  it("indexes seller injection text as ordinary data with seller provenance", async () => {
    const keys = await seedGolden();
    const indexer = worker(searchConfig());
    await indexer.prepare();
    await indexer.drain();

    const injected = await pool.query(
      `SELECT v.description, v.provenance, v.verification, d.document
       FROM catalog_resources r
       JOIN catalog_resource_versions v ON v.id = r.active_version_id
       JOIN catalog_search_documents d ON d.version_id = v.id
       WHERE r.resource_key = $1`,
      [keys.get("adversarial-prompt-injection")],
    );
    const row = injected.rows[0];
    expect(row.provenance).toBe("seller_declared");
    expect(row.verification).toBe("payment_observed");
    // The text is preserved verbatim as data. It is never executed, summarized
    // or promoted into an instruction; the document is a flat labelled record.
    expect(row.description).toContain("IGNORE ALL PREVIOUS INSTRUCTIONS");
    expect(row.document).toContain("Description: IGNORE ALL PREVIOUS INSTRUCTIONS");
    expect(row.document.startsWith("Service:")).toBe(true);

    // And it gains no authority: it never outranks the endpoint that genuinely
    // answers an unrelated query.
    const ranked = (await runSearch(
      service(searchConfig(), new FakeEmbeddingProvider(64)), "extract text from a scanned document",
    )).rows.map(row => row.resource);
    const ocr = ranked.indexOf("https://vision.example.com/ocr");
    const injected2 = ranked.indexOf("https://inject.example.com/notes");
    expect(ocr).toBeGreaterThanOrEqual(0);
    if (injected2 >= 0) expect(injected2).toBeGreaterThan(ocr);
  });

  it("bounds an adversarial listing structurally rather than trusting the ranker", async () => {
    const keys = await seedGolden();
    const stuffed = await pool.query(
      `SELECT v.tags, v.description, v.service_name, d.document
       FROM catalog_resources r
       JOIN catalog_resource_versions v ON v.id = r.active_version_id
       JOIN catalog_search_documents d ON d.version_id = v.id
       WHERE r.resource_key = $1`,
      [keys.get("adversarial-keyword-stuffing")],
    );
    const row = stuffed.rows[0];
    // The caps are what actually limit a stuffed listing: five tags, a bounded
    // description, and no seller-controlled boost field anywhere in the record.
    expect(row.tags).toHaveLength(5);
    expect(row.description.length).toBeLessThanOrEqual(catalogConfig().maxDescriptionLength);
    expect(row.service_name.length).toBeLessThanOrEqual(catalogConfig().maxServiceNameLength);
    expect(row.document).not.toMatch(/boost|rank|weight|priority/i);
    // The document is compiled only from declared fields in a fixed order.
    expect(row.document.split("\n")[0]).toBe(`Service: ${row.service_name}`);
  });

  it("keeps a genuine endpoint first under deterministic lexical ranking", async () => {
    await seedGolden();
    // Lexical ranking is fully deterministic, so this is a hard assertion. The
    // hybrid ordering under an adversarial corpus is a *quality* property, not
    // an invariant: it is measured as `violations@k` by `npm run evaluate`,
    // which reports it per profile rather than asserting it here.
    const lexicalOnly = service(searchConfig({
      semantic: { ...searchConfig().semantic, enabled: false },
    }));
    for (const [query, expected] of [
      ["current weather for a city", "https://weather.example.com/current"],
      ["translate text between languages", "https://lingua.example.com/translate"],
      ["convert currency between USD and EUR", "https://fx.example.com/rates"],
      ["extract text from a scanned document", "https://vision.example.com/ocr"],
    ] as const) {
      const result = await runSearch(lexicalOnly, query);
      expect(result.rows[0]!.resource, query).toBe(expected);
    }
  });

  it("caps how much of a page one origin can occupy", async () => {
    await seedGolden();
    const config = searchConfig({
      semantic: { ...searchConfig().semantic, enabled: false },
      originDiversityLimit: 1,
    });
    const result = await runSearch(service(config), "weather");
    const origins = result.rows.slice(0, 2).map(row => new URL(row.resource).origin);
    expect(new Set(origins).size).toBe(2);
  });

  it("stops one seller from editing another seller's ranking document", async () => {
    await catalogOne("https://api.example.com/weather");
    const spoof = extractCandidate(
      payload({ resourceOverride: { description: "Seized by a rival." } }),
      requirements({ payTo: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H" }),
      catalogConfig(),
    );
    if (spoof.kind !== "candidate") throw new Error("expected candidate");
    const outcome = await catalog.observe(spoof.candidate, {
      stage: "verified", activate: true, duplicateChanged: "version_and_verify",
    });
    expect(outcome.outcome).toBe("quarantined");

    const documents = await pool.query("SELECT document FROM catalog_search_documents");
    expect(documents.rowCount).toBe(1);
    expect(documents.rows[0].document).not.toContain("Seized by a rival");
  });
});

describe("GET /discovery/search", () => {
  function config(overrides: Partial<AppConfig> = {}): AppConfig {
    return {
      port: 0, databaseUrl, apiKeys: [], keyEncryptionKey: Buffer.alloc(32, 1), instanceId: "test",
      networks, catalog: catalogConfig(), discovery: discoveryConfig(),
      search: searchConfig({ defaultResultLimit: 3, maximumResultLimit: 10 }),
      analytics: analyticsConfig(),
      limits: {
        maxRequestBytes: 262_144, maxConcurrentSimulations: 1, maxSimulationsPerKeyPerMinute: 10,
        maxSponsoredStroopsPerKeyPerDay: 1n, maxGlobalSponsoredStroopsPerDay: 1n,
        maxPendingSettlements: 1, channelLeaseMs: 1, settlePollMs: 1, settleTimeoutMs: 1,
      },
      ...overrides,
    };
  }

  function app(overrides: Partial<AppConfig> = {}, provider?: EmbeddingProvider) {
    const appConfig = config(overrides);
    const svc = service(appConfig.search, provider ?? new FakeEmbeddingProvider(64));
    const recorder = new ImpressionRecorder(pool, appConfig.search);
    const core = {
      supported: () => ({ kinds: [], extensions: [], signers: {} }),
      verify: async () => ({ response: { isValid: true } }),
      settle: async () => ({ response: { success: true, transaction: "h", network: "stellar:testnet" } }),
    } as unknown as Parameters<typeof createApp>[1];
    return createApp(appConfig, core, state, {
      catalog, analytics, search: searchStore, searchService: svc, impressions: recorder,
    });
  }

  it("keeps the official response shape while ranking with the hybrid pipeline", async () => {
    await seedGolden();
    const indexer = worker(searchConfig());
    await indexer.prepare();
    await indexer.drain();

    const response = await request(app()).get("/discovery/search?query=current+weather+for+a+city").expect(200);
    expect(response.body.x402Version).toBe(2);
    expect(Array.isArray(response.body.resources)).toBe(true);
    expect(response.body.resources).toHaveLength(3);
    expect(response.body.pagination).toMatchObject({ limit: 3 });
    expect(typeof response.body.partialResults).toBe("boolean");
    const item = response.body.resources[0];
    expect(item.resource).toBe("https://weather.example.com/current");
    expect(Object.keys(item).sort()).toEqual([
      "accepts", "description", "extensions", "lastUpdated", "resource", "serviceName", "tags",
      "type", "x402Version",
    ]);
    // No ranking score, provenance or degradation field leaks into a Bazaar resource.
    expect(item).not.toHaveProperty("score");
    expect(item).not.toHaveProperty("degraded");
    expect(response.body).not.toHaveProperty("mode");
  });

  it("accepts a mode override and rejects an unknown one", async () => {
    await seedGolden();
    const lexical = await request(app()).get("/discovery/search?query=weather&mode=lexical").expect(200);
    expect(lexical.body.resources.length).toBeGreaterThan(0);
    await request(app()).get("/discovery/search?query=weather&mode=neural").expect(400);
  });

  it("clamps the limit to the configured search maximum", async () => {
    await seedGolden();
    const response = await request(app()).get("/discovery/search?query=weather&limit=100").expect(200);
    expect(response.body.resources.length).toBeLessThanOrEqual(10);
  });

  it("paginates with a signed cursor bound to the query", async () => {
    await seedGolden();
    const first = await request(app()).get("/discovery/search?query=weather&limit=2").expect(200);
    const cursor = first.body.pagination.cursor as string;
    expect(cursor).toBeTypeOf("string");

    const second = await request(app())
      .get(`/discovery/search?query=weather&limit=2&cursor=${encodeURIComponent(cursor)}`).expect(200);
    const seen = [...first.body.resources, ...second.body.resources]
      .map((item: { resource: string }) => item.resource);
    expect(new Set(seen).size).toBe(seen.length);

    // A cursor is not transferable to a different query or a different mode.
    await request(app())
      .get(`/discovery/search?query=finance&limit=2&cursor=${encodeURIComponent(cursor)}`).expect(400);
    await request(app())
      .get(`/discovery/search?query=weather&mode=lexical&limit=2&cursor=${encodeURIComponent(cursor)}`).expect(400);
    await request(app()).get("/discovery/search?query=weather&cursor=forged").expect(400);
  });

  it("keeps a cursor page stable while another replica catalogs", async () => {
    await seedGolden();
    const first = await request(app()).get("/discovery/search?query=weather&limit=2").expect(200);
    const cursor = first.body.pagination.cursor as string;

    const rival = extractCandidate(
      payload({ url: "https://late.example.com/weather" }), requirements(), catalogConfig(),
    );
    if (rival.kind !== "candidate") throw new Error("expected candidate");
    await new CatalogStore(replicaB).observe(rival.candidate, {
      stage: "verified", activate: true, duplicateChanged: "version_and_verify",
    });

    const second = await request(app())
      .get(`/discovery/search?query=weather&limit=2&cursor=${encodeURIComponent(cursor)}`).expect(200);
    const seen = [...first.body.resources, ...second.body.resources]
      .map((item: { resource: string }) => item.resource);
    expect(seen).not.toContain("https://late.example.com/weather");
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("records an impression with the ranking model and degradation report", async () => {
    await seedGolden();
    const indexer = worker(searchConfig());
    await indexer.prepare();
    await indexer.drain();
    await request(app()).get("/discovery/search?query=weather&limit=2").expect(200);

    const impressions = await pool.query(
      `SELECT mode, reranked, generation_id, position, ranking_config, degraded, query_text
       FROM search_impressions ORDER BY position`,
    );
    expect(impressions.rowCount).toBe(2);
    expect(impressions.rows[0]).toMatchObject({ mode: "hybrid", reranked: false, position: 1 });
    expect(impressions.rows[0].ranking_config).toMatchObject({ rrfK: 20, lexicalWeight: 0.7, semanticWeight: 0.3 });
    expect(impressions.rows[0].degraded).toMatchObject({ effectiveMode: "hybrid", semantic: "used" });
    expect(impressions.rows[0].generation_id).toBe(1);
  });

  it("reports indexing health and conversion on the operator API", async () => {
    await seedGolden();
    const indexer = worker(searchConfig());
    await indexer.prepare();
    await indexer.drain();

    const appConfig = config();
    const server = createApp(appConfig, {
      supported: () => ({ kinds: [], extensions: [], signers: {} }),
    } as unknown as Parameters<typeof createApp>[1], state, {
      catalog, analytics, search: searchStore, worker: indexer,
    });

    const status = await request(server).get("/analytics/v1/search/status").expect(200);
    expect(status.body.lexical.ranking).toBe("postgresql_fts_ts_rank_cd");
    expect(status.body.semantic).toMatchObject({ vectorSupport: true, dimension: 64 });
    expect(status.body.activeGeneration).toMatchObject({ status: "active", dimension: 64 });
    expect(status.body.queue).toMatchObject({ done: suite.resources.length });
    expect(status.body.fusion).toEqual({ rrfK: 20, minimumRelevanceScore: 0 });

    const generations = await request(server).get("/analytics/v1/search/generations").expect(200);
    expect(generations.body.items).toHaveLength(1);

    const conversion = await request(server).get("/analytics/v1/search/conversion").expect(200);
    expect(conversion.body.attribution).toBe("resource_within_window");
  });

  it("links an impression to a later settlement for conversion reporting", async () => {
    const created = await catalogOne("https://api.example.com/weather");
    const server = app();
    await request(server).get("/discovery/search?query=weather").expect(200);
    await analytics.record({
      stage: "settled", status: "success", network: "stellar:testnet", scheme: "exact",
      asset: ASSET, payer: "payer-1", payTo: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
      maxAmount: "10000", amount: "10000", facilitatorId: "sponsor", transactionHash: "hash-conv",
      ...(created.resourceId ? { resourceId: created.resourceId } : {}),
    });

    const conversion = await analytics.searchConversion(24);
    expect(Number(conversion.impressions)).toBe(1);
    expect(Number(conversion.settled_impressions)).toBe(1);
    expect(Number(conversion.settled_at_position_1)).toBe(1);
    expect(conversion.byMode).toEqual([expect.objectContaining({ impressions: "1", sessions: "1" })]);
  });
});
