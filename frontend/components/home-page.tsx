import Form from "next/form";
import Image from "next/image";
import Link from "next/link";

import { ArrowRightIcon, ArrowUpRightIcon, ChevronDownIcon, CopyIcon, MoreIcon, SearchIcon } from "@/components/icons";
import type { DashboardData, Entity } from "@/components/data";
import { AppShell, EntityLogo, PageContainer } from "@/components/explorer-shell";
import { Card, Input } from "@/components/ui";
import { pageHref, type DashboardSearch } from "@/lib/facilitator";

export default function DiscoverPage({ data, search }: { data: DashboardData; search: DashboardSearch }) {
  const query = search.q;
  return (
    <AppShell>
      <PageContainer className="discover-page">
        <section className="discover-hero" aria-labelledby="discover-title">
          <h1 id="discover-title"><Image alt="" aria-hidden="true" className="discover-hero__word" height={45} priority src="/services-title.svg" width={619} /><span className="sr-only">Services</span></h1>
          <p>Use openx402 services with your agent.</p>
        </section>
        {data.partialResults && <div className="data-notice" role="status"><span><strong>Partial data</strong> The facilitator marked this result set as partial, or an optional data source was unavailable.</span></div>}
        <div className="discover-directory">
          <section className="discover-services" aria-labelledby="featured-services-title">
            <input className="directory-view-input" defaultChecked id="directory-view-list" name="directory-view" type="radio" value="list" />
            <input className="directory-view-input" id="directory-view-grid" name="directory-view" type="radio" value="grid" />
            <div className="discover-toolbar">
              <Form action="/discover" className="discover-search-form">
                <label className="toolbar-search"><SearchIcon size={16} /><span className="sr-only">Search Bazaar resources</span><Input defaultValue={query} maxLength={512} name="q" placeholder="Search services" type="search" /></label>
              </Form>
              <button className="directory-filter" type="button">Showing all <ChevronDownIcon size={15} /></button>
              <div className="directory-view-toggle" aria-label="View options">
                <label aria-label="List view" className="directory-view-button" htmlFor="directory-view-list"><MoreIcon size={17} /></label>
                <label aria-label="Grid view" className="directory-view-button" htmlFor="directory-view-grid"><span className="directory-grid-icon" /></label>
              </div>
              <a className="directory-learn-more" href="https://docs.stellarx402.xyz/" rel="noreferrer noopener" target="_blank">Learn more <ArrowRightIcon size={15} /></a>
            </div>
            <div className="services-list-heading" aria-hidden="true"><span>Provider</span><span>Description</span><span>Service URL</span></div>
            <h2 className="sr-only" id="featured-services-title">{query ? `Results for “${query}”` : "Indexed services"}</h2>
            {data.entities.length ? <><FeaturedServicesTable data={data} entities={data.entities} search={search} /><ServicesGrid entities={data.entities} /></> : (
              <Card className="state-panel state-panel--empty"><h3>{query ? "No search matches" : data.states.discovery === "unavailable" ? "Discovery unavailable" : data.states.discovery === "invalid" ? "Invalid discovery response" : "No resources found"}</h3><p>{query ? "The live Bazaar search returned no matches." : "The catalog has no usable resources to display."}</p><Link className="text-link" href="/discover">Retry</Link></Card>
            )}
          </section>
          <DiscoveryAside />
        </div>
      </PageContainer>
    </AppShell>
  );
}

function ServicesGrid({ entities }: { entities: Entity[] }) {
  return (
    <div className="service-grid" role="list">
      {entities.map((entity) => (
        <article className="service-card" key={`${entity.resource}:${entity.name}`} role="listitem">
          <div className="service-card__provider"><EntityLogo accent={entity.accent} name={entity.name} size="md" /><span><strong>{entity.name}</strong><small>{entity.category}</small></span></div>
          <p>{entity.description}</p>
          {entity.href ? <a className="service-card__url" href={entity.href} rel="noreferrer noopener" target="_blank"><span>{entity.href}</span><CopyIcon size={14} /></a> : <span className="service-card__url"><span>{entity.resource}</span></span>}
        </article>
      ))}
    </div>
  );
}

function FeaturedServicesTable({ data, entities, search }: { data: DashboardData; entities: Entity[]; search: DashboardSearch }) {
  const pagination = data.pagination;
  const currentPage = pagination?.page ?? 1;
  const previousHref = currentPage > 1 ? pageHref("/discover", search, currentPage - 1) : undefined;
  const nextHref = pagination?.nextCursor ? pageHref("/discover", search, currentPage + 1) : undefined;
  return (
    <div className="service-list" role="list">
      {entities.map(entity => <article className="service-row" key={`${entity.resource}:${entity.name}`} role="listitem">
        <div className="service-row__provider">
          <EntityLogo accent={entity.accent} name={entity.name} size="md" />
          <span><strong>{entity.name}</strong><small>{entity.category}</small></span>
        </div>
        <p className="service-row__description">{entity.description}</p>
        <div className="service-row__actions">
          {entity.href ? <a className="service-row__url" href={entity.href} rel="noreferrer noopener" target="_blank"><span>{entity.href}</span><CopyIcon size={14} /></a> : <span className="service-row__url"><span>{entity.resource}</span></span>}
          {entity.href ? <a aria-label={`Open ${entity.name}`} className="service-row__icon" href={entity.href} rel="noreferrer noopener" target="_blank"><ArrowUpRightIcon size={15} /></a> : null}
          <button aria-label={`More options for ${entity.name}`} className="service-row__icon" type="button"><ChevronDownIcon size={15} /></button>
        </div>
      </article>)}
      <div className="pagination directory-pagination"><span className="mono">{pagination?.total !== undefined ? `${pagination.total} indexed services` : `${entities.length} results on this page`}</span><div>{previousHref ? <Link className="pagination__text-button" href={previousHref}>Previous</Link> : <span aria-disabled="true" className="pagination__text-button pagination__text-button--disabled">Previous</span>}<span aria-current="page" className="pagination__page-label mono">Page {currentPage}</span>{nextHref ? <Link className="pagination__text-button" href={nextHref}>Next</Link> : <span aria-disabled="true" className="pagination__text-button pagination__text-button--disabled">Next</span>}</div></div>
    </div>
  );
}

function DiscoveryAside() {
  return (
    <aside className="discovery-aside" aria-label="Agent resources">
      <details className="agent-guide" open>
        <summary><span><strong>Use with agents</strong><small>Connect an agent to openx402 services with the same live catalog.</small></span><ChevronDownIcon size={15} /></summary>
        <div className="agent-guide__body">
          <div><strong>Discover a service</strong><p>Search the catalog, then give your agent the service URL and its declared payment details.</p></div>
          <div className="agent-code"><code><span>$</span> curl https://facilitator.stellarx402.xyz/discovery</code><CopyIcon size={14} /></div>
          <div><strong>Prompt your agent</strong><p>Tell Claude, Codex, or another coding agent which service to inspect.</p></div>
          <div className="agent-code"><code><span>$</span> “Use the openx402 catalog to find a weather service”</code><CopyIcon size={14} /></div>
          <p>Read the <a href="https://docs.stellarx402.xyz/" rel="noreferrer noopener" target="_blank">documentation</a> for integration details.</p>
        </div>
      </details>
      <div className="aside-links">
        <a href="https://docs.stellarx402.xyz/" rel="noreferrer noopener" target="_blank"><span><strong>Documentation</strong><small>Guides, quickstarts, and SDKs.</small></span><ArrowUpRightIcon size={15} /></a>
        <a href="/ecosystem"><span><strong>Ecosystem</strong><small>Explore the wider payment network.</small></span><ArrowUpRightIcon size={15} /></a>
        <a href="/transactions"><span><strong>Activity</strong><small>Inspect observed settlement activity.</small></span><ArrowUpRightIcon size={15} /></a>
      </div>
    </aside>
  );
}
