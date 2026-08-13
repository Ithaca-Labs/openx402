import type {
  Activity,
  DataState,
  EcosystemGroup,
  Entity,
  FacilitatorSummary,
  Metric,
  NetworkSummary,
} from "@/components/data";
import type {
  AnalyticsResource,
  BreakdownsResponse,
  DiscoveryResource,
  HealthReadyResponse,
  OverviewResponse,
  ResourceObservabilityResponse,
  SupportedResponse,
  TimeseriesResponse,
  TransactionRow,
} from "./contracts";
import {
  chartNumber,
  compactDecimalString,
  formatAtomicAmount,
  formatPaymentOption,
  humanNetwork,
  relativeTime,
  resourceLabel,
  safeResourceHref,
  shortIdentifier,
  transactionExplorerUrl,
} from "./format";

/**
 * Settled value carries no asset of its own, so it is only meaningful once the
 * breakdown shows a single asset behind it. Totals across different assets are
 * not summable and are reported as such.
 */
function assetTotal(amount: string | undefined, breakdowns?: BreakdownsResponse): string {
  const assets = (breakdowns?.assets ?? []).filter(asset => asset.total_amount !== undefined);
  if (assets.length === 1) return formatAtomicAmount(amount ?? assets[0]?.total_amount, assets[0]?.key);
  return assets.length > 1 ? "Multiple assets" : "Amount unavailable";
}

/**
 * Splits "0.18907 USDC" into number and unit. The metric boxes render the value
 * at display size, where a trailing symbol wraps to a second line and knocks the
 * number off the baseline its neighbours sit on; the unit belongs with the
 * context caption instead.
 */
function assetTotalParts(amount: string | undefined, breakdowns?: BreakdownsResponse): { value: string; unit?: string } {
  const formatted = assetTotal(amount, breakdowns);
  const match = /^(-?[\d.,]+)\s+(.+)$/.exec(formatted);
  return match ? { value: match[1]!, unit: match[2]! } : { value: formatted };
}

export function adaptTransactionTotals(overview?: OverviewResponse, breakdowns?: BreakdownsResponse): { totalTransactions: string; totalAmount: string; activeServices: string } {
  return {
    totalTransactions: compactDecimalString(overview?.total_transactions),
    totalAmount: assetTotal(undefined, breakdowns),
    activeServices: compactDecimalString(overview?.active_resources),
  };
}

function unavailableMetrics(): Metric[] {
  return ["Payments observed", "Unique buyers", "Active services", "Volume"].map(label => ({
    label,
    value: "Unavailable",
    delta: "unavailable",
    context: "analytics unavailable",
    trend: "flat" as const,
    bars: [],
  }));
}

export function adaptMetrics(overview?: OverviewResponse, timeseries?: TimeseriesResponse, breakdowns?: BreakdownsResponse): Metric[] {
  if (!overview) return unavailableMetrics();
  const seriesValues = (key: "total_transactions" | "total_amount" | "unique_buyers") =>
    (timeseries?.series ?? []).flatMap(row => {
      const value = chartNumber(row[key]);
      return value === undefined ? [] : [value];
    });
  const observed = { delta: "observed", context: "last 30 days", trend: "flat" as const };
  const snapshot = { delta: "current", context: "catalog snapshot", trend: "flat" as const, bars: [] };
  const volume = assetTotalParts(overview.total_amount, breakdowns);
  return [
    { label: "Payments observed", value: compactDecimalString(overview.total_transactions), ...observed, bars: seriesValues("total_transactions") },
    { label: "Unique buyers", value: compactDecimalString(overview.unique_buyers), ...observed, bars: seriesValues("unique_buyers") },
    { label: "Active services", value: compactDecimalString(overview.active_resources), ...snapshot },
    { label: "Volume", value: volume.value, ...observed, context: volume.unit ? `${volume.unit} · last 30 days` : observed.context, bars: seriesValues("total_amount") },
  ];
}

export function adaptEntity(
  resource: DiscoveryResource,
  options: {
    summary?: AnalyticsResource;
    observability?: ResourceObservabilityResponse;
    analyticsState: DataState;
  },
): Entity {
  const paymentOptions = resource.accepts.map(formatPaymentOption);
  const primary = resource.accepts[0];
  const noObservation = (options.analyticsState === "success" || options.analyticsState === "empty") && !options.summary;
  const transactions = options.observability
    ? compactDecimalString(options.observability.calls_all_time)
    : noObservation ? "No observations yet" : "Unavailable";
  const buyers = options.observability
    ? compactDecimalString(options.observability.unique_buyers)
    : noObservation ? "No observations yet" : "Unavailable";
  // Settled value is reported in atomic units of the resource's own asset.
  const volume = options.observability
    ? formatAtomicAmount(options.observability.total_amount, primary?.asset)
    : noObservation ? "No observations yet" : "Unavailable";
  return {
    name: resource.serviceName || resourceLabel(resource.resource, resource.type),
    category: resource.type === "mcp" ? "MCP" : "HTTP",
    description: resource.description || "Description unavailable",
    domain: resourceLabel(resource.resource, resource.type),
    resource: resource.resource,
    ...(safeResourceHref(resource.resource, resource.type) ? { href: safeResourceHref(resource.resource, resource.type) } : {}),
    price: primary ? formatAtomicAmount(primary.amount, primary.asset) : "Price unavailable",
    paymentOptions,
    optionCount: paymentOptions.length,
    transactions,
    volume,
    buyers,
    network: humanNetwork(primary?.network),
    freshness: relativeTime(options.observability?.latest_activity ?? resource.lastUpdated),
    stale: options.summary?.status === "stale",
    accent: resource.type === "mcp" ? "yellow" : "graphite",
  };
}

export function adaptActivity(row: TransactionRow): Activity {
  const hash = row.transaction_hash ?? "";
  const explorerUrl = transactionExplorerUrl(row.network, hash);
  const recipient = row.resource_url
    ? resourceLabel(row.resource_url, "http")
    : row.pay_to ? `Recipient ${shortIdentifier(row.pay_to)}` : "Recipient unavailable";
  return {
    entity: recipient,
    type: `${row.scheme ?? "Unknown scheme"} payment`,
    amount: formatAtomicAmount(row.amount, row.asset, row.asset_symbol, row.asset_decimals),
    network: humanNetwork(row.network),
    facilitator: row.facilitator_id ? shortIdentifier(row.facilitator_id) : "Unavailable",
    payer: row.payer ? shortIdentifier(row.payer) : "Unavailable",
    hash,
    ...(explorerUrl ? { explorerUrl } : {}),
    time: relativeTime(row.occurred_at),
    state: row.status === "success" ? "settled" : row.status === "failed" ? "failed" : "pending",
  };
}

function observedValue(value: string | undefined, observed: boolean): string {
  return observed ? compactDecimalString(value) : "No observations yet";
}

export function adaptNetworks(
  breakdowns: BreakdownsResponse | undefined,
  supported: SupportedResponse | undefined,
  health: HealthReadyResponse | undefined,
): NetworkSummary[] {
  const observed = new Map((breakdowns?.networks ?? []).map(row => [row.key, row]));
  const kinds = supported?.kinds ?? [];
  const names = new Set<string>([
    ...observed.keys(),
    ...kinds.map(kind => kind.network),
  ]);
  const ready = health?.status === "ready";

  return [...names].sort().map((network, index) => {
    const row = observed.get(network);
    const configuredKinds = kinds.filter(kind => kind.network === network);
    const configured = configuredKinds.length > 0;
    const enabled = configured;
    const isObserved = row !== undefined;
    const role = network === "stellar:testnet"
      ? "Test settlement environment"
      : network === "stellar:pubnet"
        ? "Public settlement network"
        : "Configured settlement network";
    return {
      id: network,
      name: humanNetwork(network),
      role,
      buyers: observedValue(row?.unique_buyers, isObserved),
      payments: observedValue(row?.tx_count, isObserved),
      sellers: observedValue(row?.unique_sellers, isObserved),
      configured,
      enabled,
      observed: isObserved,
      feeSponsored: configuredKinds.some(kind => kind.extra?.areFeesSponsored === true),
      status: enabled && ready ? "online" : enabled ? "limited" : "preview",
      accent: index === 0 ? "yellow" : "graphite",
    };
  });
}

export function adaptFacilitators(
  overview: OverviewResponse | undefined,
  supported: SupportedResponse | undefined,
  health: HealthReadyResponse | undefined,
  healthState: DataState,
): FacilitatorSummary[] {
  if (!overview && !supported && !health) return [];
  const kinds = supported?.kinds ?? [];
  const status = healthState === "success" || healthState === "partial"
    ? health?.status === "ready" ? "Ready" : "Degraded"
    : "Unavailable";
  return [{
    name: "openx402",
    description: "The deployed facilitator serving this dashboard's discovery and settlement analytics.",
    settlements: compactDecimalString(overview?.successful_transactions),
    payments: compactDecimalString(overview?.total_transactions),
    status,
    supported: supported ? `${kinds.length} payment ${kinds.length === 1 ? "kind" : "kinds"}` : "Capabilities unavailable",
    accent: "yellow",
  }];
}

export function adaptEcosystemGroups(
  entities: Entity[],
  networks: NetworkSummary[],
  facilitators: FacilitatorSummary[],
): EcosystemGroup[] {
  const groups: EcosystemGroup[] = [
    { category: "HTTP resources", entities: entities.filter(entity => entity.category === "HTTP").map(entity => entity.name) },
    { category: "MCP resources", entities: entities.filter(entity => entity.category === "MCP").map(entity => entity.name) },
    { category: "Enabled networks", entities: networks.filter(network => network.enabled).map(network => network.name) },
    { category: "Facilitators", entities: facilitators.map(facilitator => facilitator.name) },
  ];
  return groups.filter(group => group.entities.length > 0);
}
