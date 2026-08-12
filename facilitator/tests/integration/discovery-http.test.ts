import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/migrate.js";
import { CatalogStore } from "../../src/db/catalog.js";
import { AnalyticsStore } from "../../src/db/analytics.js";
import { Cataloger, encodeExtensionResponses } from "../../src/bazaar/cataloger.js";
import { extractCandidate } from "../../src/bazaar/extract.js";
import { createApp } from "../../src/http/app.js";
import { StateStore } from "../../src/db/state.js";
import { decodeCursor } from "../../src/http/cursor.js";
import type { FacilitatorCore } from "../../src/orchestrator.js";
import type { AppConfig, NetworkConfig, StellarNetwork } from "../../src/types.js";
import {
  ASSET, RIVAL_SELLER, SELLER, analyticsConfig, catalogConfig, discoveryConfig,
  mcpMetadata, payload, requirements, searchConfig,
} from "../helpers/bazaar.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/facilitator_test";
const pool = new pg.Pool({ connectionString: databaseUrl });
const writer = new pg.Pool({ connectionString: databaseUrl });
const catalog = new CatalogStore(pool);
const concurrentCatalog = new CatalogStore(writer);
const analytics = new AnalyticsStore(pool);
const state = new StateStore(pool);

const TABLES = `search_resource_fetches, search_sessions, catalog_index_jobs, catalog_search_documents, catalog_observations,
  payment_events, payment_daily_totals, catalog_payment_options, catalog_resource_versions,
  catalog_resources`;

const networks = new Map<StellarNetwork, NetworkConfig>([
  ["stellar:testnet", {
    allowedAssets: new Map([[ASSET, { symbol: "USDC", decimals: 7, maxPayment: 10n ** 9n }]]),
  } as unknown as NetworkConfig],
]);

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    databaseUrl,
    apiKeys: [],
    keyEncryptionKey: Buffer.alloc(32, 1),
    instanceId: "test",
    networks,
    catalog: catalogConfig(),
    discovery: discoveryConfig({ defaultPageSize: 2, maxPageSize: 10 }),
    search: searchConfig({ defaultResultLimit: 2, maximumResultLimit: 10 }),
    analytics: analyticsConfig(),
    limits: {
      maxRequestBytes: 262_144, maxConcurrentSimulations: 1, maxSimulationsPerKeyPerMinute: 10,
      maxSponsoredStroopsPerKeyPerDay: 1n, maxGlobalSponsoredStroopsPerDay: 1n,
      maxPendingSettlements: 1, channelLeaseMs: 1, settlePollMs: 1, settleTimeoutMs: 1,
    },
    ...overrides,
  };
}

/** Only /supported, /verify and /settle touch the core, which is stubbed here. */
function stubCore(extensionResponses?: Record<string, unknown>): FacilitatorCore {
  return {
    supported: () => ({ kinds: [], extensions: ["payment-identifier", "bazaar"], signers: {} }),
    verify: async () => ({ response: { isValid: true }, ...(extensionResponses ? { extensionResponses } : {}) }),
    settle: async () => ({
      response: { success: true, transaction: "hash", network: "stellar:testnet" },
      ...(extensionResponses ? { extensionResponses } : {}),
    }),
  } as unknown as FacilitatorCore;
}

function app(overrides: Partial<AppConfig> = {}, core = stubCore()) {
  return createApp(config(overrides), core, state, { catalog, analytics });
}

async function catalogResource(url: string, overrides: Partial<ReturnType<typeof requirements>> = {}) {
  const result = extractCandidate(payload({ url }), requirements(overrides), catalogConfig());
  if (result.kind !== "candidate") throw new Error("expected candidate");
  return catalog.observe(result.candidate, {
    stage: "verified", activate: true, duplicateChanged: "version_and_verify",
  });
}

beforeAll(async () => migrate(pool));
beforeEach(async () => {
  await pool.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
  await pool.query("UPDATE catalog_state SET last_version = 0 WHERE id = 1");
});
afterAll(async () => {
  await pool.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
  await Promise.all([pool.end(), writer.end()]);
});

describe("GET /discovery/resources", () => {
  it("returns the official browse shape", async () => {
    await catalogResource("https://api.example.com/weather");
    const response = await request(app()).get("/discovery/resources").expect(200);

    expect(response.body.x402Version).toBe(2);
    expect(response.body.pagination).toMatchObject({ limit: 2, offset: 0, total: 1 });
    expect(response.body.items).toHaveLength(1);
    const item = response.body.items[0];
    expect(Object.keys(item).sort()).toEqual([
      "accepts", "description", "extensions", "iconUrl", "lastUpdated", "mimeType",
      "resource", "serviceName", "tags", "type", "x402Version",
    ]);
    expect(item.resource).toBe("https://api.example.com/weather");
    expect(item.type).toBe("http");
    expect(item.accepts[0]).toMatchObject({ scheme: "exact", network: "stellar:testnet", payTo: SELLER });
    expect(new Date(item.lastUpdated).toString()).not.toBe("Invalid Date");
    // Operator-only state never leaks into a Bazaar resource.
    expect(item).not.toHaveProperty("status");
    expect(item).not.toHaveProperty("verification");
    expect(item).not.toHaveProperty("provenance");
  });

  it("honours the configured default and maximum page sizes", async () => {
    for (let index = 0; index < 5; index += 1) {
      await catalogResource(`https://api.example.com/r-${index}`);
    }
    expect((await request(app()).get("/discovery/resources").expect(200)).body.items).toHaveLength(2);
    expect((await request(app()).get("/discovery/resources?limit=4").expect(200)).body.items).toHaveLength(4);
    // A limit above the maximum is clamped, not honoured.
    const clamped = await request(app({ discovery: discoveryConfig({ defaultPageSize: 2, maxPageSize: 3 }) }))
      .get("/discovery/resources?limit=100").expect(200);
    expect(clamped.body.items).toHaveLength(3);
  });

  it("applies the specification filters plus asset-bound maximum price", async () => {
    await catalogResource("https://api.example.com/weather");
    await catalogResource("https://api.example.com/other", {
      scheme: "upto", payTo: RIVAL_SELLER, amount: "20000",
    });
    const browse = (query: string) => request(app()).get(`/discovery/resources?${query}`).expect(200);

    expect((await browse("type=http")).body.pagination.total).toBe(2);
    expect((await browse("type=mcp")).body.pagination.total).toBe(0);
    expect((await browse("scheme=upto")).body.pagination.total).toBe(1);
    expect((await browse(`payTo=${SELLER}`)).body.pagination.total).toBe(1);
    expect((await browse("network=stellar:testnet")).body.pagination.total).toBe(2);
    expect((await browse(`asset=${ASSET}`)).body.pagination.total).toBe(2);
    expect((await browse(`asset=${ASSET}&maxPrice=10000`)).body.pagination.total).toBe(1);
    expect((await browse("extensions=bazaar")).body.pagination.total).toBe(2);
    expect((await browse("extensions=nothing")).body.pagination.total).toBe(0);
    await request(app()).get("/discovery/resources?maxPrice=10000").expect(400);
    await request(app()).get(`/discovery/resources?asset=${ASSET}&maxPrice=1.5`).expect(400);
  });

  it("rejects an unknown resource type filter rather than ignoring it", async () => {
    await request(app()).get("/discovery/resources?type=grpc").expect(400);
  });

  it("paginates stably with an opaque cursor while another replica writes", async () => {
    for (let index = 0; index < 6; index += 1) {
      await catalogResource(`https://api.example.com/r-${index}`);
    }
    const first = await request(app()).get("/discovery/resources?limit=3").expect(200);
    expect(first.body.pagination.total).toBe(6);
    expect(first.body.partialResults).toBe(true);
    const cursor = first.body.pagination.cursor as string;
    expect(cursor).toBeTypeOf("string");

    // Concurrent catalog writes from a second replica.
    for (let index = 6; index < 10; index += 1) {
      const result = extractCandidate(
        payload({ url: `https://api.example.com/r-${index}` }), requirements(), catalogConfig(),
      );
      if (result.kind !== "candidate") throw new Error("expected candidate");
      await concurrentCatalog.observe(result.candidate, {
        stage: "verified", activate: true, duplicateChanged: "version_and_verify",
      });
    }

    const second = await request(app())
      .get(`/discovery/resources?limit=3&cursor=${encodeURIComponent(cursor)}`).expect(200);
    expect(second.body.pagination.total).toBe(6);
    expect(second.body.pagination.cursor).toBeNull();
    expect(second.body.partialResults).toBe(false);

    const seen = [...first.body.items, ...second.body.items].map((item: { resource: string }) => item.resource);
    expect(new Set(seen).size).toBe(6);
    expect(seen.sort()).toEqual(
      Array.from({ length: 6 }, (_, index) => `https://api.example.com/r-${index}`).sort(),
    );

    // Only a fresh request sees the concurrent writes.
    expect((await request(app()).get("/discovery/resources?limit=3").expect(200)).body.pagination.total).toBe(10);
  });

  it("refuses a tampered or mismatched cursor", async () => {
    for (let index = 0; index < 4; index += 1) await catalogResource(`https://api.example.com/r-${index}`);
    const first = await request(app()).get("/discovery/resources?limit=2").expect(200);
    const cursor = first.body.pagination.cursor as string;

    const tampered = `${cursor.slice(0, -3)}aaa`;
    await request(app()).get(`/discovery/resources?limit=2&cursor=${encodeURIComponent(tampered)}`).expect(400);
    await request(app()).get("/discovery/resources?limit=2&cursor=not-a-cursor").expect(400);
    // A cursor may not be replayed against a different filter set.
    await request(app())
      .get(`/discovery/resources?limit=2&type=mcp&cursor=${encodeURIComponent(cursor)}`).expect(400);

    const decoded = decodeCursor(discoveryConfig().cursorHmacKey, cursor);
    expect(decoded).toMatchObject({ offset: 2 });
  });

  it("excludes stale entries by default and includes them when configured", async () => {
    await catalogResource("https://api.example.com/weather");
    await pool.query("UPDATE catalog_resources SET last_seen = now() - interval '400 hours'");
    await catalog.sweepStale(168);

    expect((await request(app()).get("/discovery/resources").expect(200)).body.pagination.total).toBe(0);
    const inclusive = app({ discovery: discoveryConfig({ includeStale: true }) });
    expect((await request(inclusive).get("/discovery/resources").expect(200)).body.pagination.total).toBe(1);
  });

  it("serves lexical search with no API key configured", async () => {
    await catalogResource("https://api.example.com/weather");
    const result = extractCandidate(
      payload({ url: "https://api.example.com/mcp", metadata: mcpMetadata("sentiment") }),
      requirements(), catalogConfig(),
    );
    if (result.kind !== "candidate") throw new Error("expected candidate");
    await catalog.observe(result.candidate, {
      stage: "verified", activate: true, duplicateChanged: "version_and_verify",
    });

    const response = await request(app()).get("/discovery/search?query=weather").expect(200);
    expect(response.body.x402Version).toBe(2);
    expect(response.body.resources.map((item: { resource: string }) => item.resource))
      .toEqual(["https://api.example.com/weather"]);
    expect(response.body.partialResults).toBe(false);
    expect(response.body.pagination).toMatchObject({ limit: 2, cursor: null });

    await request(app()).get("/discovery/search").expect(400);
  });

  it("returns 404 when discovery is disabled", async () => {
    const disabled = app({ discovery: discoveryConfig({ enabled: false }) });
    await request(disabled).get("/discovery/resources").expect(404);
  });
});

describe("GET /discovery/resource", () => {
  it("resolves one HTTP resource by exact url with no sequential id exposed", async () => {
    await catalogResource("https://api.example.com/weather");
    const response = await request(app())
      .get("/discovery/resource?type=http&url=https://api.example.com/weather").expect(200);
    expect(response.body.x402Version).toBe(2);
    expect(response.body.resource.resource).toBe("https://api.example.com/weather");
    expect(response.body.resource).not.toHaveProperty("id");
    expect(response.body.resource).not.toHaveProperty("resourceId");
  });

  it("keys MCP entries on (url, toolName), so two tools on one URL resolve separately", async () => {
    const sentiment = extractCandidate(
      payload({ url: "https://api.example.com/mcp", metadata: mcpMetadata("sentiment") }),
      requirements(), catalogConfig(),
    );
    const summary = extractCandidate(
      payload({ url: "https://api.example.com/mcp", metadata: mcpMetadata("summary") }),
      requirements(), catalogConfig(),
    );
    if (sentiment.kind !== "candidate" || summary.kind !== "candidate") throw new Error("expected candidates");
    await catalog.observe(sentiment.candidate, { stage: "verified", activate: true, duplicateChanged: "version_and_verify" });
    await catalog.observe(summary.candidate, { stage: "verified", activate: true, duplicateChanged: "version_and_verify" });

    const a = await request(app())
      .get("/discovery/resource?type=mcp&url=https://api.example.com/mcp&toolName=sentiment").expect(200);
    const b = await request(app())
      .get("/discovery/resource?type=mcp&url=https://api.example.com/mcp&toolName=summary").expect(200);
    expect(a.body.resource.extensions.bazaar.info.input.toolName).toBe("sentiment");
    expect(b.body.resource.extensions.bazaar.info.input.toolName).toBe("summary");
  });

  it("404s on an unknown resource and rejects missing/invalid query params", async () => {
    await request(app())
      .get("/discovery/resource?type=http&url=https://api.example.com/missing").expect(404);
    await request(app()).get("/discovery/resource?type=grpc&url=https://api.example.com/x").expect(400);
    await request(app()).get("/discovery/resource?type=http").expect(400);
    await request(app()).get("/discovery/resource?type=mcp&url=https://api.example.com/mcp").expect(400);
    await request(app()).get("/discovery/resource?type=http&url=not-a-url").expect(400);
  });

  it("returns 404 when discovery is disabled", async () => {
    const disabled = app({ discovery: discoveryConfig({ enabled: false }) });
    await request(disabled).get("/discovery/resource?type=http&url=https://api.example.com/weather").expect(404);
  });
});

const envelopeBody = () => ({
  x402Version: 2,
  paymentPayload: payload(),
  paymentRequirements: requirements(),
});

describe("EXTENSION-RESPONSES", () => {
  it("encodes the official base64 JSON shape on verify and settle", async () => {
    const core = stubCore({ bazaar: { status: "success" } });
    const server = app({}, core);

    const verified = await request(server).post("/verify").send(envelopeBody()).expect(200);
    expect(verified.headers["extension-responses"]).toBe("eyJiYXphYXIiOnsic3RhdHVzIjoic3VjY2VzcyJ9fQ==");
    expect(verified.body).toEqual({ isValid: true });

    const settled = await request(server).post("/settle").send(envelopeBody()).expect(200);
    expect(settled.headers["extension-responses"]).toBe("eyJiYXphYXIiOnsic3RhdHVzIjoic3VjY2VzcyJ9fQ==");
  });

  it("encodes a rejection reason without failing the payment", async () => {
    const core = stubCore({
      bazaar: { status: "rejected", rejectedReason: "info failed schema validation" },
    });
    const response = await request(app({}, core)).post("/verify").send(envelopeBody()).expect(200);
    expect(JSON.parse(Buffer.from(response.headers["extension-responses"]!, "base64").toString())).toEqual({
      bazaar: { status: "rejected", rejectedReason: "info failed schema validation" },
    });
    expect(response.body).toEqual({ isValid: true });
  });

  it("omits the header when no extension applies", async () => {
    const response = await request(app()).post("/verify").send(envelopeBody()).expect(200);
    expect(response.headers["extension-responses"]).toBeUndefined();
  });

  it("produces the official example encodings", () => {
    expect(encodeExtensionResponses({ bazaar: { status: "success" } }))
      .toBe("eyJiYXphYXIiOnsic3RhdHVzIjoic3VjY2VzcyJ9fQ==");
    expect(encodeExtensionResponses({
      bazaar: { status: "rejected", rejectedReason: "info failed schema validation" },
    })).toBe("eyJiYXphYXIiOnsic3RhdHVzIjoicmVqZWN0ZWQiLCJyZWplY3RlZFJlYXNvbiI6ImluZm8gZmFpbGVkIHNjaGVtYSB2YWxpZGF0aW9uIn19");
  });

  it("reports a soft-dropped payload as rejected while cataloging nothing", async () => {
    const cataloger = new Cataloger(catalogConfig(), catalog, networks);
    const response = await cataloger.observe({
      x402Version: 2,
      paymentPayload: payload({ extensionOverride: { info: {} } }),
      paymentRequirements: requirements(),
    }, { stage: "verified" });
    expect(response).toMatchObject({ status: "rejected" });
    expect((await pool.query("SELECT count(*)::int AS count FROM catalog_resources")).rows[0].count).toBe(0);
  });
});

describe("internal analytics API", () => {
  it("serves overview, transactions and resource detail without contaminating discovery", async () => {
    const created = await catalogResource("https://api.example.com/weather");
    await analytics.record({
      stage: "settled", status: "success", network: "stellar:testnet", scheme: "exact",
      asset: ASSET, assetSymbol: "USDC", assetDecimals: 7, payer: "payer-1", payTo: SELLER,
      maxAmount: "10000", amount: "10000", feeStroops: "100", transactionHash: "hash-1",
      facilitatorId: "sponsor", ...(created.resourceId ? { resourceId: created.resourceId } : {}),
    });

    const server = app();
    const overview = await request(server).get("/analytics/v1/overview").expect(200);
    expect(Number(overview.body.total_transactions)).toBe(1);
    expect(Number(overview.body.active_resources)).toBe(1);

    const transactions = await request(server).get("/analytics/v1/transactions").expect(200);
    expect(transactions.body.items[0]).toMatchObject({ transaction_hash: "hash-1", payer: "payer-1" });

    const buyers = await request(server).get("/analytics/v1/buyers").expect(200);
    expect(buyers.body.items[0].address).toBe("payer-1");
    expect(buyers.body.concentration).toBeDefined();

    const detail = await request(server).get(`/analytics/v1/resources/${created.resourceId}`).expect(200);
    // Provenance lives here, not in the Bazaar response.
    expect(detail.body.resource.provenance).toBe("seller_declared");
    expect(detail.body.resource.verification).toBe("payment_observed");
    expect(detail.body.observations).toHaveLength(0);
    expect(detail.body.paymentOptions).toHaveLength(1);

    const observability = await request(server)
      .get(`/analytics/v1/resources/${created.resourceId}/observability`).expect(200);
    expect(Number(observability.body.calls_all_time)).toBe(1);

    await request(server).get("/analytics/v1/transactions/hash-1").expect(200);
    await request(server).get("/analytics/v1/transactions/missing").expect(404);
  });

  it("returns observability for the resources on the requested discovery page", async () => {
    const created = [];
    for (let index = 0; index < 25; index += 1) {
      created.push(await catalogResource(`https://api.example.com/resource-${index}`));
    }
    const firstResourceId = created[0]?.resourceId;
    if (!firstResourceId) throw new Error("expected the first resource to be cataloged");
    for (const [index, payer] of ["payer-1", "payer-2"].entries()) {
      await analytics.record({
        stage: "settled", status: "success", network: "stellar:testnet", scheme: "exact",
        asset: ASSET, payer, payTo: SELLER, maxAmount: "10000", amount: "10000",
        transactionHash: `old-resource-hash-${index}`, facilitatorId: "sponsor",
        resourceId: firstResourceId,
      });
    }

    const server = app({ discovery: discoveryConfig({ defaultPageSize: 20, maxPageSize: 20 }) });
    const recent = await request(server).get("/analytics/v1/resources?limit=20").expect(200);
    expect(recent.body.items.some((item: { resource_url: string }) =>
      item.resource_url === "https://api.example.com/resource-0")).toBe(false);

    const pageUrls = Array.from({ length: 5 }, (_, index) => `https://api.example.com/resource-${index}`);
    const response = await request(server)
      .post("/analytics/v1/resources/observability")
      .send({ resourceUrls: pageUrls })
      .expect(200);

    expect(response.body.items.map((item: { resource_url: string }) => item.resource_url)).toEqual(pageUrls);
    expect(response.body.items[0]).toMatchObject({
      resource_url: pageUrls[0], calls_all_time: "2", success_all_time: "2", unique_buyers: "2",
    });
    expect(response.body.items[1]).toMatchObject({ resource_url: pageUrls[1], calls_all_time: "0" });
  });

  it("bounds page observability requests to the configured discovery page size", async () => {
    const server = app({
      discovery: discoveryConfig({ defaultPageSize: 2, maxPageSize: 3 }),
      search: searchConfig({ defaultResultLimit: 2, maximumResultLimit: 3 }),
    });
    await request(server)
      .post("/analytics/v1/resources/observability")
      .send({ resourceUrls: ["https://a.example", "https://b.example", "https://c.example", "https://d.example"] })
      .expect(400, { error: "invalid_resource_urls" });
  });

  it("redacts addresses when configured", async () => {
    await analytics.record({
      stage: "settled", status: "success", network: "stellar:testnet", scheme: "exact",
      asset: ASSET, payer: SELLER, payTo: RIVAL_SELLER, maxAmount: "1", amount: "1",
      facilitatorId: "sponsor", transactionHash: "hash-redact",
    });
    const server = app({ analytics: analyticsConfig({ redactAddresses: true }) });
    const transactions = await request(server).get("/analytics/v1/transactions").expect(200);
    expect(transactions.body.items[0].payer).toBe(`${SELLER.slice(0, 6)}…${SELLER.slice(-4)}`);
  });

  it("returns 404 when analytics is disabled", async () => {
    const server = app({ analytics: analyticsConfig({ enabled: false }) });
    await request(server).get("/analytics/v1/overview").expect(404);
  });

  it("requires the configured bearer key for analytics but not for discovery", async () => {
    const server = app({ apiKeys: ["secret-key"] });
    await request(server).get("/analytics/v1/overview").expect(401);
    await request(server).get("/analytics/v1/overview").set("authorization", "Bearer secret-key").expect(200);
    await request(server).get("/discovery/resources").expect(200);
  });
});
