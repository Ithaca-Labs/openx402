import { describe, expect, it } from "vitest";
import { computeVersionHash, decodeResourceRef, encodeResourceRef } from "../../src/resourceRef.js";
import type { CanonicalResource } from "../../src/types.js";

function resource(overrides: Partial<CanonicalResource> = {}): CanonicalResource {
  return {
    resource: "https://api.example.com/mcp",
    type: "mcp",
    x402Version: 2,
    lastUpdated: "2026-01-01T00:00:00.000Z",
    accepts: [{
      scheme: "exact", network: "stellar:testnet", asset: "CASSET", amount: "10000",
      payTo: "GPAYTO", maxTimeoutSeconds: 60, extra: { areFeesSponsored: true },
    }],
    extensions: { bazaar: { info: { input: { type: "mcp", toolName: "sentiment", inputSchema: {} } } } },
    ...overrides,
  };
}

describe("resourceRef", () => {
  it("same MCP URL with two tool names encodes to two distinct references", () => {
    const a = encodeResourceRef({ type: "mcp", url: "https://api.example.com/mcp", toolName: "sentiment" });
    const b = encodeResourceRef({ type: "mcp", url: "https://api.example.com/mcp", toolName: "summary" });
    expect(a).not.toBe(b);
    expect(decodeResourceRef(a)).toEqual({ type: "mcp", url: "https://api.example.com/mcp", toolName: "sentiment" });
    expect(decodeResourceRef(b)).toEqual({ type: "mcp", url: "https://api.example.com/mcp", toolName: "summary" });
  });

  it("round-trips HTTP identities without a toolName", () => {
    const ref = encodeResourceRef({ type: "http", url: "https://api.example.com/weather" });
    expect(decodeResourceRef(ref)).toEqual({ type: "http", url: "https://api.example.com/weather" });
  });

  it("rejects malformed references", () => {
    expect(() => decodeResourceRef("not-a-ref")).toThrow(/malformed/);
    expect(() => decodeResourceRef("v2.abc")).toThrow(/malformed/);
    expect(() => decodeResourceRef("v1.")).toThrow(/malformed/);
    expect(() => decodeResourceRef(`v1.${Buffer.from("not json").toString("base64url")}`)).toThrow(/malformed/);
    expect(() => decodeResourceRef(`v1.${Buffer.from(JSON.stringify({ t: "grpc", u: "x" })).toString("base64url")}`)).toThrow(/malformed/);
  });

  it("version hash is deterministic for identical content", () => {
    expect(computeVersionHash(resource())).toBe(computeVersionHash(resource()));
  });

  it("version hash changes when price, payTo, asset, network, or schema changes", () => {
    const base = computeVersionHash(resource());
    expect(computeVersionHash(resource({ accepts: [{ ...resource().accepts[0]!, amount: "20000" }] }))).not.toBe(base);
    expect(computeVersionHash(resource({ accepts: [{ ...resource().accepts[0]!, payTo: "GOTHER" }] }))).not.toBe(base);
    expect(computeVersionHash(resource({ accepts: [{ ...resource().accepts[0]!, asset: "COTHER" }] }))).not.toBe(base);
    expect(computeVersionHash(resource({ accepts: [{ ...resource().accepts[0]!, network: "stellar:pubnet" }] }))).not.toBe(base);
    expect(computeVersionHash(resource({
      extensions: { bazaar: { info: { input: { type: "mcp", toolName: "sentiment", inputSchema: { changed: true } } } } },
    }))).not.toBe(base);
  });

  it("version hash is stable under key reordering (canonical JSON)", () => {
    const reordered = {
      accepts: resource().accepts, extensions: resource().extensions, lastUpdated: resource().lastUpdated,
      resource: resource().resource, type: resource().type, x402Version: resource().x402Version,
    } as CanonicalResource;
    expect(computeVersionHash(reordered)).toBe(computeVersionHash(resource()));
  });
});
