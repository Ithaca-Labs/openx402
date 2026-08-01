import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/migrate.js";
import { CatalogStore } from "../../src/db/catalog.js";
import { AnalyticsStore } from "../../src/db/analytics.js";
import { Cataloger } from "../../src/bazaar/cataloger.js";
import { extractCandidate, type CatalogCandidate } from "../../src/bazaar/extract.js";
import type { NetworkConfig, RequestEnvelope, StellarNetwork } from "../../src/types.js";
import {
  ASSET, RIVAL_SELLER, SELLER, catalogConfig, mcpMetadata, payload, requirements, weatherMetadata,
} from "../helpers/bazaar.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/facilitator_test";

// Two independent pools stand in for two facilitator replicas sharing one
// PostgreSQL instance.
const replicaA = new pg.Pool({ connectionString: databaseUrl });
const replicaB = new pg.Pool({ connectionString: databaseUrl });
const catalogA = new CatalogStore(replicaA);
const catalogB = new CatalogStore(replicaB);
const analytics = new AnalyticsStore(replicaA);

const TABLES = `catalog_index_jobs, catalog_search_documents, catalog_observations,
  payment_events, payment_daily_totals, catalog_payment_options, catalog_resource_versions,
  catalog_resources`;

const networks = new Map<StellarNetwork, NetworkConfig>([
  ["stellar:testnet", {
    allowedAssets: new Map([[ASSET, { symbol: "USDC", decimals: 7, maxPayment: 10n ** 9n }]]),
  } as unknown as NetworkConfig],
]);

beforeAll(async () => migrate(replicaA));
beforeEach(async () => {
  await replicaA.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
  await replicaA.query("UPDATE catalog_state SET last_version = 0 WHERE id = 1");
});
afterAll(async () => {
  await replicaA.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
  await Promise.all([replicaA.end(), replicaB.end()]);
});

function candidate(options: Parameters<typeof payload>[0] = {}, overrides: Partial<ReturnType<typeof requirements>> = {}): CatalogCandidate {
  const result = extractCandidate(payload(options), requirements(overrides), catalogConfig());
  if (result.kind !== "candidate") throw new Error(`expected candidate, got ${result.kind}`);
  return result.candidate;
}

function envelope(options: Parameters<typeof payload>[0] = {}): RequestEnvelope {
  return { x402Version: 2, paymentPayload: payload(options), paymentRequirements: requirements() };
}

const observed = { stage: "verified" as const, activate: true, duplicateChanged: "version_and_verify" as const };

async function listAll(store: CatalogStore) {
  const snapshot = await store.watermark();
  return store.list({
    filters: {}, limit: 50, offset: 0, snapshot,
    includeStale: false, includeUnverified: false, staleAfterHours: 168,
  });
}

describe("catalog identity, duplicates and updates", () => {
  it("indexes a new resource with its payment option and search document", async () => {
    const result = await catalogA.observe(candidate(), observed);
    expect(result.outcome).toBe("indexed");

    const page = await listAll(catalogA);
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({
      resource: "https://api.example.com/weather",
      type: "http",
      x402Version: 2,
      description: "Returns the current weather for a city.",
      serviceName: "Weather API",
      tags: ["weather", "forecast"],
      iconUrl: "https://api.example.com/icon.png",
    });
    expect(page.rows[0]!.accepts).toEqual([{
      scheme: "exact", network: "stellar:testnet", asset: ASSET,
      amount: "10000", payTo: SELLER, maxTimeoutSeconds: 60, extra: {},
    }]);

    const documents = await replicaA.query("SELECT document FROM catalog_search_documents");
    expect(documents.rows[0].document).toContain("Service: Weather API");
    expect(documents.rows[0].document).toContain("- city (required): City to look up.");
    const jobs = await replicaA.query("SELECT kind, state FROM catalog_index_jobs");
    expect(jobs.rows).toEqual([{ kind: "embedding", state: "pending" }]);
  });

  it("refreshes lastSeen for an identical declaration without creating a version", async () => {
    await catalogA.observe(candidate(), observed);
    const second = await catalogA.observe(candidate(), observed);
    expect(second.outcome).toBe("refreshed");

    const versions = await replicaA.query("SELECT count(*)::int AS count FROM catalog_resource_versions");
    expect(versions.rows[0].count).toBe(1);
    expect((await listAll(catalogA)).total).toBe(1);
  });

  it("appends a new active version when the declaration changes", async () => {
    await catalogA.observe(candidate(), observed);
    const changed = await catalogA.observe(
      candidate({ resourceOverride: { description: "Returns hourly rainfall." } }), observed,
    );
    expect(changed.outcome).toBe("versioned");

    const versions = await replicaA.query(
      "SELECT version, status, verification FROM catalog_resource_versions ORDER BY version",
    );
    expect(versions.rows).toEqual([
      { version: 1, status: "superseded", verification: "payment_observed" },
      { version: 2, status: "active", verification: "payment_observed" },
    ]);

    const page = await listAll(catalogA);
    expect(page.total).toBe(1);
    expect(page.rows[0]!.description).toBe("Returns hourly rainfall.");
  });

  it("rejects a changed declaration when duplicate_changed is reject", async () => {
    await catalogA.observe(candidate(), observed);
    const rejected = await catalogA.observe(
      candidate({ resourceOverride: { description: "Different." } }),
      { ...observed, duplicateChanged: "reject" },
    );
    expect(rejected).toMatchObject({ outcome: "rejected", code: "duplicate_change_rejected" });
    expect((await listAll(catalogA)).rows[0]!.description).toBe("Returns the current weather for a city.");
  });

  it("retires the previous payment option when the price changes, preserving history", async () => {
    await catalogA.observe(candidate(), observed);
    const changed = await catalogA.observe(candidate({}, { amount: "20000" }), observed);
    expect(changed.outcome).toBe("refreshed");

    const options = await replicaA.query(
      "SELECT amount::text, retired_version IS NULL AS live FROM catalog_payment_options ORDER BY id",
    );
    expect(options.rows).toEqual([
      { amount: "10000", live: false },
      { amount: "20000", live: true },
    ]);

    const page = await listAll(catalogA);
    expect(page.rows[0]!.accepts).toEqual([expect.objectContaining({ amount: "20000" })]);
  });

  it("keeps one resource while accumulating several payment options", async () => {
    await catalogA.observe(candidate(), observed);
    await catalogA.observe(candidate({}, { scheme: "upto", amount: "50000" }), observed);

    const page = await listAll(catalogA);
    expect(page.total).toBe(1);
    expect(page.rows[0]!.accepts).toHaveLength(2);
    expect(page.rows[0]!.accepts.map(option => option.scheme).sort()).toEqual(["exact", "upto"]);
    const document = await replicaA.query<{ document: string }>(
      "SELECT document FROM catalog_search_documents WHERE version_id = $1",
      [page.rows[0]!.versionId],
    );
    expect(document.rows[0]!.document).toContain("exact");
    expect(document.rows[0]!.document).toContain("upto");
  });

  it("quarantines a rival payTo instead of overwriting the active listing", async () => {
    await catalogA.observe(candidate(), observed);
    const spoof = await catalogA.observe(
      candidate({ resourceOverride: { serviceName: "Spoofed" } }, { payTo: RIVAL_SELLER }), observed,
    );
    expect(spoof).toMatchObject({ outcome: "quarantined", code: "payto_ownership_conflict" });

    const page = await listAll(catalogA);
    expect(page.total).toBe(1);
    expect(page.rows[0]!.serviceName).toBe("Weather API");
    expect(page.rows[0]!.accepts).toEqual([expect.objectContaining({ payTo: SELLER })]);

    const quarantined = await replicaA.query(
      "SELECT status, rejected_reason, declared_pay_to FROM catalog_resource_versions WHERE status = 'quarantined'",
    );
    expect(quarantined.rows).toEqual([
      { status: "quarantined", rejected_reason: "payto_ownership_conflict", declared_pay_to: RIVAL_SELLER },
    ]);
  });

  it("keeps MCP tools on one endpoint as distinct resources", async () => {
    const url = "https://api.example.com/mcp";
    await catalogA.observe(candidate({ url, metadata: mcpMetadata("financial_analysis") }), observed);
    await catalogA.observe(candidate({ url, metadata: mcpMetadata("sentiment") }), observed);

    const page = await listAll(catalogA);
    expect(page.total).toBe(2);
    expect(page.rows.every(row => row.type === "mcp")).toBe(true);
    const filtered = await catalogA.list({
      filters: { type: "mcp" }, limit: 50, offset: 0, snapshot: await catalogA.watermark(),
      includeStale: false, includeUnverified: false, staleAfterHours: 168,
    });
    expect(filtered.total).toBe(2);
  });
});

describe("index_on policy", () => {
  it("activates on verify when index_on is verified", async () => {
    const cataloger = new Cataloger(catalogConfig({ indexOn: "verified" }), catalogA, networks);
    const response = await cataloger.observe(envelope(), { stage: "verified" });
    expect(response).toMatchObject({ status: "success" });
    expect((await listAll(catalogA)).total).toBe(1);
  });

  it("holds the candidate until settlement when index_on is settled", async () => {
    const cataloger = new Cataloger(catalogConfig({ indexOn: "settled" }), catalogA, networks);
    const pending = await cataloger.observe(envelope(), { stage: "verified" });
    expect(pending).toMatchObject({ status: "processing" });
    expect((await listAll(catalogA)).total).toBe(0);

    const settled = await cataloger.observe(envelope(), { stage: "settled" });
    expect(settled).toMatchObject({ status: "success" });
    const page = await listAll(catalogA);
    expect(page.total).toBe(1);

    const rows = await replicaA.query("SELECT last_seen_paid IS NOT NULL AS paid FROM catalog_resources");
    expect(rows.rows[0].paid).toBe(true);
  });

  it("records a precise internal reason for a rejected declaration", async () => {
    const cataloger = new Cataloger(catalogConfig(), catalogA, networks);
    const response = await cataloger.observe(
      envelope({ url: "http://api.example.com/weather" }), { stage: "verified" },
    );
    expect(response).toMatchObject({ status: "rejected", rejectedReason: "resource origin must use https" });

    const observations = await replicaA.query(
      "SELECT outcome, wire_status, internal_reason FROM catalog_observations",
    );
    expect(observations.rows).toEqual([{
      outcome: "rejected", wire_status: "rejected", internal_reason: "insecure_resource_origin",
    }]);
    expect((await listAll(catalogA)).total).toBe(0);
  });

  it("returns no extension response when the payload carries no bazaar extension", async () => {
    const cataloger = new Cataloger(catalogConfig(), catalogA, networks);
    const request = envelope();
    delete (request.paymentPayload.extensions as Record<string, unknown>).bazaar;
    expect(await cataloger.observe(request, { stage: "verified" })).toBeUndefined();
  });
});

describe("liveness", () => {
  it("demotes and restores a resource across the staleness boundary", async () => {
    await catalogA.observe(candidate(), observed);
    expect((await listAll(catalogA)).total).toBe(1);

    await replicaA.query("UPDATE catalog_resources SET last_seen = now() - interval '400 hours'");
    expect(await catalogA.sweepStale(168)).toBe(1);
    expect((await replicaA.query("SELECT status FROM catalog_resources")).rows[0].status).toBe("stale");
    expect((await listAll(catalogA)).total).toBe(0);

    const snapshot = await catalogA.watermark();
    const withStale = await catalogA.list({
      filters: {}, limit: 50, offset: 0, snapshot,
      includeStale: true, includeUnverified: false, staleAfterHours: 168,
    });
    expect(withStale.total).toBe(1);

    // A fresh observation is a liveness signal and restores the listing.
    await catalogA.observe(candidate(), observed);
    expect((await replicaA.query("SELECT status FROM catalog_resources")).rows[0].status).toBe("active");
    expect((await listAll(catalogA)).total).toBe(1);
  });

  it("removes a quarantined resource from discovery", async () => {
    const created = await catalogA.observe(candidate(), observed);
    expect(created.outcome).toBe("indexed");
    await catalogA.setResourceStatus(candidate().resourceKey, "quarantined", "operator review");
    expect((await listAll(catalogA)).total).toBe(0);
  });
});

describe("cursor stability across replicas", () => {
  it("keeps a snapshot page stable while another replica writes", async () => {
    for (let index = 0; index < 6; index += 1) {
      await catalogA.observe(candidate({ url: `https://api.example.com/weather-${index}` }), observed);
    }
    const snapshot = await catalogA.watermark();
    const options = {
      filters: {}, limit: 3, snapshot,
      includeStale: false, includeUnverified: false, staleAfterHours: 168,
    };
    const first = await catalogA.list({ ...options, offset: 0 });
    expect(first.total).toBe(6);
    expect(first.partialResults).toBe(true);

    // Replica B catalogs three more resources and changes an existing one.
    for (let index = 6; index < 9; index += 1) {
      await catalogB.observe(candidate({ url: `https://api.example.com/weather-${index}` }), observed);
    }
    await catalogB.observe(
      candidate({ url: "https://api.example.com/weather-0", resourceOverride: { description: "Changed." } }),
      observed,
    );

    const second = await catalogA.list({ ...options, offset: 3 });
    expect(second.total).toBe(6);
    expect(second.partialResults).toBe(false);

    const paged = [...first.rows, ...second.rows].map(row => row.resource);
    expect(new Set(paged).size).toBe(6);
    expect(paged.sort()).toEqual(
      Array.from({ length: 6 }, (_, index) => `https://api.example.com/weather-${index}`).sort(),
    );

    // The new writes are visible only under a fresh watermark.
    const fresh = await catalogB.list({ ...options, snapshot: await catalogB.watermark(), offset: 0 });
    expect(fresh.total).toBe(9);
  });

  it("hides a version created after the snapshot but shows it afterwards", async () => {
    await catalogA.observe(candidate(), observed);
    const snapshot = await catalogA.watermark();
    await catalogB.observe(candidate({ resourceOverride: { description: "Later revision." } }), observed);

    const options = {
      filters: {}, limit: 10, offset: 0,
      includeStale: false, includeUnverified: false, staleAfterHours: 168,
    };
    const atSnapshot = await catalogA.list({ ...options, snapshot });
    expect(atSnapshot.rows[0]!.description).toBe("Returns the current weather for a city.");

    const now = await catalogA.list({ ...options, snapshot: await catalogA.watermark() });
    expect(now.rows[0]!.description).toBe("Later revision.");
  });

  it("reports partialResults when a page loses rows after its snapshot", async () => {
    await catalogA.observe(candidate({ url: "https://api.example.com/a" }), observed);
    await catalogA.observe(candidate({ url: "https://api.example.com/b" }), observed);
    const snapshot = await catalogA.watermark();
    await catalogB.setResourceStatus(candidate({ url: "https://api.example.com/a" }).resourceKey, "disabled");

    const page = await catalogA.list({
      filters: {}, limit: 10, offset: 0, snapshot,
      includeStale: false, includeUnverified: false, staleAfterHours: 168,
    });
    expect(page.total).toBe(1);
    expect(page.partialResults).toBe(true);
  });

  it("assigns strictly increasing catalog versions under concurrent replica writes", async () => {
    await Promise.all(Array.from({ length: 10 }, (_, index) =>
      (index % 2 === 0 ? catalogA : catalogB)
        .observe(candidate({ url: `https://api.example.com/r-${index}` }), observed)));

    const versions = await replicaA.query<{ created_version: string }>(
      "SELECT created_version FROM catalog_resources ORDER BY created_version",
    );
    const values = versions.rows.map(row => Number(row.created_version));
    expect(values).toHaveLength(10);
    expect(new Set(values).size).toBe(10);
    expect(Number(await catalogA.watermark())).toBeGreaterThanOrEqual(Math.max(...values));
  });
});

describe("filters and analytics facts", () => {
  it("applies every allowed structured filter", async () => {
    await catalogA.observe(candidate(), observed);
    await catalogA.observe(
      candidate({ url: "https://api.example.com/mcp", metadata: mcpMetadata("tool") },
        { scheme: "upto", network: "stellar:pubnet" }),
      observed,
    );
    const snapshot = await catalogA.watermark();
    const base = {
      limit: 10, offset: 0, snapshot,
      includeStale: false, includeUnverified: false, staleAfterHours: 168,
    };
    expect((await catalogA.list({ ...base, filters: { type: "http" } })).total).toBe(1);
    expect((await catalogA.list({ ...base, filters: { scheme: "upto" } })).total).toBe(1);
    expect((await catalogA.list({ ...base, filters: { network: "stellar:testnet" } })).total).toBe(1);
    expect((await catalogA.list({ ...base, filters: { payTo: SELLER } })).total).toBe(2);
    expect((await catalogA.list({ ...base, filters: { payTo: RIVAL_SELLER } })).total).toBe(0);
    expect((await catalogA.list({ ...base, filters: { asset: ASSET } })).total).toBe(2);
    expect((await catalogA.list({ ...base, filters: { extensions: "bazaar" } })).total).toBe(2);
    expect((await catalogA.list({ ...base, filters: { extensions: "offer-receipt" } })).total).toBe(0);
  });

  it("finds resources lexically without any API key or external service", async () => {
    await catalogA.observe(candidate(), observed);
    await catalogA.observe(
      candidate({ url: "https://api.example.com/mcp", metadata: mcpMetadata("sentiment") }), observed,
    );
    const snapshot = await catalogA.watermark();
    const base = {
      filters: {}, limit: 10, offset: 0, snapshot,
      includeStale: false, includeUnverified: false, staleAfterHours: 168,
    };
    const weather = await catalogA.list({ ...base, query: "weather" });
    expect(weather.rows.map(row => row.resource)).toEqual(["https://api.example.com/weather"]);
    const sentiment = await catalogA.list({ ...base, query: "sentiment" });
    expect(sentiment.rows.map(row => row.resource)).toEqual(["https://api.example.com/mcp"]);
    expect((await catalogA.list({ ...base, query: "nonexistentterm" })).total).toBe(0);
  });

  it("records settlement facts and rolls up daily volume", async () => {
    const created = await catalogA.observe(candidate(), observed);
    for (let index = 0; index < 3; index += 1) {
      await analytics.record({
        stage: "settled", status: "success", network: "stellar:testnet", scheme: "exact",
        asset: ASSET, assetSymbol: "USDC", assetDecimals: 7, payer: `payer-${index % 2}`,
        payTo: SELLER, maxAmount: "10000", amount: "10000", feeStroops: "100",
        transactionHash: `hash-${index}`, facilitatorId: "sponsor",
        ...(created.resourceId ? { resourceId: created.resourceId } : {}),
      });
    }
    const overview = await analytics.overview({ days: 30 });
    expect(Number(overview.total_transactions)).toBe(3);
    expect(String(overview.total_amount)).toBe("30000");
    expect(Number(overview.unique_buyers)).toBe(2);
    expect(Number(overview.unique_sellers)).toBe(1);
    expect(Number(overview.active_resources)).toBe(1);

    const daily = await analytics.dailyVolume({ days: 30 });
    expect(daily).toHaveLength(1);
    expect(String(daily[0]!.transactions)).toBe("3");
    expect(String(daily[0]!.amount)).toBe("30000");

    const buyers = await analytics.participants("buyer", { days: 30 }, { limit: 10, offset: 0 });
    expect(buyers.total).toBe(2);
    expect(Number(buyers.concentration.participants)).toBe(2);
    expect(String(buyers.concentration.top1_amount)).toBe("20000");

    const breakdowns = await analytics.breakdowns({ days: 30 });
    expect(breakdowns.networks).toEqual([expect.objectContaining({ key: "stellar:testnet" })]);
    expect(breakdowns.statuses).toEqual([expect.objectContaining({ key: "success" })]);

    if (created.resourceId) {
      const observability = await analytics.resourceObservability(created.resourceId);
      expect(Number(observability.calls_all_time)).toBe(3);
      expect(Number(observability.success_all_time)).toBe(3);
      expect(Number(observability.unique_buyers)).toBe(2);
    }
  });

  it("upserts one fact per settlement record when an unknown result later resolves", async () => {
    const record = await replicaA.query<{ id: string }>(
      `INSERT INTO idempotency_records(scope, idempotency_key, fingerprint, scheme, network)
       VALUES ('scope', 'key-upsert', 'fingerprint', 'exact', 'stellar:testnet') RETURNING id`,
    );
    const settlementRecordId = Number(record.rows[0]!.id);
    const base = {
      settlementRecordId, stage: "settled" as const, network: "stellar:testnet",
      scheme: "exact", asset: ASSET, payTo: SELLER, maxAmount: "10000",
      amount: "10000", feeStroops: "100", facilitatorId: "sponsor",
    };
    await analytics.record({ ...base, status: "unknown" });
    await analytics.record({ ...base, status: "success", transactionHash: "resolved-hash" });

    const events = await replicaA.query(
      "SELECT status, transaction_hash FROM payment_events WHERE settlement_record_id = $1",
      [settlementRecordId],
    );
    expect(events.rows).toEqual([{ status: "success", transaction_hash: "resolved-hash" }]);

    // The daily rollup is corrected, not double counted.
    const totals = await replicaA.query(
      "SELECT status, transactions::text, amount::text FROM payment_daily_totals ORDER BY status",
    );
    expect(totals.rows).toEqual([
      { status: "success", transactions: "1", amount: "10000" },
      { status: "unknown", transactions: "0", amount: "0" },
    ]);
    await replicaA.query("DELETE FROM payment_events WHERE settlement_record_id = $1", [settlementRecordId]);
    await replicaA.query("DELETE FROM idempotency_records WHERE id = $1", [settlementRecordId]);
  });

  it("keeps tiny-value high-count workloads countable", async () => {
    await Promise.all(Array.from({ length: 200 }, (_, index) => analytics.record({
      stage: "settled", status: index % 20 === 0 ? "failed" : "success",
      network: "stellar:testnet", scheme: "exact", asset: ASSET,
      payer: `payer-${index % 25}`, payTo: SELLER, maxAmount: "1", amount: "1",
      feeStroops: "100", transactionHash: `h-${index}`, facilitatorId: "sponsor",
    })));
    const overview = await analytics.overview({ days: 1 });
    expect(Number(overview.total_transactions)).toBe(200);
    expect(Number(overview.unique_buyers)).toBe(25);
    const recent = await analytics.transactions({ limit: 5, offset: 0 });
    expect(recent.items).toHaveLength(5);
    expect(recent.total).toBe(200);
  });
});

describe("seller metadata provenance", () => {
  it("stores the original declaration alongside the sanitized display form", async () => {
    const result = await catalogA.observe(
      candidate({ resourceOverride: { description: "Weather\u202e data" } }), observed,
    );
    const row = await replicaA.query(
      "SELECT description, provenance, verification, observed_at FROM catalog_resource_versions WHERE id = $1",
      [result.versionId],
    );
    expect(row.rows[0].description).toBe("Weather data");
    expect(row.rows[0].provenance).toBe("seller_declared");
    expect(row.rows[0].verification).toBe("payment_observed");
    expect(row.rows[0].observed_at).toBeInstanceOf(Date);

    const detail = await catalogA.resourceDetail(result.resourceId!);
    const version = (detail!.versions as Array<Record<string, unknown>>)[0]!;
    expect(version.verification).toBe("payment_observed");
    const stored = await replicaA.query(
      "SELECT bazaar_extension FROM catalog_resource_versions WHERE id = $1", [result.versionId],
    );
    expect(stored.rows[0].bazaar_extension).toEqual(weatherMetadata().extensions.bazaar);
  });
});
