"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";

import {
  ActivityIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  DatabaseIcon,
  GlobeIcon,
  SearchIcon,
  SparkIcon,
} from "@/components/icons";
import { featuredEntities, metrics, recentActivity } from "@/components/data";
import {
  AppShell,
  CommandHint,
  EntityLogo,
  MetricCard,
  PageContainer,
  SectionHeading,
  Sparkline,
  StatusBadge,
  TimeControl,
} from "@/components/explorer-shell";
import { Badge, Card, Input, cn } from "@/components/ui";

const heroPoints = [22, 27, 25, 39, 33, 48, 43, 55, 51, 67, 59, 77, 71, 86, 81, 94];

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  const filteredEntities = useMemo(() => {
    const normalized = submittedQuery.trim().toLowerCase();
    if (!normalized) return featuredEntities;

    return featuredEntities.filter((entity) =>
      [entity.name, entity.category, entity.description, entity.domain]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [submittedQuery]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedQuery(query);
    document.getElementById("featured-services")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <AppShell>
      <PageContainer>
        <section className="discover-hero" aria-labelledby="discover-title">
          <div className="hero-copy">
            <div className="eyebrow hero-eyebrow"><span className="eyebrow-mark" /> Discover / ecosystem index</div>
            <h1 id="discover-title">
              Discover the
              <br />
              <span>ecosystem.</span>
            </h1>
            <p className="hero-description">
              Search services, inspect payment activity, and compare the infrastructure supporting paid agent requests.
            </p>
            <div className="hero-actions">
              <Link className="ui-button ui-button--solid ui-button--lg" href="/marketplace">
                Explore the marketplace <ArrowUpRightIcon size={17} />
              </Link>
              <Link className="text-link text-link--dark" href="/transactions">
                View live activity <ArrowRightIcon size={16} />
              </Link>
            </div>
          </div>

          <div className="hero-signal" aria-label="Openx402 ecosystem status">
            <div className="hero-signal__grid" aria-hidden="true" />
            <ImageMark />
            <div className="hero-signal__topline">
              <span className="mono">SIGNAL / 001</span>
              <Badge tone="ink"><span className="status-badge__dot" /> rail active</Badge>
            </div>
            <div className="hero-signal__metric">
              <span className="mono">SETTLED THIS MONTH</span>
              <strong>$42,801.16</strong>
              <span className="hero-signal__delta">+9.4% against prior window</span>
            </div>
            <Sparkline className="sparkline--signal" points={heroPoints} />
            <div className="hero-signal__footer">
              <span>Stellar settlement rail</span>
              <span className="hero-signal__pulse"><span /> 4.2s avg.</span>
            </div>
          </div>

          <form className="discover-search" onSubmit={handleSearch} role="search">
            <div className="discover-search__icon"><SearchIcon size={21} /></div>
            <label className="sr-only" htmlFor="ecosystem-search">Search services, facilitators, networks</label>
            <Input
              id="ecosystem-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search services, facilitators, networks..."
              value={query}
            />
            <CommandHint />
            <button className="discover-search__submit" type="submit">Search</button>
          </form>

          <div className="signal-rail" aria-label="Discover, pay, continue">
            <div className="signal-rail__line" aria-hidden="true" />
            <RailStep number="01" label="Discover" detail="Find a paid route" active />
            <RailStep number="02" label="Pay" detail="Settle with proof" />
            <RailStep number="03" label="Continue" detail="Keep the task moving" />
          </div>
        </section>

        <section className="section-block" aria-labelledby="pulse-title">
          <SectionHeading
            eyebrow="01 / OVERVIEW"
            title="Overview"
            description="Current activity across services, payments, facilitators, and networks."
            action={<TimeControl />}
          />
          <div className="metric-grid">
            {metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
          </div>
        </section>

        <section className="section-block section-block--activity" aria-labelledby="activity-title">
          <SectionHeading
            eyebrow="02 / RECENT ACTIVITY"
            title="Recent activity"
            description="Settlement events with enough context to understand the handoff."
            action={<Link className="text-link" href="/transactions">View all transactions <ArrowRightIcon size={16} /></Link>}
          />
          <div className="activity-layout">
            <Card className="activity-panel">
              <div className="activity-panel__header">
                <div className="table-label"><span className="live-dot" /> latest settled events</div>
                <span className="mono">UPDATED 18 SEC AGO</span>
              </div>
              <div className="activity-list">
                {recentActivity.map((activity, index) => (
                  <div className="activity-row" key={`${activity.hash}-${index}`}>
                    <div className="activity-row__identity">
                      <EntityLogo accent={index % 2 === 0 ? "yellow" : "graphite"} name={activity.entity} size="sm" />
                      <div>
                        <strong>{activity.entity}</strong>
                        <span>{activity.type}</span>
                      </div>
                    </div>
                    <div className="activity-row__hash mono">{activity.hash}</div>
                    <div className="activity-row__amount">
                      <strong>{activity.amount}</strong>
                      <span>{activity.time}</span>
                    </div>
                    <StatusBadge state={activity.state} />
                  </div>
                ))}
              </div>
              <div className="activity-panel__footer">
                <span><ActivityIcon size={15} /> Showing the latest 5 of 184,204 indexed payments</span>
                <Link href="/transactions">Open ledger <ArrowUpRightIcon size={15} /></Link>
              </div>
            </Card>

            <Card className="observer-card">
              <div className="observer-card__index"><span className="mono">OBS / 402</span><SparkIcon size={17} /></div>
              <div className="observer-card__content">
                <div className="observer-card__icon"><DatabaseIcon size={22} /></div>
                <h3>Payment activity.</h3>
                <p>Review request, settlement, and receipt details in one view.</p>
              </div>
              <Link className="observer-card__link" href="/all">Open the index <ArrowRightIcon size={17} /></Link>
            </Card>
          </div>
        </section>

        <section className="section-block section-block--featured" id="featured-services" aria-labelledby="featured-title">
          <SectionHeading
            eyebrow="03 / FEATURED SERVICES"
            title={submittedQuery ? `Matches for “${submittedQuery}”` : "Featured services"}
            description="Services in the index, sorted by recent activity."
            action={<Link className="text-link" href="/marketplace">Browse all services <ArrowRightIcon size={16} /></Link>}
          />
          {filteredEntities.length ? (
            <div className="entity-grid">
              {filteredEntities.slice(0, 4).map((entity) => <EntityPreview key={entity.name} entity={entity} />)}
            </div>
          ) : (
            <Card className="empty-panel">
              <div className="empty-panel__mark"><SearchIcon size={20} /></div>
              <h3>No indexed service matches yet.</h3>
              <p>Try a service name, category, or domain. The observer is deliberately literal.</p>
              <button className="text-link text-link--button" onClick={() => { setQuery(""); setSubmittedQuery(""); }} type="button">Clear search <ArrowRightIcon size={16} /></button>
            </Card>
          )}
        </section>

        <section className="closing-field" aria-labelledby="closing-title">
          <div>
            <div className="eyebrow">04 / EXPLORE</div>
            <h2 id="closing-title">Explore the index.</h2>
            <p>Browse services, inspect transactions, and compare network coverage.</p>
          </div>
          <div className="closing-field__actions">
            <Link className="ui-button ui-button--ink ui-button--lg" href="/ecosystem">Explore the ecosystem <ArrowUpRightIcon size={17} /></Link>
            <Link className="text-link text-link--ink" href="/networks">See supported networks <ArrowRightIcon size={16} /></Link>
          </div>
          <div className="closing-field__mark" aria-hidden="true"><GlobeIcon size={126} /></div>
        </section>
      </PageContainer>
    </AppShell>
  );
}

function ImageMark() {
  return <Image alt="" className="hero-signal__mark" height={162} src="/brand/logo/mark-black.svg" width={162} />;
}

function RailStep({ number, label, detail, active = false }: { number: string; label: string; detail: string; active?: boolean }) {
  return (
    <div className={cn("rail-step", active && "rail-step--active")}>
      <span className="rail-step__number mono">{number}</span>
      <span className="rail-step__label">{label}</span>
      <span className="rail-step__detail">{detail}</span>
    </div>
  );
}

function EntityPreview({ entity }: { entity: (typeof featuredEntities)[number] }) {
  return (
    <Link className="entity-preview" href={`/marketplace?entity=${encodeURIComponent(entity.name)}`}>
      <div className="entity-preview__topline">
        <EntityLogo accent={entity.accent} name={entity.name} />
        <span className="entity-preview__arrow"><ArrowUpRightIcon size={17} /></span>
      </div>
      <div className="entity-preview__category">{entity.category}</div>
      <h3>{entity.name}</h3>
      <p>{entity.description}</p>
      <div className="entity-preview__meta">
        <span>{entity.domain}</span>
        <span><strong>{entity.volume}</strong> volume</span>
      </div>
    </Link>
  );
}
