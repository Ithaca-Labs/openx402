import type { CanonicalResource, ResourceIdentity, WrappedResource } from "../types.js";
import { FacilitatorClient } from "../facilitatorClient.js";
import { encodeResourceRef, computeVersionHash } from "../resourceRef.js";
import { bazaarToolName } from "../bazaarExtension.js";
import { McpToolError } from "../errors.js";

export interface SearchResourcesInput {
  query?: string | undefined;
  type?: "http" | "mcp" | undefined;
  network?: string | undefined;
  scheme?: string | undefined;
  payTo?: string | undefined;
  asset?: string | undefined;
  extensions?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface SearchResourcesOutput {
  x402Version: number;
  resources: WrappedResource[];
  partialResults: boolean;
  pagination: { limit: number; cursor: string | null };
}

function identityOf(resource: CanonicalResource): ResourceIdentity {
  if (resource.type === "mcp") {
    const toolName = bazaarToolName(resource);
    if (!toolName) throw new McpToolError("UPSTREAM_PROTOCOL_ERROR", `catalog returned an MCP resource with no toolName: ${resource.resource}`);
    return { type: "mcp", url: resource.resource, toolName };
  }
  return { type: "http", url: resource.resource };
}

export function wrapResource(resource: CanonicalResource): WrappedResource {
  const identity = identityOf(resource);
  return {
    resource,
    wrapper: {
      ref: encodeResourceRef(identity),
      versionHash: computeVersionHash(resource),
      provenance: "seller_declared",
      status: "active",
      warnings: [],
    },
  };
}

/**
 * `x402_search_resources`: queries the facilitator's canonical Bazaar
 * search/browse API and returns the untouched canonical resources plus a
 * per-item trust wrapper (stable ref, version hash, provenance, status,
 * warnings). The canonical resource object is never modified.
 */
export async function searchResources(client: FacilitatorClient, input: SearchResourcesInput): Promise<SearchResourcesOutput> {
  const filters = {
    ...(input.type ? { type: input.type } : {}),
    ...(input.network ? { network: input.network } : {}),
    ...(input.scheme ? { scheme: input.scheme } : {}),
    ...(input.payTo ? { payTo: input.payTo } : {}),
    ...(input.asset ? { asset: input.asset } : {}),
    ...(input.extensions ? { extensions: input.extensions } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
  };
  const page = input.query
    ? await client.search({ ...filters, query: input.query })
    : await client.resources(filters);

  if (page.resources.length === 0) {
    throw new McpToolError("NO_RESULTS", "no resources matched the query and filters");
  }
  return {
    x402Version: page.x402Version,
    resources: page.resources.map(wrapResource),
    partialResults: page.partialResults,
    pagination: page.pagination,
  };
}
