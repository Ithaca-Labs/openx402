import {
  isValidIconUrl,
  isValidServiceName,
  sanitizeTags,
} from "@x402/extensions/bazaar";
import { isCompiledInputSchema } from "./types.js";
import type {
  CompiledInputSchema, HttpMetadataConfig, McpMetadataConfig, ParameterConfig, ParameterMap, ServiceMetadataConfig,
} from "./types.js";

export class BazaarConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`invalid bazaar metadata configuration:\n- ${issues.join("\n- ")}`);
    this.name = "BazaarConfigError";
  }
}

const QUERY_METHODS = new Set(["GET", "HEAD", "DELETE"]);
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
const PARAMETER_TYPES = new Set(["string", "number", "integer", "boolean", "object", "array"]);
const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/**
 * Runtime validation of the seller's configuration.
 *
 * These are the same rules the facilitator applies when cataloging, so a seller
 * finds out at startup rather than after their first paid request is dropped.
 */
export function validateServiceMetadata(config: ServiceMetadataConfig, issues: string[]): void {
  if (config.serviceName !== undefined && !isValidServiceName(config.serviceName)) {
    issues.push("serviceName must be 1-32 printable ASCII characters");
  }
  if (config.tags !== undefined) {
    if (!Array.isArray(config.tags)) issues.push("tags must be an array of strings");
    else {
      const sanitized = sanitizeTags(config.tags);
      if ((sanitized?.length ?? 0) !== config.tags.length) {
        issues.push("tags must be at most 5 unique entries of 1-32 printable ASCII characters");
      }
    }
  }
  if (config.iconUrl !== undefined && !isValidIconUrl(config.iconUrl)) {
    issues.push("iconUrl must be an absolute http(s) URL to a public host");
  }
  if (config.description !== undefined && config.description.trim().length === 0) {
    issues.push("description must not be blank when provided");
  }
  if (config.mimeType !== undefined && !/^[\w.+-]+\/[\w.+-]+$/.test(config.mimeType)) {
    issues.push("mimeType must look like `type/subtype`");
  }
}

function validateParameters(
  label: string,
  map: ParameterMap | CompiledInputSchema | undefined,
  issues: string[],
): void {
  if (map === undefined) return;
  // A pre-compiled schema (e.g. from `fromZod`) is validated by its own adapter; this
  // helper only understands the readable `ParameterMap` shape.
  if (isCompiledInputSchema(map)) return;
  for (const [name, parameter] of Object.entries(map)) {
    if (!PARAMETER_NAME.test(name)) {
      issues.push(`${label}.${name}: parameter names must match ${PARAMETER_NAME.source}`);
    }
    validateParameter(`${label}.${name}`, parameter, issues);
  }
}

function validateParameter(label: string, parameter: ParameterConfig, issues: string[]): void {
  if (!parameter || typeof parameter !== "object") {
    issues.push(`${label}: must be a parameter object`);
    return;
  }
  if (!PARAMETER_TYPES.has(parameter.type)) {
    issues.push(`${label}.type must be one of ${[...PARAMETER_TYPES].join(", ")}`);
  }
  if (parameter.enum !== undefined) {
    if (!Array.isArray(parameter.enum) || parameter.enum.length === 0) {
      issues.push(`${label}.enum must be a non-empty array`);
    } else if (parameter.example !== undefined && !parameter.enum.includes(parameter.example as never)) {
      issues.push(`${label}.example must be one of the declared enum values`);
    }
  }
  if (parameter.type === "array" && parameter.items !== undefined && typeof parameter.items !== "object") {
    issues.push(`${label}.items must be a JSON Schema object`);
  }
  if (parameter.properties !== undefined) {
    validateParameters(label, parameter.properties, issues);
  }
}

export function validateHttpConfig(config: HttpMetadataConfig): void {
  const issues: string[] = [];
  validateServiceMetadata(config, issues);
  if (!QUERY_METHODS.has(config.method) && !BODY_METHODS.has(config.method)) {
    issues.push("method must be one of GET, HEAD, DELETE, POST, PUT, PATCH");
  }
  if (config.body !== undefined && !BODY_METHODS.has(config.method)) {
    issues.push(`body is only valid for POST, PUT and PATCH, not ${config.method}`);
  }
  if (config.bodyType !== undefined && config.body === undefined) {
    issues.push("bodyType requires body");
  }
  if (config.bodyType !== undefined && !["json", "form-data", "text"].includes(config.bodyType)) {
    issues.push("bodyType must be json, form-data or text");
  }
  validateParameters("query", config.query, issues);
  validateParameters("path", config.path, issues);
  validateParameters("body", config.body, issues);
  validateParameters("headers", config.headers, issues);
  if (config.headers !== undefined) {
    for (const [name, parameter] of Object.entries(config.headers)) {
      if (parameter.type !== "string") issues.push(`headers.${name}.type must be string`);
    }
  }
  if (issues.length > 0) throw new BazaarConfigError(issues);
}

export function validateMcpConfig(config: McpMetadataConfig): void {
  const issues: string[] = [];
  validateServiceMetadata(config, issues);
  if (typeof config.toolName !== "string" || config.toolName.length === 0) {
    issues.push("toolName is required and must be a non-empty string");
  }
  if (!config.inputSchema || typeof config.inputSchema !== "object" || Array.isArray(config.inputSchema)) {
    issues.push("inputSchema is required and must be a JSON Schema object");
  } else if (config.inputSchema.type !== undefined && config.inputSchema.type !== "object") {
    issues.push("inputSchema.type must be \"object\" for an MCP tool");
  }
  if (config.transport !== undefined && !["streamable-http", "sse"].includes(config.transport)) {
    issues.push("transport must be streamable-http or sse");
  }
  if (config.example !== undefined && (typeof config.example !== "object" || Array.isArray(config.example))) {
    issues.push("example must be an arguments object");
  }
  if (issues.length > 0) throw new BazaarConfigError(issues);
}
