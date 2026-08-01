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
  volume: string;
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
  hash: string;
  time: string;
  state: "settled" | "pending";
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

export const metrics: Metric[] = [
  {
    label: "Payments observed",
    value: "184.2k",
    delta: "+18.6%",
    context: "last 30 days",
    trend: "up",
    bars: [22, 34, 28, 46, 38, 52, 44, 60, 51, 72, 68, 80, 76, 94],
  },
  {
    label: "Settlement volume",
    value: "$42.8k",
    delta: "+9.4%",
    context: "last 30 days",
    trend: "up",
    bars: [18, 26, 22, 36, 28, 31, 48, 44, 55, 42, 65, 58, 76, 70],
  },
  {
    label: "Active services",
    value: "1,284",
    delta: "+14.1%",
    context: "indexed endpoints",
    trend: "up",
    bars: [44, 49, 52, 51, 56, 55, 60, 63, 69, 72, 71, 79, 83, 88],
  },
  {
    label: "Networks online",
    value: "12",
    delta: "+2 this month",
    context: "available rails",
    trend: "flat",
    bars: [32, 32, 38, 38, 44, 44, 52, 52, 52, 60, 60, 70, 70, 70],
  },
];

export const featuredEntities: Entity[] = [
  {
    name: "RouteKit",
    category: "Agent tooling",
    description: "A routing layer for agents that need paid web actions with receipts.",
    domain: "routekit.dev",
    volume: "$12.4k",
    transactions: "38.4k",
    buyers: "862",
    network: "Stellar",
    freshness: "2m ago",
    accent: "yellow",
  },
  {
    name: "Proofmail",
    category: "Communication",
    description: "Send high-trust email workflows with a clear settlement trail.",
    domain: "proofmail.io",
    volume: "$8.7k",
    transactions: "21.8k",
    buyers: "412",
    network: "Stellar",
    freshness: "6m ago",
    accent: "graphite",
  },
  {
    name: "Scout MCP",
    category: "Research",
    description: "Discover paid MCP tools and invoke them from one agent-native catalog.",
    domain: "scoutmcp.com",
    volume: "$6.1k",
    transactions: "17.2k",
    buyers: "306",
    network: "Stellar",
    freshness: "11m ago",
    accent: "ink",
  },
  {
    name: "Ledger Lens",
    category: "Data",
    description: "Readable blockchain context for products that should explain every move.",
    domain: "ledgerlens.xyz",
    volume: "$4.8k",
    transactions: "12.6k",
    buyers: "194",
    network: "Stellar",
    freshness: "18m ago",
    accent: "paper",
  },
  {
    name: "Beacon API",
    category: "Infrastructure",
    description: "Low-latency primitives for agents that need a reliable next step.",
    domain: "beaconapi.dev",
    volume: "$3.3k",
    transactions: "9.8k",
    buyers: "157",
    network: "Stellar",
    freshness: "24m ago",
    accent: "yellow",
  },
];

export const recentActivity: Activity[] = [
  {
    entity: "RouteKit",
    type: "service call",
    amount: "$0.42",
    network: "Stellar",
    facilitator: "openx402",
    hash: "a81f…91c2",
    time: "2 min ago",
    state: "settled",
  },
  {
    entity: "Proofmail",
    type: "message delivery",
    amount: "$0.08",
    network: "Stellar",
    facilitator: "Bridgeway",
    hash: "7d30…ce12",
    time: "6 min ago",
    state: "settled",
  },
  {
    entity: "Scout MCP",
    type: "catalog lookup",
    amount: "$0.15",
    network: "Stellar",
    facilitator: "openx402",
    hash: "44b0…8fa3",
    time: "11 min ago",
    state: "settled",
  },
  {
    entity: "Beacon API",
    type: "data request",
    amount: "$0.26",
    network: "Stellar",
    facilitator: "Relay House",
    hash: "e90a…0b72",
    time: "18 min ago",
    state: "pending",
  },
  {
    entity: "Ledger Lens",
    type: "context fetch",
    amount: "$0.05",
    network: "Stellar",
    facilitator: "openx402",
    hash: "091c…6d44",
    time: "23 min ago",
    state: "settled",
  },
];

export const facilitators = [
  { name: "openx402", description: "Reference facilitator for open, self-hostable rails.", volume: "$18.9k", payments: "82.4k", uptime: "99.98%", supported: "12 rails", accent: "yellow" },
  { name: "Bridgeway", description: "Multi-network routing with detailed settlement receipts.", volume: "$11.3k", payments: "46.8k", uptime: "99.95%", supported: "8 rails", accent: "graphite" },
  { name: "Relay House", description: "Small, fast facilitator for builder-owned service catalogs.", volume: "$7.1k", payments: "32.5k", uptime: "99.91%", supported: "5 rails", accent: "ink" },
  { name: "Northstar", description: "Compliance-ready payment routing for production workloads.", volume: "$5.5k", payments: "22.5k", uptime: "99.89%", supported: "4 rails", accent: "paper" },
];

export const networks = [
  { name: "Stellar mainnet", role: "Primary settlement rail", volume: "$38.4k", payments: "161.7k", latency: "4.2s", status: "online", accent: "yellow" },
  { name: "Stellar testnet", role: "Conformance and staging", volume: "$3.7k", payments: "22.5k", latency: "3.8s", status: "online", accent: "graphite" },
  { name: "EVM sandbox", role: "Compatibility preview", volume: "$0.7k", payments: "4.2k", latency: "12.4s", status: "limited", accent: "ink" },
  { name: "Local relay", role: "Self-hosted development", volume: "—", payments: "1.1k", latency: "1.2s", status: "preview", accent: "paper" },
];

export const ecosystemGroups = [
  { category: "Build", entities: ["RouteKit", "Scout MCP", "Beacon API"] },
  { category: "Settle", entities: ["openx402", "Bridgeway", "Relay House"] },
  { category: "Understand", entities: ["Ledger Lens", "Proofmail", "Northstar"] },
];

export const transactionRows = [
  ...recentActivity,
  { entity: "RouteKit", type: "service call", amount: "$0.72", network: "Stellar", facilitator: "openx402", hash: "b021…c718", time: "31 min ago", state: "settled" as const },
  { entity: "Proofmail", type: "message delivery", amount: "$0.09", network: "Stellar", facilitator: "Bridgeway", hash: "1f20…80a1", time: "39 min ago", state: "settled" as const },
  { entity: "Beacon API", type: "data request", amount: "$0.22", network: "Stellar", facilitator: "Relay House", hash: "d2f0…109e", time: "44 min ago", state: "settled" as const },
];
