import Form from "next/form";
import Link from "next/link";

import { ArrowUpRightIcon, SearchIcon } from "@/components/icons";
import type { DashboardData, Entity } from "@/components/data";
import { AppShell, EntityLogo, MetricCard, PageContainer, PageHeader, SectionHeading } from "@/components/explorer-shell";
import { HistoryBackButton } from "@/components/history-back-button";
import { Card, Input } from "@/components/ui";
import { pageHref, type DashboardSearch } from "@/lib/facilitator";

export default function DiscoverPage({ data, search }: { data: DashboardData; search: DashboardSearch }) {
  const query = search.q;
  return (
    <AppShell>
      <PageContainer className="data-page discover-page">
        <PageHeader description="Search live Bazaar resources and inspect observed facilitator activity." title="Discover" />
        {data.partialResults && <div className="data-notice" role="status"><span><strong>Partial data</strong> The facilitator marked this result set as partial, or an optional data source was unavailable.</span></div>}
        <section className="discover-section discover-section--stats" aria-labelledby="overall-stats-title">
          <SectionHeading title="Overall Stats" description="Observed statistics from this openx402 facilitator" />
          <div className="metric-grid">{data.metrics.map((metric, index) => <MetricCard key={metric.label} metric={metric} featured={index === 0} />)}</div>
        </section>
        <section className="discover-section discover-section--services" aria-labelledby="featured-services-title">
          <SectionHeading title={query ? `Results for “${query}”` : "Indexed Services"} description={query ? "Returned in the live Bazaar search order" : "Seller-declared resources observed by this facilitator"} />
          <Form action="/discover" className="browse-toolbar discover-search-form">
            <label className="toolbar-search"><SearchIcon size={18} /><span className="sr-only">Search Bazaar resources</span><Input defaultValue={query} maxLength={512} name="q" placeholder="Search the complete Bazaar catalog" /></label>
            <button className="control-button" type="submit">Search</button>
          </Form>
          {data.entities.length ? <FeaturedServicesTable data={data} entities={data.entities} search={search} /> : (
            <Card className="state-panel state-panel--empty"><h3>{query ? "No search matches" : data.states.discovery === "unavailable" ? "Discovery unavailable" : data.states.discovery === "invalid" ? "Invalid discovery response" : "No resources found"}</h3><p>{query ? "The live Bazaar search returned no matches." : "The catalog has no usable resources to display."}</p><Link className="text-link" href="/discover">Retry</Link></Card>
          )}
        </section>
      </PageContainer>
    </AppShell>
  );
}

function FeaturedServicesTable({ data, entities, search }: { data: DashboardData; entities: Entity[]; search: DashboardSearch }) {
  const pagination = data.pagination;
  const nextHref = pagination?.nextCursor ? pageHref("/discover", search, { cursor: pagination.nextCursor }) : undefined;
  return (
    <Card className="table-card featured-services-table">
      <div className="table-scroll"><table className="data-table">
        <caption className="sr-only">Services in the live x402 index</caption>
        <thead><tr><th scope="col">Server</th><th scope="col">Type</th><th scope="col">Primary option</th><th scope="col">Txns</th><th scope="col">Buyers</th><th scope="col">Latest</th><th scope="col">Network</th><th aria-label="Open service" scope="col" /></tr></thead>
        <tbody>{entities.map(entity => <tr key={`${entity.resource}:${entity.name}`}>
          <td>{entity.href ? <a className="table-entity" href={entity.href} rel="noreferrer noopener" target="_blank"><EntityLogo accent={entity.accent} name={entity.name} size="sm" /><span><strong>{entity.name}</strong><small>{entity.description}</small><em>{entity.domain}</em></span></a> : <div className="table-entity"><EntityLogo accent={entity.accent} name={entity.name} size="sm" /><span><strong>{entity.name}</strong><small>{entity.description}</small><em>{entity.domain}</em></span></div>}</td>
          <td><span className="table-muted">{entity.category}</span></td><td><strong className="table-number">{entity.price}{entity.optionCount > 1 ? ` (+${entity.optionCount - 1})` : ""}</strong></td><td><span className="mono table-muted">{entity.transactions}</span></td><td><span className="mono table-muted">{entity.buyers}</span></td><td><span className="table-muted">{entity.freshness}{entity.stale ? " · stale" : ""}</span></td><td><span className="table-network">{entity.network}</span></td><td>{entity.href ? <a className="table-try" href={entity.href} rel="noreferrer noopener" target="_blank"><ArrowUpRightIcon size={14} />Try it</a> : <span className="table-muted">Logical ID</span>}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="pagination"><span className="mono">{pagination?.total !== undefined ? `${pagination.total} indexed services` : `${entities.length} results on this page`}</span><div>{search.cursor ? <HistoryBackButton /> : <span aria-disabled="true" className="pagination__text-button pagination__text-button--disabled">Previous</span>}{nextHref ? <Link className="pagination__text-button" href={nextHref}>Next</Link> : <span aria-disabled="true" className="pagination__text-button pagination__text-button--disabled">Next</span>}</div></div>
    </Card>
  );
}
