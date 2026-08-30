import { randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/migrate.js";
import { StateStore } from "../../src/db/state.js";
import { KeyStore } from "../../src/db/keystore.js";
import type { PreparedSettlement } from "../../src/types.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:55432/facilitator_test";
const pool = new pg.Pool({ connectionString: databaseUrl });
const state = new StateStore(pool);

beforeAll(async () => migrate(pool));
beforeEach(async () => {
  await pool.query("TRUNCATE settlement_audit, sponsor_daily_usage, simulation_windows, channel_accounts, idempotency_records, managed_keys RESTART IDENTITY CASCADE");
});
afterAll(async () => {
  await pool.query(
    "TRUNCATE settlement_audit, sponsor_daily_usage, simulation_windows, channel_accounts, idempotency_records, managed_keys RESTART IDENTITY CASCADE",
  );
  await pool.end();
});

function prepared(channelAddress: string, fee = 100n, sequence = 42n): PreparedSettlement {
  return {
    scheme: "exact",
    network: "stellar:testnet",
    payer: "payer",
    maximum: 10n,
    actual: 10n,
    channelAddress,
    channelSequence: sequence,
    envelopeXdr: "AAAA",
    transactionHash: "a".repeat(64),
    estimatedResourceFee: fee - 2n,
    estimatedInclusionFee: 2n,
    estimatedTotalFee: fee,
  };
}

async function storePrepared(key: string, sequence: bigint): Promise<{ recordId: number; stored: string }> {
  const claim = await state.claimSettlement({
    scope: "scope", key, fingerprint: key, scheme: "exact",
    network: "stellar:testnet", actual: 10n, workerId: "worker", leaseMs: 1000,
  });
  if (claim.kind !== "owner") throw new Error("claim failed");
  const lease = await state.leaseChannel("stellar:testnet", "worker", 30_000);
  if (!lease) throw new Error("lease failed");
  const stored = await state.storePreparedAndReserve({
    recordId: claim.record.id, lease, prepared: prepared(lease.address, 100n, sequence), scope: "scope",
    perScopeDailyLimit: 100_000n, globalDailyLimit: 100_000n,
  });
  if (stored !== "stored") await state.releaseChannel(lease);
  return { recordId: claim.record.id, stored };
}

async function lastSequence(): Promise<string | null> {
  const result = await pool.query<{ last_sequence: string | null }>(
    "SELECT last_sequence FROM channel_accounts WHERE network = 'stellar:testnet' AND address = 'channel-a'",
  );
  return result.rows[0]?.last_sequence ?? null;
}

describe("durable settlement state", () => {
  it("leases different channels concurrently with fencing tokens", async () => {
    await state.upsertChannel("stellar:testnet", "channel-a");
    await state.upsertChannel("stellar:testnet", "channel-b");
    const leases = await Promise.all([
      state.leaseChannel("stellar:testnet", "worker-a", 30_000),
      state.leaseChannel("stellar:testnet", "worker-b", 30_000),
    ]);
    expect(new Set(leases.map(lease => lease?.address)).size).toBe(2);
    expect(leases.every(lease => lease?.fencingToken === 1n)).toBe(true);
  });

  it("detects conflicting identifier reuse and settlement amounts", async () => {
    const first = await state.claimSettlement({
      scope: "scope", key: "pay_1234567890abcd", fingerprint: "one",
      scheme: "upto", network: "stellar:testnet", actual: 3n, workerId: "worker", leaseMs: 1000,
    });
    expect(first.kind).toBe("owner");
    const fingerprintConflict = await state.claimSettlement({
      scope: "scope", key: "pay_1234567890abcd", fingerprint: "two",
      scheme: "upto", network: "stellar:testnet", actual: 3n, workerId: "worker", leaseMs: 1000,
    });
    expect(fingerprintConflict.kind).toBe("conflict");
    const amountConflict = await state.claimSettlement({
      scope: "scope", key: "pay_1234567890abcd", fingerprint: "one",
      scheme: "upto", network: "stellar:testnet", actual: 4n, workerId: "worker", leaseMs: 1000,
    });
    expect(amountConflict.kind).toBe("conflict");
  });

  it("commits envelope, hash, budget and unresolved channel atomically", async () => {
    await state.upsertChannel("stellar:testnet", "channel-a");
    const claim = await state.claimSettlement({
      scope: "scope", key: "key", fingerprint: "fingerprint", scheme: "exact",
      network: "stellar:testnet", actual: 10n, workerId: "worker", leaseMs: 1000,
    });
    if (claim.kind !== "owner") throw new Error("claim failed");
    const lease = await state.leaseChannel("stellar:testnet", "worker", 30_000);
    if (!lease) throw new Error("lease failed");
    expect(await state.storePreparedAndReserve({
      recordId: claim.record.id, lease, prepared: prepared(lease.address), scope: "scope",
      perScopeDailyLimit: 1000n, globalDailyLimit: 1000n,
    })).toBe("stored");
    const record = await state.getRecord(claim.record.id);
    expect(record?.transactionHash).toBe("a".repeat(64));
    expect(await state.leaseChannel("stellar:testnet", "other", 30_000)).toBeUndefined();
    await state.markUnknown(claim.record.id, "timeout");
    expect(await state.leaseChannel("stellar:testnet", "other", 30_000)).toBeUndefined();
    await state.complete(claim.record.id, {
      success: true, transaction: "a".repeat(64), network: "stellar:testnet", payer: "payer",
    }, "success");
    expect((await state.leaseChannel("stellar:testnet", "other", 30_000))?.address).toBe("channel-a");
  });

  it("enforces per-principal and global sponsor budgets in PostgreSQL", async () => {
    await state.upsertChannel("stellar:testnet", "channel-a");
    const claim = await state.claimSettlement({
      scope: "scope", key: "key", fingerprint: "fingerprint", scheme: "exact",
      network: "stellar:testnet", actual: 10n, workerId: "worker", leaseMs: 1000,
    });
    if (claim.kind !== "owner") throw new Error("claim failed");
    const lease = await state.leaseChannel("stellar:testnet", "worker", 30_000);
    if (!lease) throw new Error("lease failed");
    expect(await state.storePreparedAndReserve({
      recordId: claim.record.id, lease, prepared: prepared(lease.address, 101n), scope: "scope",
      perScopeDailyLimit: 100n, globalDailyLimit: 1000n,
    })).toBe("budget_exceeded");
    const usage = await pool.query("SELECT count(*) FROM sponsor_daily_usage");
    expect(Number(usage.rows[0].count)).toBe(0);
  });

  it("counts actual RPC simulations in the shared rate window", async () => {
    expect(await state.consumeSimulations("principal", 4, 5)).toBe(true);
    expect(await state.consumeSimulations("principal", 2, 5)).toBe(false);
  });

  it("rotates a sponsor only after unresolved settlements drain", async () => {
    const keys = new KeyStore(pool, randomBytes(32));
    const first = Keypair.random();
    const second = Keypair.random();
    await keys.put("stellar:testnet", "sponsor", first.publicKey(), first.secret());
    await state.claimSettlement({
      scope: "scope", key: "rotation-key", fingerprint: "fingerprint", scheme: "exact",
      network: "stellar:testnet", actual: 10n, workerId: "worker", leaseMs: 1000,
    });
    await expect(keys.rotateSponsor("stellar:testnet", second.publicKey(), second.secret()))
      .rejects.toThrow("unresolved settlements");
    await pool.query("UPDATE idempotency_records SET status = 'failed' WHERE idempotency_key = 'rotation-key'");
    await keys.rotateSponsor("stellar:testnet", second.publicKey(), second.secret());
    const active = await keys.list("stellar:testnet");
    expect(active.map(key => key.address)).toEqual([second.publicKey()]);
  });

  it("advances the channel sequence only when a ledger confirmed the transaction", async () => {
    await state.upsertChannel("stellar:testnet", "channel-a");

    const unsubmitted = await storePrepared("key-unsubmitted", 42n);
    expect(unsubmitted.stored).toBe("stored");
    await state.complete(unsubmitted.recordId, {
      success: false, transaction: "", network: "stellar:testnet",
      errorReason: "settle_stellar_transaction_submission_failed",
    }, "failed");
    expect(await lastSequence()).toBeNull();

    const applied = await storePrepared("key-applied", 42n);
    expect(applied.stored).toBe("stored");
    await state.complete(applied.recordId, {
      success: true, transaction: "a".repeat(64), network: "stellar:testnet", payer: "payer",
    }, "success", true);
    expect(await lastSequence()).toBe("42");
  });

  it("rejects a settlement built on a sequence the ledger already consumed", async () => {
    await state.upsertChannel("stellar:testnet", "channel-a");
    const applied = await storePrepared("key-applied", 42n);
    await state.complete(applied.recordId, {
      success: true, transaction: "a".repeat(64), network: "stellar:testnet", payer: "payer",
    }, "success", true);

    expect((await storePrepared("key-stale", 41n)).stored).toBe("stale_sequence");
    expect((await storePrepared("key-replay", 42n)).stored).toBe("stale_sequence");
    expect((await storePrepared("key-fresh", 43n)).stored).toBe("stored");
  });
});
