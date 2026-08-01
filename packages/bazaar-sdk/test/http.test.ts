import { declareDiscoveryExtension, validateDiscoveryExtension } from "@x402/extensions/bazaar";
import { describe, expect, it } from "vitest";
import { bazaar, BazaarConfigError } from "../src/index.js";

describe("bazaar.http", () => {
  it("compiles readable query configuration into the official GET wire structure", () => {
    const metadata = bazaar.http({
      description: "Returns the current weather for a city.",
      serviceName: "Weather API",
      tags: ["weather", "forecast"],
      iconUrl: "https://api.example.com/icon.png",
      method: "GET",
      query: {
        city: {
          type: "string",
          description: "The city to look up, such as Mumbai or London.",
          required: true,
          example: "Mumbai",
        },
        units: {
          type: "string",
          description: "Temperature units.",
          enum: ["celsius", "fahrenheit"],
          required: false,
          example: "celsius",
        },
      },
      output: {
        type: "json",
        example: { city: "Mumbai", temperature: 29, condition: "Sunny" },
      },
    });

    expect(metadata.resource).toEqual({
      description: "Returns the current weather for a city.",
      serviceName: "Weather API",
      tags: ["weather", "forecast"],
      iconUrl: "https://api.example.com/icon.png",
    });

    // Byte-structural compatibility: identical to what the official builder
    // produces for the equivalent official configuration.
    const official = declareDiscoveryExtension({
      method: "GET",
      input: { city: "Mumbai", units: "celsius" },
      inputSchema: {
        properties: {
          city: { type: "string", description: "The city to look up, such as Mumbai or London." },
          units: {
            type: "string",
            description: "Temperature units.",
            enum: ["celsius", "fahrenheit"],
          },
        },
        required: ["city"],
      },
      output: { example: { city: "Mumbai", temperature: 29, condition: "Sunny" } },
    } as Parameters<typeof declareDiscoveryExtension>[0]);

    expect(metadata.extensions).toEqual(official);
    expect(JSON.stringify(metadata.extensions)).toBe(JSON.stringify(official));
    expect(validateDiscoveryExtension(metadata.extensions.bazaar).valid).toBe(true);
  });

  it("matches the official body structure for POST", () => {
    const metadata = bazaar.http({
      description: "Search endpoint",
      method: "POST",
      body: {
        query: { type: "string", description: "Search terms.", required: true, example: "x402" },
        limit: { type: "integer", description: "Maximum results.", example: 10 },
      },
      output: { example: { results: [] } },
    });

    const official = declareDiscoveryExtension({
      method: "POST",
      bodyType: "json",
      input: { query: "x402", limit: 10 },
      inputSchema: {
        properties: {
          query: { type: "string", description: "Search terms." },
          limit: { type: "integer", description: "Maximum results." },
        },
        required: ["query"],
      },
      output: { example: { results: [] } },
    } as Parameters<typeof declareDiscoveryExtension>[0]);

    expect(JSON.stringify(metadata.extensions)).toBe(JSON.stringify(official));
    const info = metadata.extensions.bazaar.info as { input: Record<string, unknown> };
    expect(info.input.bodyType).toBe("json");
    expect(info.input.body).toEqual({ query: "x402", limit: 10 });
  });

  it("emits path parameters in the official pathParams slots", () => {
    const metadata = bazaar.http({
      method: "GET",
      path: { userId: { type: "string", description: "User id.", required: true, example: "123" } },
    });
    const official = declareDiscoveryExtension({
      method: "GET",
      pathParams: { userId: "123" },
      pathParamsSchema: {
        properties: { userId: { type: "string", description: "User id." } },
        required: ["userId"],
      },
    } as Parameters<typeof declareDiscoveryExtension>[0]);
    expect(JSON.stringify(metadata.extensions)).toBe(JSON.stringify(official));
  });

  it("declares headers in both info and schema so the extension stays valid", () => {
    const metadata = bazaar.http({
      method: "GET",
      query: { city: { type: "string", required: true, example: "Mumbai" } },
      headers: { "x-tenant": { type: "string", description: "Tenant id.", example: "acme" } },
    });
    const extension = metadata.extensions.bazaar as unknown as {
      info: { input: Record<string, unknown> };
      schema: { properties: { input: { properties: Record<string, unknown> } } };
    };
    expect(extension.info.input.headers).toEqual({ "x-tenant": "acme" });
    expect(extension.schema.properties.input.properties.headers).toEqual({
      type: "object",
      additionalProperties: { type: "string" },
    });
    expect(validateDiscoveryExtension(metadata.extensions.bazaar).valid).toBe(true);
  });

  it("carries a non-json output type and an output description in official positions", () => {
    const metadata = bazaar.http({
      method: "GET",
      output: { type: "text", description: "Plain text forecast.", example: { text: "sunny" } },
    });
    const extension = metadata.extensions.bazaar as unknown as {
      info: { output: Record<string, unknown> };
      schema: { properties: { output: Record<string, unknown> } };
    };
    expect(extension.info.output.type).toBe("text");
    expect(extension.schema.properties.output.description).toBe("Plain text forecast.");
    expect(validateDiscoveryExtension(metadata.extensions.bazaar).valid).toBe(true);
  });

  it("still produces a valid extension when only an output schema is declared", () => {
    const metadata = bazaar.http({
      method: "GET",
      output: { description: "Structured forecast.", schema: { properties: { temp: { type: "number" } } } },
    });
    expect(validateDiscoveryExtension(metadata.extensions.bazaar).valid).toBe(true);
  });

  it("compile() returns the same canonical object", () => {
    const metadata = bazaar.http({ method: "GET", query: { a: { type: "string", example: "b" } } });
    expect(metadata.compile()).toEqual({ resource: metadata.resource, extensions: metadata.extensions });
  });

  it("rejects configurations the facilitator would drop", () => {
    expect(() => bazaar.http({ method: "GET", body: { a: { type: "string" } } })).toThrow(BazaarConfigError);
    expect(() => bazaar.http({ method: "GET", serviceName: "a".repeat(33) })).toThrow(BazaarConfigError);
    expect(() => bazaar.http({ method: "GET", iconUrl: "data:image/png;base64,iVBOR" })).toThrow(BazaarConfigError);
    expect(() => bazaar.http({ method: "GET", tags: ["a", "a"] })).toThrow(BazaarConfigError);
    expect(() => bazaar.http({
      method: "GET",
      query: { units: { type: "string", enum: ["celsius"], example: "kelvin" } },
    })).toThrow(BazaarConfigError);
  });
});
