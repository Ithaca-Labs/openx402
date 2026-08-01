import { describe, expect, it } from "vitest";
import type { PaymentRequirements } from "@x402/core/types";
import { guardAgainstCatalog } from "../../src/catalogGuard.js";
import { McpToolError } from "../../src/errors.js";
import type { CanonicalResource, ResourceIdentity } from "../../src/types.js";

const identity: ResourceIdentity = { type: "mcp", url: "https://api.example.com/mcp", toolName: "sentiment" };
const selection = { network: "stellar:testnet", scheme: "exact", asset: "CASSET" };

function accepted(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact", network: "stellar:testnet", asset: "CASSET", amount: "10000",
    payTo: "GPAYTO", maxTimeoutSeconds: 60, extra: { areFeesSponsored: true }, ...overrides,
  };
}

function catalogResource(overrides: Partial<CanonicalResource> = {}): CanonicalResource {
  return {
    resource: "https://api.example.com/mcp", type: "mcp", x402Version: 2, lastUpdated: "now",
    accepts: [accepted()],
    extensions: { bazaar: { info: { input: { type: "mcp", toolName: "sentiment", transport: "streamable-http", inputSchema: { type: "object" } } } } },
    ...overrides,
  };
}

function liveChallenge(overrides: Record<string, unknown> = {}) {
  return {
    x402Version: 2,
    resource: { url: "https://api.example.com/mcp" },
    accepts: [accepted()],
    extensions: { bazaar: { info: { input: { type: "mcp", toolName: "sentiment", transport: "streamable-http", inputSchema: { type: "object" } } } } },
    ...overrides,
  } as never;
}

describe("guardAgainstCatalog", () => {
  it("passes when live challenge matches the selected catalog version exactly", () => {
    expect(() => guardAgainstCatalog({ liveChallenge: liveChallenge(), catalogResource: catalogResource(), identity, selection })).not.toThrow();
  });

  for (const [label, mutate] of Object.entries({
    "changed price (amount)": () => liveChallenge({ accepts: [accepted({ amount: "99999" })] }),
    "changed payTo": () => liveChallenge({ accepts: [accepted({ payTo: "GDIFFERENT" })] }),
    "changed asset": () => liveChallenge({ accepts: [accepted({ asset: "CDIFFERENT" })] }),
    "changed network": () => liveChallenge({ accepts: [{ ...accepted(), network: "stellar:pubnet" }] }),
    "changed maxTimeoutSeconds": () => liveChallenge({ accepts: [accepted({ maxTimeoutSeconds: 5 })] }),
    "changed extra": () => liveChallenge({ accepts: [accepted({ extra: {} })] }),
    "changed resource url": () => liveChallenge({ resource: { url: "https://api.example.com/other" } }),
    "changed tool name": () => liveChallenge({ extensions: { bazaar: { info: { input: { type: "mcp", toolName: "different-tool", transport: "streamable-http", inputSchema: { type: "object" } } } } } }),
    "changed schema": () => liveChallenge({ extensions: { bazaar: { info: { input: { type: "mcp", toolName: "sentiment", transport: "streamable-http", inputSchema: { type: "object", properties: { new: {} } } } } } } }),
    "changed transport": () => liveChallenge({ extensions: { bazaar: { info: { input: { type: "mcp", toolName: "sentiment", transport: "sse", inputSchema: { type: "object" } } } } } }),
  })) {
    it(`rejects RESOURCE_CHANGED on ${label}`, () => {
      expect(() => guardAgainstCatalog({ liveChallenge: mutate(), catalogResource: catalogResource(), identity, selection }))
        .toThrow(McpToolError);
      try {
        guardAgainstCatalog({ liveChallenge: mutate(), catalogResource: catalogResource(), identity, selection });
      } catch (error) {
        expect(error).toBeInstanceOf(McpToolError);
        expect((error as McpToolError).code).toBe("RESOURCE_CHANGED");
      }
    });
  }

  it("never silently accepts new terms -- multiple simultaneous mismatches are all reported", () => {
    try {
      guardAgainstCatalog({
        liveChallenge: liveChallenge({ accepts: [accepted({ amount: "1", payTo: "GX" })] }),
        catalogResource: catalogResource(), identity, selection,
      });
      throw new Error("expected to throw");
    } catch (error) {
      expect((error as McpToolError).details?.mismatches).toEqual(expect.arrayContaining(["amount", "payTo"]));
    }
  });
});
