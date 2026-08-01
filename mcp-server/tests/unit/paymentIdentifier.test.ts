import { describe, expect, it } from "vitest";
import { SingleRetryGuard, computePaymentIdentifier } from "../../src/payment/paymentIdentifier.js";

describe("computePaymentIdentifier", () => {
  it("is deterministic for identical inputs", () => {
    const input = { ref: "r", versionHash: "v", network: "stellar:testnet", scheme: "exact", asset: "a", maxAtomicAmount: "10000", nonce: "n" };
    expect(computePaymentIdentifier(input)).toBe(computePaymentIdentifier({ ...input }));
  });

  it("changes if any field changes, including the nonce", () => {
    const base = { ref: "r", versionHash: "v", network: "stellar:testnet", scheme: "exact", asset: "a", maxAtomicAmount: "10000", nonce: "n" };
    expect(computePaymentIdentifier({ ...base, nonce: "different" })).not.toBe(computePaymentIdentifier(base));
  });
});

describe("SingleRetryGuard", () => {
  it("claims a payment identifier exactly once -- a duplicate claim is rejected", () => {
    const guard = new SingleRetryGuard();
    expect(guard.claim("pid-1")).toBe(true);
    expect(guard.claim("pid-1")).toBe(false);
    expect(guard.claim("pid-2")).toBe(true);
  });

  it("release allows a subsequent reclaim (used only for cleanup, not for granting a second live retry mid-flow)", () => {
    const guard = new SingleRetryGuard();
    expect(guard.claim("pid-1")).toBe(true);
    guard.release("pid-1");
    expect(guard.claim("pid-1")).toBe(true);
  });
});
