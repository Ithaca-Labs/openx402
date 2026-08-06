---
version: 1
slug: "app-analytics-page-tsx"
primary_target: "app/analytics/page.tsx"
related_targets: ["app/api/site-analytics/access/route.ts","app/api/site-analytics/overview/route.ts","app/api/site-analytics/track/route.ts"]
---

# Site analytics

## Scope and mode

`/analytics` is a private **Operate** surface in the established openx402 explorer.

## Audience and task

The project operator enters the allowed email in a focused modal, then scans anonymous site usage: unique route visits, page views, content impressions, daily movement, and the routes receiving attention.

## Content and constraints

The page shows real aggregated event data for a 7- or 30-day window. It never exposes visitor identifiers or raw event rows. The email modal accepts only `labsithaca@gmail.com`; it is a convenience gate rather than ownership verification. The route stays outside public navigation and inherits existing dark/light, operational dashboard patterns.

## Direction and memorable moment

Use a restrained operator console: a clear page heading and live-range control lead into one metric strip, then a single decisive activity curve beside a compact legend. The page table turns the abstract totals into answerable questions about where attention lands. The gate has protected focus and a short explanation, then dissolves to the data without a theatrical load sequence.

## Unresolved decisions

Production deployment must configure `ANALYTICS_ACCESS_SECRET` and `ANALYTICS_DATABASE_URL` in the frontend service.
