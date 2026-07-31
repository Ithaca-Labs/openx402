import { describe, expect, it } from "vitest";
import { extractCandidate, normalizeResourceUrl } from "../../src/bazaar/extract.js";
import { jsonDepth, sanitizeText } from "../../src/bazaar/sanitize.js";
import {
  catalogConfig, mcpMetadata, payload, requirements, weatherMetadata,
} from "../helpers/bazaar.js";

function extract(options: Parameters<typeof payload>[0] = {}, config = catalogConfig()) {
  return extractCandidate(payload(options), requirements(), config);
}

describe("bazaar candidate extraction", () => {
  it("accepts the official valid vector produced by the seller SDK", () => {
    const result = extract();
    expect(result.kind).toBe("candidate");
    if (result.kind !== "candidate") return;
    expect(result.candidate.type).toBe("http");
    expect(result.candidate.resourceUrl).toBe("https://api.example.com/weather");
    expect(result.candidate.method).toBe("GET");
    expect(result.candidate.description).toBe("Returns the current weather for a city.");
    expect(result.candidate.serviceName).toBe("Weather API");
    expect(result.candidate.tags).toEqual(["weather", "forecast"]);
    expect(result.candidate.iconUrl).toBe("https://api.example.com/icon.png");
    expect(result.candidate.softDropped).toEqual([]);
    expect(result.candidate.paymentOption.payTo).toBe(requirements().payTo);
  });

  it("reports no cataloging when the payload carries no bazaar extension", () => {
    const value = payload();
    delete (value.extensions as Record<string, unknown>).bazaar;
    expect(extractCandidate(value, requirements(), catalogConfig()).kind).toBe("absent");
  });

  it("rejects info that does not validate against its own schema", () => {
    const broken = structuredClone(weatherMetadata().extensions.bazaar) as unknown as Record<string, unknown>;
    (broken.info as Record<string, Record<string, unknown>>).input!.method = "TRACE";
    const result = extract({ extensionOverride: broken });
    expect(result).toMatchObject({ kind: "rejected", code: "spec_validation_failed" });
  });

  it("rejects an info/schema mismatch even when the spec shape is legal", () => {
    const broken = structuredClone(weatherMetadata().extensions.bazaar) as unknown as Record<string, unknown>;
    delete (broken.info as Record<string, Record<string, unknown>>).input!.method;
    const result = extract({ extensionOverride: broken });
    expect(result).toMatchObject({ kind: "rejected", code: "schema_validation_failed" });
  });

  it("rejects a non-object bazaar extension", () => {
    expect(extract({ extensionOverride: "poison" })).toMatchObject({
      kind: "rejected", code: "bazaar_extension_not_an_object",
    });
  });

  describe("size limits", () => {
    it("rejects metadata over the byte limit", () => {
      expect(extract({}, catalogConfig({ maxMetadataBytes: 100 })))
        .toMatchObject({ kind: "rejected", code: "metadata_too_large" });
    });

    it("rejects metadata over the depth limit", () => {
      const deep = structuredClone(weatherMetadata().extensions.bazaar) as unknown as Record<string, unknown>;
      let node: Record<string, unknown> = deep;
      for (let index = 0; index < 40; index += 1) {
        node.nested = {};
        node = node.nested as Record<string, unknown>;
      }
      expect(extract({ extensionOverride: deep })).toMatchObject({
        kind: "rejected", code: "metadata_too_deep",
      });
    });

    it("rejects an oversized declared schema", () => {
      expect(extract({}, catalogConfig({ maxSchemaBytes: 50 })))
        .toMatchObject({ kind: "rejected", code: "schema_too_large" });
    });

    it("rejects an oversized declared example", () => {
      expect(extract({}, catalogConfig({ maxExampleBytes: 5 })))
        .toMatchObject({ kind: "rejected", code: "example_too_large" });
    });

    it("truncates an over-long description instead of rejecting the payment metadata", () => {
      const result = extract(
        { resourceOverride: { description: "x".repeat(9_000) } },
        catalogConfig({ maxDescriptionLength: 100 }),
      );
      expect(result.kind).toBe("candidate");
      if (result.kind !== "candidate") return;
      expect(result.candidate.description).toHaveLength(100);
    });
  });

  describe("route templates", () => {
    it("uses a valid template as the catalog key", () => {
      const result = extract({ url: "https://api.example.com/users/123", routeTemplate: "/users/:userId" });
      expect(result.kind).toBe("candidate");
      if (result.kind !== "candidate") return;
      expect(result.candidate.resourceUrl).toBe("https://api.example.com/users/:userId");
      expect(result.candidate.resourceKey).toBe("http|https://api.example.com|/users/:userId|GET");
    });

    it.each([
      ["/users/../admin", "plain traversal"],
      ["/users/%2e%2e/admin", "percent-encoded traversal"],
      ["/users/%2E%2E/admin", "upper-case percent-encoded traversal"],
      ["users/123", "missing leading slash"],
      ["/users/http://evil", "url injection"],
      ["/path with spaces", "invalid characters"],
      ["/users/..hidden", "traversal substring"],
    ])("soft-drops %s (%s) and falls back to the concrete path", template => {
      const result = extract({ url: "https://api.example.com/users/123", routeTemplate: template });
      expect(result.kind).toBe("candidate");
      if (result.kind !== "candidate") return;
      expect(result.candidate.routeTemplate).toBeUndefined();
      expect(result.candidate.softDropped).toContain("routeTemplate");
      expect(result.candidate.resourceUrl).toBe("https://api.example.com/users/123");
    });

    it("soft-drops a template longer than the configured maximum", () => {
      const result = extract(
        { url: "https://api.example.com/users/123", routeTemplate: `/${"a".repeat(600)}` },
        catalogConfig({ maxRouteTemplateLength: 64 }),
      );
      expect(result.kind).toBe("candidate");
      if (result.kind !== "candidate") return;
      expect(result.candidate.softDropped).toContain("routeTemplate");
    });
  });

  describe("resource urls", () => {
    it.each([
      ["ftp://api.example.com/x", "unsupported_url_scheme"],
      ["javascript:alert(1)", "unsupported_url_scheme"],
      ["https://user:pass@api.example.com/x", "url_credentials_present"],
      ["not-a-url", "invalid_resource_url"],
      ["", "missing_resource_url"],
    ])("rejects %s", (url, code) => {
      expect(extract({ url })).toMatchObject({ kind: "rejected", code });
    });

    it("rejects a loopback origin unless local origins are explicitly allowed", () => {
      expect(extract({ url: "http://localhost:4021/weather" }))
        .toMatchObject({ kind: "rejected", code: "local_resource_origin" });
      const allowed = extract(
        { url: "http://localhost:4021/weather" },
        catalogConfig({ allowLocalOrigins: true }),
      );
      expect(allowed.kind).toBe("candidate");
    });

    it("rejects a plain http public origin when https is required", () => {
      expect(extract({ url: "http://api.example.com/weather" }))
        .toMatchObject({ kind: "rejected", code: "insecure_resource_origin" });
    });

    it("normalizes case, default ports, query strings and fragments", () => {
      const normalized = normalizeResourceUrl("https://API.Example.com:443/weather?city=x#top");
      expect(normalized).toMatchObject({
        origin: "https://api.example.com",
        pathname: "/weather",
        canonical: "https://api.example.com/weather",
      });
    });
  });

  describe("icon urls", () => {
    it.each([
      "data:image/png;base64,iVBOR",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "http://127.0.0.1/icon.png",
      "http://2130706433/icon.png",
      "http://0x7f000001/icon.png",
      "http://localhost/icon.png",
      "http://ip6-localhost/icon.png",
      "http://ｌｏｃａｌｈｏｓｔ/icon.png",
      "https://user@example.com/icon.png",
      "/icon.png",
    ])("soft-drops the dangerous icon url %s", iconUrl => {
      const result = extract({ resourceOverride: { iconUrl } });
      expect(result.kind).toBe("candidate");
      if (result.kind !== "candidate") return;
      expect(result.candidate.iconUrl).toBeUndefined();
      expect(result.candidate.softDropped).toContain("iconUrl");
    });
  });

  describe("service metadata soft-drop rules", () => {
    it("drops an over-long service name but keeps valid tags", () => {
      const result = extract({ resourceOverride: { serviceName: "a".repeat(33), tags: ["weather"] } });
      expect(result.kind).toBe("candidate");
      if (result.kind !== "candidate") return;
      expect(result.candidate.serviceName).toBeUndefined();
      expect(result.candidate.tags).toEqual(["weather"]);
      expect(result.candidate.softDropped).toEqual(["serviceName"]);
    });

    it("drops non-ASCII tags, dedupes case-insensitively and caps at five", () => {
      const result = extract({
        resourceOverride: { tags: ["Weather", "weather", "café", "a", "b", "c", "d", "e"] },
      });
      expect(result.kind).toBe("candidate");
      if (result.kind !== "candidate") return;
      expect(result.candidate.tags).toEqual(["Weather", "a", "b", "c", "d"]);
    });

    it("strips control and bidi characters from displayed text", () => {
      expect(sanitizeText("we ather‮ forecast", 100)).toBe("weather forecast");
    });
  });

  describe("mcp identity", () => {
    it("keys an MCP tool on the (resource.url, toolName) tuple", () => {
      const first = extractCandidate(
        payload({ url: "https://api.example.com/mcp", metadata: mcpMetadata("financial_analysis") }),
        requirements(), catalogConfig(),
      );
      const second = extractCandidate(
        payload({ url: "https://api.example.com/mcp", metadata: mcpMetadata("sentiment") }),
        requirements(), catalogConfig(),
      );
      expect(first.kind).toBe("candidate");
      expect(second.kind).toBe("candidate");
      if (first.kind !== "candidate" || second.kind !== "candidate") return;
      expect(first.candidate.resourceKey).toBe("mcp|https://api.example.com/mcp|financial_analysis");
      expect(second.candidate.resourceKey).toBe("mcp|https://api.example.com/mcp|sentiment");
      expect(first.candidate.resourceKey).not.toBe(second.candidate.resourceKey);
      expect(first.candidate.toolName).toBe("financial_analysis");
      expect(first.candidate.transport).toBe("streamable-http");
    });
  });

  it("produces a stable declaration hash for an identical declaration", () => {
    const first = extract();
    const second = extract();
    if (first.kind !== "candidate" || second.kind !== "candidate") throw new Error("expected candidates");
    expect(first.candidate.declarationHash).toBe(second.candidate.declarationHash);
  });

  it("produces a different declaration hash when the description changes", () => {
    const first = extract();
    const second = extract({ resourceOverride: { description: "Something else." } });
    if (first.kind !== "candidate" || second.kind !== "candidate") throw new Error("expected candidates");
    expect(first.candidate.declarationHash).not.toBe(second.candidate.declarationHash);
  });

  it("bounds json depth measurement", () => {
    expect(jsonDepth({ a: { b: { c: 1 } } }, 32)).toBe(4);
    expect(jsonDepth(1, 32)).toBe(1);
  });
});
