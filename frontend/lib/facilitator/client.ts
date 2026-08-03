import "server-only";

import type { DataState } from "@/components/data";
import {
  parseAnalyticsResourcesResponse,
  parseBreakdownsResponse,
  parseBrowseResponse,
  parseHealthReadyResponse,
  parseOverviewResponse,
  parseResourceObservabilityResponse,
  parseSearchResponse,
  parseSupportedResponse,
  parseTimeseriesResponse,
  parseTransactionsResponse,
  type AnalyticsResourcesResponse,
  type BreakdownsResponse,
  type BrowseResponse,
  type HealthReadyResponse,
  type OverviewResponse,
  type ResourceObservabilityResponse,
  type SearchResponse,
  type SupportedResponse,
  type TimeseriesResponse,
  type TransactionsResponse,
  type Validation,
} from "./contracts";

export type ApiResult<T> = {
  state: DataState;
  data?: T;
};

export type DiscoveryRequest = {
  query?: string;
  cursor?: string;
  type?: "http" | "mcp";
  network?: string;
  scheme?: string;
  payTo?: string;
  asset?: string;
  extensions?: string;
  limit: number;
};

function facilitatorBaseUrl(): string {
  return process.env.FACILITATOR_INTERNAL_URL
    ?? process.env.FACILITATOR_URL
    ?? "http://127.0.0.1:4022";
}

async function requestJson<T>(
  path: string,
  validate: (value: unknown) => Validation<T>,
  isEmpty: (value: T) => boolean,
  timeoutMs = 8_000,
): Promise<ApiResult<T>> {
  const headers = new Headers({ Accept: "application/json" });
  const apiKey = process.env.FACILITATOR_API_KEY;
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);

  try {
    const response = await fetch(new URL(path, facilitatorBaseUrl()), {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { state: "unavailable" };

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { state: "invalid" };
    }

    const parsed = validate(json);
    if (!parsed.ok) return { state: "invalid" };
    return {
      state: parsed.partial ? "partial" : isEmpty(parsed.value) ? "empty" : "success",
      data: parsed.value,
    };
  } catch {
    return { state: "unavailable" };
  }
}

function discoveryParams(request: DiscoveryRequest): URLSearchParams {
  const params = new URLSearchParams({ limit: String(request.limit) });
  if (request.cursor) params.set("cursor", request.cursor);
  if (request.type) params.set("type", request.type);
  if (request.network) params.set("network", request.network);
  if (request.scheme) params.set("scheme", request.scheme);
  if (request.payTo) params.set("payTo", request.payTo);
  if (request.asset) params.set("asset", request.asset);
  if (request.extensions) params.set("extensions", request.extensions);
  return params;
}

export function getHealth(timeoutMs = 3_000): Promise<ApiResult<HealthReadyResponse>> {
  return requestJson("/health/ready", parseHealthReadyResponse, () => false, timeoutMs);
}

export function getSupported(): Promise<ApiResult<SupportedResponse>> {
  return requestJson("/supported", parseSupportedResponse, value => value.kinds.length === 0);
}

export function getDiscovery(request: DiscoveryRequest): Promise<ApiResult<BrowseResponse | SearchResponse>> {
  const params = discoveryParams(request);
  if (request.query !== undefined && request.query.length > 0) {
    params.set("query", request.query.slice(0, 512));
    return requestJson(
      `/discovery/search?${params.toString()}`,
      parseSearchResponse,
      value => value.resources.length === 0,
    );
  }
  return requestJson(
    `/discovery/resources?${params.toString()}`,
    parseBrowseResponse,
    value => value.items.length === 0,
  );
}

export function getOverview(): Promise<ApiResult<OverviewResponse>> {
  return requestJson("/analytics/v1/overview?days=30", parseOverviewResponse, value => Object.keys(value).length === 0);
}

export function getTimeseries(): Promise<ApiResult<TimeseriesResponse>> {
  return requestJson("/analytics/v1/overview/timeseries?days=30&bucket=day", parseTimeseriesResponse, value => value.series.length === 0);
}

export function getBreakdowns(): Promise<ApiResult<BreakdownsResponse>> {
  return requestJson(
    "/analytics/v1/overview/breakdowns?days=30",
    parseBreakdownsResponse,
    value => value.networks.length === 0 && value.schemes.length === 0 && value.assets.length === 0 && value.statuses.length === 0,
  );
}

export function getTransactions(options: { limit: number; offset: number; status?: "success" | "failed" | "unknown" }): Promise<ApiResult<TransactionsResponse>> {
  const params = new URLSearchParams({ limit: String(options.limit), offset: String(options.offset) });
  if (options.status) params.set("status", options.status);
  return requestJson(`/analytics/v1/transactions?${params.toString()}`, parseTransactionsResponse, value => value.items.length === 0);
}

export function getAnalyticsResources(limit: number): Promise<ApiResult<AnalyticsResourcesResponse>> {
  return requestJson(`/analytics/v1/resources?limit=${limit}`, parseAnalyticsResourcesResponse, value => value.items.length === 0);
}

export function getResourceObservability(id: string): Promise<ApiResult<ResourceObservabilityResponse>> {
  return requestJson(`/analytics/v1/resources/${encodeURIComponent(id)}/observability`, parseResourceObservabilityResponse, value => Object.keys(value).length === 0);
}
