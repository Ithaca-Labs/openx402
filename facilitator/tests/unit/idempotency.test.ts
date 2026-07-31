import { describe, expect, it } from "vitest";
import { idempotencyData, paymentIdentifier, paymentIdentifierError } from "../../src/idempotency.js";
import type { RequestEnvelope } from "../../src/types.js";

function request(): RequestEnvelope {
  return {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      accepted: {
        scheme: "upto",
        network: "stellar:testnet",
        asset: "C".padEnd(56, "A"),
        amount: "100",
        payTo: "G".padEnd(56, "A"),
        maxTimeoutSeconds: 60,
        extra: { areFeesSponsored: true },
      },
      payload: { transaction: "AAAA" },
      extensions: {
        "payment-identifier": { info: { required: false, id: "pay_1234567890abcd" } },
      },
    },
    paymentRequirements: {
      scheme: "upto",
      network: "stellar:testnet",
      asset: "C".padEnd(56, "A"),
      amount: "25",
      payTo: "G".padEnd(56, "A"),
      maxTimeoutSeconds: 60,
      extra: { areFeesSponsored: true },
    },
  };
}

describe("payment identifier", () => {
  it("uses the standard extension and keeps the upto fingerprint stable across actual amounts", () => {
    const first = request();
    const second = request();
    second.paymentRequirements.amount = "75";
    expect(paymentIdentifier(first.paymentPayload)).toBe("pay_1234567890abcd");
    expect(idempotencyData(first)).toEqual(idempotencyData(second));
  });

  it("changes the fingerprint when signed payment terms change", () => {
    const first = request();
    const second = request();
    second.paymentPayload.accepted.payTo = "G".padEnd(56, "B");
    expect(idempotencyData(first).fingerprint).not.toBe(idempotencyData(second).fingerprint);
  });

  it("falls back to a deterministic XDR key when the extension is absent", () => {
    const value = request();
    delete value.paymentPayload.extensions;
    expect(idempotencyData(value).key).toMatch(/^xdr_[0-9a-f]{64}$/);
  });

  it("rejects a required identifier when the id is absent", () => {
    const value = request();
    value.paymentPayload.extensions = {
      "payment-identifier": { info: { required: true } },
    };
    expect(paymentIdentifierError(value.paymentPayload)).toBe("payment_identifier_required");
  });

  it("rejects malformed identifiers instead of silently falling back to XDR", () => {
    const value = request();
    value.paymentPayload.extensions = {
      "payment-identifier": { info: { required: false, id: "short" } },
    };
    expect(paymentIdentifierError(value.paymentPayload)).toBe("invalid_payment_identifier");
  });
});
