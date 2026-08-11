# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People exploring the openx402 ecosystem use the public explorer to find services, networks, facilitators, and observed payment activity. The analytics surface provides anonymous, aggregate insight into how the explorer is used.

## Product Purpose

openx402 makes a live index of discoverable x402 services and ecosystem activity easier to inspect. Success means a visitor can find and assess the live ecosystem, while the operator can understand high-level anonymous usage of the explorer.

## Positioning

The explorer combines a live Bazaar index with observed facilitator and payment activity in one navigable public product surface.

## Operating Context

Visitors browse, search, and inspect operational data across routes such as Discover, Marketplace, Networks, Facilitators, and Transactions. Anyone can review the analytics route to compare anonymous page views, unique route visits, and content impressions over a selected reporting window.

## Capabilities and Constraints

- The existing Next.js explorer renders the public routes and records site analytics through its own server-side Postgres connection.
- Site analytics record only a random browser identifier, route path, event type, and timestamp. They do not collect email addresses, IP addresses, or page-content payloads.
- The analytics route and reporting endpoint are public; the data remains aggregate and anonymous.
- `ANALYTICS_DATABASE_URL` is required in the frontend server environment; the site does not send traffic telemetry to the facilitator.
- The analytics surface must preserve the established public explorer identity and remain hidden from primary navigation.

## Brand Commitments

The product is named openx402. Existing logo, Archivo and IBM Plex Mono font assets, and the established application UI are binding identity evidence.

## Evidence on Hand

- Public routes and UI system: `app/`, `components/`, and `public/brand/`
- Frontend analytics storage and reporting: `lib/site-analytics-store.ts` and `app/api/site-analytics/`

## Product Principles

- Keep the public explorer immediately useful without an account.
- Present live and historical operational data with clear provenance and restrained confidence.
- Treat visitor analytics as anonymous, minimal telemetry rather than behavioural profiling.
- Keep operator-only controls out of the public navigation and avoid overstating the strength of a convenience gate.
