"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import {
  ActivityIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FilterIcon,
  GlobeIcon,
  NetworkIcon,
  SearchIcon,
  ServerIcon,
  SlidersIcon,
} from "@/components/icons";
import {
  ecosystemGroups,
  facilitators,
  featuredEntities,
  metrics,
  networks,
  transactionRows,
  type Activity,
  type Entity,
} from "@/components/data";
import {
  AppShell,
  EntityLogo,
  MetricCard,
  PageContainer,
  PageHeader,
  SectionHeading,
  Sparkline,
  StatusBadge,
  TimeControl,
} from "@/components/explorer-shell";
import { Badge, Card, Input, SelectField, cn } from "@/components/ui";

export function AllPage() {
  const [grouping, setGrouping] = useState("Volume");

  return (
    <AppShell>
      <PageContainer className="data-page">
        <PageHeader
          actions={
            <div className="control-cluster">
              <SelectField aria-label="Group statistics by" onChange={(event) => setGrouping(event.target.value)} value={grouping}>
                <option>Volume</option>
                <option>Payments</option>
                <option>Buyers</option>
              </SelectField>
              <TimeControl label="Last 30 days" />
            </div>
          }
          description="Aggregate activity across services, payments, facilitators, and networks."
          eyebrow="ALL ACTIVITY / SYSTEM VIEW"
          title="All activity"
        />

        <section className="section-block section-block--compact" aria-labelledby="overall-title">
          <SectionHeading title="Overall stats" description={`Grouped by ${grouping.toLowerCase()} across the current index.`} />
          <div className="metric-grid">{metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}</div>
        </section>

        <section className="section-block" aria-labelledby="top-services-title">
          <SectionHeading
            eyebrow="RANKED DIRECTORY"
            title="Top services"
            description="The services with the clearest activity signal in the selected window."
            action={<TimeControl label="Last 30 days" />}
          />
          <EntityTable entities={featuredEntities} />
        </section>
      </PageContainer>
    </AppShell>
  );
}

export function MarketplacePage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All categories");
  const filteredEntities = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    return featuredEntities.filter((entity) => {
      const matchesQuery = !normalized || [entity.name, entity.description, entity.domain].join(" ").toLowerCase().includes(normalized);
      const matchesCategory = category === "All categories" || entity.category === category;
      return matchesQuery && matchesCategory;
    });
  }, [category, query]);
  const categories = ["All categories", ...new Set(featuredEntities.map((entity) => entity.category))];

  return (
    <AppShell>
      <PageContainer className="data-page">
        <PageHeader
          actions={<div className="control-cluster"><TimeControl label="Last 30 days" /><Link className="ui-button ui-button--solid ui-button--sm" href="/ecosystem">Suggest a service <ArrowUpRightIcon size={15} /></Link></div>}
          description="Browse services and merchants tracked by the index."
          eyebrow="MARKETPLACE / DISCOVERABLE SERVICES"
          title="Marketplace"
        />

        <section className="section-block section-block--compact" aria-labelledby="marketplace-pulse-title">
          <SectionHeading title="Marketplace stats" description="Activity across the services currently in the index." />
          <div className="metric-grid metric-grid--three">
            {metrics.slice(0, 3).map((metric) => <MetricCard key={metric.label} metric={metric} />)}
          </div>
        </section>

        <section className="section-block" aria-labelledby="browse-title">
          <SectionHeading
            eyebrow="BROWSE THE INDEX"
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

export function TransactionsPage() {
  const [state, setState] = useState("All states");
  const rows = state === "All states" ? transactionRows : transactionRows.filter((row) => row.state === state.toLowerCase());

  return (
    <AppShell>
      <PageContainer className="data-page">
        <PageHeader
          actions={<div className="control-cluster"><TimeControl label="Last 24 hours" /><SelectField aria-label="Filter transaction state" onChange={(event) => setState(event.target.value)} value={state}><option>All states</option><option>Settled</option><option>Pending</option></SelectField></div>}
          description="Inspect tracked payments and settlement receipts."
          eyebrow="TRANSACTIONS / RECEIPTS"
          title="Transactions"
        />
        <section className="section-block section-block--compact" aria-labelledby="transaction-pulse-title">
          <div className="transaction-callout">
            <div className="transaction-callout__icon"><ActivityIcon size={22} /></div>
            <div><strong>Live settlement window</strong><span>Indexing 184,204 payments across 12 rails. New receipts land every few seconds.</span></div>
            <Badge tone="success"><span className="status-badge__dot" /> syncing</Badge>
          </div>
        </section>
        <section className="section-block" aria-labelledby="ledger-title">
          <SectionHeading eyebrow="THE LEDGER" title="Latest receipts" description="Hashes are shortened visually and remain copyable at the transaction level." action={<button className="control-button" type="button"><SlidersIcon size={15} /> More filters</button>} />
          <ActivityTable rows={rows} />
        </section>
      </PageContainer>
    </AppShell>
  );
}

export function FacilitatorsPage() {
  return (
    <AppShell>
      <PageContainer className="data-page">
        <PageHeader
          actions={<div className="control-cluster"><TimeControl label="Last 30 days" /><SelectField aria-label="Sort facilitators" defaultValue="Volume"><option>Volume</option><option>Payments</option><option>Uptime</option></SelectField></div>}
          description="Compare payment facilitators and their routing activity."
          eyebrow="FACILITATORS / ROUTING LAYER"
          title="Facilitators"
        />
        <section className="section-block section-block--compact" aria-labelledby="facilitator-pulse-title">
          <div className="facilitator-banner">
            <div className="facilitator-banner__copy"><div className="eyebrow">ROUTING HEALTH</div><h2>Facilitator activity</h2><p>Compare volume, uptime, and supported paths for the facilitators in the index.</p></div>
            <div className="facilitator-banner__stats"><span><strong>99.96%</strong><small>network average</small></span><span><strong>4.2s</strong><small>median settlement</small></span><span><strong>12</strong><small>rails supported</small></span></div>
            <NetworkIcon className="facilitator-banner__mark" size={104} />
          </div>
        </section>
        <section className="section-block" aria-labelledby="facilitator-directory-title">
          <SectionHeading eyebrow="RANKED OPERATORS" title="Facilitator directory" description="Operational context for the services doing the routing." />
          <div className="facilitator-list">
            {facilitators.map((facilitator, index) => (
              <Card className="facilitator-row" key={facilitator.name}>
                <span className="rank mono">0{index + 1}</span>
                <EntityLogo accent={facilitator.accent} name={facilitator.name} size="lg" />
                <div className="facilitator-row__identity"><h3>{facilitator.name}</h3><p>{facilitator.description}</p></div>
                <div className="facilitator-row__metric"><span>Volume</span><strong>{facilitator.volume}</strong></div>
                <div className="facilitator-row__metric"><span>Payments</span><strong>{facilitator.payments}</strong></div>
                <div className="facilitator-row__metric"><span>Uptime</span><strong>{facilitator.uptime}</strong></div>
                <div className="facilitator-row__end"><Badge tone="neutral">{facilitator.supported}</Badge><ArrowUpRightIcon size={18} /></div>
              </Card>
            ))}
          </div>
        </section>
      </PageContainer>
    </AppShell>
  );
}

export function NetworksPage() {
  return (
    <AppShell>
      <PageContainer className="data-page">
        <PageHeader
          actions={<div className="control-cluster"><TimeControl label="Last 30 days" /><Link className="ui-button ui-button--outline ui-button--sm" href="/ecosystem">Read the spec <ExternalLinkIcon size={15} /></Link></div>}
          description="Compare supported settlement networks and environments."
          eyebrow="NETWORKS / SETTLEMENT RAILS"
          title="Networks"
        />
        <section className="section-block section-block--compact" aria-labelledby="network-summary-title">
          <SectionHeading title="Network overview" description="Availability and activity by settlement environment." />
          <div className="network-grid">
            {networks.map((network) => (
              <Card className={cn("network-card", network.status === "online" && "network-card--online")} key={network.name}>
                <div className="network-card__top"><EntityLogo accent={network.accent} name={network.name} size="lg" /><StatusBadge state={network.status as "online" | "limited" | "preview"} /></div>
                <div className="network-card__copy"><h3>{network.name}</h3><p>{network.role}</p></div>
                <div className="network-card__metrics"><span><small>Volume</small><strong>{network.volume}</strong></span><span><small>Payments</small><strong>{network.payments}</strong></span><span><small>Latency</small><strong>{network.latency}</strong></span></div>
                <Sparkline className="sparkline--network" points={network.status === "online" ? [30, 36, 32, 46, 42, 55, 50, 61, 57, 68, 74] : [32, 35, 31, 33, 39, 36, 42, 40, 45, 43, 47]} />
              </Card>
            ))}
          </div>
        </section>
        <section className="section-block" aria-labelledby="capability-title">
          <SectionHeading eyebrow="CAPABILITY MAP" title="Network capabilities" description="Compare the supported capabilities of each settlement environment." />
          <Card className="capability-card">
            <div className="capability-card__lead"><GlobeIcon size={19} /><span>Capability</span></div>
            {networks.map((network) => <div className="capability-card__network" key={network.name}><EntityLogo accent={network.accent} name={network.name} size="sm" /><span>{network.name.replace("Stellar ", "").replace("EVM ", "EVM ")}</span></div>)}
            {[
              ["Fast settlement", [true, true, false, true]],
              ["Production ready", [true, false, false, false]],
              ["Receipt indexing", [true, true, true, true]],
              ["Self-hostable", [true, true, true, true]],
            ].map(([label, values]) => <div className="capability-row" key={label as string}><span>{label as string}</span>{(values as boolean[]).map((value, index) => <span className={cn("capability-cell", value ? "capability-cell--yes" : "capability-cell--no")} key={`${label}-${index}`}>{value ? <CheckIcon size={15} /> : "—"}</span>)}</div>)}
          </Card>
        </section>
      </PageContainer>
    </AppShell>
  );
}

export function EcosystemPage() {
  return (
    <AppShell>
      <PageContainer className="data-page">
        <PageHeader
          actions={<Link className="ui-button ui-button--solid ui-button--sm" href="/marketplace">Open marketplace <ArrowUpRightIcon size={15} /></Link>}
          description="Browse organizations, tools, and infrastructure in the wider ecosystem."
          eyebrow="ECOSYSTEM / THE WIDER MAP"
          title="Ecosystem"
        />
        <section className="section-block section-block--compact" aria-labelledby="ecosystem-groups-title">
          <SectionHeading title="Ecosystem categories" description="Browse the index by build tools, payment rails, or data services." />
          <div className="ecosystem-groups">
            {ecosystemGroups.map((group, index) => (
              <Card className="ecosystem-group" key={group.category}>
                <div className="ecosystem-group__top"><span className="mono">0{index + 1}</span><ArrowUpRightIcon size={18} /></div>
                <div className="ecosystem-group__icon">{index === 0 ? <ServerIcon size={22} /> : index === 1 ? <NetworkIcon size={22} /> : <DatabaseIcon size={22} />}</div>
                <div className="eyebrow">{group.eyebrow}</div>
                <h3>{group.category}</h3>
                <div className="ecosystem-group__entities">{group.entities.map((entity) => <span key={entity}>{entity}</span>)}</div>
              </Card>
            ))}
          </div>
        </section>
        <section className="section-block" aria-labelledby="directory-title">
          <SectionHeading eyebrow="CURATED DIRECTORY" title="Directory" description="Entities currently represented in the ecosystem index." action={<button className="control-button" type="button"><SlidersIcon size={15} /> Filter directory</button>} />
          <div className="ecosystem-directory">
            {[...featuredEntities, ...facilitators.map((facilitator) => ({ name: facilitator.name, category: "Facilitator", description: facilitator.description, domain: `${facilitator.name.toLowerCase().replaceAll(" ", "")}.network`, volume: facilitator.volume, transactions: facilitator.payments, buyers: "—", network: "Stellar", freshness: "online", accent: facilitator.accent }))].map((entity) => <DirectoryRow entity={entity} key={entity.name} />)}
          </div>
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
          <thead><tr><th scope="col">Service</th><th scope="col">Activity</th><th scope="col">Volume</th><th scope="col">Payments</th><th scope="col">Buyers</th><th scope="col">Latest</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>{entities.map((entity, index) => <tr key={entity.name}><td><Link className="table-entity" href={`/marketplace?entity=${encodeURIComponent(entity.name)}`}><EntityLogo accent={entity.accent} name={entity.name} size="sm" /><span><strong>{entity.name}</strong><small>{entity.description}</small><em>{entity.domain}</em></span></Link></td><td><Sparkline className="sparkline--table" points={[18 + index * 2, 27, 24, 38, 32, 43, 39, 50, 45, 58 + index * 3, 52, 65]} /></td><td><strong className="table-number">{entity.volume}</strong></td><td><span className="mono table-muted">{entity.transactions}</span></td><td><span className="mono table-muted">{entity.buyers}</span></td><td><span className="table-muted">{entity.freshness}</span></td><td><ArrowUpRightIcon size={17} /></td></tr>)}</tbody>
        </table>
      </div>
      <Pagination label={`1–${entities.length} of 1,284 services`} />
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
          <tbody>{rows.map((row) => <tr key={row.hash}><td><div className="table-entity"><EntityLogo accent={row.entity === "RouteKit" ? "yellow" : "graphite"} name={row.entity} size="sm" /><span><strong>{row.entity}</strong><small>{row.type}</small></span></div></td><td><strong className="table-number">{row.amount}</strong></td><td><span className="mono table-muted">GAB7…E9Q2</span></td><td><button className="hash-button mono" title={`Copy full transaction hash for ${row.hash}`} type="button">{row.hash}<span aria-hidden="true">⌘</span></button></td><td><span className="table-network"><span className="network-dot" />{row.network}</span></td><td><span className="table-muted">{row.facilitator}</span></td><td><time className="table-muted">{row.time}</time></td><td><StatusBadge state={row.state} /></td></tr>)}</tbody>
        </table>
      </div>
      <Pagination label={`1–${rows.length} of 184,204 receipts`} />
    </Card>
  );
}

function MarketplaceCard({ entity }: { entity: Entity }) {
  return (
    <Link className="marketplace-card" href={`/marketplace?entity=${encodeURIComponent(entity.name)}`}>
      <div className="marketplace-card__top"><EntityLogo accent={entity.accent} name={entity.name} size="lg" /><Badge tone="neutral">{entity.category}</Badge></div>
      <h3>{entity.name}</h3>
      <p>{entity.description}</p>
      <span className="marketplace-card__domain">{entity.domain} <ExternalLinkIcon size={14} /></span>
      <div className="marketplace-card__footer"><span><small>Volume</small><strong>{entity.volume}</strong></span><span><small>Payments</small><strong>{entity.transactions}</strong></span><span className="marketplace-card__arrow"><ArrowUpRightIcon size={17} /></span></div>
    </Link>
  );
}

function DirectoryRow({ entity }: { entity: Entity }) {
  return (
    <Link className="directory-row" href={`/marketplace?entity=${encodeURIComponent(entity.name)}`}>
      <EntityLogo accent={entity.accent} name={entity.name} size="md" />
      <div className="directory-row__identity"><strong>{entity.name}</strong><span>{entity.category}</span></div>
      <p>{entity.description}</p>
      <span className="directory-row__domain mono">{entity.domain}</span>
      <ArrowUpRightIcon size={17} />
    </Link>
  );
}

function Pagination({ label }: { label: string }) {
  return <div className="pagination"><span className="mono">{label}</span><div><button aria-label="Previous page" className="pagination__button" type="button"><ChevronLeftIcon size={16} /></button><button aria-label="Next page" className="pagination__button" type="button"><ChevronRightIcon size={16} /></button></div></div>;
}

function StatePanel({ kind, title, description, action }: { kind: "empty" | "error"; title: string; description: string; action?: ReactNode }) {
  return <Card className={cn("state-panel", `state-panel--${kind}`)}><div className="state-panel__icon">{kind === "empty" ? <SearchIcon size={20} /> : <ActivityIcon size={20} />}</div><h3>{title}</h3><p>{description}</p>{action}</Card>;
}
