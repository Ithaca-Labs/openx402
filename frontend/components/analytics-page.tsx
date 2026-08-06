"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Area, AreaChart, ChartTooltip, Grid, XAxis } from "@/components/charts";
import { ActivityIcon, ArrowUpRightIcon, CheckIcon, DatabaseIcon } from "@/components/icons";
import { AppShell, PageContainer, PageHeader, SectionHeading } from "@/components/explorer-shell";
import { Badge, Button, Card, Input, SelectField, cn } from "@/components/ui";
import type { SiteAnalyticsOverview } from "@/lib/site-analytics-types";

type AccessState = "checking" | "gated" | "approved";
type SourceIssue = "storage_unconfigured" | "storage_unavailable";

const EMPTY_OVERVIEW: SiteAnalyticsOverview = {
  days: 30,
  summary: { uniqueVisitors: 0, uniquePageVisits: 0, pageViews: 0, impressions: 0 },
  series: [],
  pages: [],
};

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: value >= 1000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "No activity";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "No activity"
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function chartSeries(data: SiteAnalyticsOverview["series"], days: number) {
  const values = new Map(data.map(item => [item.day, item]));
  const end = new Date();
  const output: Array<{ day: string; pageViews: number; uniquePageVisits: number; impressions: number }> = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - offset));
    const day = date.toISOString().slice(0, 10);
    const point = values.get(day);
    output.push({
      day,
      pageViews: point?.pageViews ?? 0,
      uniquePageVisits: point?.uniquePageVisits ?? 0,
      impressions: point?.impressions ?? 0,
    });
  }

  return output;
}

export function AnalyticsPage() {
  const [access, setAccess] = useState<AccessState>("checking");
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<SiteAnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceIssue, setSourceIssue] = useState<SourceIssue | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    void fetch("/api/site-analytics/access", { cache: "no-store" })
      .then(async response => ({ ok: response.ok, body: await response.json() as { authorized?: boolean } }))
      .then(({ ok, body }) => {
        if (!active) return;
        setAccess(ok && body.authorized ? "approved" : "gated");
      })
      .catch(() => {
        if (active) setAccess("gated");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (access !== "approved") return;
    let active = true;
    setLoading(true);
    setError(null);
    setSourceIssue(null);

    void fetch(`/api/site-analytics/overview?days=${days}`, { cache: "no-store" })
      .then(async response => {
        if (response.status === 401) {
          if (active) setAccess("gated");
          return null;
        }
        if (!response.ok) {
          const body = await response.json() as { issue?: SourceIssue; message?: string };
          if (active && body.issue) setSourceIssue(body.issue);
          throw new Error(body.message ?? "The analytics collector is not reachable. Check the facilitator service, then refresh this report.");
        }
        return response.json() as Promise<SiteAnalyticsOverview>;
      })
      .then((data) => {
        if (active && data) setOverview(data);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Frontend analytics storage is not reachable. Check ANALYTICS_DATABASE_URL, then refresh this report.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [access, days, refreshKey]);

  const activeOverview = overview ?? EMPTY_OVERVIEW;
  const trend = useMemo(() => chartSeries(activeOverview.series, days), [activeOverview.series, days]);
  const viewsPerVisitor = activeOverview.summary.uniqueVisitors
    ? activeOverview.summary.pageViews / activeOverview.summary.uniqueVisitors
    : 0;

  return (
    <AppShell>
      <PageContainer className="data-page analytics-page">
        <PageHeader
          description="Anonymous route-level signals for the public explorer. No email addresses, IP addresses, or raw visitor identifiers are shown here."
          title="Site analytics"
          actions={(
            <div className="analytics-page-actions">
              <Badge tone="signal">Private operator view</Badge>
              <Button disabled={access !== "approved" || loading} onClick={() => setRefreshKey(key => key + 1)} size="sm" variant="outline">
                <ActivityIcon size={14} /> {loading ? "Refreshing" : "Refresh"}
              </Button>
            </div>
          )}
        />

        <section className="analytics-control-row" aria-label="Analytics reporting controls">
          <p><span aria-hidden="true" className="live-dot" /> Live collection · reporting window</p>
          <SelectField aria-label="Reporting window" onChange={event => setDays(Number(event.target.value))} value={days}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </SelectField>
        </section>

        {error ? <AnalyticsSourceNotice issue={sourceIssue} message={error} onRefresh={() => setRefreshKey(key => key + 1)} /> : null}

        <section className="analytics-summary-grid" aria-label="Usage summary">
          <SummaryMetric detail="visitor + route pairs" label="Unique page visits" loading={loading && !overview} value={activeOverview.summary.uniquePageVisits} />
          <SummaryMetric detail="route loads observed" label="Page views" loading={loading && !overview} value={activeOverview.summary.pageViews} />
          <SummaryMetric detail="main content entered view" label="Content impressions" loading={loading && !overview} value={activeOverview.summary.impressions} />
          <SummaryMetric detail="page views per visitor" label="Views / visitor" loading={loading && !overview} value={viewsPerVisitor} precision={1} />
        </section>

        <section className="section-block analytics-signal-layout" aria-labelledby="attention-over-time-title">
          <Card className="analytics-trend-panel">
            <div className="analytics-trend-panel__heading">
              <div>
                <h2 id="attention-over-time-title">Attention over time</h2>
                <p>Daily route loads and content impressions across the selected reporting window.</p>
              </div>
              <div className="analytics-legend" aria-label="Chart legend">
                <span><i className="analytics-legend__mark analytics-legend__mark--views" /> Page views</span>
                <span><i className="analytics-legend__mark analytics-legend__mark--impressions" /> Impressions</span>
              </div>
            </div>
            <AreaChart ariaLabel="Daily page views and content impressions" data={trend} xDataKey="day">
              <Grid numTicksRows={4} />
              <XAxis numTicks={days === 7 ? 4 : 5} />
              <Area dataKey="impressions" fill="var(--color-text-muted)" fillOpacity={0.08} label="Impressions" stroke="var(--color-text-muted)" strokeWidth={1.5} />
              <Area dataKey="pageViews" fill="var(--color-accent)" fillOpacity={0.28} label="Page views" stroke="var(--color-text)" strokeWidth={2.2} />
              <ChartTooltip />
            </AreaChart>
          </Card>

          <aside className="analytics-method" aria-labelledby="measurement-title">
            <div className="analytics-method__icon"><DatabaseIcon size={19} /></div>
            <div>
              <h2 id="measurement-title">Minimal by design</h2>
              <p>Each event contains only the anonymous browser key, the route, its type, and its timestamp.</p>
            </div>
            <dl>
              <div><dt>Unique visits</dt><dd>distinct browser + route</dd></div>
              <div><dt>Impression</dt><dd>main content reaches 25% view</dd></div>
              <div><dt>Retention</dt><dd>aggregate report only</dd></div>
            </dl>
          </aside>
        </section>

        <section className="section-block" aria-labelledby="page-attention-title">
          <SectionHeading description="The routes receiving the most attention in the selected window." title="Page attention" />
          {activeOverview.pages.length ? (
            <Card className="table-card analytics-table-card">
              <div className="table-scroll">
                <table className="data-table analytics-table">
                  <caption className="sr-only">Analytics by page route</caption>
                  <thead>
                    <tr>
                      <th scope="col">Route</th>
                      <th scope="col">Unique visits</th>
                      <th scope="col">Views</th>
                      <th scope="col">Impressions</th>
                      <th scope="col">Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeOverview.pages.map(page => (
                      <tr key={page.pagePath}>
                        <td><span className="analytics-route mono">{page.pagePath}</span></td>
                        <td>{compactNumber(page.uniquePageVisits)}</td>
                        <td>{compactNumber(page.pageViews)}</td>
                        <td>{compactNumber(page.impressions)}</td>
                        <td><span className="analytics-last-activity">{formatDate(page.latestActivity)} <ArrowUpRightIcon size={13} /></span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <div className="analytics-empty-state">
              <CheckIcon size={18} />
              <div><strong>Collection is ready.</strong><p>Page activity will appear here as visitors use the explorer.</p></div>
            </div>
          )}
        </section>
      </PageContainer>

      {access !== "approved" ? <AnalyticsGate state={access} onGranted={() => setAccess("approved")} /> : null}
    </AppShell>
  );
}

function AnalyticsSourceNotice({
  issue,
  message,
  onRefresh,
}: {
  issue: SourceIssue | null;
  message: string;
  onRefresh: () => void;
}) {
  const storagePending = issue === "storage_unconfigured";
  return (
    <div className={cn("analytics-source-notice", storagePending && "analytics-source-notice--pending")} role="status">
      <DatabaseIcon size={19} />
      <div>
        <strong>{storagePending ? "Analytics storage needs configuration." : "Analytics storage needs attention."}</strong>
        <p>{message}</p>
      </div>
      <Button onClick={onRefresh} size="sm" variant="outline">Refresh report</Button>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  detail,
  precision = 0,
  loading,
}: {
  label: string;
  value: number;
  detail: string;
  precision?: number;
  loading: boolean;
}) {
  const formatted = precision ? new Intl.NumberFormat("en-US", { maximumFractionDigits: precision }).format(value) : compactNumber(value);
  return (
    <Card className="analytics-summary-card">
      <span className="analytics-summary-card__label">{label}</span>
      <strong className={cn("analytics-summary-card__value", loading && "analytics-summary-card__value--loading")}>{loading ? "—" : formatted}</strong>
      <span className="analytics-summary-card__detail">{detail}</span>
    </Card>
  );
}

function AnalyticsGate({ state, onGranted }: { state: AccessState; onGranted: () => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/site-analytics/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await response.json() as { authorized?: boolean; message?: string };
      if (!response.ok || !body.authorized) throw new Error(body.message ?? "We could not grant access to analytics.");
      onGranted();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "We could not grant access to analytics.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="analytics-gate" role="presentation">
      <section aria-describedby="analytics-gate-description" aria-labelledby="analytics-gate-title" aria-modal="true" className="analytics-gate__dialog" role="dialog">
        <div className="analytics-gate__signal" aria-hidden="true"><ActivityIcon size={20} /></div>
        <h2 id="analytics-gate-title">Operator access</h2>
        <p id="analytics-gate-description">Enter the approved email address to view anonymous explorer analytics.</p>
        <form onSubmit={submit}>
          <label htmlFor="analytics-email">Approved email</label>
          <Input autoComplete="email" autoFocus disabled={state === "checking" || submitting} id="analytics-email" inputMode="email" onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required type="email" value={email} />
          {error ? <p className="analytics-gate__error" role="alert">{error}</p> : null}
          <Button disabled={state === "checking" || submitting} size="lg" type="submit">
            {submitting ? "Checking access" : "View analytics"}
          </Button>
        </form>
        <span className="analytics-gate__note">This gate limits the dashboard to the configured address. It does not verify email ownership.</span>
      </section>
    </div>
  );
}
