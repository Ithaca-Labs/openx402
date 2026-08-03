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

function unavailableMetrics(): Metric[] {
  return ["Payments observed", "Unique buyers", "Active services", "Networks observed"].map(label => ({
    label,
    value: "Unavailable",
    delta: "unavailable",
    context: "analytics unavailable",
    trend: "flat" as const,
    bars: [],
  }));
}

export function adaptMetrics(overview?: OverviewResponse, timeseries?: TimeseriesResponse): Metric[] {
  if (!overview) return unavailableMetrics();
  const transactionValues = (timeseries?.series ?? []).flatMap(row => {
    const value = chartNumber(row.total_transactions);
    return value === undefined ? [] : [value];
  });
  const buyerValues = (timeseries?.series ?? []).flatMap(row => {
    const value = chartNumber(row.unique_buyers);
    return value === undefined ? [] : [value];
  });
  const observed = { delta: "observed", context: "last 30 days", trend: "flat" as const };
  const snapshot = { delta: "current", context: "catalog snapshot", trend: "flat" as const, bars: [] };
  return [
    { label: "Payments observed", value: compactDecimalString(overview.total_transactions), ...observed, bars: transactionValues },
    { label: "Unique buyers", value: compactDecimalString(overview.unique_buyers), ...observed, bars: buyerValues },
    { label: "Active services", value: compactDecimalString(overview.active_resources), ...snapshot },
    { label: "Networks observed", value: compactDecimalString(overview.unique_networks), ...snapshot },
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
    buyers,
    network: humanNetwork(primary?.network),
    freshness: relativeTime(resource.lastUpdated),
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
