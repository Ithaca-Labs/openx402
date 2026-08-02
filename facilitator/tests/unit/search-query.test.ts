import { describe, expect, it } from "vitest";
import type { CatalogCandidate } from "../../src/bazaar/extract.js";
import { compileSearchDocumentParts } from "../../src/bazaar/document.js";
import {
  buildSearchTsquery, describeSearchQuery, normalizeSearchQuery,
} from "../../src/search/query.js";

const candidate: CatalogCandidate = {
  type: "http",
  resourceKey: "http|https://weather.example.com|/v1/weather/{city}|GET",
  resourceUrl: "https://weather.example.com/v1/weather/{city}",
  origin: "https://weather.example.com",
  routeTemplate: "/v1/weather/{city}",
  method: "GET",
  x402Version: 2,
  serviceName: "Weather API",
  description: "Returns current conditions and forecasts.",
  tags: ["weather", "forecast"],
  mimeType: "application/json",
  bazaarExtension: {},
  extensions: {},
  inputSchema: {
    type: "object",
    properties: { city: { type: "string", description: "City name." } },
    required: ["city"],
  },
  inputExample: { city: "Mumbai" },
  outputType: "json",
  outputExample: { temperature: 29 },
  declarationHash: "hash",
  paymentOption: {
    optionHash: "option",
    x402Version: 2,
    scheme: "exact",
    network: "stellar:testnet",
    asset: "CUSDC",
    amount: "1000",
    payTo: "GSELLER",
    maxTimeoutSeconds: 60,
    extra: {},
  },
  softDropped: [],
};

describe("weighted search document compilation", () => {
  it("keeps the readable document while separating lexical priorities", () => {
    const compiled = compileSearchDocumentParts(candidate, [{
      scheme: "exact", network: "stellar:testnet", amount: "1000", asset: "CUSDC", payTo: "GSELLER",
    }]);

    expect(compiled.document).toContain("Service: Weather API");
    expect(compiled.document).toContain("- city (required): City name.");
    expect(compiled.document).toContain("Input.city: Mumbai");
    expect(compiled.lexicalHigh).toContain("Weather API");
    expect(compiled.lexicalHigh).toContain("/v1/weather/{city}");
    expect(compiled.lexicalMedium).toContain("Returns current conditions");
    expect(compiled.lexicalMedium).toContain("city");
    expect(compiled.lexicalLow).toContain("forecast");
    expect(compiled.lexicalLow).toContain("stellar:testnet");
    expect(compiled.lexicalLow).toContain("Mumbai");
  });
});

describe("safe search query parsing", () => {
  it("normalizes Unicode and whitespace without dropping identifiers", () => {
    expect(normalizeSearchQuery("  ＧＥＴ\u00a0weather\n/v1  ")).toBe("GET weather /v1");
    const query = buildSearchTsquery("GET weather /v1");
    expect(query).toContain("'get'");
    expect(query).toContain("'weather'");
    expect(query).toContain("'v1'");
  });

  it("combines phrase matching with token fallback and preserves numeric terms", () => {
    const query = buildSearchTsquery('"pay 1000 USDC" weather');
    expect(query).toContain("<->");
    expect(query).toContain("'1000'");
    expect(query).toContain("'usdc'");
    expect(describeSearchQuery("pay 1000 USDC weather")).toMatchObject({
      hasPhrase: true, hasNumericToken: true, hasIdentifier: false,
    });
  });

  it("turns empty and stopword-only input into a guaranteed no-match query", () => {
    expect(buildSearchTsquery("   ")).toBe("'x402zzzznomatch'");
    expect(buildSearchTsquery("the and for")).toBe("'x402zzzznomatch'");
    expect(describeSearchQuery("the and for").stopwordOnly).toBe(true);
  });

  it("does not allow tsquery operators or punctuation to cross the parameter boundary", () => {
    const query = buildSearchTsquery("weather:* | !payments; DROP TABLE catalog_resources");
    expect(query).not.toMatch(/[!:;]/);
    expect(query).toContain("'weather'");
    expect(query).toContain("'payments'");
    expect(query).toContain("'drop'");
  });
});
