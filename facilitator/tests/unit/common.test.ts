import { describe, expect, it } from "vitest";
import { I128_MAX, parseInteger, sameTransfers } from "../../src/stellar/common.js";

describe("Stellar boundary helpers", () => {
  it("accepts canonical i128 strings only", () => {
    expect(parseInteger("0")).toBe(0n);
    expect(parseInteger("-1")).toBe(-1n);
    expect(parseInteger(I128_MAX.toString())).toBe(I128_MAX);
    expect(parseInteger((I128_MAX + 1n).toString())).toBeUndefined();
    expect(parseInteger("01")).toBeUndefined();
    expect(parseInteger("1.0")).toBeUndefined();
    expect(parseInteger(1)).toBeUndefined();
  });

  it("requires exact transfer ordering and values", () => {
    const expected = [{ from: "payer", to: "contract", amount: 10n }, { from: "contract", to: "payee", amount: 3n }];
    expect(sameTransfers(expected, expected)).toBe(true);
    expect(sameTransfers([...expected].reverse(), expected)).toBe(false);
    expect(sameTransfers(expected.slice(0, 1), expected)).toBe(false);
  });
});
