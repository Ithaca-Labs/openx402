import "server-only";

import type { DashboardData, DataState, PageInfo } from "@/components/data";
import {
  adaptActivity,
  adaptEcosystemGroups,
  adaptEntity,
  adaptFacilitators,
  adaptMetrics,
  adaptNetworks,
} from "./adapters";
import {
  getAnalyticsResources,
  getBreakdowns,
  getDiscovery,
  getHealth,
  getOverview,
  getResourceObservability,
  getSupported,
  getTimeseries,
  getTransactions,
  type ApiResult,
} from "./client";
import type {
  AnalyticsResource,
  BrowseResponse,
  DiscoveryResource,
  ResourceObservabilityResponse,
  SearchResponse,
} from "./contracts";
import type { DashboardSearch } from "./query";

export { pageHref, parseDashboardSearch } from "./query";
export type { DashboardSearch, RawSearchParams } from "./query";

export type DashboardScope = "discover" | "all" | "marketplace" | "transactions" | "facilitators" | "networks" | "ecosystem";

function combinedState(results: Array<ApiResult<unknown> | undefined>): DataState {
  const states = results.flatMap(result => result ? [result.state] : []);
  if (states.length === 0) return "unavailable";
  if (states.every(state => state === "empty")) return "empty";
  const hasData = states.some(state => state === "success" || state === "partial" || state === "empty");
  if (states.includes("partial") || (hasData && states.some(state => state === "invalid" || state === "unavailable"))) return "partial";
  if (states.includes("success")) return "success";
  if (states.includes("invalid")) return "invalid";
  return "unavailable";
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function discoveryRows(result: ApiResult<BrowseResponse | SearchResponse> | undefined): DiscoveryResource[] {
  if (!result?.data) return [];
  return "items" in result.data ? result.data.items : result.data.resources;
}

function discoveryPage(result: ApiResult<BrowseResponse | SearchResponse> | undefined): PageInfo | undefined {
  if (!result?.data) return undefined;
  const pagination = result.data.pagination;
  if ("offset" in pagination) {
    return {
      kind: "cursor",
      limit: pagination.limit,
      offset: pagination.offset,
      total: pagination.total,
      ...(pagination.cursor ? { nextCursor: pagination.cursor } : {}),
    };
  }
  return {
    kind: "cursor",
    limit: pagination.limit,
    ...(pagination.cursor ? { nextCursor: pagination.cursor } : {}),
  };
}

function upstreamPartial(result: ApiResult<BrowseResponse | SearchResponse> | undefined): boolean {
  return result?.state === "partial" || result?.data?.partialResults === true;
}

export async function getFacilitatorHealth(timeoutMs = 3_000) {
  return getHealth(timeoutMs);
}

export async function loadDashboardData(options: {
  scope?: DashboardScope;
  search?: DashboardSearch;
} = {}): Promise<DashboardData> {
  const scope = options.scope ?? "all";
  const search = options.search ?? { offset: 0 };
  const needsDiscovery = ["discover", "all", "marketplace", "ecosystem"].includes(scope);
  const needsOverview = ["discover", "all", "marketplace", "facilitators"].includes(scope);
  const needsTimeseries = ["discover", "all", "marketplace"].includes(scope);
  const needsSupported = ["facilitators", "networks", "ecosystem"].includes(scope);
  const needsBreakdowns = scope === "networks";
  const needsTransactions = scope === "transactions";

  const [healthResult, supportedResult, overviewResult, timeseriesResult, breakdownsResult, transactionsResult, discoveryResult, analyticsResourcesResult] = await Promise.all([
    getHealth(),
    needsSupported ? getSupported() : Promise.resolve(undefined),
    needsOverview ? getOverview() : Promise.resolve(undefined),
    needsTimeseries ? getTimeseries() : Promise.resolve(undefined),
    needsBreakdowns ? getBreakdowns() : Promise.resolve(undefined),
    needsTransactions ? getTransactions({ limit: 20, offset: search.offset, ...(search.status ? { status: search.status } : {}) }) : Promise.resolve(undefined),
    needsDiscovery ? getDiscovery({
      limit: 20,
      ...(search.q ? { query: search.q } : {}),
      ...(search.cursor ? { cursor: search.cursor } : {}),
      ...(search.type ? { type: search.type } : {}),
      ...(search.network ? { network: search.network } : {}),
      ...(search.scheme ? { scheme: search.scheme } : {}),
      ...(search.payTo ? { payTo: search.payTo } : {}),
      ...(search.asset ? { asset: search.asset } : {}),
      ...(search.extensions ? { extensions: search.extensions } : {}),
    }) : Promise.resolve(undefined),
    needsDiscovery ? getAnalyticsResources(20) : Promise.resolve(undefined),
  ]);

  const resources = discoveryRows(discoveryResult);
  const summaries = analyticsResourcesResult?.data?.items ?? [];
  const summaryByUrl = new Map(summaries.map(summary => [summary.resource_url, summary]));
  const detailsToFetch: Array<{ resource: DiscoveryResource; summary: AnalyticsResource }> = [];
  const detailUrls = new Set<string>();
  for (const resource of resources) {
    const summary = summaryByUrl.get(resource.resource);
    if (!summary || detailUrls.has(summary.resource_url)) continue;
    detailUrls.add(summary.resource_url);
    detailsToFetch.push({ resource, summary });
    if (detailsToFetch.length === 8) break;
  }
  const detailResults = await mapWithConcurrency(detailsToFetch, 3, async ({ summary }) => ({
    url: summary.resource_url,
    result: await getResourceObservability(summary.id),
  }));
  const observabilityByUrl = new Map<string, ResourceObservabilityResponse>();
  for (const detail of detailResults) {
    if (detail.result.data) observabilityByUrl.set(detail.url, detail.result.data);
  }

  const analyticsState = combinedState([
    overviewResult,
    timeseriesResult,
    breakdownsResult,
    transactionsResult,
    analyticsResourcesResult,
  ]);
  const entities = resources.map(resource => adaptEntity(resource, {
    summary: summaryByUrl.get(resource.resource),
    observability: observabilityByUrl.get(resource.resource),
    analyticsState,
  }));
  const networks = adaptNetworks(breakdownsResult?.data, supportedResult?.data, healthResult.data);
  const facilitators = adaptFacilitators(overviewResult?.data, supportedResult?.data, healthResult.data, healthResult.state);
  const pagination = transactionsResult?.data
    ? {
        kind: "offset" as const,
        limit: transactionsResult.data.pagination.limit,
        offset: transactionsResult.data.pagination.offset,
        total: transactionsResult.data.pagination.total,
      }
    : discoveryPage(discoveryResult);

  return {
    metrics: adaptMetrics(overviewResult?.data, timeseriesResult?.data),
    entities,
    activity: (transactionsResult?.data?.items ?? []).map(adaptActivity),
    facilitators,
    networks,
    ecosystemGroups: adaptEcosystemGroups(entities, networks, facilitators),
    states: {
      health: healthResult.state,
      discovery: discoveryResult?.state ?? "unavailable",
      analytics: analyticsState,
      supported: supportedResult?.state ?? "unavailable",
    },
    ...(pagination ? { pagination } : {}),
    partialResults: upstreamPartial(discoveryResult) || analyticsState === "partial",
    connected: healthResult.data?.status === "ready",
  };
}
