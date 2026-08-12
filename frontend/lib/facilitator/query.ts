export type RawSearchParams = Record<string, string | string[] | undefined>;

export type DashboardSearch = {
  q?: string;
  type?: "http" | "mcp";
  network?: string;
  scheme?: string;
  payTo?: string;
  asset?: string;
  extensions?: string;
  page: number;
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
  const rawPage = first(params.page);
  const parsedPage = rawPage && /^\d+$/.test(rawPage) ? Number(rawPage) : 1;
  return {
    ...(bounded(params.q, 512) ? { q: bounded(params.q, 512) } : {}),
    ...(rawType === "http" || rawType === "mcp" ? { type: rawType } : {}),
    ...(bounded(params.network, 128) ? { network: bounded(params.network, 128) } : {}),
    ...(bounded(params.scheme, 64) ? { scheme: bounded(params.scheme, 64) } : {}),
    ...(bounded(params.payTo, 128) ? { payTo: bounded(params.payTo, 128) } : {}),
    ...(bounded(params.asset, 128) ? { asset: bounded(params.asset, 128) } : {}),
    ...(bounded(params.extensions, 64) ? { extensions: bounded(params.extensions, 64) } : {}),
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 && parsedPage <= 1_000 ? parsedPage : 1,
    ...(rawStatus === "success" || rawStatus === "failed" || rawStatus === "unknown" ? { status: rawStatus } : {}),
  };
}

export function pageHref(
  pathname: string,
  search: DashboardSearch,
  page: number,
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
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
