import { describe, expect, it } from "vitest";
import { amountToReserve, computeEffectiveCap, reserveForCall } from "../../src/budget/budgetPolicy.js";
import { McpToolError } from "../../src/errors.js";
import { MemoryBudgetStore } from "../../src/budget/memoryBudgetStore.js";

describe("computeEffectiveCap", () => {
  it("is the minimum of every independent ceiling", () => {
    expect(computeEffectiveCap({
      perCallLimitAtomic: 500n, sessionOrDayRemainingAtomic: 300n, x402RequiredAtomic: 1000n,
    })).toBe(300n);
  });

  it("includes the on-chain policy ceiling when present", () => {
    expect(computeEffectiveCap({
      perCallLimitAtomic: 500n, sessionOrDayRemainingAtomic: 500n, x402RequiredAtomic: 500n,
      onChainPolicyCeilingAtomic: 10n,
    })).toBe(10n);
  });
});

describe("amountToReserve", () => {
  it("exact: reserves exactly the required amount when budget covers it", () => {
    expect(amountToReserve("exact", {
      perCallLimitAtomic: 1000n, sessionOrDayRemainingAtomic: 1000n, x402RequiredAtomic: 750n,
    })).toBe(750n);
  });

  it("exact: rejects BUDGET_EXCEEDED before any signing when budget is below the required amount -- no partial exact payment", () => {
    expect(() => amountToReserve("exact", {
      perCallLimitAtomic: 100n, sessionOrDayRemainingAtomic: 1000n, x402RequiredAtomic: 750n,
    })).toThrow(McpToolError);
    try {
      amountToReserve("exact", { perCallLimitAtomic: 100n, sessionOrDayRemainingAtomic: 1000n, x402RequiredAtomic: 750n });
    } catch (error) {
      expect((error as McpToolError).code).toBe("BUDGET_EXCEEDED");
    }
  });

  it("upto: may legitimately reserve less than the seller's advertised maximum", () => {
    expect(amountToReserve("upto", {
      perCallLimitAtomic: 100n, sessionOrDayRemainingAtomic: 1000n, x402RequiredAtomic: 750n,
    })).toBe(100n);
  });

  it("upto: rejects when ceilings leave zero room", () => {
    expect(() => amountToReserve("upto", {
      perCallLimitAtomic: 0n, sessionOrDayRemainingAtomic: 1000n, x402RequiredAtomic: 750n,
    })).toThrow(McpToolError);
  });

  it("bigint boundary: amounts far beyond Number.MAX_SAFE_INTEGER are handled exactly", () => {
    const huge = 9_000_000_000_000_000_000_000n; // > 2^63, would lose precision as a JS number
    expect(amountToReserve("exact", {
      perCallLimitAtomic: huge, sessionOrDayRemainingAtomic: huge, x402RequiredAtomic: huge,
    })).toBe(huge);
  });

  it("bigint boundary: zero amount is valid for exact when required is zero", () => {
    expect(amountToReserve("exact", {
      perCallLimitAtomic: 0n, sessionOrDayRemainingAtomic: 0n, x402RequiredAtomic: 0n,
    })).toBe(0n);
  });
});

describe("reserveForCall", () => {
  it("reserves before signing and enforces the per-call limit hard, with no partial exact reservation", async () => {
    const store = new MemoryBudgetStore();
    await expect(reserveForCall(store, {
      paymentIdentifier: "pid-1", agentId: "agent-1", resourceRef: "ref-1",
      network: "stellar:testnet", asset: "CASSET", scheme: "exact",
      perCallMaxAtomic: 100n, sessionOrDayMaxAtomic: 1000n, x402RequiredAtomic: 500n,
    })).rejects.toThrow(McpToolError);
    // Nothing was reserved -- a failed pre-signing check must not consume budget.
    expect(await store.usedToday("agent-1")).toBe(0n);
  });

  it("is idempotent on paymentIdentifier: a duplicate reserve does not double-spend", async () => {
    const store = new MemoryBudgetStore();
    const input = {
      paymentIdentifier: "pid-2", agentId: "agent-2", resourceRef: "ref-1",
      network: "stellar:testnet" as const, asset: "CASSET", scheme: "exact" as const,
      perCallMaxAtomic: 1000n, sessionOrDayMaxAtomic: 1000n, x402RequiredAtomic: 300n,
    };
    await reserveForCall(store, input);
    await reserveForCall(store, input);
    expect(await store.usedToday("agent-2")).toBe(300n);
  });
});
