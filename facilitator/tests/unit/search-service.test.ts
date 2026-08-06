import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashSearchQuery } from "../../src/search/service.js";

describe("search impression query hash", () => {
  it("uses the complete SHA-256 digest without exposing query text", () => {
    const query = "private seller search with spaces";
    const expected = createHash("sha256").update(query, "utf8").digest("hex");
    const hashed = hashSearchQuery(query);

    expect(hashed).toBe(expected);
    expect(hashed).toMatch(/^[a-f0-9]{64}$/);
    expect(hashed).not.toContain(Buffer.from(query).toString("base64url").slice(0, 16));
  });

  it("is deterministic and query-sensitive", () => {
    expect(hashSearchQuery("weather")).toBe(hashSearchQuery("weather"));
    expect(hashSearchQuery("weather")).not.toBe(hashSearchQuery("weather "));
  });
});
