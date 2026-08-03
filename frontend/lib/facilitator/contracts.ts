export type Validation<T> =
  | { ok: true; value: T; partial: boolean }
  | { ok: false };

export type HealthReadyResponse = {
  status: string;
  search?: {
    lexical?: string;
    semantic?: string;
  };
};

export type SupportedKind = {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: { areFeesSponsored?: boolean };
};

export type SupportedResponse = {
  kinds: SupportedKind[];
  extensions: string[];
  signers: Record<string, string[]>;
};

export type PaymentOption = {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: { areFeesSponsored?: boolean };
};

export type DiscoveryResource = {
  resource: string;
  type: "http" | "mcp";
  x402Version: number;
  accepts: PaymentOption[];
  lastUpdated?: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  extensionNames: string[];
};

export type BrowseResponse = {
  x402Version: number;
  items: DiscoveryResource[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    cursor: string | null;
  };
  partialResults: boolean;
};

export type SearchResponse = {
  x402Version: number;
  resources: DiscoveryResource[];
  pagination: { limit: number; cursor: string | null };
  partialResults: boolean;
};

export type OverviewResponse = {
  total_transactions?: string;
  successful_transactions?: string;
  failed_transactions?: string;
  unique_buyers?: string;
  unique_sellers?: string;
  unique_networks?: string;
  cataloged_resources?: string;
  active_resources?: string;
  stale_resources?: string;
  latest_activity?: string;
};

export type TimeseriesPoint = {
  bucket_start: string;
  total_transactions?: string;
  unique_buyers?: string;
};

export type TimeseriesResponse = {
  bucket: "hour" | "day";
  series: TimeseriesPoint[];
};

export type BreakdownRow = {
  key: string;
  tx_count?: string;
  total_amount?: string;
  unique_buyers?: string;
  unique_sellers?: string;
  latest_activity?: string;
};

export type BreakdownsResponse = {
  networks: BreakdownRow[];
  schemes: BreakdownRow[];
  assets: BreakdownRow[];
  statuses: BreakdownRow[];
};

export type TransactionRow = {
  id: string;
  occurred_at: string;
  network?: string;
  scheme?: string;
  asset?: string;
  asset_symbol?: string;
  asset_decimals?: number;
  payer?: string;
  pay_to?: string;
  max_amount?: string;
  amount?: string;
  transaction_hash?: string;
  status?: string;
  facilitator_id?: string;
  resource_id?: string;
  resource_url?: string;
  error_reason?: string;
};

export type TransactionsResponse = {
  items: TransactionRow[];
  pagination: { limit: number; offset: number; total: number };
};

export type AnalyticsResource = {
  id: string;
  resource_url: string;
  type: "http" | "mcp";
  status?: string;
  last_seen?: string;
};

export type AnalyticsResourcesResponse = { items: AnalyticsResource[] };

export type ResourceObservabilityResponse = {
  calls_all_time?: string;
  success_all_time?: string;
  failed_all_time?: string;
  unknown_all_time?: string;
  unique_buyers?: string;
  latest_activity?: string;
};

type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  const result = string(value);
  return result && result.length > 0 ? result : undefined;
}

function decimalString(value: unknown): string | undefined {
  const result = string(value);
  return result !== undefined && /^\d+$/.test(result) ? result : undefined;
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function optionalString(source: JsonObject, key: string, target: JsonObject): boolean {
  if (source[key] === undefined || source[key] === null) return false;
  const value = string(source[key]);
  if (value === undefined) return true;
  target[key] = value;
  return false;
}

function optionalDecimal(source: JsonObject, key: string, target: JsonObject): boolean {
  if (source[key] === undefined || source[key] === null) return false;
  const value = decimalString(source[key]);
  if (value === undefined) return true;
  target[key] = value;
  return false;
}

function parsePaymentOption(input: unknown): Validation<PaymentOption> {
  const source = record(input);
  if (!source) return { ok: false };
  const scheme = nonEmptyString(source.scheme);
  const network = nonEmptyString(source.network);
  const asset = nonEmptyString(source.asset);
  const amount = decimalString(source.amount);
  const payTo = nonEmptyString(source.payTo);
  if (!scheme || !network || !asset || amount === undefined || !payTo) return { ok: false };

  let partial = false;
  const option: PaymentOption = { scheme, network, asset, amount, payTo };
  if (source.maxTimeoutSeconds !== undefined) {
    const timeout = finiteInteger(source.maxTimeoutSeconds);
    if (timeout === undefined) partial = true;
    else option.maxTimeoutSeconds = timeout;
  }
  if (source.extra !== undefined) {
    const extra = record(source.extra);
    if (!extra) partial = true;
    else if (extra.areFeesSponsored === undefined) option.extra = {};
    else if (typeof extra.areFeesSponsored === "boolean") option.extra = { areFeesSponsored: extra.areFeesSponsored };
    else partial = true;
  }
  return { ok: true, value: option, partial };
}

export function parseDiscoveryResource(input: unknown): Validation<DiscoveryResource> {
  const source = record(input);
  if (!source) return { ok: false };
  const resource = nonEmptyString(source.resource);
  const type = source.type === "http" || source.type === "mcp" ? source.type : undefined;
  const x402Version = finiteInteger(source.x402Version);
  if (!resource || !type || x402Version === undefined || !Array.isArray(source.accepts)) return { ok: false };

  let partial = false;
  const accepts: PaymentOption[] = [];
  for (const item of source.accepts) {
    const parsed = parsePaymentOption(item);
    if (!parsed.ok) partial = true;
    else {
      accepts.push(parsed.value);
      partial ||= parsed.partial;
    }
  }

  const optional: JsonObject = {};
  for (const key of ["lastUpdated", "description", "mimeType", "serviceName"] as const) {
    partial ||= optionalString(source, key, optional);
  }

  let tags: string[] | undefined;
  if (source.tags !== undefined) {
    if (!Array.isArray(source.tags)) partial = true;
    else {
      tags = source.tags.filter((tag): tag is string => typeof tag === "string");
      partial ||= tags.length !== source.tags.length;
    }
  }

  let extensionNames: string[] = [];
  if (source.extensions !== undefined) {
    const extensions = record(source.extensions);
    if (!extensions) partial = true;
    else extensionNames = Object.keys(extensions).filter(name => name.length <= 64);
  }

  return {
    ok: true,
    partial,
    value: {
      resource,
      type,
      x402Version,
      accepts,
      ...(optional as Pick<DiscoveryResource, "lastUpdated" | "description" | "mimeType" | "serviceName">),
      ...(tags ? { tags } : {}),
      extensionNames,
    },
  };
}

function parseResources(value: unknown): { rows?: DiscoveryResource[]; partial: boolean } {
  if (!Array.isArray(value)) return { partial: false };
  const rows: DiscoveryResource[] = [];
  let partial = false;
  for (const item of value) {
    const parsed = parseDiscoveryResource(item);
    if (!parsed.ok) partial = true;
    else {
      rows.push(parsed.value);
      partial ||= parsed.partial;
    }
  }
  return { rows, partial };
}

function cursor(value: unknown): string | null | undefined {
  return value === null ? null : string(value);
}

export function parseBrowseResponse(input: unknown): Validation<BrowseResponse> {
  const source = record(input);
  const pagination = record(source?.pagination);
  const parsedRows = parseResources(source?.items);
  const x402Version = finiteInteger(source?.x402Version);
  const limit = finiteInteger(pagination?.limit);
  const offset = finiteInteger(pagination?.offset);
  const total = finiteInteger(pagination?.total);
  const nextCursor = cursor(pagination?.cursor);
  if (!source || !pagination || !parsedRows.rows || x402Version === undefined || limit === undefined || offset === undefined || total === undefined || nextCursor === undefined || typeof source.partialResults !== "boolean") return { ok: false };
  return {
    ok: true,
    partial: parsedRows.partial,
    value: { x402Version, items: parsedRows.rows, pagination: { limit, offset, total, cursor: nextCursor }, partialResults: source.partialResults },
  };
}

export function parseSearchResponse(input: unknown): Validation<SearchResponse> {
  const source = record(input);
  const pagination = record(source?.pagination);
  const parsedRows = parseResources(source?.resources);
  const x402Version = finiteInteger(source?.x402Version);
  const limit = finiteInteger(pagination?.limit);
  const nextCursor = cursor(pagination?.cursor);
  if (!source || !pagination || !parsedRows.rows || x402Version === undefined || limit === undefined || nextCursor === undefined || typeof source.partialResults !== "boolean") return { ok: false };
  return {
    ok: true,
    partial: parsedRows.partial,
    value: { x402Version, resources: parsedRows.rows, pagination: { limit, cursor: nextCursor }, partialResults: source.partialResults },
  };
}

export function parseHealthReadyResponse(input: unknown): Validation<HealthReadyResponse> {
  const source = record(input);
  const status = nonEmptyString(source?.status);
  if (!source || !status) return { ok: false };
  let partial = false;
  let search: HealthReadyResponse["search"];
  if (source.search !== undefined) {
    const rawSearch = record(source.search);
    if (!rawSearch) partial = true;
    else {
      const lexical = string(rawSearch.lexical);
      const semantic = string(rawSearch.semantic);
      partial ||= rawSearch.lexical !== undefined && lexical === undefined;
      partial ||= rawSearch.semantic !== undefined && semantic === undefined;
      search = { ...(lexical ? { lexical } : {}), ...(semantic ? { semantic } : {}) };
    }
  }
  return { ok: true, partial, value: { status, ...(search ? { search } : {}) } };
}

export function parseSupportedResponse(input: unknown): Validation<SupportedResponse> {
  const source = record(input);
  if (!source || !Array.isArray(source.kinds) || !Array.isArray(source.extensions) || !record(source.signers)) return { ok: false };
  let partial = false;
  const kinds: SupportedKind[] = [];
  for (const item of source.kinds) {
    const row = record(item);
    const x402Version = finiteInteger(row?.x402Version);
    const scheme = nonEmptyString(row?.scheme);
    const network = nonEmptyString(row?.network);
    if (!row || x402Version === undefined || !scheme || !network) {
      partial = true;
      continue;
    }
    let extra: SupportedKind["extra"];
    if (row.extra !== undefined) {
      const rawExtra = record(row.extra);
      if (!rawExtra) partial = true;
      else if (rawExtra.areFeesSponsored === undefined) extra = {};
      else if (typeof rawExtra.areFeesSponsored === "boolean") extra = { areFeesSponsored: rawExtra.areFeesSponsored };
      else partial = true;
    }
    kinds.push({ x402Version, scheme, network, ...(extra ? { extra } : {}) });
  }
  const extensions = source.extensions.filter((item): item is string => typeof item === "string");
  partial ||= extensions.length !== source.extensions.length;
  const signers: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(record(source.signers)!)) {
    if (!Array.isArray(value) || value.some(item => typeof item !== "string")) partial = true;
    else signers[key] = value as string[];
  }
  return { ok: true, partial, value: { kinds, extensions, signers } };
}

export function parseOverviewResponse(input: unknown): Validation<OverviewResponse> {
  const source = record(input);
  if (!source) return { ok: false };
  const value: JsonObject = {};
  let partial = false;
  const decimals = ["total_transactions", "successful_transactions", "failed_transactions", "unique_buyers", "unique_sellers", "unique_networks", "cataloged_resources", "active_resources", "stale_resources"];
  for (const key of decimals) partial ||= optionalDecimal(source, key, value);
  partial ||= optionalString(source, "latest_activity", value);
  if (Object.keys(value).length === 0 && Object.keys(source).length > 0) return { ok: false };
  return { ok: true, partial, value: value as OverviewResponse };
}

function parseBreakdownRows(input: unknown): { rows?: BreakdownRow[]; partial: boolean } {
  if (!Array.isArray(input)) return { partial: false };
  const rows: BreakdownRow[] = [];
  let partial = false;
  for (const item of input) {
    const source = record(item);
    const key = nonEmptyString(source?.key);
    if (!source || !key) { partial = true; continue; }
    const value: JsonObject = { key };
    for (const field of ["tx_count", "total_amount", "unique_buyers", "unique_sellers"]) partial ||= optionalDecimal(source, field, value);
    partial ||= optionalString(source, "latest_activity", value);
    rows.push(value as BreakdownRow);
  }
  return { rows, partial };
}

export function parseTimeseriesResponse(input: unknown): Validation<TimeseriesResponse> {
  const source = record(input);
  if (!source || (source.bucket !== "hour" && source.bucket !== "day") || !Array.isArray(source.series)) return { ok: false };
  const series: TimeseriesPoint[] = [];
  let partial = false;
  for (const item of source.series) {
    const row = record(item);
    const bucketStart = string(row?.bucket_start);
    if (!row || !bucketStart) { partial = true; continue; }
    const value: JsonObject = { bucket_start: bucketStart };
    partial ||= optionalDecimal(row, "total_transactions", value);
    partial ||= optionalDecimal(row, "unique_buyers", value);
    series.push(value as TimeseriesPoint);
  }
  return { ok: true, partial, value: { bucket: source.bucket, series } };
}

export function parseBreakdownsResponse(input: unknown): Validation<BreakdownsResponse> {
  const source = record(input);
  if (!source) return { ok: false };
  const networks = parseBreakdownRows(source.networks);
  const schemes = parseBreakdownRows(source.schemes);
  const assets = parseBreakdownRows(source.assets);
  const statuses = parseBreakdownRows(source.statuses);
  if (!networks.rows || !schemes.rows || !assets.rows || !statuses.rows) return { ok: false };
  return { ok: true, partial: networks.partial || schemes.partial || assets.partial || statuses.partial, value: { networks: networks.rows, schemes: schemes.rows, assets: assets.rows, statuses: statuses.rows } };
}

function parseTransaction(input: unknown): Validation<TransactionRow> {
  const source = record(input);
  const id = decimalString(source?.id);
  const occurredAt = string(source?.occurred_at);
  if (!source || id === undefined || !occurredAt) return { ok: false };
  const value: JsonObject = { id, occurred_at: occurredAt };
  let partial = false;
  for (const key of ["network", "scheme", "asset", "asset_symbol", "payer", "pay_to", "max_amount", "amount", "transaction_hash", "status", "facilitator_id", "resource_id", "resource_url", "error_reason"]) {
    partial ||= optionalString(source, key, value);
  }
  if (source.asset_decimals !== undefined && source.asset_decimals !== null) {
    const decimals = finiteInteger(source.asset_decimals);
    if (decimals === undefined || decimals > 30) partial = true;
    else value.asset_decimals = decimals;
  }
  return { ok: true, partial, value: value as TransactionRow };
}

export function parseTransactionsResponse(input: unknown): Validation<TransactionsResponse> {
  const source = record(input);
  const pagination = record(source?.pagination);
  if (!source || !pagination || !Array.isArray(source.items)) return { ok: false };
  const limit = finiteInteger(pagination.limit);
  const offset = finiteInteger(pagination.offset);
  const total = finiteInteger(pagination.total);
  if (limit === undefined || offset === undefined || total === undefined) return { ok: false };
  const items: TransactionRow[] = [];
  let partial = false;
  for (const item of source.items) {
    const parsed = parseTransaction(item);
    if (!parsed.ok) partial = true;
    else { items.push(parsed.value); partial ||= parsed.partial; }
  }
  return { ok: true, partial, value: { items, pagination: { limit, offset, total } } };
}

export function parseAnalyticsResourcesResponse(input: unknown): Validation<AnalyticsResourcesResponse> {
  const source = record(input);
  if (!source || !Array.isArray(source.items)) return { ok: false };
  const items: AnalyticsResource[] = [];
  let partial = false;
  for (const item of source.items) {
    const row = record(item);
    const id = decimalString(row?.id);
    const resourceUrl = nonEmptyString(row?.resource_url);
    const type = row?.type === "http" || row?.type === "mcp" ? row.type : undefined;
    if (!row || id === undefined || !resourceUrl || !type) { partial = true; continue; }
    const value: AnalyticsResource = { id, resource_url: resourceUrl, type };
    if (row.status !== undefined) {
      if (typeof row.status === "string") value.status = row.status;
      else partial = true;
    }
    if (row.last_seen !== undefined) {
      if (typeof row.last_seen === "string") value.last_seen = row.last_seen;
      else partial = true;
    }
    items.push(value);
  }
  return { ok: true, partial, value: { items } };
}

export function parseResourceObservabilityResponse(input: unknown): Validation<ResourceObservabilityResponse> {
  const source = record(input);
  if (!source) return { ok: false };
  const value: JsonObject = {};
  let partial = false;
  for (const key of ["calls_all_time", "success_all_time", "failed_all_time", "unknown_all_time", "unique_buyers"]) partial ||= optionalDecimal(source, key, value);
  partial ||= optionalString(source, "latest_activity", value);
  if (Object.keys(value).length === 0 && Object.keys(source).length > 0) return { ok: false };
  return { ok: true, partial, value: value as ResourceObservabilityResponse };
}
