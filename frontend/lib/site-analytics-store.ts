import "server-only";

import { createHash } from "node:crypto";
import { Pool } from "pg";

import type { SiteAnalyticsEvent, SiteAnalyticsOverview } from "@/lib/site-analytics-types";

export type SiteAnalyticsStorageIssue = "storage_unconfigured" | "storage_unavailable";

export class SiteAnalyticsStorageError extends Error {
  constructor(readonly issue: SiteAnalyticsStorageIssue) {
    super(issue);
  }
}

type AnalyticsGlobal = typeof globalThis & {
  frontendAnalyticsPool?: Pool;
  frontendAnalyticsSchema?: Promise<void>;
};

const analyticsGlobal = globalThis as AnalyticsGlobal;

function pool() {
  const connectionString = process.env.ANALYTICS_DATABASE_URL?.trim();
  if (!connectionString) throw new SiteAnalyticsStorageError("storage_unconfigured");

  if (!analyticsGlobal.frontendAnalyticsPool) {
    analyticsGlobal.frontendAnalyticsPool = new Pool({
      connectionString,
      idleTimeoutMillis: 20_000,
      max: 3,
    });
  }
  return analyticsGlobal.frontendAnalyticsPool;
}

async function ensureSchema() {
  const database = pool();
  if (!analyticsGlobal.frontendAnalyticsSchema) {
    analyticsGlobal.frontendAnalyticsSchema = database.query(`
      CREATE TABLE IF NOT EXISTS frontend_analytics_events (
        id bigserial PRIMARY KEY,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        visitor_hash text NOT NULL CHECK (visitor_hash ~ '^[a-f0-9]{64}$'),
        event_type text NOT NULL CHECK (event_type IN ('page_view', 'impression')),
        page_path text NOT NULL CHECK (length(page_path) BETWEEN 1 AND 512),
        element_key text CHECK (element_key IS NULL OR length(element_key) <= 96)
      );
      CREATE INDEX IF NOT EXISTS frontend_analytics_events_time_idx
        ON frontend_analytics_events (occurred_at DESC);
      CREATE INDEX IF NOT EXISTS frontend_analytics_events_page_time_idx
        ON frontend_analytics_events (page_path, occurred_at DESC);
    `).then(() => undefined).catch((error: unknown) => {
      analyticsGlobal.frontendAnalyticsSchema = undefined;
      throw error;
    });
  }
  await analyticsGlobal.frontendAnalyticsSchema;
  return database;
}

function hashVisitor(visitorId: string) {
  return createHash("sha256").update(visitorId).digest("hex");
}

function count(value: unknown) {
  return Number(value ?? 0);
}

function since(days: number) {
  return `AND occurred_at >= now() - (${days} * interval '1 day')`;
}

function unavailable(error: unknown): never {
  if (error instanceof SiteAnalyticsStorageError) throw error;
  throw new SiteAnalyticsStorageError("storage_unavailable");
}

export async function recordFrontendAnalyticsEvent(event: SiteAnalyticsEvent) {
  try {
    const database = await ensureSchema();
    await database.query(
      `INSERT INTO frontend_analytics_events(visitor_hash, event_type, page_path, element_key)
       VALUES ($1, $2, $3, $4)`,
      [hashVisitor(event.visitorId), event.eventType, event.pagePath, event.elementKey ?? null],
    );
  } catch (error) {
    unavailable(error);
  }
}

export async function loadFrontendAnalyticsOverview(days: 7 | 30): Promise<SiteAnalyticsOverview> {
  try {
    const database = await ensureSchema();
    const [summary, series, pages] = await Promise.all([
      database.query<Record<string, unknown>>(
        `SELECT
           count(DISTINCT visitor_hash) FILTER (WHERE event_type = 'page_view') AS unique_visitors,
           count(DISTINCT (visitor_hash, page_path)) FILTER (WHERE event_type = 'page_view') AS unique_page_visits,
           count(*) FILTER (WHERE event_type = 'page_view') AS page_views,
           count(*) FILTER (WHERE event_type = 'impression') AS impressions
         FROM frontend_analytics_events WHERE true ${since(days)}`,
      ),
      database.query<Record<string, unknown>>(
        `SELECT
           occurred_at::date::text AS day,
           count(DISTINCT (visitor_hash, page_path)) FILTER (WHERE event_type = 'page_view') AS unique_page_visits,
           count(*) FILTER (WHERE event_type = 'page_view') AS page_views,
           count(*) FILTER (WHERE event_type = 'impression') AS impressions
         FROM frontend_analytics_events WHERE true ${since(days)}
         GROUP BY 1 ORDER BY 1`,
      ),
      database.query<Record<string, unknown>>(
        `SELECT
           page_path,
           count(DISTINCT (visitor_hash, page_path)) FILTER (WHERE event_type = 'page_view') AS unique_page_visits,
           count(*) FILTER (WHERE event_type = 'page_view') AS page_views,
           count(*) FILTER (WHERE event_type = 'impression') AS impressions,
           max(occurred_at) AS latest_activity
         FROM frontend_analytics_events WHERE true ${since(days)}
         GROUP BY page_path
         ORDER BY page_views DESC, unique_page_visits DESC, page_path
         LIMIT 20`,
      ),
    ]);
    const row = summary.rows[0] ?? {};

    return {
      days,
      summary: {
        uniqueVisitors: count(row.unique_visitors),
        uniquePageVisits: count(row.unique_page_visits),
        pageViews: count(row.page_views),
        impressions: count(row.impressions),
      },
      series: series.rows.map(item => ({
        day: String(item.day),
        uniquePageVisits: count(item.unique_page_visits),
        pageViews: count(item.page_views),
        impressions: count(item.impressions),
      })),
      pages: pages.rows.map(item => ({
        pagePath: String(item.page_path),
        uniquePageVisits: count(item.unique_page_visits),
        pageViews: count(item.page_views),
        impressions: count(item.impressions),
        latestActivity: item.latest_activity instanceof Date
          ? item.latest_activity.toISOString()
          : typeof item.latest_activity === "string" ? item.latest_activity : null,
      })),
    };
  } catch (error) {
    unavailable(error);
  }
}
