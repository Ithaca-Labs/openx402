import { describe, expect, it } from "vitest";
import { searchResources } from "../../src/tools/searchResources.js";
import { McpToolError } from "../../src/errors.js";
import type { DiscoveryPage, SearchParams } from "../../src/facilitatorClient.js";
import type { CanonicalResource } from "../../src/types.js";

function resource(url: string): CanonicalResource {
  return {
    resource: url, type: "mcp", x402Version: 2, lastUpdated: "now",
    accepts: [{ scheme: "exact", network: "stellar:testnet", asset: "CASSET", amount: "10000", payTo: "GPAYTO", maxTimeoutSeconds: 60, extra: {} }],
    extensions: { bazaar: { info: { input: { type: "mcp", toolName: "sentiment", inputSchema: {} } } } },
  };
}

function fakeClient(page: DiscoveryPage) {
  return {
    search: async (_params: SearchParams) => page,
    resources: async () => page,
  } as never;
}

describe("searchResources", () => {
  it("wraps canonical resources with a stable ref/versionHash/provenance/status/warnings without modifying them", async () => {
    const page: DiscoveryPage = {
      x402Version: 2, resources: [resource("https://api.example.com/mcp")],
      partialResults: false, pagination: { limit: 20, cursor: null },
    };
    const result = await searchResources(fakeClient(page), { query: "sentiment" });
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]!.resource).toEqual(page.resources[0]);
    expect(result.resources[0]!.wrapper.provenance).toBe("seller_declared");
    expect(result.resources[0]!.wrapper.status).toBe("active");
    expect(typeof result.resources[0]!.wrapper.ref).toBe("string");
    expect(typeof result.resources[0]!.wrapper.versionHash).toBe("string");
  });

  it("throws NO_RESULTS when the facilitator returns an empty page", async () => {
    const page: DiscoveryPage = { x402Version: 2, resources: [], partialResults: false, pagination: { limit: 20, cursor: null } };
    await expect(searchResources(fakeClient(page), { query: "nothing-matches" })).rejects.toBeInstanceOf(McpToolError);
    try {
      await searchResources(fakeClient(page), { query: "nothing-matches" });
    } catch (error) {
      expect((error as McpToolError).code).toBe("NO_RESULTS");
    }
  });

  it("still returns wrapped results when the facilitator degrades to lexical-only search (no semantic fields on the wire, fewer/differently-ranked results)", async () => {
    // The public discovery/search response shape never carries a "degraded"
    // flag -- lexical-only mode is invisible at this layer by design (see
    // facilitator/src/search/service.ts). This only proves x402_search_resources
    // doesn't assume semantic-specific fields exist.
    const page: DiscoveryPage = {
      x402Version: 2, resources: [resource("https://api.example.com/lexical-only")],
      partialResults: false, pagination: { limit: 20, cursor: null },
    };
    const result = await searchResources(fakeClient(page), { query: "weather" });
    expect(result.resources).toHaveLength(1);
  });

  it("uses browse (resources) when no query is given, search when a query is given", async () => {
    const page: DiscoveryPage = {
      x402Version: 2, resources: [resource("https://api.example.com/mcp")],
      partialResults: false, pagination: { limit: 20, cursor: null },
    };
    let calledSearch = false;
    let calledBrowse = false;
    const client = {
      search: async () => { calledSearch = true; return page; },
      resources: async () => { calledBrowse = true; return page; },
    } as never;
    await searchResources(client, { type: "mcp" });
    expect(calledBrowse).toBe(true);
    expect(calledSearch).toBe(false);
    await searchResources(client, { query: "x" });
    expect(calledSearch).toBe(true);
  });
});
