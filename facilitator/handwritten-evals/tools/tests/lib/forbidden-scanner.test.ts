import { describe, expect, it } from "vitest";
import {
  assertExactSignatureSync,
  humanScannerSignatures,
  matchesForbiddenSignature,
  scanForbiddenRecords,
} from "../../lib/forbidden-scanner.js";

describe("matchesForbiddenSignature", () => {
  it("matches complete normalized token sequences", () => {
    expect(matchesForbiddenSignature("Secure wallet-signing for agents", "wallet signing")).toBe(true);
    expect(matchesForbiddenSignature("Use our CODE RUNNER API", "code runner")).toBe(true);
  });

  it("does not match signatures inside longer words", () => {
    expect(matchesForbiddenSignature(
      "We help finance teams redesign transaction reporting workflows for audit trails.",
      "sign transaction",
    )).toBe(false);
    expect(matchesForbiddenSignature("Teams can assign transaction categories.", "sign transaction")).toBe(false);
    expect(matchesForbiddenSignature("Rerun code quality reports nightly.", "run code")).toBe(false);
    expect(matchesForbiddenSignature("Track overrun codebase budgets.", "run code")).toBe(false);
    expect(matchesForbiddenSignature("Backup restoreation glossary.", "backup restore")).toBe(false);
  });
});

describe("human/machine signature synchronization", () => {
  const section = "**Scanner signatures.** `run code`; `code runner`.\n\n";

  it("requires exact two-way synchronization", () => {
    expect(humanScannerSignatures(section)).toEqual(["run code", "code runner"]);
    expect(() => assertExactSignatureSync(section, ["code runner", "run code"], "FC-06")).not.toThrow();
    expect(() => assertExactSignatureSync(section, ["run code"], "FC-06")).toThrow(/extra=code runner/);
    expect(() => assertExactSignatureSync(section, ["run code", "compiler api"], "FC-06"))
      .toThrow(/missing=compiler api/);
  });
});

describe("scanForbiddenRecords", () => {
  const base = {
    resource_id: "res-0101",
    wire: {
      resource: { serviceName: "Ordinary service", tags: ["utility"], mimeType: "application/json" },
      extensions: { bazaar: {} },
    },
  };
  const capabilities = [{ id: "FC-01", name: "Wallet signing", signatures: ["sign transaction"] }];

  it("scans Bazaar schema field names and string values", () => {
    const fieldHit = scanForbiddenRecords([{
      ...base,
      wire: { ...base.wire, extensions: { bazaar: { inputSchema: { properties: { sign_transaction: { type: "boolean" } } } } } },
    }], capabilities);
    const valueHit = scanForbiddenRecords([{
      ...base,
      wire: { ...base.wire, extensions: { bazaar: { description: "Use this tool to sign transactions." } } },
    }], [{ ...capabilities[0]!, signatures: ["sign transactions"] }]);

    expect(fieldHit).toMatchObject([{ resourceId: "res-0101", field: expect.stringContaining("sign_transaction#key") }]);
    expect(valueHit).toMatchObject([{ resourceId: "res-0101", field: "extensions.bazaar.description" }]);
  });

  it("does not scan URLs or payment metadata outside the mandated fields", () => {
    const record = {
      ...base,
      wire: {
        ...base.wire,
        resource: { ...base.wire.resource, url: "https://sign-transaction.example/api" },
        accepts: [{ scheme: "exact", extra: { note: "sign transaction" } }],
      },
    };
    expect(scanForbiddenRecords([record], capabilities)).toEqual([]);
  });
});
