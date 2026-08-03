export type NavItem = {
  href: string;
  label: string;
};

export type Trend = "up" | "down" | "flat";
export type DataState = "success" | "empty" | "partial" | "unavailable" | "invalid";

export type Metric = {
  label: string;
  value: string;
  delta: string;
  context: string;
  trend: Trend;
  bars: number[];
};

export type Entity = {
  name: string;
  category: "HTTP" | "MCP";
  description: string;
  domain: string;
  resource: string;
  href?: string;
  price: string;
  paymentOptions: string[];
  optionCount: number;
  transactions: string;
  buyers: string;
  network: string;
  freshness: string;
  stale: boolean;
  accent: string;
};

export type Activity = {
  entity: string;
  type: string;
  amount: string;
  network: string;
  facilitator: string;
  payer: string;
  hash: string;
  explorerUrl?: string;
  time: string;
  state: "settled" | "pending" | "failed";
};

export type FacilitatorSummary = {
  name: string;
  description: string;
  settlements: string;
  payments: string;
  status: "Ready" | "Degraded" | "Unavailable";
  supported: string;
  accent: string;
};

export type NetworkSummary = {
  id: string;
  name: string;
  role: string;
  buyers: string;
  payments: string;
  sellers: string;
  configured: boolean;
  enabled: boolean;
  observed: boolean;
  feeSponsored: boolean;
  status: "online" | "limited" | "preview";
  accent: string;
};

export type EcosystemGroup = {
  category: string;
  entities: string[];
};

export type PageInfo = {
  kind: "cursor" | "offset";
  limit: number;
  nextCursor?: string;
  offset?: number;
  total?: number;
};

export type DashboardData = {
  metrics: Metric[];
  entities: Entity[];
  activity: Activity[];
  facilitators: FacilitatorSummary[];
  networks: NetworkSummary[];
  ecosystemGroups: EcosystemGroup[];
  states: {
    health: DataState;
    discovery: DataState;
    analytics: DataState;
    supported: DataState;
  };
  pagination?: PageInfo;
  partialResults: boolean;
  connected: boolean;
};

export const navItems: NavItem[] = [
  { href: "/discover", label: "Discover" },
  { href: "/all", label: "All activity" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/transactions", label: "Transactions" },
  { href: "/ecosystem", label: "Ecosystem" },
];
