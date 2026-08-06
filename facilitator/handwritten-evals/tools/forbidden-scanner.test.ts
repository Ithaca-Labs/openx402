import { describe, expect, it } from "vitest";
import { matchesForbiddenSignature } from "./forbidden-scanner.js";

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
