import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FacilitatorClient } from "../../src/facilitatorClient.js";
import { searchResources } from "../../src/tools/searchResources.js";
import { getResource } from "../../src/tools/getResource.js";
import { encodeResourceRef } from "../../src/resourceRef.js";
import { FakeFacilitator, type FakeResource } from "../helpers/fakeFacilitator.js";

const SENTIMENT: FakeResource = {
  resource: "https://api.example.com/mcp", type: "mcp", x402Version: 2, lastUpdated: "2026-01-01T00:00:00.000Z",
  description: "Runs sentiment analysis.",
  accepts: [{ scheme: "exact", network: "stellar:testnet", asset: "CASSET", amount: "10000", payTo: "GPAYTO", maxTimeoutSeconds: 60, extra: { areFeesSponsored: true } }],
  extensions: { bazaar: { info: { input: { type: "mcp", toolName: "sentiment", inputSchema: { type: "object" } } } } },
};
const SUMMARY: FakeResource = {
  ...SENTIMENT,
  description: "Summarizes text.",
  extensions: { bazaar: { info: { input: { type: "mcp", toolName: "summary", inputSchema: { type: "object" } } } } },
};

describe("FacilitatorClient + tools against a real HTTP server (documented discovery contract)", () => {
  let facilitator: FakeFacilitator;

  beforeEach(async () => {
    facilitator = new FakeFacilitator();
    await facilitator.start();
    facilitator.resources = [SENTIMENT, SUMMARY];
  });
  afterEach(async () => facilitator.stop());

  it("x402_search_resources finds a cataloged MCP tool by query over real HTTP", async () => {
    const client = new FacilitatorClient(facilitator.baseUrl);
    const result = await searchResources(client, { query: "sentiment" });
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]!.resource.resource).toBe(SENTIMENT.resource);
  });

  it("browse (no query) returns every cataloged resource, filterable by type", async () => {
    const client = new FacilitatorClient(facilitator.baseUrl);
    const result = await searchResources(client, { type: "mcp" });
    expect(result.resources).toHaveLength(2);
  });

  it("same MCP URL with two tool names resolves to two distinct entries via /discovery/resource", async () => {
    const client = new FacilitatorClient(facilitator.baseUrl);
    const sentimentRef = encodeResourceRef({ type: "mcp", url: SENTIMENT.resource, toolName: "sentiment" });
    const summaryRef = encodeResourceRef({ type: "mcp", url: SUMMARY.resource, toolName: "summary" });
    const a = await getResource(client, { ref: sentimentRef });
    const b = await getResource(client, { ref: summaryRef });
    expect(a.resource.description).toBe("Runs sentiment analysis.");
    expect(b.resource.description).toBe("Summarizes text.");
    expect(a.wrapper.ref).not.toBe(b.wrapper.ref);
  });

  it("x402_get_resource never accepts a raw URL -- only a decodable stable reference", async () => {
    const client = new FacilitatorClient(facilitator.baseUrl);
    // A ref is always base64url("v1." + json); a raw URL string fails to decode.
    await expect(getResource(client, { ref: "https://api.example.com/mcp" })).rejects.toThrow(/malformed/);
  });

  it("propagates NO_RESULTS through the real HTTP path when nothing matches", async () => {
    const client = new FacilitatorClient(facilitator.baseUrl);
    await expect(searchResources(client, { query: "no-such-thing" })).rejects.toMatchObject({ code: "NO_RESULTS" });
  });

  it("propagates a 404 from /discovery/resource as NO_RESULTS at the tool layer", async () => {
    const client = new FacilitatorClient(facilitator.baseUrl);
    const ref = encodeResourceRef({ type: "mcp", url: "https://api.example.com/missing", toolName: "x" });
    await expect(getResource(client, { ref })).rejects.toMatchObject({ code: "NO_RESULTS" });
  });
});
