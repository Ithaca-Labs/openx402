import "server-only";

import type {
  Activity,
  DashboardData,
  EcosystemGroup,
  Entity,
  FacilitatorSummary,
  Metric,
  NetworkSummary,
} from "@/components/data";

type JsonObject = Record<string, unknown>;

const TESTNET_USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const PUBNET_USDC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const STELLAR_EXPLORER = "https://stellar.expert/explorer";

function baseUrl(): string {
  return process.env.FACILITATOR_INTERNAL_URL
    ?? process.env.FACILITATOR_URL
    ?? "http://127.0.0.1:4022";
}

async function getJson(path: string, authenticated = false): Promise<JsonObject | undefined> {
  const headers: HeadersInit = { accept: "application/json" };
  const apiKey = process.env.FACILITATOR_API_KEY;
  if (authenticated && apiKey) headers.authorization = `Bearer ${apiKey}`;

  try {
    const response = await fetch(new URL(path, baseUrl()), {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return undefined;
    return await response.json() as JsonObject;
  } catch {
    return undefined;
  }
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function list(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === "object") as JsonObject[] : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compact(value: unknown): string {
  const number = numeric(value);
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(number);
}

function relative(value: unknown): string {
  const timestamp = Date.parse(text(value));
  if (!Number.isFinite(timestamp)) return "No activity";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function resourceUrl(resource: JsonObject): string {
  const raw = resource.resource;
  return typeof raw === "string" ? raw : text(object(raw).url);
}

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url || "Unknown service"; }
}

function assetLabel(asset: string): { symbol: string; decimals: number } {
  if (asset === TESTNET_USDC || asset === PUBNET_USDC) return { symbol: "USDC", decimals: 7 };
  return { symbol: "atomic", decimals: 0 };
}

function decimalAmount(amount: unknown, decimals: number): string {
  const raw = text(amount, "0");
  if (!/^\d+$/.test(raw)) return "0";
  if (decimals === 0) return raw;
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function price(resource: JsonObject): string {
  const option = list(resource.accepts)[0];
  if (!option) return "Price unavailable";
  const asset = assetLabel(text(option.asset));
  return `${decimalAmount(option.amount, asset.decimals)} ${asset.symbol}`;
}

function emptyMetrics(): Metric[] {
  const bars: number[] = [];
  return [
    { label: "Payments observed", value: "—", delta: "offline", context: "facilitator unavailable", trend: "flat", bars },
    { label: "Unique buyers", value: "—", delta: "offline", context: "facilitator unavailable", trend: "flat", bars },
    { label: "Active services", value: "—", delta: "offline", context: "facilitator unavailable", trend: "flat", bars },
    { label: "Networks observed", value: "—", delta: "offline", context: "facilitator unavailable", trend: "flat", bars },
  ];
}

function metrics(overview: JsonObject | undefined, timeseries: JsonObject | undefined): Metric[] {
  if (!overview) return emptyMetrics();
  const series = list(timeseries?.series);
  const transactionValues = series.slice(-14).map(row => numeric(row.total_transactions));
  const buyerValues = series.slice(-14).map(row => numeric(row.unique_buyers));
  const pad = (values: number[]) => [...Array(Math.max(0, 14 - values.length)).fill(0), ...values];
  const observed = { delta: "observed", context: "last 30 days", trend: "flat" as const };
  const snapshot = { delta: "current", context: "catalog snapshot", trend: "flat" as const, bars: [] };
  return [
    { label: "Payments observed", value: compact(overview.total_transactions), ...observed, bars: pad(transactionValues) },
    { label: "Unique buyers", value: compact(overview.unique_buyers), ...observed, bars: pad(buyerValues) },
    { label: "Active services", value: compact(overview.active_resources), ...snapshot },
    { label: "Networks observed", value: compact(overview.unique_networks), ...snapshot },
  ];
}

function toEntity(resource: JsonObject, analytics?: JsonObject): Entity {
  const url = resourceUrl(resource);
  const tags = Array.isArray(resource.tags) ? resource.tags.map(String) : [];
  const option = list(resource.accepts)[0] ?? {};
  return {
    name: text(resource.serviceName) || hostname(url),
    category: tags[0] || text(resource.type, "service").toUpperCase(),
    description: text(resource.description, "Seller-provided Bazaar resource."),
    domain: hostname(url),
    url,
    price: price(resource),
    transactions: compact(analytics?.calls_all_time),
    buyers: compact(analytics?.unique_buyers),
    network: text(option.network, "Stellar").replace("stellar:", "Stellar "),
    freshness: relative(resource.lastUpdated),
    accent: text(resource.type) === "mcp" ? "yellow" : "graphite",
  };
}

function shortAddress(value: unknown): string {
  const address = text(value);
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address || "—";
}

function transactionExplorer(network: string, hash: string): string | undefined {
  if (!hash) return undefined;
  if (network === "stellar:testnet") return `${STELLAR_EXPLORER}/testnet/tx/${hash}`;
  if (network === "stellar:pubnet") return `${STELLAR_EXPLORER}/public/tx/${hash}`;
  return undefined;
}

function toActivity(row: JsonObject): Activity {
  const network = text(row.network, "stellar:testnet");
  const hash = text(row.transaction_hash);
  const asset = assetLabel(text(row.asset));
  const status = text(row.status);
  return {
    entity: hostname(text(row.resource_url, text(row.pay_to, "Unknown recipient"))),
    type: `${text(row.scheme, "exact")} payment`,
    amount: `${decimalAmount(row.amount, numeric(row.asset_decimals) || asset.decimals)} ${text(row.asset_symbol, asset.symbol)}`,
    network: network.replace("stellar:", "Stellar "),
    facilitator: text(row.facilitator_id, "openx402"),
    payer: shortAddress(row.payer),
    hash,
    ...(transactionExplorer(network, hash) ? { explorerUrl: transactionExplorer(network, hash) } : {}),
    time: relative(row.occurred_at),
    state: status === "success" ? "settled" : status === "unknown" ? "pending" : "failed",
  };
}

function networkSummaries(breakdowns: JsonObject | undefined, supported: JsonObject | undefined): NetworkSummary[] {
  const observed = new Map(list(breakdowns?.networks).map(row => [text(row.key), row]));
  const kinds = list(supported?.kinds);
  const names = new Set<string>([...observed.keys(), ...kinds.map(kind => text(kind.network)).filter(Boolean)]);
  return [...names].sort().map((network, index) => {
    const row = observed.get(network) ?? {};
    return {
      name: network.replace("stellar:", "Stellar "),
      role: network === "stellar:pubnet" ? "Production settlement rail" : "Conformance and staging",
      buyers: compact(row.unique_buyers),
      payments: compact(row.tx_count),
      sellers: compact(row.unique_sellers),
      status: kinds.some(kind => text(kind.network) === network) ? "online" : "preview",
      accent: index === 0 ? "yellow" : "graphite",
    };
  });
}

function facilitatorSummaries(overview: JsonObject | undefined, supported: JsonObject | undefined): FacilitatorSummary[] {
  if (!overview && !supported) return [];
  const kinds = list(supported?.kinds);
  return [{
    name: "openx402",
    description: "Self-hostable Stellar facilitator with Bazaar discovery and fee sponsorship.",
    settlements: compact(overview?.successful_transactions),
    payments: compact(overview?.total_transactions),
    status: "Online",
    supported: `${kinds.length} payment kinds`,
    accent: "yellow",
  }];
}

function groups(entities: Entity[]): EcosystemGroup[] {
  const http = entities.filter(entity => entity.category !== "MCP").slice(0, 6).map(entity => entity.name);
  const mcp = entities.filter(entity => entity.category === "MCP").slice(0, 6).map(entity => entity.name);
  return [
    { category: "HTTP resources", entities: http },
    { category: "MCP tools", entities: mcp },
    { category: "Settlement", entities: ["openx402", "Stellar testnet", "Stellar pubnet"] },
  ].filter(group => group.entities.length > 0);
}

export async function loadDashboardData(query?: string): Promise<DashboardData> {
  const discoveryPath = query
    ? `/discovery/search?query=${encodeURIComponent(query)}&limit=50`
    : "/discovery/resources?limit=50";
  const [overview, timeseries, breakdowns, transactions, resources, supported] = await Promise.all([
    getJson("/analytics/v1/overview?days=30", true),
    getJson("/analytics/v1/overview/timeseries?days=30&bucket=day", true),
    getJson("/analytics/v1/overview/breakdowns?days=30", true),
    getJson("/analytics/v1/transactions?limit=50", true),
    getJson(discoveryPath),
    getJson("/supported", true),
  ]);

  const resourceRows = list(resources?.items ?? resources?.resources);
  const recent = await getJson("/analytics/v1/resources?limit=50", true);
  const analyticsByUrl = new Map(list(recent?.items).map(row => [text(row.resource_url), row]));
  const observable = await Promise.all(resourceRows.slice(0, 20).map(async resource => {
    const row = analyticsByUrl.get(resourceUrl(resource));
    const id = numeric(row?.id);
    return id > 0 ? await getJson(`/analytics/v1/resources/${id}/observability`, true) : undefined;
  }));
  const entities = resourceRows.map((resource, index) => toEntity(resource, observable[index]));
  const connected = Boolean(overview || resources || supported);

  return {
    metrics: metrics(overview, timeseries),
    entities,
    activity: list(transactions?.items).map(toActivity),
    facilitators: facilitatorSummaries(overview, supported),
    networks: networkSummaries(breakdowns, supported),
    ecosystemGroups: groups(entities),
    connected,
  };
}
