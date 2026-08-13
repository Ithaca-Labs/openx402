import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";

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
import type { Activity, DashboardData, DataState, Entity } from "@/components/data";
import {
  AppShell,
  EntityLogo,
  MetricSparkline,
  PageContainer,
  PageHeader,
  SectionHeading,
  StatusBadge,
} from "@/components/explorer-shell";
import { Badge, Card, Input, SelectField, cn } from "@/components/ui";
import { pageHref, type DashboardSearch } from "@/lib/facilitator";

export function AllPage({ data, search }: { data: DashboardData; search: DashboardSearch }) {
  return (
    <AppShell>
      <PageContainer className="data-page directory-page directory-page--all">
        {/* Sits above both the header and the metrics so the CSS-only toggle can
            style the labels in one and the charts in the other. */}
        <input className="metric-view-input" defaultChecked id="metric-view-curve" name="metric-view" type="radio" value="curve" />
        <input className="metric-view-input" id="metric-view-bars" name="metric-view" type="radio" value="bars" />
        <PageHeader
          actions={
            <div className="metric-view-toggle" role="group" aria-label="Chart style">
              <label className="metric-view-button" htmlFor="metric-view-curve">Curve</label>
              <label className="metric-view-button" htmlFor="metric-view-bars">Bars</label>
            </div>
          }
          description="Aggregate activity across services, payments, facilitators, and networks."
          pixelTitle
          title="All activity"
        />
        <AllActivityLayout data={data} search={search} />
      </PageContainer>
    </AppShell>
  );
}

function AllActivityLayout({ data, search }: { data: DashboardData; search: DashboardSearch }) {
  return (
    <div className="all-activity-directory">
      <section aria-label="Activity summary" className="all-activity-main">
        <div className="all-activity-summary">
          <div className="all-activity-summary__metrics">
            {data.metrics.map(metric => <article key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><MetricSparkline label={metric.label} points={metric.bars} /><small>{metric.context}</small></article>)}
          </div>
        </div>
        <section className="all-activity-ledger" aria-labelledby="indexed-services-title">
          <div className="all-activity-ledger__heading"><div><h2 id="indexed-services-title">Indexed services</h2><p>Seller-declared services in the facilitator&apos;s returned order.</p></div><span className="mono">{data.entities.length} SHOWN</span></div>
          {data.entities.length ? <>
            <div className="all-activity-ledger__labels" aria-hidden="true"><span>Service</span><span>Type</span><span>Primary option</span><span>Volume</span><span>Payments</span><span>Buyers</span><span>Latest</span><span /></div>
            <div className="all-activity-ledger__rows">
              {data.entities.map(entity => <article className="all-activity-ledger__row" key={`${entity.resource}:${entity.name}`}>
                <ResourceIdentity entity={entity} />
                <span className="ledger-type">{entity.category}</span>
                <strong className="table-price">{entity.price}</strong>
                <strong className="table-figure">{entity.volume}</strong>
                <strong className="table-figure">{entity.transactions}</strong>
                <strong className="table-figure">{entity.buyers}</strong>
                <span className="table-freshness">{entity.freshness}{entity.stale ? " · stale" : ""}</span>
                {entity.href ? <ArrowUpRightIcon size={16} /> : <span />}
              </article>)}
            </div>
            <Pagination data={data} label={paginationLabel(data, data.entities.length, "indexed services")} pathname="/all" search={search} />
          </> : <DiscoveryState pathname="/all" query={search.q} state={data.states.discovery} />}
        </section>
      </section>
      <aside className="all-activity-aside" aria-label="Activity scope">
        <dl><div><dt>Window</dt><dd>Last 30 days</dd></div><div><dt>Resources</dt><dd>{data.entities.length} on this page</dd></div><div><dt>Networks</dt><dd>{data.networks.length} observed</dd></div></dl>
      </aside>
    </div>
  );
}

export function MarketplacePage({ data, search }: { data: DashboardData; search: DashboardSearch }) {
  return (
    <AppShell>
      <PageContainer className="data-page directory-page directory-page--marketplace">
        <PageHeader description="Browse services and merchants tracked by the live Bazaar index." pixelTitle title="Marketplace" />
        <section className="marketplace-catalog" aria-labelledby="browse-title">
          <div className="marketplace-catalog__heading"><div><h2 id="browse-title">Services & merchants</h2><p>Search the complete server-side Bazaar catalog.</p></div><span className="mono">{data.entities.length} LISTED</span></div>
          <DiscoveryForm action="/marketplace" search={search} visibleCount={data.entities.length} />
          {data.entities.length ? (
            <>
              <div className="directory-grid">{data.entities.map(entity => <MarketplaceCard entity={entity} key={`${entity.resource}:${entity.name}`} />)}</div>
              <Pagination data={data} label={`${data.entities.length} results on this page`} pathname="/marketplace" search={search} />
            </>
          ) : <DiscoveryState pathname="/marketplace" query={search.q} state={data.states.discovery} />}
        </section>
      </PageContainer>
    </AppShell>
  );
}

export function TransactionsPage({ data, search }: { data: DashboardData; search: DashboardSearch }) {
  return (
    <AppShell>
      <PageContainer className="data-page directory-page directory-page--transactions">
        <PageHeader
          actions={(
            <Form action="/transactions" className="control-cluster">
              <SelectField aria-label="Filter transaction state" defaultValue={search.status ?? ""} name="status">
                <option value="">All states</option>
                <option value="success">Settled</option>
                <option value="unknown">Unknown</option>
                <option value="failed">Failed</option>
              </SelectField>
              <button className="control-button" type="submit">Apply</button>
            </Form>
          )}
          description="Inspect tracked payments and settlement receipts."
          pixelTitle
          title="Transactions"
        />
        <section className="transaction-desk" aria-labelledby="transaction-pulse-title">
          <div className="transaction-desk__bar">
            <div className="transaction-callout__icon"><ActivityIcon size={22} /></div>
            <div><strong id="transaction-pulse-title">Live settlement window</strong><span>Receipts are loaded from the facilitator&apos;s settlement index.</span></div>
            <Badge tone={data.connected ? "success" : "neutral"}><span className="status-badge__dot" /> {data.connected ? "ready" : "unavailable"}</Badge>
          </div>
          <div className="transaction-desk__stats">
            <span><small>Total transactions</small><strong>{data.transactionTotals.totalTransactions}</strong><em>Last 30 days</em></span>
            <span><small>Total amount</small><strong>{data.transactionTotals.totalAmount}</strong><em>Settled volume</em></span>
            <span><small>Active services</small><strong>{data.transactionTotals.activeServices}</strong><em>Catalog snapshot</em></span>
          </div>
        </section>
        <section className="transaction-ledger" aria-labelledby="ledger-title">
          <div className="transaction-ledger__heading"><div><h2 id="ledger-title">Latest receipts</h2><p>Hashes open Stellar Expert when a submitted transaction exists.</p></div><span className="mono">SETTLEMENT LOG</span></div>
          {data.activity.length
            ? <ActivityTable data={data} pathname="/transactions" rows={data.activity} search={search} />
            : <AnalyticsState pathname="/transactions" state={data.states.analytics} />}
        </section>
      </PageContainer>
    </AppShell>
  );
}

export function FacilitatorsPage({ data }: { data: DashboardData }) {
  const facilitator = data.facilitators[0];
  return (
    <AppShell>
      <PageContainer className="data-page">
        <PageHeader description="Current capability and readiness for the deployed payment facilitator." title="Facilitators" />
        <section className="section-block section-block--compact" aria-labelledby="facilitator-pulse-title">
          <div className="facilitator-banner">
            <div className="facilitator-banner__copy"><h2>Facilitator activity</h2><p>Capability comes from /supported; readiness comes from /health/ready.</p></div>
            <div className="facilitator-banner__stats"><span><strong>{facilitator?.status ?? "Unavailable"}</strong><small>readiness</small></span><span><strong>{facilitator?.payments ?? "Unavailable"}</strong><small>observed payments</small></span><span><strong>{data.networks.length || "Unavailable"}</strong><small>configured rails</small></span></div>
            <NetworkIcon className="facilitator-banner__mark" size={104} />
          </div>
        </section>
        <section className="section-block" aria-labelledby="facilitator-directory-title">
          <SectionHeading title="Facilitator directory" description="Only facilitators proved by the deployed API are shown." />
          {data.facilitators.length ? <div className="facilitator-list">
            {data.facilitators.map((item, index) => (
              <Card className="facilitator-row" key={item.name}>
                <span className="rank mono">{String(index + 1).padStart(2, "0")}</span>
                <EntityLogo accent={item.accent} name={item.name} size="lg" />
                <div className="facilitator-row__identity"><h3>{item.name}</h3><p>{item.description}</p></div>
                <div className="facilitator-row__metric"><span>Settlements</span><strong>{item.settlements}</strong></div>
                <div className="facilitator-row__metric"><span>Payments</span><strong>{item.payments}</strong></div>
                <div className="facilitator-row__metric"><span>Status</span><strong>{item.status}</strong></div>
                <div className="facilitator-row__end"><Badge tone="neutral">{item.supported}</Badge></div>
              </Card>
            ))}
          </div> : <StatePanel actionHref="/facilitators" kind="error" title="Facilitator unavailable" description="Readiness and capability could not be read from the deployed facilitator." />}
        </section>
      </PageContainer>
    </AppShell>
  );
}

export function NetworksPage({ data }: { data: DashboardData }) {
  return (
    <AppShell>
      <PageContainer className="data-page">
        <PageHeader description="Configured capabilities and observed settlement activity by network." title="Networks" />
        <section className="section-block section-block--compact" aria-labelledby="network-summary-title">
          <SectionHeading title="Network overview" description="Configured, enabled, and observed are reported as distinct states." />
          <div className="network-grid">
            {data.networks.map(network => (
              <Card className={cn("network-card", network.status === "online" && "network-card--online")} key={network.id}>
                <div className="network-card__top"><EntityLogo accent={network.accent} name={network.name} size="lg" /><StatusBadge state={network.status} /></div>
                <div className="network-card__copy"><h3>{network.name}</h3><p>{network.role}</p></div>
                <div className="network-card__metrics"><span><small>Buyers</small><strong>{network.buyers}</strong></span><span><small>Payments</small><strong>{network.payments}</strong></span><span><small>Sellers</small><strong>{network.sellers}</strong></span></div>
              </Card>
            ))}
          </div>
          {!data.networks.length && <StatePanel actionHref="/networks" kind="error" title="Network data unavailable" description="Neither supported capabilities nor observed network breakdowns were usable." />}
        </section>
        {data.networks.length > 0 && <section className="section-block" aria-labelledby="capability-title">
          <SectionHeading title="Network capabilities" description="Every capability below is derived from readiness, /supported, or observed breakdowns." />
          <Card className="capability-card">
            <div className="capability-card__lead"><GlobeIcon size={19} /><span>Capability</span></div>
            {data.networks.map(network => <div className="capability-card__network" key={network.id}><EntityLogo accent={network.accent} name={network.name} size="sm" /><span>{network.name.replace("Stellar ", "")}</span></div>)}
            {[
              ["Configured", data.networks.map(network => network.configured)],
              ["Enabled", data.networks.map(network => network.enabled)],
              ["Observed", data.networks.map(network => network.observed)],
              ["Fee sponsorship", data.networks.map(network => network.feeSponsored)],
            ].map(([label, values]) => <CapabilityRow key={label as string} label={label as string} values={values as boolean[]} />)}
          </Card>
        </section>}
      </PageContainer>
    </AppShell>
  );
}

export function EcosystemPage({ data, search }: { data: DashboardData; search: DashboardSearch }) {
  return (
    <AppShell>
      <PageContainer className="data-page directory-page directory-page--ecosystem">
        <PageHeader description="Live resources, networks, and facilitator capabilities returned by the deployed APIs." pixelTitle title="Ecosystem" />
        <section className="ecosystem-atlas" aria-labelledby="ecosystem-groups-title">
          <div className="ecosystem-atlas__heading"><div><h2 id="ecosystem-groups-title">Connected surfaces</h2><p>Resources, networks, and facilitator capabilities published to the live index.</p></div><span className="mono">{data.networks.length} NETWORKS</span></div>
          <div className="ecosystem-groups">
            {data.ecosystemGroups.map((group, index) => (
              <Card className="ecosystem-group" key={group.category}>
                <div className="ecosystem-group__top"><span className="mono">{String(index + 1).padStart(2, "0")}</span></div>
                <div className="ecosystem-group__icon">{index === 0 ? <ServerIcon size={22} /> : index === 1 ? <NetworkIcon size={22} /> : <DatabaseIcon size={22} />}</div>
                <h3>{group.category}</h3>
                <div className="ecosystem-group__entities">{group.entities.map(entity => <span className="ecosystem-group__entity" key={entity}><EntityLogo accent={group.category === "MCP resources" ? "yellow" : "graphite"} name={entity} size="sm" />{entity}</span>)}</div>
              </Card>
            ))}
          </div>
        </section>
        <section className="ecosystem-directory-section" aria-labelledby="directory-title">
          <div className="ecosystem-directory-section__heading"><div><h2 id="directory-title">Resource directory</h2><p>Seller-authored metadata is rendered as inert text.</p></div><span className="mono">{data.entities.length} RESOURCES</span></div>
          <div className="ecosystem-directory">{data.entities.map(entity => <DirectoryRow entity={entity} key={`${entity.resource}:${entity.name}`} />)}</div>
          {!data.entities.length && <DiscoveryState pathname="/ecosystem" state={data.states.discovery} />}
          {data.entities.length > 0 && <Pagination data={data} label={`${data.entities.length} resources on this page`} pathname="/ecosystem" search={search} />}
        </section>
      </PageContainer>
    </AppShell>
  );
}

function DiscoveryForm({ action, search, visibleCount }: { action: string; search: DashboardSearch; visibleCount: number }) {
  return (
    <Form action={action} className="browse-toolbar">
      <label className="toolbar-search">
        <SearchIcon size={18} /><span className="sr-only">Search services</span>
        <Input defaultValue={search.q} maxLength={512} name="q" placeholder="Search the complete Bazaar catalog" />
      </label>
      <label className="toolbar-select">
        <FilterIcon size={17} /><span className="sr-only">Filter by resource type</span>
        <SelectField aria-label="Filter by resource type" defaultValue={search.type ?? ""} name="type">
          <option value="">HTTP and MCP</option><option value="http">HTTP</option><option value="mcp">MCP</option>
        </SelectField>
      </label>
      <button className="control-button" type="submit">Search</button>
      <span className="toolbar-count mono">{String(visibleCount).padStart(2, "0")} SHOWN</span>
    </Form>
  );
}

function ActivityTable({ data, pathname, rows, search }: { data: DashboardData; pathname: string; rows: Activity[]; search: DashboardSearch }) {
  return (
    <Card className="table-card">
      <div className="table-scroll"><table className="data-table data-table--transactions">
        <caption className="sr-only">Latest openx402 transactions</caption>
        <thead><tr><th scope="col">Entity / event</th><th scope="col">Amount</th><th scope="col">Sender</th><th scope="col">Hash</th><th scope="col">Network</th><th scope="col">Facilitator</th><th scope="col">Time</th><th scope="col">State</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.hash || `${row.entity}:${index}`}><td><div className="table-entity"><EntityLogo accent="graphite" name={row.entity} size="sm" /><span><strong>{row.entity}</strong><small>{row.type}</small></span></div></td><td><strong className="table-number">{row.amount}</strong></td><td><span className="mono table-muted">{row.payer}</span></td><td>{row.explorerUrl ? <a className="hash-button mono" href={row.explorerUrl} rel="noreferrer noopener" target="_blank" title={`Open transaction ${row.hash}`}>{shortHash(row.hash)}<ArrowUpRightIcon size={13} /></a> : <span className="mono table-muted">{shortHash(row.hash)}</span>}</td><td><span className="table-network"><span className="network-dot" />{row.network}</span></td><td><span className="table-muted">{row.facilitator}</span></td><td><time className="table-muted">{row.time}</time></td><td><StatusBadge state={row.state} /></td></tr>)}</tbody>
      </table></div>
      <Pagination data={data} label={paginationLabel(data, rows.length, "receipts")} pathname={pathname} search={search} />
    </Card>
  );
}

function MarketplaceCard({ entity }: { entity: Entity }) {
  const content = <>
    <div className="marketplace-card__top"><EntityLogo accent={entity.accent} name={entity.name} size="lg" /><div className="card-badges"><Badge tone="neutral">{entity.category}</Badge>{entity.stale && <Badge tone="neutral">stale</Badge>}</div></div>
    <h3>{entity.name}</h3><p>{entity.description}</p>
    <span className="marketplace-card__domain">{entity.domain} {entity.href && <ExternalLinkIcon size={14} />}</span>
    <div className="marketplace-card__footer"><span><small>Primary option</small><strong>{entity.price}</strong>{entity.optionCount > 1 && <small>{entity.optionCount} payment options</small>}</span><span><small>Payments</small><strong>{entity.transactions}</strong></span>{entity.href && <span className="marketplace-card__arrow"><ArrowUpRightIcon size={17} /></span>}</div>
  </>;
  return entity.href
    ? <a className="marketplace-card" href={entity.href} rel="noreferrer noopener" target="_blank">{content}</a>
    : <div className="marketplace-card">{content}</div>;
}

function DirectoryRow({ entity }: { entity: Entity }) {
  const content = <><EntityLogo accent={entity.accent} name={entity.name} size="md" /><div className="directory-row__identity"><strong>{entity.name}</strong><span>{entity.category}{entity.stale ? " · stale" : ""}</span></div><p>{entity.description}</p><span className="directory-row__domain mono">{entity.domain}</span>{entity.href ? <ArrowUpRightIcon size={17} /> : <span />}</>;
  return entity.href
    ? <a className="directory-row" href={entity.href} rel="noreferrer noopener" target="_blank">{content}</a>
    : <div className="directory-row">{content}</div>;
}

function ResourceIdentity({ entity }: { entity: Entity }) {
  const content = <><EntityLogo accent={entity.accent} name={entity.name} size="sm" /><span><strong>{entity.name}</strong><small>{entity.description}</small><em>{entity.domain}</em></span></>;
  return entity.href
    ? <a className="table-entity" href={entity.href} rel="noreferrer noopener" target="_blank">{content}</a>
    : <div className="table-entity">{content}</div>;
}

function Pagination({ data, label, pathname, search }: { data: DashboardData; label: string; pathname: string; search: DashboardSearch }) {
  const pagination = data.pagination;
  if (!pagination) return <div className="pagination"><span className="mono">{label}</span></div>;
  const currentPage = pagination.page;
  const offset = pagination.offset ?? 0;
  const previousHref = currentPage > 1 ? pageHref(pathname, search, currentPage - 1) : undefined;
  const hasNextOffset = pagination.kind === "offset" && pagination.total !== undefined && offset + pagination.limit < pagination.total;
  const nextHref = pagination.kind === "cursor" && pagination.nextCursor
    ? pageHref(pathname, search, currentPage + 1)
    : hasNextOffset ? pageHref(pathname, search, currentPage + 1) : undefined;
  return <div className="pagination"><span className="mono">{label}</span><div>
    {previousHref ? <Link className="pagination__text-button" href={previousHref}>Previous</Link> : <span aria-disabled="true" className="pagination__text-button pagination__text-button--disabled">Previous</span>}
    <span aria-current="page" className="pagination__page-label mono">Page {currentPage}</span>
    {nextHref ? <Link className="pagination__text-button" href={nextHref}>Next</Link> : <span aria-disabled="true" className="pagination__text-button pagination__text-button--disabled">Next</span>}
  </div></div>;
}

function paginationLabel(data: DashboardData, visible: number, noun: string): string {
  return data.pagination?.total !== undefined ? `${data.pagination.total} ${noun}` : `${visible} ${noun} on this page`;
}

function CapabilityRow({ label, values }: { label: string; values: boolean[] }) {
  return <div className="capability-row"><span>{label}</span>{values.map((value, index) => <span className={cn("capability-cell", value ? "capability-cell--yes" : "capability-cell--no")} key={`${label}-${index}`}>{value ? <CheckIcon size={15} /> : "—"}</span>)}</div>;
}

function DiscoveryState({ pathname, query, state }: { pathname: string; query?: string; state: DataState }) {
  if (state === "invalid") return <StatePanel actionHref={pathname} kind="error" title="Invalid discovery response" description="The facilitator returned a response that did not match its published contract." />;
  if (state === "unavailable") return <StatePanel actionHref={pathname} kind="error" title="Discovery unavailable" description="The Bazaar catalog could not be reached. Analytics may still be available." />;
  if (query) return <StatePanel actionHref={pathname} kind="empty" title="No resources found" description="The live Bazaar search returned no matches for this query and filter set." />;
  return <StatePanel actionHref={pathname} kind="empty" title="No resources found" description="The live Bazaar catalog is currently empty." />;
}

function AnalyticsState({ pathname, state }: { pathname: string; state: DataState }) {
  if (state === "invalid") return <StatePanel actionHref={pathname} kind="error" title="Invalid analytics response" description="The facilitator returned analytics that did not match the expected contract." />;
  if (state === "unavailable") return <StatePanel actionHref={pathname} kind="error" title="Analytics unavailable" description="Discovery may still work while settlement analytics are unavailable." />;
  return <StatePanel actionHref={pathname} kind="empty" title="No observations yet" description="The facilitator has no matching settlement receipts for this page." />;
}

function StatePanel({ actionHref, kind, title, description, action }: { actionHref?: string; kind: "empty" | "error"; title: string; description: string; action?: ReactNode }) {
  return <Card className={cn("state-panel", `state-panel--${kind}`)}><div className="state-panel__icon">{kind === "empty" ? <SearchIcon size={20} /> : <ActivityIcon size={20} />}</div><h3>{title}</h3><p>{description}</p>{action ?? (actionHref && <Link className="text-link" href={actionHref}>Retry <ArrowRightIcon size={16} /></Link>)}</Card>;
}

function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 7)}…${hash.slice(-6)}` : hash || "—";
}
