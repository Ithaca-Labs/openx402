import { describe, expect, it } from "vitest";
import { ERROR_CODES, McpToolError, isRetryable, toErrorPayload } from "../../src/errors.js";

describe("error contract", () => {
  it("declares exactly the eleven stable codes", () => {
    expect([...ERROR_CODES].sort()).toEqual([
      "BUDGET_EXCEEDED", "INVALID_ARGUMENT", "NO_RESULTS", "PAYMENT_REJECTED",
      "PAYMENT_REQUIRED", "RESOURCE_CHANGED", "RESOURCE_STALE", "SETTLEMENT_UNKNOWN",
      "UNTRUSTED_REDIRECT", "UPSTREAM_PROTOCOL_ERROR", "UPSTREAM_TIMEOUT",
    ].sort());
  });

  it("every code has a defined retryable boolean", () => {
    for (const code of ERROR_CODES) {
      expect(typeof isRetryable(code)).toBe("boolean");
    }
  });

  it("SETTLEMENT_UNKNOWN is retryable only through polling, never re-authorization", () => {
    expect(isRetryable("SETTLEMENT_UNKNOWN")).toBe(true);
    // The distinction (polling vs. re-authorizing) is enforced by callResource
    // never re-signing on this code -- see tests/unit/duplicatePayment.test.ts.
  });

  it("RESOURCE_CHANGED and PAYMENT_REJECTED are not retryable -- new terms are never silently accepted", () => {
    expect(isRetryable("RESOURCE_CHANGED")).toBe(false);
    expect(isRetryable("PAYMENT_REJECTED")).toBe(false);
  });

  it("toPayload produces the deterministic versioned JSON contract", () => {
    const error = new McpToolError("BUDGET_EXCEEDED", "too much", { amount: "5" });
    const payload = error.toPayload();
    expect(payload).toEqual({
      schemaVersion: 1, code: "BUDGET_EXCEEDED", message: "too much",
      retryable: false, details: { amount: "5" },
    });
  });

  it("omits details when none were given", () => {
    const payload = new McpToolError("NO_RESULTS", "nothing found").toPayload();
    expect(payload).not.toHaveProperty("details");
  });

  it("toErrorPayload wraps a non-McpToolError as UPSTREAM_PROTOCOL_ERROR, non-retryable", () => {
    const payload = toErrorPayload(new Error("boom"));
    expect(payload.code).toBe("UPSTREAM_PROTOCOL_ERROR");
    expect(payload.retryable).toBe(false);
    expect(payload.message).toBe("boom");
  });
});
