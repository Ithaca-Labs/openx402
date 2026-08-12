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
  getBreakdowns,
  getDiscovery,
  getHealth,
  getOverview,
  getPageResourceObservability,
  getSupported,
  getTimeseries,
  getTransactions,
  type ApiResult,
  type DiscoveryRequest,
} from "./client";
import type { BrowseResponse, DiscoveryResource, SearchResponse } from "./contracts";
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

function discoveryRows(result: ApiResult<BrowseResponse | SearchResponse> | undefined): DiscoveryResource[] {
  if (!result?.data) return [];
  return "items" in result.data ? result.data.items : result.data.resources;
}

function discoveryPage(result: ApiResult<BrowseResponse | SearchResponse> | undefined, page: number): PageInfo | undefined {
  if (!result?.data) return undefined;
  const pagination = result.data.pagination;
  if ("offset" in pagination) {
    return {
      kind: "cursor",
      limit: pagination.limit,
      page,
      offset: pagination.offset,
      total: pagination.total,
      ...(pagination.cursor ? { nextCursor: pagination.cursor } : {}),
    };
  }
  return {
    kind: "cursor",
    limit: pagination.limit,
    page,
    ...(pagination.cursor ? { nextCursor: pagination.cursor } : {}),
  };
}

function discoveryRequest(search: DashboardSearch, cursor?: string): DiscoveryRequest {
  return {
    limit: 20,
    ...(search.q ? { query: search.q } : {}),
    ...(cursor ? { cursor } : {}),
    ...(search.type ? { type: search.type } : {}),
    ...(search.network ? { network: search.network } : {}),
    ...(search.scheme ? { scheme: search.scheme } : {}),
    ...(search.payTo ? { payTo: search.payTo } : {}),
    ...(search.asset ? { asset: search.asset } : {}),
    ...(search.extensions ? { extensions: search.extensions } : {}),
  };
}

async function getDiscoveryPage(search: DashboardSearch): Promise<{
  page: number;
  result: ApiResult<BrowseResponse | SearchResponse>;
}> {
  let page = 1;
  let result = await getDiscovery(discoveryRequest(search));

  while (page < search.page) {
    const cursor = result.data?.pagination.cursor;
    if (!cursor) break;
    result = await getDiscovery(discoveryRequest(search, cursor));
    page += 1;
  }

  return { page, result };
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
  const search = options.search ?? { page: 1 };
  const needsDiscovery = ["discover", "all", "marketplace", "ecosystem"].includes(scope);
  const needsOverview = ["discover", "all", "marketplace", "facilitators"].includes(scope);
  const needsTimeseries = ["discover", "all", "marketplace"].includes(scope);
  const needsSupported = ["facilitators", "networks", "ecosystem"].includes(scope);
  const needsBreakdowns = scope === "networks";
  const needsTransactions = scope === "transactions";

  const [healthResult, supportedResult, overviewResult, timeseriesResult, breakdownsResult, transactionsResult, discoveryLookup] = await Promise.all([
    getHealth(),
    needsSupported ? getSupported() : Promise.resolve(undefined),
    needsOverview ? getOverview() : Promise.resolve(undefined),
    needsTimeseries ? getTimeseries() : Promise.resolve(undefined),
    needsBreakdowns ? getBreakdowns() : Promise.resolve(undefined),
    needsTransactions ? getTransactions({ limit: 20, offset: (search.page - 1) * 20, ...(search.status ? { status: search.status } : {}) }) : Promise.resolve(undefined),
    needsDiscovery ? getDiscoveryPage(search) : Promise.resolve(undefined),
  ]);
  const discoveryResult = discoveryLookup?.result;

  const resources = discoveryRows(discoveryResult);
  const pageObservabilityResult = needsDiscovery && resources.length > 0
    ? await getPageResourceObservability(resources.map(resource => resource.resource))
    : undefined;
  const pageObservability = pageObservabilityResult?.data?.items ?? [];
  const observabilityByUrl = new Map(pageObservability.map(item => [item.resource_url, item]));

  const analyticsState = combinedState([
    overviewResult,
    timeseriesResult,
    breakdownsResult,
    transactionsResult,
    pageObservabilityResult,
  ]);
  const entities = resources.map(resource => adaptEntity(resource, {
    summary: observabilityByUrl.get(resource.resource),
    observability: observabilityByUrl.get(resource.resource),
    analyticsState,
  }));
  const networks = adaptNetworks(breakdownsResult?.data, supportedResult?.data, healthResult.data);
  const facilitators = adaptFacilitators(overviewResult?.data, supportedResult?.data, healthResult.data, healthResult.state);
  const pagination = transactionsResult?.data
    ? {
        kind: "offset" as const,
        limit: transactionsResult.data.pagination.limit,
        page: Math.floor(transactionsResult.data.pagination.offset / transactionsResult.data.pagination.limit) + 1,
        offset: transactionsResult.data.pagination.offset,
        total: transactionsResult.data.pagination.total,
      }
    : discoveryPage(discoveryResult, discoveryLookup?.page ?? 1);

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
