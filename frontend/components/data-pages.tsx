"use client";

import { useMemo, useState, type ReactNode } from "react";

import {
  ActivityIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  CheckIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FilterIcon,
  GlobeIcon,
  NetworkIcon,
  SearchIcon,
  ServerIcon,
} from "@/components/icons";
import {
  type Activity,
  type DashboardData,
  type Entity,
} from "@/components/data";
import {
  AppShell,
  EntityLogo,
  MetricCard,
  PageContainer,
  PageHeader,
  SectionHeading,
  StatusBadge,
} from "@/components/explorer-shell";
import { Badge, Card, Input, SelectField, cn } from "@/components/ui";

export function AllPage({ data }: { data: DashboardData }) {
  return (
    <AppShell>
      <PageContainer className="data-page">
        <PageHeader
          description="Aggregate activity across services, payments, facilitators, and networks."
          title="All activity"
        />

        <section className="section-block section-block--compact" aria-labelledby="overall-title">
          <SectionHeading title="Overall stats" description="Observed over the last 30 days unless marked as a current catalog value." />
          <div className="metric-grid">{data.metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}</div>
        </section>

        <section className="section-block" aria-labelledby="top-services-title">
          <SectionHeading
            title="Top services"
            description="Seller-declared services ordered by the facilitator response."
          />
          {data.entities.length ? <EntityTable entities={data.entities} /> : <UnavailableState />}
        </section>
      </PageContainer>
    </AppShell>
  );
}

export function MarketplacePage({ data }: { data: DashboardData }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All categories");
  const filteredEntities = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    return data.entities.filter((entity) => {
      const matchesQuery = !normalized || [entity.name, entity.description, entity.domain].join(" ").toLowerCase().includes(normalized);
      const matchesCategory = category === "All categories" || entity.category === category;
      return matchesQuery && matchesCategory;
    });
  }, [category, data.entities, query]);
  const categories = ["All categories", ...new Set(data.entities.map((entity) => entity.category))];

  return (
    <AppShell>
      <PageContainer className="data-page">
        <PageHeader
          description="Browse services and merchants tracked by the index."
          title="Marketplace"
        />

        <section className="section-block section-block--compact" aria-labelledby="marketplace-pulse-title">
          <SectionHeading title="Marketplace stats" description="Activity across the services currently in the index." />
          <div className="metric-grid metric-grid--three">
            {data.metrics.slice(0, 3).map((metric) => <MetricCard key={metric.label} metric={metric} />)}
          </div>
        </section>

        <section className="section-block" aria-labelledby="browse-title">
          <SectionHeading
            title="Services & merchants"
            description="Identity first, then the activity that makes an entity worth opening."
          />
          <div className="browse-toolbar">
            <label className="toolbar-search">
              <SearchIcon size={18} />
              <span className="sr-only">Search services</span>
              <Input onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, description, or domain" value={query} />
            </label>
            <label className="toolbar-select">
              <FilterIcon size={17} />
              <span className="sr-only">Filter by category</span>
              <SelectField aria-label="Filter by category" onChange={(event) => setCategory(event.target.value)} value={category}>
                {categories.map((option) => <option key={option}>{option}</option>)}
              </SelectField>
            </label>
            <span className="toolbar-count mono">{filteredEntities.length.toString().padStart(2, "0")} RESULTS</span>
          </div>
          {filteredEntities.length ? (
            <div className="directory-grid">{filteredEntities.map((entity) => <MarketplaceCard entity={entity} key={entity.name} />)}</div>
          ) : (
            <StatePanel kind="empty" title="No services match that cut." description="Try a broader name or clear the category filter." action={<button className="text-link text-link--button" onClick={() => { setQuery(""); setCategory("All categories"); }} type="button">Reset browse <ArrowRightIcon size={16} /></button>} />
          )}
        </section>
      </PageContainer>
    </AppShell>
  );
}

export function TransactionsPage({ data }: { data: DashboardData }) {
  const [state, setState] = useState("All states");
  const rows = state === "All states" ? data.activity : data.activity.filter((row) => row.state === state.toLowerCase());

  return (
    <AppShell>
      <PageContainer className="data-page">
        <PageHeader
          actions={<SelectField aria-label="Filter transaction state" onChange={(event) => setState(event.target.value)} value={state}><option>All states</option><option>Settled</option><option>Pending</option><option>Failed</option></SelectField>}
          description="Inspect tracked payments and settlement receipts."
          title="Transactions"
        />
        <section className="section-block section-block--compact" aria-labelledby="transaction-pulse-title">
          <div className="transaction-callout">
            <div className="transaction-callout__icon"><ActivityIcon size={22} /></div>
            <div><strong>Live settlement window</strong><span>Receipts shown here are observed by this facilitator and loaded from its settlement index.</span></div>
            <Badge tone={data.connected ? "success" : "neutral"}><span className="status-badge__dot" /> {data.connected ? "connected" : "offline"}</Badge>
          </div>
        </section>
        <section className="section-block" aria-labelledby="ledger-title">
          <SectionHeading title="Latest receipts" description="Hashes link to their network explorer when a submitted transaction exists." />
          {rows.length ? <ActivityTable rows={rows} /> : <UnavailableState />}
        </section>
      </PageContainer>
    </AppShell>
  );
}

export function FacilitatorsPage({ data }: { data: DashboardData }) {
  return (
    <AppShell>
      <PageContainer className="data-page">
        <PageHeader
          description="Compare payment facilitators and their routing activity."
          title="Facilitators"
        />
        <section className="section-block section-block--compact" aria-labelledby="facilitator-pulse-title">
          <div className="facilitator-banner">
            <div className="facilitator-banner__copy"><h2>Facilitator activity</h2><p>Current capabilities and observed settlement activity from the deployed openx402 facilitator.</p></div>
            <div className="facilitator-banner__stats"><span><strong>{data.connected ? "Live" : "Offline"}</strong><small>service status</small></span><span><strong>{data.metrics[0]?.value ?? "—"}</strong><small>observed payments</small></span><span><strong>{data.networks.length}</strong><small>rails supported</small></span></div>
            <NetworkIcon className="facilitator-banner__mark" size={104} />
          </div>
        </section>
        <section className="section-block" aria-labelledby="facilitator-directory-title">
          <SectionHeading title="Facilitator directory" description="Operational context for the services doing the routing." />
          {data.facilitators.length ? <div className="facilitator-list">
            {data.facilitators.map((facilitator, index) => (
              <Card className="facilitator-row" key={facilitator.name}>
                <span className="rank mono">0{index + 1}</span>
                <EntityLogo accent={facilitator.accent} name={facilitator.name} size="lg" />
                <div className="facilitator-row__identity"><h3>{facilitator.name}</h3><p>{facilitator.description}</p></div>
                <div className="facilitator-row__metric"><span>Settlements</span><strong>{facilitator.settlements}</strong></div>
                <div className="facilitator-row__metric"><span>Payments</span><strong>{facilitator.payments}</strong></div>
                <div className="facilitator-row__metric"><span>Status</span><strong>{facilitator.status}</strong></div>
                <div className="facilitator-row__end"><Badge tone="neutral">{facilitator.supported}</Badge></div>
              </Card>
            ))}
          </div> : <UnavailableState />}
        </section>
      </PageContainer>
    </AppShell>
  );
}

export function NetworksPage({ data }: { data: DashboardData }) {
  return (
    <AppShell>
      <PageContainer className="data-page">
        <PageHeader
          description="Compare supported settlement networks and environments."
          title="Networks"
        />
        <section className="section-block section-block--compact" aria-labelledby="network-summary-title">
          <SectionHeading title="Network overview" description="Availability and activity by settlement environment." />
          <div className="network-grid">
            {data.networks.map((network) => (
              <Card className={cn("network-card", network.status === "online" && "network-card--online")} key={network.name}>
                <div className="network-card__top"><EntityLogo accent={network.accent} name={network.name} size="lg" /><StatusBadge state={network.status as "online" | "limited" | "preview"} /></div>
                <div className="network-card__copy"><h3>{network.name}</h3><p>{network.role}</p></div>
                <div className="network-card__metrics"><span><small>Buyers</small><strong>{network.buyers}</strong></span><span><small>Payments</small><strong>{network.payments}</strong></span><span><small>Sellers</small><strong>{network.sellers}</strong></span></div>
              </Card>
            ))}
          </div>
          {!data.networks.length && <UnavailableState />}
        </section>
        <section className="section-block" aria-labelledby="capability-title">
          <SectionHeading title="Network capabilities" description="Compare the supported capabilities of each settlement environment." />
          <Card className="capability-card">
            <div className="capability-card__lead"><GlobeIcon size={19} /><span>Capability</span></div>
            {data.networks.map((network) => <div className="capability-card__network" key={network.name}><EntityLogo accent={network.accent} name={network.name} size="sm" /><span>{network.name.replace("Stellar ", "")}</span></div>)}
            {[
              ["Fast settlement", data.networks.map(() => true)],
              ["Production ready", data.networks.map(network => network.name.toLowerCase().includes("pubnet"))],
              ["Receipt indexing", data.networks.map(() => true)],
              ["Self-hostable", data.networks.map(() => true)],
            ].map(([label, values]) => <div className="capability-row" key={label as string}><span>{label as string}</span>{(values as boolean[]).map((value, index) => <span className={cn("capability-cell", value ? "capability-cell--yes" : "capability-cell--no")} key={`${label}-${index}`}>{value ? <CheckIcon size={15} /> : "—"}</span>)}</div>)}
          </Card>
        </section>
      </PageContainer>
    </AppShell>
  );
}

export function EcosystemPage({ data }: { data: DashboardData }) {
  return (
    <AppShell>
      <PageContainer className="data-page">
        <PageHeader
          description="Browse organizations, tools, and infrastructure in the wider ecosystem."
          title="Ecosystem"
        />
        <section className="section-block section-block--compact" aria-labelledby="ecosystem-groups-title">
          <SectionHeading title="Ecosystem categories" description="Browse the index by build tools, payment rails, or data services." />
          <div className="ecosystem-groups">
            {data.ecosystemGroups.map((group, index) => (
              <Card className="ecosystem-group" key={group.category}>
                <div className="ecosystem-group__top"><span className="mono">0{index + 1}</span><ArrowUpRightIcon size={18} /></div>
                <div className="ecosystem-group__icon">{index === 0 ? <ServerIcon size={22} /> : index === 1 ? <NetworkIcon size={22} /> : <DatabaseIcon size={22} />}</div>
                <h3>{group.category}</h3>
                <div className="ecosystem-group__entities">{group.entities.map((entity) => <span key={entity}>{entity}</span>)}</div>
              </Card>
            ))}
          </div>
        </section>
        <section className="section-block" aria-labelledby="directory-title">
          <SectionHeading title="Directory" description="Entities currently represented in the ecosystem index." />
          <div className="ecosystem-directory">
            {data.entities.map((entity) => <DirectoryRow entity={entity} key={`${entity.url}:${entity.name}`} />)}
          </div>
          {!data.entities.length && <UnavailableState />}
        </section>
      </PageContainer>
    </AppShell>
  );
}

function EntityTable({ entities }: { entities: Entity[] }) {
  return (
    <Card className="table-card">
      <div className="table-scroll">
        <table className="data-table">
          <caption className="sr-only">Ranked services in the openx402 index</caption>
          <thead><tr><th scope="col">Service</th><th scope="col">Category</th><th scope="col">Price</th><th scope="col">Payments</th><th scope="col">Buyers</th><th scope="col">Latest</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>{entities.map((entity) => <tr key={`${entity.url}:${entity.name}`}><td><a className="table-entity" href={entity.url} rel="noreferrer" target="_blank"><EntityLogo accent={entity.accent} name={entity.name} size="sm" /><span><strong>{entity.name}</strong><small>{entity.description}</small><em>{entity.domain}</em></span></a></td><td><span className="table-muted">{entity.category}</span></td><td><strong className="table-number">{entity.price}</strong></td><td><span className="mono table-muted">{entity.transactions}</span></td><td><span className="mono table-muted">{entity.buyers}</span></td><td><span className="table-muted">{entity.freshness}</span></td><td><ArrowUpRightIcon size={17} /></td></tr>)}</tbody>
        </table>
      </div>
      <Pagination label={`${entities.length} indexed services`} />
    </Card>
  );
}

function ActivityTable({ rows }: { rows: Activity[] }) {
  return (
    <Card className="table-card">
      <div className="table-scroll">
        <table className="data-table data-table--transactions">
          <caption className="sr-only">Latest openx402 transactions</caption>
          <thead><tr><th scope="col">Entity / event</th><th scope="col">Amount</th><th scope="col">Sender</th><th scope="col">Hash</th><th scope="col">Network</th><th scope="col">Facilitator</th><th scope="col">Time</th><th scope="col">State</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.hash || `${row.entity}:${index}`}><td><div className="table-entity"><EntityLogo accent="graphite" name={row.entity} size="sm" /><span><strong>{row.entity}</strong><small>{row.type}</small></span></div></td><td><strong className="table-number">{row.amount}</strong></td><td><span className="mono table-muted">{row.payer}</span></td><td>{row.explorerUrl ? <a className="hash-button mono" href={row.explorerUrl} rel="noreferrer" target="_blank" title={`Open transaction ${row.hash}`}>{shortHash(row.hash)}<ArrowUpRightIcon size={13} /></a> : <span className="mono table-muted">{shortHash(row.hash)}</span>}</td><td><span className="table-network"><span className="network-dot" />{row.network}</span></td><td><span className="table-muted">{row.facilitator}</span></td><td><time className="table-muted">{row.time}</time></td><td><StatusBadge state={row.state} /></td></tr>)}</tbody>
        </table>
      </div>
      <Pagination label={`${rows.length} recent receipts`} />
    </Card>
  );
}

function MarketplaceCard({ entity }: { entity: Entity }) {
  return (
    <a className="marketplace-card" href={entity.url} rel="noreferrer" target="_blank">
      <div className="marketplace-card__top"><EntityLogo accent={entity.accent} name={entity.name} size="lg" /><Badge tone="neutral">{entity.category}</Badge></div>
      <h3>{entity.name}</h3>
      <p>{entity.description}</p>
      <span className="marketplace-card__domain">{entity.domain} <ExternalLinkIcon size={14} /></span>
      <div className="marketplace-card__footer"><span><small>Price</small><strong>{entity.price}</strong></span><span><small>Payments</small><strong>{entity.transactions}</strong></span><span className="marketplace-card__arrow"><ArrowUpRightIcon size={17} /></span></div>
    </a>
  );
}

function DirectoryRow({ entity }: { entity: Entity }) {
  return (
    <a className="directory-row" href={entity.url} rel="noreferrer" target="_blank">
      <EntityLogo accent={entity.accent} name={entity.name} size="md" />
      <div className="directory-row__identity"><strong>{entity.name}</strong><span>{entity.category}</span></div>
      <p>{entity.description}</p>
      <span className="directory-row__domain mono">{entity.domain}</span>
      <ArrowUpRightIcon size={17} />
    </a>
  );
}

function Pagination({ label }: { label: string }) {
  return <div className="pagination"><span className="mono">{label}</span></div>;
}

function StatePanel({ kind, title, description, action }: { kind: "empty" | "error"; title: string; description: string; action?: ReactNode }) {
  return <Card className={cn("state-panel", `state-panel--${kind}`)}><div className="state-panel__icon">{kind === "empty" ? <SearchIcon size={20} /> : <ActivityIcon size={20} />}</div><h3>{title}</h3><p>{description}</p>{action}</Card>;
}

function UnavailableState() {
  return <StatePanel kind="empty" title="No live data yet." description="The catalog will populate after a Bazaar-declared payment is verified by this facilitator." />;
}

function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 7)}…${hash.slice(-6)}` : hash || "—";
}
