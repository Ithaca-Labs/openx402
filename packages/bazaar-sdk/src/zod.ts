/**
 * Optional Zod adapter, imported from `@openx402/bazaar-sdk/zod`.
 *
 * The root `@openx402/bazaar-sdk` entry point never imports this file, so installing
 * `@openx402/bazaar-sdk` alone works without Zod present. This adapter requires Zod 4
 * (or the Zod 4 preview shipped under the `zod/v4` subpath of Zod 3.25+): it uses
 * `toJSONSchema`, which does not exist on Zod 3's classic API. Build your schema with
 * `import { z } from "zod/v4"` (Zod 3.25–3.x) or `import { z } from "zod"` (Zod ^4.0.0).
 */
import { toJSONSchema, type ZodType } from "zod/v4";
import type { CompiledInputSchema } from "./types.js";

export class ZodAdapterError extends Error {
  constructor(readonly issues: string[]) {
    super(`invalid zod schema for bazaar.fromZod:\n- ${issues.join("\n- ")}`);
    this.name = "ZodAdapterError";
  }
}

export interface FromZodOptions {
  /** Concrete example arguments, validated against `schema` when provided. */
  example?: unknown;
}

/**
 * Compiles a Zod object schema into the `CompiledInputSchema` shape `seller.get`,
 * `seller.post` and `bazaar.http` accept for `query`/`body`, reusing `.describe()`,
 * enums, optional/required status and nested objects exactly as Zod already declares
 * them, so the same schema a seller uses for request validation also drives Bazaar
 * discovery.
 */
export function fromZod(schema: ZodType, options: FromZodOptions = {}): CompiledInputSchema {
  const jsonSchema = toJSONSchema(schema, { target: "draft-2020-12" }) as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };

  if (jsonSchema.type !== "object" || jsonSchema.properties === undefined) {
    throw new ZodAdapterError(["fromZod requires an object schema, e.g. z.object({ ... })"]);
  }

  if (options.example !== undefined) {
    const result = schema.safeParse(options.example);
    if (!result.success) {
      const issues = result.error.issues.map(issue => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
      throw new ZodAdapterError(issues);
    }
  }

  return {
    schema: {
      properties: jsonSchema.properties,
      ...(jsonSchema.required && jsonSchema.required.length > 0 ? { required: jsonSchema.required } : {}),
    },
    ...(options.example !== undefined ? { example: options.example } : {}),
  };
}
