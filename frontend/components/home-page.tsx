"use client";

import Image from "next/image";
import Link from "next/link";

import { ArrowUpRightIcon } from "@/components/icons";
import { Area, AreaChart, ChartTooltip } from "@/components/charts";
import { featuredEntities, metrics, type Entity } from "@/components/data";
import {
  AppShell,
  EntityLogo,
  MetricCard,
  PageContainer,
  SectionHeading,
  TimeControl,
} from "@/components/explorer-shell";
import { Card, SelectField } from "@/components/ui";

const featuredServiceActivity = [
  [18, 27, 24, 38, 32, 43, 39, 50, 45, 58, 52, 65],
  [16, 25, 22, 36, 31, 42, 38, 48, 44, 57, 53, 62],
  [15, 23, 21, 34, 29, 40, 36, 47, 42, 54, 49, 60],
  [12, 20, 18, 31, 27, 38, 34, 44, 40, 51, 46, 56],
  [10, 18, 16, 29, 24, 35, 31, 42, 37, 49, 43, 52],
];

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
            {metrics.map((metric, index) => (
              <MetricCard key={metric.label} metric={metric} featured={index === 0} />
            ))}
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

function FeaturedServiceActivityChart({ index, name }: { index: number; name: string }) {
  const points = featuredServiceActivity[index % featuredServiceActivity.length].map((activity, pointIndex) => ({
    date: pointIndex,
    activity,
  }));

  return (
    <AreaChart
      ariaLabel={`${name} activity trend`}
      className="table-area-chart"
      data={points}
      margin={{ top: 4, right: 2, bottom: 4, left: 2 }}
      xDataKey="date"
    >
      <Area dataKey="activity" fill="var(--color-accent)" fillOpacity={0.24} stroke="var(--color-text)" strokeWidth={1.35} />
      <ChartTooltip showDatePill={false} valueFormatter={(_, value) => `${value} signal`} />
    </AreaChart>
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
                  <FeaturedServiceActivityChart index={index} name={entity.name} />
                </td>
                <td><strong className="table-number">{entity.volume}</strong></td>
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
