import type { CanonicalResource } from "./types.js";
import { McpToolError } from "./errors.js";

export interface DiscoveryFilters {
  type?: "http" | "mcp";
  network?: string;
  scheme?: string;
  payTo?: string;
  asset?: string;
  extensions?: string;
}

export interface SearchParams extends DiscoveryFilters {
  query?: string;
  limit?: number;
  cursor?: string;
}

export interface DiscoveryPage {
  x402Version: number;
  resources: CanonicalResource[];
  partialResults: boolean;
  pagination: { limit: number; cursor: string | null };
}

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Thin client against the facilitator's public, unauthenticated discovery
 * HTTP API. Never rewrites the returned `resource`/`accepts` objects -- the
 * canonical Bazaar shape passes through unchanged; only pagination/cursor
 * plumbing is interpreted here.
 */
export class FacilitatorClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async search(params: SearchParams): Promise<DiscoveryPage> {
    return this.getPage("/discovery/search", params);
  }

  async resources(params: DiscoveryFilters & { limit?: number; cursor?: string }): Promise<DiscoveryPage> {
    const body = await this.getJson("/discovery/resources", params);
    return {
      x402Version: Number(body.x402Version ?? 2),
      resources: (body.items as CanonicalResource[] | undefined) ?? [],
      partialResults: Boolean(body.partialResults),
      pagination: {
        limit: Number((body.pagination as { limit?: number })?.limit ?? 0),
        cursor: ((body.pagination as { cursor?: string | null })?.cursor) ?? null,
      },
    };
  }

  /** Exact single-resource resolver at `/discovery/resource`. 404 -> undefined. */
  async getResource(identity: { type: "http" | "mcp"; url: string; toolName?: string }): Promise<CanonicalResource | undefined> {
    const query = new URLSearchParams({ type: identity.type, url: identity.url });
    if (identity.toolName) query.set("toolName", identity.toolName);
    const response = await this.request(`/discovery/resource?${query.toString()}`);
    if (response.status === 404) return undefined;
    const body = await this.readJson(response);
    return body.resource as CanonicalResource;
  }

  private async getPage(path: string, params: SearchParams): Promise<DiscoveryPage> {
    const body = await this.getJson(path, params);
    return {
      x402Version: Number(body.x402Version ?? 2),
      resources: (body.resources as CanonicalResource[] | undefined) ?? [],
      partialResults: Boolean(body.partialResults),
      pagination: {
        limit: Number((body.pagination as { limit?: number })?.limit ?? 0),
        cursor: ((body.pagination as { cursor?: string | null })?.cursor) ?? null,
      },
    };
  }

  private async getJson(path: string, params: object): Promise<Record<string, unknown>> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params as Record<string, string | number | undefined>)) {
      if (value !== undefined) query.set(key, String(value));
    }
    const qs = query.toString();
    const response = await this.request(`${path}${qs ? `?${qs}` : ""}`);
    return this.readJson(response);
  }

  private async request(path: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(new URL(path, this.baseUrl), { signal: controller.signal, redirect: "error" });
      if (!response.ok && response.status !== 404) {
        throw new McpToolError("UPSTREAM_PROTOCOL_ERROR", `facilitator returned ${response.status} for ${path}`);
      }
      return response;
    } catch (error) {
      if (error instanceof McpToolError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new McpToolError("UPSTREAM_TIMEOUT", `facilitator request timed out: ${path}`);
      }
      throw new McpToolError("UPSTREAM_PROTOCOL_ERROR", `facilitator request failed: ${path}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async readJson(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new McpToolError("UPSTREAM_PROTOCOL_ERROR", "facilitator response exceeded the size bound");
    }
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new McpToolError("UPSTREAM_PROTOCOL_ERROR", "facilitator returned malformed JSON");
    }
  }
}
