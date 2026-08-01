import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/migrate.js";
import { PostgresBudgetStore } from "../../src/budget/postgresBudgetStore.js";

const databaseUrl = process.env.MCP_TEST_DATABASE_URL ?? "postgresql://sachplayz:test@127.0.0.1:55432/mcp_server_test";

// Two independent pools simulate two replicas of mcp-server sharing one
// PostgreSQL instance -- exactly the deployment shape the task requires
// ("transactions and row locks must make budgets correct across replicas").
const poolA = new pg.Pool({ connectionString: databaseUrl });
const poolB = new pg.Pool({ connectionString: databaseUrl });
const replicaA = new PostgresBudgetStore(poolA);
const replicaB = new PostgresBudgetStore(poolB);

beforeAll(async () => migrate(poolA));
beforeEach(async () => {
  await poolA.query("TRUNCATE mcp_budget_reservations, mcp_budget_usage RESTART IDENTITY CASCADE");
});
afterAll(async () => {
  await poolA.query("TRUNCATE mcp_budget_reservations, mcp_budget_usage RESTART IDENTITY CASCADE");
  await Promise.all([poolA.end(), poolB.end()]);
});

describe("PostgresBudgetStore across two replicas", () => {
  it("two replicas racing to reserve against the same daily cap never jointly exceed it", async () => {
    const limits = { perCallMaxAtomic: 600n, sessionOrDayMaxAtomic: 1_000n };
    const results = await Promise.allSettled([
      replicaA.reserve({ paymentIdentifier: "race-a", agentId: "agent-race", resourceRef: "ref", network: "stellar:testnet", asset: "CASSET", scheme: "exact", amount: 600n }, limits),
      replicaB.reserve({ paymentIdentifier: "race-b", agentId: "agent-race", resourceRef: "ref", network: "stellar:testnet", asset: "CASSET", scheme: "exact", amount: 600n }, limits),
    ]);
    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");
    // 600 + 600 = 1200 > 1000, so exactly one of the two concurrent reserves
    // must fail -- the row lock on mcp_budget_usage serializes them.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(await replicaA.usedToday("agent-race")).toBe(600n);
  });

  it("both replicas can reserve when the combined amount stays within the daily cap", async () => {
    const limits = { perCallMaxAtomic: 600n, sessionOrDayMaxAtomic: 1_000n };
    const results = await Promise.all([
      replicaA.reserve({ paymentIdentifier: "ok-a", agentId: "agent-ok", resourceRef: "ref", network: "stellar:testnet", asset: "CASSET", scheme: "exact", amount: 400n }, limits),
      replicaB.reserve({ paymentIdentifier: "ok-b", agentId: "agent-ok", resourceRef: "ref", network: "stellar:testnet", asset: "CASSET", scheme: "exact", amount: 500n }, limits),
    ]);
    expect(results[0]!.status).toBe("reserved");
    expect(results[1]!.status).toBe("reserved");
    expect(await replicaA.usedToday("agent-ok")).toBe(900n);
  });

  it("reserve is idempotent on paymentIdentifier across replicas -- a duplicate never double-reserves", async () => {
    const limits = { perCallMaxAtomic: 600n, sessionOrDayMaxAtomic: 1_000n };
    const input = { paymentIdentifier: "dup-1", agentId: "agent-dup", resourceRef: "ref", network: "stellar:testnet" as const, asset: "CASSET", scheme: "exact" as const, amount: 300n };
    const [first, second] = await Promise.all([replicaA.reserve(input, limits), replicaB.reserve(input, limits)]);
    expect(first).toEqual(second);
    expect(await replicaA.usedToday("agent-dup")).toBe(300n);
  });

  it("concurrent reconcile and release on different reservations stay independent and correct", async () => {
    const limits = { perCallMaxAtomic: 1_000n, sessionOrDayMaxAtomic: 2_000n };
    await replicaA.reserve({ paymentIdentifier: "settle-me", agentId: "agent-mixed", resourceRef: "ref", network: "stellar:testnet", asset: "CASSET", scheme: "upto", amount: 1_000n }, limits);
    await replicaA.reserve({ paymentIdentifier: "release-me", agentId: "agent-mixed", resourceRef: "ref", network: "stellar:testnet", asset: "CASSET", scheme: "exact", amount: 500n }, limits);
    expect(await replicaA.usedToday("agent-mixed")).toBe(1_500n);

    await Promise.all([
      replicaA.reconcile("settle-me", 300n, "a".repeat(64)),
      replicaB.release("release-me"),
    ]);

    // settled 300 of 1000 (700 released) + released 500 (all released) = 300 remaining.
    expect(await replicaA.usedToday("agent-mixed")).toBe(300n);
    expect((await replicaA.get("settle-me"))?.status).toBe("settled");
    expect((await replicaA.get("release-me"))?.status).toBe("released");
  });

  it("row lock correctness under many concurrent reservations from both replicas", async () => {
    const limits = { perCallMaxAtomic: 10n, sessionOrDayMaxAtomic: 100n };
    const attempts = Array.from({ length: 20 }, (_, index) => {
      const store = index % 2 === 0 ? replicaA : replicaB;
      return store.reserve({
        paymentIdentifier: `bulk-${index}`, agentId: "agent-bulk", resourceRef: "ref",
        network: "stellar:testnet", asset: "CASSET", scheme: "exact", amount: 10n,
      }, limits).catch(() => undefined);
    });
    await Promise.all(attempts);
    // Exactly 10 of 20 attempts (10 atomic each) fit under the 100 cap; the
    // total committed can never exceed it regardless of interleaving.
    expect(await replicaA.usedToday("agent-bulk")).toBeLessThanOrEqual(100n);
    expect(await replicaA.usedToday("agent-bulk")).toBe(100n);
  });
});
