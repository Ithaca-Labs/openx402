# x402scan field inventory and coverage

Inventory taken from the vendored x402scan source at `reference/x402scan`:

- `packages/internal/databases/scan/prisma/schema.prisma` (catalog side)
- `packages/internal/databases/transfers/prisma/schema.prisma` (settlement side)
- `apps/scan/src/services/transfers/**` (aggregate query result shapes)
- `apps/scan/src/services/db/**`, `apps/scan/src/trpc/routers/public/**`
- `apps/scan/src/types/timeframes.ts`
- `docs/DISCOVERY.md`

Coverage below is against the read APIs this facilitator serves under
`/analytics/v1`. The dashboard UI is out of scope for this deliverable.

## Catalog side (`scan` database)

### `Resources`

| x402scan field | Here | Notes |
| --- | --- | --- |
| `id` | `catalog_resources.id` | |
| `resource` | `catalog_resources.resource_url` | |
| `method` | `catalog_resources.method` | |
| `type` (enum `http` only) | `catalog_resources.type` | Extended with `mcp`. |
| `x402Version` | `catalog_resource_versions.x402_version` | |
| `lastUpdated` | `catalog_resources.last_seen`, `catalog_resource_versions.activated_at` | |
| `metadata` (Json) | `catalog_resource_versions.bazaar_extension`, `extensions` | Original declaration kept verbatim. |
| `deprecatedAt` (soft delete) | `catalog_resources.status` (`disabled`, `tombstoned`) | Richer: also `stale`, `quarantined`. |
| `originId` | `catalog_resources.origin` | Origin is a column, not a separate table. |
| `@@unique([resource, method])` | `catalog_resources.resource_key` unique | Plus tool name for MCP. |

Not carried over: `Tag`/`ResourcesTags` (curated operator tags — this catalog
uses seller-declared `tags` only), `ExcludedResource` (replaced by
`status = 'disabled'`), `AgentConfigurationResource`, `ToolCall`, `Chat`,
`Message`, `User`, `Account`, `Session`, `ServerWallet`, `OnrampSession`,
`InviteCode`, `InviteRedemption`, `News`, `Partners`. Those belong to x402scan's
hosted consumer product, not to a self-hosted facilitator.

### `Accepts`

| x402scan field | Here |
| --- | --- |
| `scheme` | `catalog_payment_options.scheme` |
| `network` (enum of EVM/SVM chains) | `catalog_payment_options.network` (CAIP-2 text) |
| `maxAmountRequired` | `catalog_payment_options.amount` (atomic units, `numeric(39,0)`) |
| `resource` | `catalog_payment_options.resource_id` |
| `description` | `catalog_resource_versions.description` |
| `mimeType` | `catalog_resource_versions.mime_type` |
| `payTo` | `catalog_payment_options.pay_to` |
| `maxTimeoutSeconds` | `catalog_payment_options.max_timeout_seconds` |
| `asset` | `catalog_payment_options.asset` (+ `asset_symbol`, `asset_decimals`) |
| `outputSchema` | `catalog_resource_versions.output_schema`, `output_example`, `output_type` |
| `extra` | `catalog_payment_options.extra` |
| `verified`, `verifiedAddress`, `verificationProof`, `verifiedAt` | `catalog_resource_versions.verification`, `provenance`, `observed_at`, `activated_at`; ownership anchored by `catalog_resources.owner_pay_to` | 

x402scan keys `Accepts` as `@@unique([resourceId, scheme, network])`, so a price
change overwrites in place. Here each option row is append-only with
`created_version`/`retired_version`, so historical settlements keep pointing at
the terms actually paid.

### `ResourceOrigin`, `OgImage`

| x402scan field | Here |
| --- | --- |
| `origin` | `catalog_resources.origin`, `/analytics/v1/origins` |
| `title`, `description`, `favicon`, `email` | Seller-declared `service_name`, `description`, `icon_url` only |
| `OgImage.url/height/width/title/description` | Not implemented — would require fetching seller-controlled URLs, which this facilitator deliberately never does during request processing |

### `ResourceRequestMetadata`, `ResourceResponse`, `ResourceInvocation`

| x402scan field | Here | Notes |
| --- | --- | --- |
| `headers`, `body`, `queryParams`, `inputSchema` | `catalog_resource_versions.input_schema`, `input_example` | Seller-declared, not captured traffic. |
| `ResourceResponse.response` | `catalog_resource_versions.output_example` | Seller-declared. |
| `ResourceInvocation.statusCode/statusText/method/url/duration` | `payment_events` (settlement status, network, scheme, resource) | See divergence note below. |
| `ResourceInvocation.requestHeaders/requestBody/responseHeaders/responseBody` | **Deliberately not stored** | Retaining live request/response bodies and headers would turn a high-volume micropayment facilitator into a sensitive payload warehouse. |

### `ResourceMetrics` / `ResourceOriginMetrics`

x402scan precomputes, per resource and per origin:
`totalCount`, `uptimePct`, `p50Ms`, `p90Ms`, `p99Ms`, and `count_2xx/3xx/4xx/5xx`
across the windows `1h, 6h, 24h, 3d, 7d, 15d, 30d, all_time`.

`GET /analytics/v1/resources/:id/observability` serves the same window set
(1h, 6h, 24h, 3d, 7d, 15d, 30d, all time) with `calls_*`, `success_*`,
`failed_all_time`, `unknown_all_time`, `unique_buyers`, `total_amount` and
`latest_activity`. HTTP status classes and latency percentiles are **not**
populated, because this facilitator never proxies the seller's endpoint and so
has no status code or response time to record. What it does have — settlement
success, failure and unknown counts — is served instead, and is not relabelled
as uptime.

## Settlement side (`transfers` database)

### `TransferEvent`

| x402scan field | Here |
| --- | --- |
| `address` (token) | `payment_events.asset` |
| `sender` | `payment_events.payer` |
| `recipient` | `payment_events.pay_to` |
| `transaction_from` | `payment_events.facilitator_id` (the sponsor that funded the transaction) |
| `amount` (Float) | `payment_events.amount` (`numeric(39,0)`, atomic units — never a float) |
| `block_timestamp` | `payment_events.occurred_at` |
| `tx_hash` | `payment_events.transaction_hash` |
| `chain` | `payment_events.network` |
| `provider` | not applicable (single facilitator) |
| `decimals` | `payment_events.asset_decimals` |
| `facilitator_id` | `payment_events.facilitator_id` |
| `log_index` | not applicable |
| BRIN index on `block_timestamp` | `payment_events_time_brin_idx` |

Additional columns here with no x402scan equivalent: `stage`
(`verified`/`settled`), `status` (`valid`/`invalid`/`success`/`failed`/
`unknown`), `scheme`, `max_amount`, `fee_stroops` (sponsored fee),
`error_reason`, `resource_id`, `resource_version_id`, `payment_option_id`.

`TransferSyncState` has no equivalent: this facilitator is the source of its own
settlements and does not sync a third-party chain index.

## Aggregate query shapes

| x402scan query | Result fields | Served by |
| --- | --- | --- |
| `stats/overall-mv` | `total_transactions`, `total_amount`, `unique_buyers`, `unique_sellers`, `latest_block_timestamp` | `GET /analytics/v1/overview` (plus `successful_transactions`, `failed_transactions`, `total_verifications`, `total_sponsored_fee_stroops`, `unique_facilitators`, `unique_networks`, `unique_resources`, `first_activity`, and catalog counts) |
| `stats/bucketed-mv` | `bucket_start`, `total_transactions`, `total_amount`, `unique_buyers`, `unique_sellers` | `GET /analytics/v1/overview/timeseries?bucket=day\|hour` (identical field names) |
| `stats/first-transfer` | earliest timestamp | `overview.first_activity` |
| `transfers/list` | full transfer row, sortable by `block_timestamp`/`amount` | `GET /analytics/v1/transactions` (filterable by payer, payTo, network, scheme, asset, status, resourceId) |
| `buyers/list-mv` | `sender`, `facilitator_ids`, `tx_count`, `total_amount`, `latest_block_timestamp`, `unique_sellers`, `chains` | `GET /analytics/v1/buyers` → `address`, `facilitators`, `tx_count`, `total_amount`, `latest_activity`, `unique_counterparties`, `networks`, `unique_networks` |
| `sellers/list-mv` | `recipient`, `facilitator_ids`, `tx_count`, `total_amount`, `latest_block_timestamp`, `unique_buyers`, `chains` | `GET /analytics/v1/sellers` (same mapping) |
| `buyers/sellers/list` | `recipient`, `tx_count`, `total_amount`, `latest_block_timestamp`, `chains`, `facilitator_ids` | `GET /analytics/v1/buyers/:address/counterparties` and `.../sellers/:address/counterparties` |
| `buyers|sellers/stats/overall-mv` and `.../bucketed-mv` | per-address totals | `GET /analytics/v1/{buyers,sellers}/:address` and `.../transactions` |
| `networks/list` | `chain`, `tx_count`, `total_amount`, `latest_block_timestamp`, `unique_buyers`, `unique_sellers`, `unique_facilitators` | `GET /analytics/v1/overview/breakdowns` → `networks` (identical field names, `key` instead of `chain`) |
| `facilitators/list`, `facilitators/bucketed` | `facilitator_id`, `tx_count`, `total_amount`, `latest_block_timestamp`, `unique_buyers`, `unique_sellers`, `chains` | Single-facilitator deployment: `overview.unique_facilitators` and the `facilitators` array on each participant row. A multi-facilitator leaderboard is meaningless here and is deliberately not faked. |
| `origins/stats/overall-mv` | `total_origins`, `total_transactions`, `total_amount`, `unique_buyers`, `latest_block_timestamp` | `GET /analytics/v1/origins` |
| `wallets/stats` | `total_transactions`, `total_amount`, `unique_recipients`, `chains` | `GET /analytics/v1/buyers/:address` |
| `resources/stats/*`, `spending/*` | tool-call and spend rollups tied to x402scan's own chat product | Not applicable |

### Scheme, asset and status breakdowns

x402scan has no single breakdown endpoint; chain breakdowns come from
`networks/list` and status has no equivalent (it only indexes successful
transfers). `GET /analytics/v1/overview/breakdowns` returns `networks`,
`schemes`, `assets` and `statuses` in one response, each with `key`,
`tx_count`, `total_amount`, `unique_buyers`, `unique_sellers`,
`unique_facilitators` and `latest_activity`.

### Buyer and seller concentration

x402scan exposes concentration implicitly through its sorted leaderboards.
`GET /analytics/v1/{buyers,sellers}` returns an explicit `concentration` object:
`total_amount`, `top1_amount`, `top5_amount`, `top10_amount`,
`total_transactions`, `top5_transactions`, `participants`.

### Recent settlements and resources

- `GET /analytics/v1/transactions` — newest first by `occurred_at, id`.
- `GET /analytics/v1/resources` — newest cataloged resources with status,
  ownership, verification, provenance and liveness timestamps.
- `POST /analytics/v1/resources/observability` — batched metrics for the exact
  resource URLs on one discovery page, preserving that page's order.
- `GET /analytics/v1/volume/daily` — `payment_daily_totals`, maintained
  incrementally in the same transaction as each settlement fact and corrected
  (not double counted) when an `unknown` settlement later resolves.

### Time windows

x402scan's `ActivityTimeframe` is `AllTime(0), OneDay(1), SevenDays(7),
FifteenDays(14), ThirtyDays(30)`. The `?days=` parameter accepts exactly that
set and falls back to 30. Resource observability uses the separate x402scan
metrics window set (1h, 6h, 24h, 3d, 7d, 15d, 30d, all time).

### Tiny-value, high-transaction-count workloads

Amounts are `numeric(39,0)` atomic units throughout — never a JavaScript number
and never a float, so a million 1-stroop payments sum exactly (x402scan stores
`amount Float`, which cannot make that guarantee). `payment_events` carries a
descending btree and a BRIN index on `occurred_at`, plus btree indexes on
`payer`, `pay_to`, `network` and `resource_id`. Volume charts read the
pre-aggregated `payment_daily_totals` rollup rather than scanning the fact
table.

## Deliberate divergences, summarized

1. No live request/response bodies, headers or query strings are retained.
2. No HTTP status classes or latency percentiles, because this facilitator does
   not proxy seller endpoints; settlement outcome counts are served instead and
   are not relabelled as uptime.
3. No favicon, OG image or origin-title fetching — icons are never fetched.
4. Amounts are exact integers, not floats.
5. Payment options are append-only rather than overwritten in place.
6. Aggregates come from this facilitator's own confirmed and failed settlements
   and its own catalog observations. They are not presented as a network-wide
   chain index.
