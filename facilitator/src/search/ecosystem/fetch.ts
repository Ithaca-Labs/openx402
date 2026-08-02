import { sha256 } from "../release/io.js";
import type { EcosystemSource } from "./schema.js";

export interface EcosystemSourceSpec {
  source: EcosystemSource;
  url: string;
}

export interface EcosystemFetchResult {
  source: EcosystemSource;
  url: string;
  fetched_at: string;
  records: unknown[];
  response_sha256: string;
  response_bytes: number;
  pages: number;
}

export interface EcosystemFetchError {
  source: EcosystemSource;
  url: string;
  error: string;
}

export const defaultEcosystemSources = (): EcosystemSourceSpec[] => [
  {
    source: "cdp",
    url: process.env.ECOSYSTEM_CDP_URL ?? "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?type=http&limit=1000&offset=0",
  },
  {
    source: "x402.direct",
    url: process.env.ECOSYSTEM_X402_DIRECT_URL ?? "https://x402.direct/api/services?limit=100&sort=score",
  },
  {
    source: "agent-tools",
    url: process.env.ECOSYSTEM_AGENT_TOOLS_URL ?? "https://agent-tools.cloud/api/v1/search?q=x402&limit=100",
  },
  ...(process.env.ECOSYSTEM_X402SCAN_URL ? [{ source: "x402scan" as const, url: process.env.ECOSYSTEM_X402SCAN_URL }] : []),
  ...(process.env.ECOSYSTEM_OPENX402_URL ? [{ source: "openx402" as const, url: process.env.ECOSYSTEM_OPENX402_URL }] : []),
];

function recordsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const object = payload as Record<string, unknown>;
  for (const key of ["items", "resources", "services", "results", "data"]) {
    if (Array.isArray(object[key])) return object[key];
  }
  return [payload];
}

async function fetchJson(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ payload: unknown; bytes: Uint8Array }> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 32 * 1024 * 1024) throw new Error("response exceeded 32 MiB limit");
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${new TextDecoder().decode(bytes).slice(0, 300)}`);
  return { payload: JSON.parse(new TextDecoder().decode(bytes)) as unknown, bytes };
}

async function fetchJsonWithRetries(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ payload: unknown; bytes: Uint8Array }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetchJson(url, fetchImpl);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchOne(spec: EcosystemSourceSpec, fetchImpl: typeof fetch): Promise<EcosystemFetchResult> {
  const fetchedAt = new Date().toISOString();
  if (spec.source === "cdp") {
    const records: unknown[] = [];
    const pageHashes: string[] = [];
    let total = Number.POSITIVE_INFINITY;
    let offset = 0;
    let pages = 0;
    let responseBytes = 0;
    while (offset < total) {
      const pageUrl = new URL(spec.url);
      pageUrl.searchParams.set("limit", pageUrl.searchParams.get("limit") ?? "1000");
      pageUrl.searchParams.set("offset", String(offset));
      const response = await fetchJsonWithRetries(pageUrl.toString(), fetchImpl);
      const pageRecords = recordsFromPayload(response.payload);
      records.push(...pageRecords);
      pageHashes.push(sha256(response.bytes));
      responseBytes += response.bytes.byteLength;
      pages += 1;
      const payload = response.payload && typeof response.payload === "object" ? response.payload as Record<string, unknown> : {};
      const pagination = payload.pagination && typeof payload.pagination === "object" ? payload.pagination as Record<string, unknown> : {};
      total = typeof pagination.total === "number" && Number.isFinite(pagination.total) ? pagination.total : offset + pageRecords.length;
      const limit = typeof pagination.limit === "number" && pagination.limit > 0 ? pagination.limit : pageRecords.length;
      if (pageRecords.length === 0 || limit <= 0) break;
      offset += limit;
      if (pages >= 10_000) throw new Error("CDP pagination exceeded 10000 pages");
    }
    return {
      source: spec.source,
      url: spec.url,
      fetched_at: fetchedAt,
      records,
      response_sha256: sha256(pageHashes.join("\0")),
      response_bytes: responseBytes,
      pages,
    };
  }
  const response = await fetchJsonWithRetries(spec.url, fetchImpl);
  return {
        source: spec.source,
        url: spec.url,
        fetched_at: fetchedAt,
        records: recordsFromPayload(response.payload),
        response_sha256: sha256(response.bytes),
        response_bytes: response.bytes.byteLength,
        pages: 1,
  };
}

/** Fetch public directory snapshots; source failures are returned separately so one unavailable directory does not erase the others. */
export async function fetchEcosystemSources(
  specs: EcosystemSourceSpec[] = defaultEcosystemSources(),
  fetchImpl: typeof fetch = fetch,
): Promise<{ results: EcosystemFetchResult[]; errors: EcosystemFetchError[] }> {
  const results: EcosystemFetchResult[] = [];
  const errors: EcosystemFetchError[] = [];
  for (const spec of specs) {
    try {
      const result = await fetchOne(spec, fetchImpl);
      results.push(result);
    } catch (error) {
      errors.push({ source: spec.source, url: spec.url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { results, errors };
}
