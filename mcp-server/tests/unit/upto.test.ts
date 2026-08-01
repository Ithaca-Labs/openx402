import { describe, expect, it } from "vitest";
import { buildSchemeRegistry, resolveScheme, UptoUnavailableError } from "../../src/payment/schemeRegistry.js";
import { McpToolError } from "../../src/errors.js";
import { MemoryBudgetStore } from "../../src/budget/memoryBudgetStore.js";

const FAKE_SIGNER = { address: "GBUYER", signAuthEntry: async () => ({ signedAuthEntry: "x" }) } as never;

describe("upto scheme: no reusable Stellar client exists upstream -- interface stays ready, reported blocked", () => {
  it("resolveScheme(\"upto\") fails closed with UptoUnavailableError / PAYMENT_REJECTED, never silently falls back to exact", () => {
    const registry = buildSchemeRegistry(FAKE_SIGNER);
    expect(registry.has("upto")).toBe(false);
    expect(() => resolveScheme(registry, "upto")).toThrow(UptoUnavailableError);
    try {
      resolveScheme(registry, "upto");
    } catch (error) {
      expect(error).toBeInstanceOf(McpToolError);
      expect((error as McpToolError).code).toBe("PAYMENT_REJECTED");
      expect((error as McpToolError).details).toMatchObject({ scheme: "upto", blocked: true });
    }
  });

  it("exact is always available regardless of upto's absence", () => {
    const registry = buildSchemeRegistry(FAKE_SIGNER);
    expect(registry.has("exact")).toBe(true);
  });
});

/**
 * These fixtures describe the settlement shapes an upto scheme *would*
 * produce (per `specs/schemes/upto/scheme_upto.md`) and exercise this
 * package's own budget reconciliation against them. They are not evidence of
 * conformance to a canonical Stellar upto client -- none exists to conform
 * to -- only that this package's budget bookkeeping handles all three shapes
 * correctly once such a client exists.
 */
describe("upto settlement fixtures (budget reconciliation only, not canonical conformance)", () => {
  async function reserveThen(settledAmount: bigint) {
    const store = new MemoryBudgetStore();
    const paymentIdentifier = `pid-${settledAmount}`;
    await store.reserve({
      paymentIdentifier, agentId: "agent-1", resourceRef: "ref-1",
      network: "stellar:testnet", asset: "CASSET", scheme: "upto", amount: 1_000n,
    }, { perCallMaxAtomic: 1_000n, sessionOrDayMaxAtomic: 1_000n });
    return { store, paymentIdentifier };
  }

  it("zero settlement still carries a real transaction hash and is recorded as settled, not discarded", async () => {
    const { store, paymentIdentifier } = await reserveThen(0n);
    const txHash = "0".repeat(63) + "1";
    const record = await store.reconcile(paymentIdentifier, 0n, txHash);
    expect(record.status).toBe("settled");
    expect(record.settledAmount).toBe(0n);
    expect(record.transactionHash).toBe(txHash);
    // The full reservation is released back to the budget since nothing was spent.
    expect(await store.usedToday("agent-1")).toBe(0n);
  });

  it("partial settlement releases the unused portion of the reservation", async () => {
    const { store, paymentIdentifier } = await reserveThen(400n);
    const txHash = "a".repeat(64);
    const record = await store.reconcile(paymentIdentifier, 400n, txHash);
    expect(record.status).toBe("settled");
    expect(record.settledAmount).toBe(400n);
    expect(await store.usedToday("agent-1")).toBe(400n);
  });

  it("maximum settlement (settled === reserved) releases nothing extra", async () => {
    const { store, paymentIdentifier } = await reserveThen(1_000n);
    const txHash = "b".repeat(64);
    const record = await store.reconcile(paymentIdentifier, 1_000n, txHash);
    expect(record.status).toBe("settled");
    expect(record.settledAmount).toBe(1_000n);
    expect(await store.usedToday("agent-1")).toBe(1_000n);
  });

  it("SETTLEMENT_UNKNOWN keeps the entire reservation until reconciliation", async () => {
    const { store, paymentIdentifier } = await reserveThen(0n);
    const record = await store.markUnknown(paymentIdentifier, "c".repeat(64));
    expect(record.status).toBe("unknown");
    // Full 1000 stays committed -- unknown is not a release.
    expect(await store.usedToday("agent-1")).toBe(1_000n);
  });
});
