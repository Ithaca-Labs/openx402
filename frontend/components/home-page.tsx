"use client";

import Link from "next/link";

import { ArrowUpRightIcon } from "@/components/icons";
import { featuredEntities, metrics, type Entity } from "@/components/data";
import {
  AppShell,
  EntityLogo,
  MetricCard,
  PageContainer,
  SectionHeading,
  Sparkline,
  TimeControl,
} from "@/components/explorer-shell";
import { Card, SelectField } from "@/components/ui";

export default function DiscoverPage() {
  return (
    <AppShell>
      <PageContainer className="data-page discover-page">
        <section className="discover-section discover-section--stats" aria-labelledby="overall-stats-title">
          <SectionHeading
            title="Overall Stats"
            description="Global statistics for the x402 ecosystem"
            action={
              <div className="control-cluster">
                <SelectField aria-label="Group overall statistics by" defaultValue="Per bucket">
                  <option>Per bucket</option>
                  <option>Per service</option>
                  <option>Per chain</option>
                </SelectField>
                <TimeControl label="Past 30 days" />
              </div>
            }
          />
          <div className="metric-grid">
            {metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
          </div>
        </section>

        <section className="discover-section discover-section--services" aria-labelledby="featured-services-title">
          <SectionHeading
            title="Featured Services"
            description="x402scan curated services"
            action={<TimeControl label="Past 30 days" />}
          />
          <FeaturedServicesTable entities={featuredEntities} />
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
              <th scope="col">Activity</th>
              <th scope="col">Volume</th>
              <th scope="col">Txns</th>
              <th scope="col">Buyers</th>
              <th scope="col">Latest</th>
              <th scope="col">Chain</th>
              <th scope="col"><span className="sr-only">Open service</span></th>
            </tr>
          </thead>
          <tbody>
            {entities.map((entity, index) => (
              <tr key={entity.name}>
                <td>
                  <Link className="table-entity" href={`/marketplace?entity=${encodeURIComponent(entity.name)}`}>
                    <EntityLogo accent={entity.accent} name={entity.name} size="sm" />
                    <span>
                      <strong>{entity.name}</strong>
                      <small>{entity.description}</small>
                      <em>{entity.domain}</em>
                    </span>
                  </Link>
                </td>
                <td>
                  <Sparkline
                    className="sparkline--table"
                    points={[18 + index * 2, 27, 24, 38, 32, 43, 39, 50, 45, 58 + index * 3, 52, 65]}
                  />
                </td>
                <td><strong className="table-number">{entity.volume}</strong></td>
                <td><span className="mono table-muted">{entity.transactions}</span></td>
                <td><span className="mono table-muted">{entity.buyers}</span></td>
                <td><span className="table-muted">{entity.freshness}</span></td>
                <td><span className="table-network"><span className="network-dot" />{entity.network}</span></td>
                <td>
                  <Link className="table-try" href={`/marketplace?entity=${encodeURIComponent(entity.name)}`}>
                    <ArrowUpRightIcon size={14} />
                    Try it
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
