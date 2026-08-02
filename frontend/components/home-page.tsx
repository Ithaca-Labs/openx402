"use client";

import Image from "next/image";
import { ArrowUpRightIcon } from "@/components/icons";
import { type DashboardData, type Entity } from "@/components/data";
import {
  AppShell,
  EntityLogo,
  MetricCard,
  PageContainer,
  SectionHeading,
} from "@/components/explorer-shell";
import { Card } from "@/components/ui";

export default function DiscoverPage({ data, query }: { data: DashboardData; query?: string }) {
  return (
    <AppShell>
      <PageContainer className="data-page discover-page">
        <section className="discover-section discover-section--stats" aria-labelledby="overall-stats-title">
          <SectionHeading
            title="Overall Stats"
            description="Observed statistics from this openx402 facilitator"
          />
          <div className="metric-grid">
            {data.metrics.map((metric, index) => (
              <MetricCard key={metric.label} metric={metric} featured={index === 0} />
            ))}
          </div>
        </section>

        <section className="discover-section discover-section--services" aria-labelledby="featured-services-title">
          <SectionHeading
            title={query ? `Results for “${query}”` : "Indexed Services"}
            description={query ? "Ranked by the facilitator's live Bazaar search pipeline" : "Seller-declared resources observed by this facilitator"}
          />
          {data.entities.length ? <FeaturedServicesTable entities={data.entities} /> : (
            <Card className="state-panel state-panel--empty"><h3>No resources found</h3><p>The catalog populates after the first verified payment carrying valid Bazaar metadata.</p></Card>
          )}
        </section>
      </PageContainer>
    </AppShell>
  );
}

function FeaturedServicesTable({ entities }: { entities: Entity[] }) {
  return (
    <Card className="table-card featured-services-table">
      <div className="table-scroll">
        <table className="data-table">
          <caption className="sr-only">Featured services in the x402 index</caption>
          <thead>
            <tr>
              <th scope="col">Server</th>
              <th scope="col">Category</th>
              <th scope="col">Price</th>
              <th scope="col">Txns</th>
              <th scope="col">Buyers</th>
              <th scope="col">Latest</th>
              <th scope="col">Chain</th>
              <th scope="col"><span className="sr-only">Open service</span></th>
            </tr>
          </thead>
          <tbody>
            {entities.map((entity) => (
              <tr key={`${entity.url}:${entity.name}`}>
                <td>
                  <a className="table-entity" href={entity.url} rel="noreferrer" target="_blank">
                    <EntityLogo accent={entity.accent} name={entity.name} size="sm" />
                    <span>
                      <strong>{entity.name}</strong>
                      <small>{entity.description}</small>
                      <em>{entity.domain}</em>
                    </span>
                  </a>
                </td>
                <td><span className="table-muted">{entity.category}</span></td>
                <td><strong className="table-number">{entity.price}</strong></td>
                <td><span className="mono table-muted">{entity.transactions}</span></td>
                <td><span className="mono table-muted">{entity.buyers}</span></td>
                <td><span className="table-muted">{entity.freshness}</span></td>
                <td>
                  <span className="table-network">
                    <span aria-hidden="true" className="network-logo">
                      <Image alt="" className="network-logo__image" height={16} src="/brand/stellar/stellar-xlm-logo.svg" width={16} />
                    </span>
                    {entity.network}
                  </span>
                </td>
                <td>
                  <a className="table-try" href={entity.url} rel="noreferrer" target="_blank">
                    <ArrowUpRightIcon size={14} />
                    Try it
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
