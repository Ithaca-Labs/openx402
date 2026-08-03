export type RawSearchParams = Record<string, string | string[] | undefined>;

export type DashboardSearch = {
  q?: string;
  cursor?: string;
  type?: "http" | "mcp";
  network?: string;
  scheme?: string;
  payTo?: string;
  asset?: string;
  extensions?: string;
  offset: number;
  status?: "success" | "failed" | "unknown";
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function bounded(value: string | string[] | undefined, max: number): string | undefined {
  const result = first(value)?.trim();
  return result ? result.slice(0, max) : undefined;
}

export function parseDashboardSearch(params: RawSearchParams): DashboardSearch {
  const rawType = bounded(params.type, 8);
  const rawStatus = bounded(params.status, 16);
  const rawOffset = first(params.offset);
  const parsedOffset = rawOffset && /^\d+$/.test(rawOffset) ? Number(rawOffset) : 0;
  return {
    ...(bounded(params.q, 512) ? { q: bounded(params.q, 512) } : {}),
    ...(bounded(params.cursor, 4096) ? { cursor: bounded(params.cursor, 4096) } : {}),
    ...(rawType === "http" || rawType === "mcp" ? { type: rawType } : {}),
    ...(bounded(params.network, 128) ? { network: bounded(params.network, 128) } : {}),
    ...(bounded(params.scheme, 64) ? { scheme: bounded(params.scheme, 64) } : {}),
    ...(bounded(params.payTo, 128) ? { payTo: bounded(params.payTo, 128) } : {}),
    ...(bounded(params.asset, 128) ? { asset: bounded(params.asset, 128) } : {}),
    ...(bounded(params.extensions, 64) ? { extensions: bounded(params.extensions, 64) } : {}),
    offset: Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0,
    ...(rawStatus === "success" || rawStatus === "failed" || rawStatus === "unknown" ? { status: rawStatus } : {}),
  };
}

export function pageHref(
  pathname: string,
  search: DashboardSearch,
  page: { cursor?: string; offset?: number },
): string {
  const params = new URLSearchParams();
  if (search.q) params.set("q", search.q);
  if (search.type) params.set("type", search.type);
  if (search.network) params.set("network", search.network);
  if (search.scheme) params.set("scheme", search.scheme);
  if (search.payTo) params.set("payTo", search.payTo);
  if (search.asset) params.set("asset", search.asset);
  if (search.extensions) params.set("extensions", search.extensions);
  if (search.status) params.set("status", search.status);
  if (page.cursor) params.set("cursor", page.cursor);
  if (page.offset !== undefined && page.offset > 0) params.set("offset", String(page.offset));
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
