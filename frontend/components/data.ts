export type NavItem = {
  href: string;
  label: string;
};

export type Trend = "up" | "down" | "flat";

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
  category: string;
  description: string;
  domain: string;
  url: string;
  price: string;
  transactions: string;
  buyers: string;
  network: string;
  freshness: string;
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
  status: string;
  supported: string;
  accent: string;
};

export type NetworkSummary = {
  name: string;
  role: string;
  buyers: string;
  payments: string;
  sellers: string;
  status: "online" | "limited" | "preview";
  accent: string;
};

export type EcosystemGroup = {
  category: string;
  entities: string[];
};

export type DashboardData = {
  metrics: Metric[];
  entities: Entity[];
  activity: Activity[];
  facilitators: FacilitatorSummary[];
  networks: NetworkSummary[];
  ecosystemGroups: EcosystemGroup[];
  connected: boolean;
};

export const navItems: NavItem[] = [
  { href: "/discover", label: "Discover" },
  { href: "/all", label: "All activity" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/transactions", label: "Transactions" },
  { href: "/facilitators", label: "Facilitators" },
  { href: "/networks", label: "Networks" },
  { href: "/ecosystem", label: "Ecosystem" },
];
