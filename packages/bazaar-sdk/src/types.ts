import type { DiscoveryExtension } from "@x402/extensions/bazaar";

/** JSON Schema primitive types a seller can declare for a parameter. */
export type ParameterType = "string" | "number" | "integer" | "boolean" | "object" | "array";

/** One readable parameter declaration. Compiles to JSON Schema plus an example. */
export interface ParameterConfig {
  type: ParameterType;
  /** Human description. Ends up in the generated JSON Schema, never invented. */
  description?: string;
  required?: boolean;
  enum?: Array<string | number | boolean>;
  /** Concrete example value echoed into the declared `queryParams`/`body`. */
  example?: unknown;
  format?: string;
  /** For `type: "array"`, the schema of each item. */
  items?: Record<string, unknown>;
  /** For `type: "object"`, nested properties. */
  properties?: Record<string, ParameterConfig>;
  default?: unknown;
}

export type ParameterMap = Record<string, ParameterConfig>;

/**
 * A JSON Schema fragment plus an example, already compiled by an adapter such as
 * `fromZod`. Accepted anywhere a `ParameterMap` is accepted for `query`/`body`, so a
 * seller who already has a validation schema never describes the same input twice.
 */
export interface CompiledInputSchema {
  schema: { properties: Record<string, unknown>; required?: string[] };
  example?: unknown;
}

export function isCompiledInputSchema(
  value: ParameterMap | CompiledInputSchema | undefined,
): value is CompiledInputSchema {
  return value !== undefined && "schema" in value;
}

export interface OutputConfig {
  /** Response content type, for example `json` or `text`. Defaults to `json`. */
  type?: string;
  description?: string;
  /** Explicit JSON Schema for the response; generated from `example` if omitted. */
  schema?: Record<string, unknown>;
  example?: unknown;
}

/** Service-level metadata that lives on the top-level `resource` object. */
export interface ServiceMetadataConfig {
  description?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
  mimeType?: string;
}

export type QueryMethod = "GET" | "HEAD" | "DELETE";
export type BodyMethod = "POST" | "PUT" | "PATCH";
export type HttpMethod = QueryMethod | BodyMethod;

export interface HttpMetadataConfig extends ServiceMetadataConfig {
  method: HttpMethod;
  /** Query-string parameters, or a pre-compiled schema from an adapter such as `fromZod`. */
  query?: ParameterMap | CompiledInputSchema;
  /** Path parameters of a dynamic route such as `/users/:userId`. */
  path?: ParameterMap;
  /** Request body fields, or a pre-compiled schema from an adapter such as `fromZod`. Only valid for POST, PUT and PATCH. */
  body?: ParameterMap | CompiledInputSchema;
  /** Body encoding. Defaults to `json` when `body` is present. */
  bodyType?: "json" | "form-data" | "text";
  /** Custom request headers the caller must send. */
  headers?: ParameterMap;
  output?: OutputConfig;
}

export interface McpMetadataConfig extends ServiceMetadataConfig {
  toolName: string;
  /** Tool description. Stays in `info.input.description` per the official shape. */
  description?: string;
  transport?: "streamable-http" | "sse";
  /**
   * The tool's existing MCP `inputSchema`, reused unchanged. Parameter
   * descriptions stay in `inputSchema.properties.<name>.description`; this
   * helper never maintains a second schema language.
   */
  inputSchema: Record<string, unknown>;
  example?: Record<string, unknown>;
  output?: OutputConfig;
}

/** The compiled, official-format result. */
export interface BazaarMetadata {
  /** Merge into the top-level `resource` object of the 402 response. */
  resource: ServiceMetadataConfig;
  /** Merge into the `extensions` object of the 402 response. */
  extensions: { bazaar: DiscoveryExtension };
  /** Canonical object for snapshots and framework adapters. */
  compile(): { resource: ServiceMetadataConfig; extensions: { bazaar: DiscoveryExtension } };
}
