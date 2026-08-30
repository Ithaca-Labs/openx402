import { Account, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import type { StateStore, SettlementRecord } from "../../src/db/state.js";
import { FacilitatorCore, persistedTransactionMaximumTime } from "../../src/orchestrator.js";
import { networkPassphrase } from "../../src/stellar/common.js";
import type { AppConfig } from "../../src/types.js";
import type { RuntimeRegistry } from "../../src/runtime.js";

interface RecoveryInternals {
  pollRecordWithoutRequest(record: SettlementRecord): Promise<void>;
  poll(): Promise<"SUCCESS" | "FAILED" | "UNKNOWN">;
  horizonStatus(): Promise<"SUCCESS" | "FAILED" | "NOT_FOUND" | "UNKNOWN">;
  persistedTransactionExpired(): Promise<boolean>;
}

function recoveryHarness() {
  const complete = vi.fn().mockResolvedValue(undefined);
  const state = { complete } as unknown as StateStore;
  const runtime = {
    config: { id: "stellar:testnet", horizonUrl: "https://horizon.test" },
  };
  const registry = {
    networks: new Map([["stellar:testnet", runtime]]),
    channels: new Map(),
  } as unknown as RuntimeRegistry;
  const config = { limits: { maxConcurrentSimulations: 1 } } as AppConfig;
  const core = new FacilitatorCore(config, registry, state);
  const internals = core as unknown as RecoveryInternals;
  internals.poll = vi.fn().mockResolvedValue("UNKNOWN");
  internals.horizonStatus = vi.fn().mockResolvedValue("NOT_FOUND");
  internals.persistedTransactionExpired = vi.fn().mockResolvedValue(true);
  return { complete, internals };
}

const record: SettlementRecord = {
  id: 42,
  scheme: "exact",
  network: "stellar:testnet",
  status: "unknown",
  payer: Keypair.random().publicKey(),
  transactionHash: "a".repeat(64),
};

describe("unresolved settlement recovery", () => {
  it("releases an expired transaction that both RPC and Horizon cannot find", async () => {
    const { complete, internals } = recoveryHarness();
    await internals.pollRecordWithoutRequest(record);
    expect(complete).toHaveBeenCalledWith(record.id, {
      success: false,
      transaction: record.transactionHash,
      network: record.network,
      payer: record.payer,
      errorReason: "settle_stellar_transaction_expired_unconfirmed",
    }, "failed");
  });

  it("keeps the channel unresolved until the transaction expires", async () => {
    const { complete, internals } = recoveryHarness();
    internals.persistedTransactionExpired = vi.fn().mockResolvedValue(false);
    await internals.pollRecordWithoutRequest(record);
    expect(complete).not.toHaveBeenCalled();
  });

  it("keeps the channel unresolved when Horizon is unavailable", async () => {
    const { complete, internals } = recoveryHarness();
    internals.horizonStatus = vi.fn().mockResolvedValue("UNKNOWN");
    await internals.pollRecordWithoutRequest(record);
    expect(complete).not.toHaveBeenCalled();
  });

  it("accepts Horizon success after an RPC timeout", async () => {
    const { complete, internals } = recoveryHarness();
    internals.horizonStatus = vi.fn().mockResolvedValue("SUCCESS");
    await internals.pollRecordWithoutRequest(record);
    // Horizon reporting SUCCESS means the transaction reached a ledger, so the
    // channel sequence it consumed is confirmed and may be recorded.
    expect(complete).toHaveBeenCalledWith(record.id, {
      success: true,
      transaction: record.transactionHash,
      network: record.network,
      payer: record.payer,
    }, "success", true);
  });

  it("reads the inner transaction timeout from a fee-bump envelope", () => {
    const passphrase = networkPassphrase("stellar:testnet");
    const channel = Keypair.random();
    const sponsor = Keypair.random();
    const inner = new TransactionBuilder(new Account(channel.publicKey(), "1"), {
      fee: "100",
      networkPassphrase: passphrase,
    })
      .addOperation(Operation.manageData({ name: "recovery", value: "test" }))
      .setTimeout(300)
      .build();
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      sponsor.publicKey(),
      "100",
      inner,
      passphrase,
    );
    expect(persistedTransactionMaximumTime(feeBump.toXDR(), "stellar:testnet"))
      .toBeGreaterThan(BigInt(Math.floor(Date.now() / 1000)));
  });
});
