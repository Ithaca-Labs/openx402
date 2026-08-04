import { validateDiscoveryExtension } from "@x402/extensions/bazaar";
import { describe, expect, it } from "vitest";
import { bazaar, createX402Seller, SellerConfigError, type X402SellerConfig } from "../src/index.js";

const PUBLIC_URL = "https://api.example.com";
const PAY_TO = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
const XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

function buildSeller(overrides: Record<string, unknown> = {}) {
  return createX402Seller({
    publicUrl: PUBLIC_URL,
    network: "stellar:testnet",
    payTo: PAY_TO,
    assets: { XLM: XLM_SAC },
    defaults: { scheme: "exact", maxTimeoutSeconds: 60, feesSponsored: true },
    ...overrides,
  } as X402SellerConfig);
}

describe("createX402Seller", () => {
  it("compiles a GET route to the exact manually assembled RouteConfig", () => {
    const seller = buildSeller();
    const weather = seller.get("/weather", {
      payment: { asset: "XLM", amount: "1000" },
      discovery: {
        name: "Weather API",
        description: "Returns current weather for a city.",
        tags: ["weather", "forecast"],
        query: {
          city: { type: "string", description: "City name.", required: true, example: "Mumbai" },
        },
        output: { description: "Current weather conditions.", example: { city: "Mumbai", temperature: 29 } },
      },
    });

    const manual = bazaar.http({
      method: "GET",
      description: "Returns current weather for a city.",
      serviceName: "Weather API",
      tags: ["weather", "forecast"],
      query: {
        city: { type: "string", description: "City name.", required: true, example: "Mumbai" },
      },
      output: { description: "Current weather conditions.", example: { city: "Mumbai", temperature: 29 } },
    });

    expect(weather.method).toBe("GET");
    expect(weather.path).toBe("/weather");
    expect(weather.routeKey).toBe("GET /weather");
    expect(weather.resourceUrl).toBe("https://api.example.com/weather");
    expect(JSON.stringify(weather.extensions)).toBe(JSON.stringify(manual.extensions));
    expect(weather.resource).toEqual(manual.resource);

    const routeConfig = weather.paymentConfig["GET /weather"];
    expect(routeConfig).toBeDefined();
    expect(routeConfig!.resource).toBe("https://api.example.com/weather");
    expect(routeConfig!.accepts).toEqual({
      scheme: "exact",
      payTo: PAY_TO,
      price: { asset: XLM_SAC, amount: "1000" },
      network: "stellar:testnet",
      maxTimeoutSeconds: 60,
      extra: { areFeesSponsored: true },
    });
    expect(validateDiscoveryExtension(routeConfig!.extensions!.bazaar as never).valid).toBe(true);
  });

  it("keys paymentConfig by exactly one \"METHOD /path\" entry, never a bare wildcard route", () => {
    const seller = buildSeller();
    const play = seller.post("/play", {
      payment: { asset: "XLM", amount: "1000" },
      discovery: {
        description: "Plays one round.",
        body: { move: { type: "string", required: true, example: "rock" } },
      },
    });
    expect(Object.keys(play.paymentConfig)).toEqual(["POST /play"]);
    expect("accepts" in play.paymentConfig).toBe(false);
  });

  it("allows a per-route override of network, payTo, scheme, maxTimeoutSeconds and feesSponsored", () => {
    const seller = buildSeller();
    const route = seller.get("/premium", {
      payment: {
        asset: "XLM",
        amount: "5000",
        network: "stellar:pubnet",
        payTo: "GBOTHERPAYEE",
        scheme: "upto",
        maxTimeoutSeconds: 120,
        feesSponsored: false,
      },
      discovery: { description: "premium" },
    });
    const accepts = route.paymentConfig["GET /premium"]!.accepts as {
      scheme: string; network: string; payTo: string; maxTimeoutSeconds?: number; extra?: Record<string, unknown>;
    };
    expect(accepts.scheme).toBe("upto");
    expect(accepts.network).toBe("stellar:pubnet");
    expect(accepts.payTo).toBe("GBOTHERPAYEE");
    expect(accepts.maxTimeoutSeconds).toBe(120);
    expect(accepts.extra).toEqual({ areFeesSponsored: false });
  });

  it("omits extra.areFeesSponsored entirely when never set at either level", () => {
    const seller = buildSeller({ defaults: { scheme: "exact" } });
    const route = seller.get("/plain", {
      payment: { asset: "XLM", amount: "100" },
      discovery: { description: "plain" },
    });
    const accepts = route.paymentConfig["GET /plain"]!.accepts as { extra?: Record<string, unknown> };
    expect(accepts.extra).toBeUndefined();
  });

  it("rejects an unknown asset alias", () => {
    const seller = buildSeller();
    expect(() => seller.get("/x", { payment: { asset: "DOGE", amount: "1" }, discovery: {} }))
      .toThrow(SellerConfigError);
  });

  it("rejects an empty, negative or non-integer amount", () => {
    const seller = buildSeller();
    expect(() => seller.get("/a", { payment: { asset: "XLM", amount: "" }, discovery: {} })).toThrow(SellerConfigError);
    expect(() => seller.get("/b", { payment: { asset: "XLM", amount: "-5" }, discovery: {} })).toThrow(SellerConfigError);
    expect(() => seller.get("/c", { payment: { asset: "XLM", amount: "1.5" }, discovery: {} })).toThrow(SellerConfigError);
  });

  it("rejects an invalid route path", () => {
    const seller = buildSeller();
    expect(() => seller.get("weather", { payment: { asset: "XLM", amount: "1" }, discovery: {} }))
      .toThrow(SellerConfigError);
    expect(() => seller.get("/weather/../admin", { payment: { asset: "XLM", amount: "1" }, discovery: {} }))
      .toThrow(SellerConfigError);
  });

  it("rejects an invalid publicUrl at seller construction", () => {
    expect(() => buildSeller({ publicUrl: "not-a-url" })).toThrow(SellerConfigError);
  });

  it("rejects a malformed network", () => {
    const seller = buildSeller();
    expect(() => seller.get("/x", {
      payment: { asset: "XLM", amount: "1", network: "not-caip2" as never },
      discovery: {},
    })).toThrow(SellerConfigError);
  });

  it("rejects a missing payTo when neither seller nor route provides one", () => {
    const seller = buildSeller({ payTo: undefined });
    expect(() => seller.get("/x", { payment: { asset: "XLM", amount: "1" }, discovery: {} }))
      .toThrow(SellerConfigError);
  });

  it("rejects a missing network when neither seller nor route provides one", () => {
    const seller = buildSeller({ network: undefined });
    expect(() => seller.get("/x", { payment: { asset: "XLM", amount: "1" }, discovery: {} }))
      .toThrow(SellerConfigError);
  });

  it("rejects an unsupported scheme", () => {
    const seller = buildSeller();
    expect(() => seller.get("/x", { payment: { asset: "XLM", amount: "1", scheme: "made-up" }, discovery: {} }))
      .toThrow(SellerConfigError);
  });

  it("rejects a conflicting duplicate route declaration", () => {
    const seller = buildSeller();
    seller.get("/dup", { payment: { asset: "XLM", amount: "1" }, discovery: {} });
    expect(() => seller.get("/dup", { payment: { asset: "XLM", amount: "1" }, discovery: {} }))
      .toThrow(SellerConfigError);
  });

  it("allows the same path under two different methods", () => {
    const seller = buildSeller();
    seller.get("/both", { payment: { asset: "XLM", amount: "1" }, discovery: {} });
    expect(() => seller.post("/both", { payment: { asset: "XLM", amount: "1" }, discovery: {} })).not.toThrow();
  });

  it("compiles query, body, path and header metadata identically to bazaar.http", () => {
    const seller = buildSeller();
    const route = seller.post("/search/:region", {
      payment: { asset: "XLM", amount: "10" },
      discovery: {
        description: "Search endpoint",
        path: { region: { type: "string", required: true, example: "us" } },
        body: { query: { type: "string", required: true, example: "x402" } },
        headers: { "x-tenant": { type: "string", example: "acme" } },
        output: { example: { results: [] } },
      },
    });
    const manual = bazaar.http({
      method: "POST",
      description: "Search endpoint",
      path: { region: { type: "string", required: true, example: "us" } },
      body: { query: { type: "string", required: true, example: "x402" } },
      headers: { "x-tenant": { type: "string", example: "acme" } },
      output: { example: { results: [] } },
    });
    expect(JSON.stringify(route.extensions)).toBe(JSON.stringify(manual.extensions));
  });

  it("accepts a compiled input schema (e.g. from fromZod) in place of a ParameterMap", () => {
    const seller = buildSeller();
    const route = seller.post("/typed", {
      payment: { asset: "XLM", amount: "1" },
      discovery: {
        body: {
          schema: { properties: { city: { type: "string", description: "City." } }, required: ["city"] },
          example: { city: "Mumbai" },
        },
      },
    });
    const info = route.extensions.bazaar.info as { input: Record<string, unknown> };
    expect(info.input.body).toEqual({ city: "Mumbai" });
    expect(validateDiscoveryExtension(route.extensions.bazaar).valid).toBe(true);
  });
});

describe("createX402Seller.tool", () => {
  it("compiles an MCP tool with a resolved payment option", () => {
    const seller = buildSeller();
    const tool = seller.tool("financial_analysis", {
      path: "/mcp",
      payment: { asset: "XLM", amount: "5000", scheme: "upto" },
      discovery: {
        description: "Analyzes a public company.",
        inputSchema: {
          type: "object",
          properties: { ticker: { type: "string" } },
          required: ["ticker"],
        },
        example: { ticker: "AAPL" },
        output: { example: { summary: "ok" } },
      },
    });
    expect(tool.toolName).toBe("financial_analysis");
    expect(tool.resourceUrl).toBe("https://api.example.com/mcp");
    expect(tool.paymentOption).toEqual({
      scheme: "upto",
      network: "stellar:testnet",
      asset: XLM_SAC,
      amount: "5000",
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
      extra: { areFeesSponsored: true },
    });
  });

  it("requires maxTimeoutSeconds to be resolvable for an MCP tool", () => {
    const seller = buildSeller({ defaults: { scheme: "exact", feesSponsored: true } });
    expect(() => seller.tool("t", {
      path: "/mcp",
      payment: { asset: "XLM", amount: "1" },
      discovery: { inputSchema: { type: "object", properties: {} } },
    })).toThrow(SellerConfigError);
  });

  it("rejects a duplicate tool at the same path", () => {
    const seller = buildSeller();
    const config = {
      path: "/mcp",
      payment: { asset: "XLM", amount: "1" },
      discovery: { inputSchema: { type: "object", properties: {} } },
    };
    seller.tool("dup", config);
    expect(() => seller.tool("dup", config)).toThrow(SellerConfigError);
  });
});
