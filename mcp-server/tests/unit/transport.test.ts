import { describe, expect, it } from "vitest";
import { validatePaymentRequiredDualCopy } from "../../src/transport.js";

const paymentRequired = {
  x402Version: 2,
  error: "Payment required",
  resource: { url: "https://api.example.com/mcp", description: "d" },
  accepts: [{
    scheme: "exact", network: "stellar:testnet", asset: "CASSET", amount: "10000",
    payTo: "GPAYTO", maxTimeoutSeconds: 60, extra: { areFeesSponsored: true },
  }],
};

function result(overrides: { isError?: boolean | undefined; structuredContent?: unknown; content?: Array<{ type: string; text?: string }> } = {}) {
  return {
    isError: true,
    structuredContent: paymentRequired,
    content: [{ type: "text", text: JSON.stringify(paymentRequired) }],
    ...overrides,
  };
}

describe("validatePaymentRequiredDualCopy", () => {
  it("accepts exact dual-copy equality (structuredContent === parsed content[0].text)", () => {
    const parsed = validatePaymentRequiredDualCopy(result());
    expect(parsed).toEqual(paymentRequired);
  });

  it("accepts semantically equal copies with different key order (not string-identical JSON)", () => {
    const reordered = {
      accepts: paymentRequired.accepts, error: paymentRequired.error,
      resource: paymentRequired.resource, x402Version: paymentRequired.x402Version,
    };
    const parsed = validatePaymentRequiredDualCopy(result({ content: [{ type: "text", text: JSON.stringify(reordered) }] }));
    expect(parsed).toEqual(paymentRequired);
  });

  it("rejects a result that is not isError: true", () => {
    expect(() => validatePaymentRequiredDualCopy(result({ isError: false }))).toThrow(/isError/);
    expect(() => validatePaymentRequiredDualCopy(result({ isError: undefined }))).toThrow(/isError/);
  });

  it("rejects missing structuredContent", () => {
    expect(() => validatePaymentRequiredDualCopy(result({ structuredContent: undefined }))).toThrow(/structuredContent/);
  });

  it("rejects malformed structuredContent (missing accepts array)", () => {
    expect(() => validatePaymentRequiredDualCopy(result({ structuredContent: { x402Version: 2, resource: { url: "x" } } })))
      .toThrow(/structuredContent/);
  });

  it("rejects missing content[0].text", () => {
    expect(() => validatePaymentRequiredDualCopy(result({ content: [] }))).toThrow(/content\[0\]\.text/);
    expect(() => validatePaymentRequiredDualCopy(result({ content: [{ type: "image" }] }))).toThrow(/content\[0\]\.text/);
  });

  it("rejects unparseable content[0].text", () => {
    expect(() => validatePaymentRequiredDualCopy(result({ content: [{ type: "text", text: "{not json" }] }))).toThrow(/JSON/);
  });

  it("rejects an oversized content[0].text", () => {
    const huge = JSON.stringify({ ...paymentRequired, error: "x".repeat(300_000) });
    expect(() => validatePaymentRequiredDualCopy(result({ content: [{ type: "text", text: huge }] }))).toThrow(/size bound/);
  });

  it("rejects unequal copies (amount differs between structuredContent and content[0].text)", () => {
    const tampered = { ...paymentRequired, accepts: [{ ...paymentRequired.accepts[0]!, amount: "1" }] };
    expect(() => validatePaymentRequiredDualCopy(result({ content: [{ type: "text", text: JSON.stringify(tampered) }] })))
      .toThrow(/not semantically equal/);
  });
});
