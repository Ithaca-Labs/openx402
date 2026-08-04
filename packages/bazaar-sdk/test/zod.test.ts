import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDiscoveryExtension } from "@x402/extensions/bazaar";
import { z } from "zod/v4";
import { describe, expect, it } from "vitest";
import { bazaar } from "../src/index.js";
import { fromZod, ZodAdapterError } from "../src/zod.js";

const query = z.object({
  city: z.string().describe("City name, such as Mumbai or London."),
  units: z.enum(["celsius", "fahrenheit"]).describe("Temperature units.").optional(),
});

describe("fromZod", () => {
  it("preserves descriptions, enums and required/optional status", () => {
    const compiled = fromZod(query, { example: { city: "Mumbai", units: "celsius" } });
    expect(compiled.schema.properties.city).toMatchObject({
      type: "string",
      description: "City name, such as Mumbai or London.",
    });
    expect(compiled.schema.properties.units).toMatchObject({
      description: "Temperature units.",
      enum: ["celsius", "fahrenheit"],
    });
    expect(compiled.schema.required).toEqual(["city"]);
    expect(compiled.example).toEqual({ city: "Mumbai", units: "celsius" });
  });

  it("preserves nested objects", () => {
    const nested = z.object({
      address: z.object({
        city: z.string().describe("City."),
        zip: z.string().describe("Postal code.").optional(),
      }).describe("Shipping address."),
    });
    const compiled = fromZod(nested);
    const address = compiled.schema.properties.address as { properties: Record<string, unknown>; required?: string[] };
    expect(address.properties.city).toMatchObject({ type: "string", description: "City." });
    expect(address.required).toEqual(["city"]);
  });

  it("validates the example against the schema when provided", () => {
    expect(() => fromZod(query, { example: { units: "kelvin" } })).toThrow(ZodAdapterError);
  });

  it("omits example entirely when not provided", () => {
    const compiled = fromZod(query);
    expect(compiled.example).toBeUndefined();
  });

  it("requires an object schema", () => {
    expect(() => fromZod(z.string())).toThrow(ZodAdapterError);
  });

  it("produces output that still passes official Bazaar validation end to end through bazaar.http", () => {
    const metadata = bazaar.http({
      method: "GET",
      description: "Returns the current weather for a city.",
      query: fromZod(query, { example: { city: "Mumbai", units: "celsius" } }),
    });
    expect(validateDiscoveryExtension(metadata.extensions.bazaar).valid).toBe(true);
    const info = metadata.extensions.bazaar.info as { input: Record<string, unknown> };
    expect(info.input.queryParams).toEqual({ city: "Mumbai", units: "celsius" });
  });
});

describe("root package independence from optional peers", () => {
  it("never reaches an import of zod, @x402/stellar or @stellar/stellar-sdk from the root src/index.ts module graph", () => {
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    const excluded = new Set(["zod.ts", "stellar.ts"]);
    const visited = new Set<string>();
    const stack = ["index.ts"];

    while (stack.length > 0) {
      const relative = stack.pop()!;
      if (visited.has(relative) || excluded.has(relative.split("/").pop()!)) continue;
      visited.add(relative);

      const contents = readFileSync(join(srcDir, relative), "utf8");
      expect(contents).not.toMatch(/from\s+["']zod/);
      expect(contents).not.toMatch(/from\s+["']@x402\/stellar/);
      expect(contents).not.toMatch(/from\s+["']@stellar\/stellar-sdk/);

      for (const match of contents.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
        const importPath = match[1]!;
        const resolved = importPath.endsWith(".js")
          ? importPath.slice(0, -3) + ".ts"
          : `${importPath}.ts`;
        const normalized = join(dirname(relative), resolved).replace(/\\/g, "/");
        stack.push(normalized);
      }
    }

    // Sanity check: the walk actually traversed the seller subtree, not just index.ts.
    const files = new Set([...visited]);
    expect(files.has("seller/seller.ts")).toBe(true);
  });

  it("lists every source file in src/ so the independence check above cannot silently go stale", () => {
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    const files = readdirSync(srcDir, { recursive: true }) as string[];
    expect(files.some(f => f === "zod.ts")).toBe(true);
    expect(files.some(f => f === "stellar.ts")).toBe(true);
  });
});
