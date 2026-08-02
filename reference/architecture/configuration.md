# Configuration Reference

## Loading and validation

Configuration loads in this order: release defaults, named profile, YAML file,
environment-variable overrides, secret-file references, and CLI overrides.
Unknown keys, duplicate networks/assets, invalid CAIP-2 IDs, unsafe numeric
ranges, contradictory limits, model-dimension mismatch, and unresolved secret
references are startup errors.

Secrets are never accepted as literal YAML values. A `secret://name` resolves
from a mounted file, encrypted local keystore, or configured KMS adapter. The
effective non-secret configuration and its hash are logged at startup.

`required` below is an intentional fail-closed sentinel. `calibrated:<name>`
refers to a signed fee-profile artifact containing network, contract/WASM,
mechanism versions, sample corpus, percentile, safety margin, timestamp, and
ceiling.

## Profiles

| Profile | Networks | Authentication | Embedding | Reranking | Bootstrap |
| --- | --- | --- | --- | --- | --- |
| `testnet-dev` | testnet | none | local, async | off | generated encrypted keys + Friendbot |
| `self-hosted` | configured, testnet default | none on testnet; required on pubnet | local | off | none |
| `lightweight` | configured, testnet default | same as self-hosted | off | off | none |
| `hosted` | testnet + pubnet | API key | configured provider | on | none |
| `e2e` | harness-selected | none, loopback only | off | off | harness fixtures |

The explicit command `docker compose --profile testnet-dev up` supplies the
zero-account, zero-API-key experience. No profile invokes Friendbot on pubnet.
That profile also supplies the Compose database URL and public localhost URL,
generates the keystore master and cursor HMAC secrets on the persistent volume,
selects the release test asset and bounded fixture maximum, and creates/funds
the sponsor/channel pool. None of those generated values is reused for pubnet.

The `e2e` profile binds only to loopback, accepts harness-local HTTP/MCP origins,
and exposes schema-valid candidates observed in completed test scenarios so the
official Bazaar harness can inspect them. It cannot be combined with pubnet or a
non-loopback listener and does not change auth, simulation, fee, replay, source,
or settlement checks.

## Complete default surface

```yaml
service:
  listen_host: "0.0.0.0"
  listen_port: 8080
  public_base_url: required
  profile: self-hosted
  replica_id: auto
  request_body_max_bytes: 1048576
  graceful_shutdown_ms: 30000

database:
  url: secret://database_url
  pool_min: 2
  pool_max: 20
  statement_timeout_ms: 10000
  lock_timeout_ms: 3000
  migration_mode: apply
  job_poll_ms: 500
  job_lease_ms: 30000

networks:
  - id: "stellar:testnet"
    enabled: true
    rpc_urls: ["https://soroban-testnet.stellar.org"]
    horizon_urls: ["https://horizon-testnet.stellar.org"]
    rpc_request_timeout_ms: 5000
    horizon_request_timeout_ms: 5000
    rpc_submit_timeout_ms: 10000
    rpc_health_interval_ms: 15000
    rpc_failure_threshold: 5
    rpc_recovery_ms: 30000
    poll_interval_ms: 1000
    poll_timeout_ms: 60000
    contract_manifest: "builtin://stellar-upto-contracts.json"
  - id: "stellar:pubnet"
    enabled: false
    rpc_urls: []
    horizon_urls: []
    rpc_request_timeout_ms: 5000
    horizon_request_timeout_ms: 5000
    rpc_submit_timeout_ms: 10000
    rpc_health_interval_ms: 15000
    rpc_failure_threshold: 5
    rpc_recovery_ms: 30000
    poll_interval_ms: 1000
    poll_timeout_ms: 90000
    contract_manifest: "builtin://stellar-upto-contracts.json"

assets:
  - network: "stellar:testnet"
    contract: "manifest://testnet-usdc"
    symbol: "USDC"
    decimals: 7
    enabled: true
    maximum_payment_atomic: required
    compatibility: common-sep41

schemes:
  exact:
    enabled: true
  upto:
    enabled: true

payment_policy:
  maximum_accepted_timeout_seconds: 300
  minimum_actual_atomic: 0
  require_recipient_receivable_at_verify: true
  accepted_contract_versions: manifest
  fee_sponsorship: true

facilitator:
  verify_timeout_ms: 5000
  settle_timeout_ms: 10000
  max_pending_settlements: 1000
  channel_account_count: 10
  channel_allocation_strategy: postgres_lease
  sequence_lock_timeout_ms: 3000
  channel_lease_ms: 120000
  unknown_result_quarantine: until_ledger_expiry
  max_submission_retries: 1
  transaction_poll_providers: all_healthy
  not_found_quorum: 2
  health_check_interval_ms: 15000
  circuit_breaker_failure_threshold: 5
  circuit_breaker_reset_ms: 30000

sponsorship:
  sponsor_account: secret://facilitator_sponsor_account
  channel_accounts: secret://facilitator_channel_accounts
  minimum_available_channels: 2
  minimum_sponsor_balance_stroops: required
  reserve_budget_before_signing: true

keys:
  provider: local_encrypted
  keystore_path: "/var/lib/x402/keys"
  master_key: secret://keystore_master_key
  rotation_overlap_hours: 24
  pending_key_retention_days: 30
  forbid_plaintext_environment_keys: true

development:
  bootstrap_testnet: false
  friendbot_url: "https://friendbot.stellar.org"
  generate_channel_accounts: true
  allow_local_catalog_origins: false

authentication:
  mode: none
  api_key_header: "Authorization"
  api_key_prefix: "Bearer"
  key_hash: argon2id
  trusted_proxy_hops: 0

limits:
  fee_profile:
    stellar:testnet: calibrated:release-testnet
    stellar:pubnet: required
  max_resource_fee_stroops: calibrated
  max_inclusion_fee_stroops: calibrated
  max_total_fee_stroops: calibrated
  max_sponsored_stroops_per_key_per_day:
    stellar:testnet: unlimited
    stellar:pubnet: required
  max_global_sponsored_stroops_per_day:
    stellar:testnet: unlimited
    stellar:pubnet: required
  max_concurrent_simulations: 20
  max_simulations_per_key_per_minute: 30
  max_simulations_per_ip_per_minute: 60
  max_pending_per_payer: 2
  max_requests_per_ip_per_minute: 120
  max_xdr_bytes: 262144
  max_auth_entries: 16
  max_json_depth: 32
  max_metadata_bytes: 131072
  sponsor_budget_reservation_ttl_ms: 120000
  reject_when_budget_store_unavailable: true

idempotency:
  pending_wait_ms: 2000
  record_retention_days: 90
  envelope_retention_days: 30
  unknown_reconcile_interval_ms: 2000
  terminal_not_found_after_ledger_expiry: true

search:
  lexical:
    enabled: true
    language: simple
    weight: 0.35
    candidate_count: 100
  semantic:
    enabled: true
    provider: local
    model: "BAAI/bge-m3"
    revision: release-pinned
    dimension: 1024
    weight: 0.65
    timeout_ms: 500
    candidate_count: 100
    index: hnsw
    exact_scan_below_documents: 2000
  reranking:
    enabled: false
    provider: local
    model: "BAAI/bge-reranker-v2-m3"
    revision: release-pinned
    top_k: 30
    timeout_ms: 800
    fallback_to_hybrid: true
  rrf_k: 60
  minimum_relevance_score: 0
  default_result_limit: 20
  maximum_result_limit: 50
  maximum_session_candidates: 1000
  origin_diversity_limit: 3

models:
  cache_dir: "/var/lib/x402/models"
  download_policy: if_missing
  download_base_url: "https://huggingface.co"
  require_manifest_checksum: true
  allow_unreviewed_licenses: false
  offline: false
  worker_threads: auto
  embedding_batch_size: 32

indexing:
  auto_catalog: true
  require_valid_schema: true
  index_on: verified
  stale_after_hours: 168
  probe_interval_hours: 24
  probe_timeout_ms: 2000
  probe_max_bytes: 262144
  probe_max_redirects: 0
  embedding_batch_size: 32
  max_description_length: 4000
  max_tags: 20
  max_tag_length: 64
  max_example_bytes: 16384
  reindex_schedule: manual
  duplicate_identical: refresh
  duplicate_changed: version_and_verify
  inactive_version_retention_days: 365
  catalog_observation_retention_days: 90
  fetch_icons: false
  icon_max_bytes: 262144
  icon_timeout_ms: 1000

discovery:
  max_page_size: 50
  default_page_size: 20
  cursor_ttl_minutes: 15
  allowed_filters: [type, network, scheme, payTo, extensions]
  browse_order: newest
  search_order: relevance
  include_stale: false
  include_unverified: false
  hmac_key: secret://cursor_hmac_key

catalog_security:
  require_https_origins: true
  deny_private_networks: true
  dns_rebind_check: true
  allowed_internal_origins: []
  sanitize_bidi_controls: true
  require_signed_offer_for_mutating_http: true
  require_signed_offer_for_mcp: true
  require_signed_offer_for_all: false

analytics:
  enabled: true
  raw_query_retention_days: 7
  impression_retention_days: 90
  aggregate_refresh_minutes: 5
  public_address_redaction: false

operator_pricing:
  mode: none
  accounting_currency: null
  price_per_settlement_minor: null
  sponsored_fee_markup_bps: 0
  plan_source: local_database

observability:
  log_level: info
  log_format: json
  metrics_enabled: true
  metrics_path: "/metrics"
  trace_enabled: false
  otlp_endpoint: null
  redact_addresses: false
  redact_xdr: true
  retain_settlement_records_days: 90
  retain_audit_logs_days: 90
  alert_sponsor_balance_stroops: required
  alert_channel_available_below: 2
  alert_unknown_settlements: 1
```

The release replaces `release-pinned`, manifest asset aliases, and calibrated
testnet profile references with immutable revisions/values. A template sentinel
is never accepted as a production value.

## Field semantics and allowed changes

### Network and payment

- `networks[].enabled` controls readiness and advertisement.
- `rpc_urls`/`horizon_urls`, timeouts, health, polling, and breaker settings are
  operational. At least two independent pubnet poll providers are recommended;
  a second provider is required when `not_found_quorum` is two.
- `assets` is an operator allowlist. Contract, symbol, and decimals must agree
  with on-chain inspection at startup. `maximum_payment_atomic` is required on
  pubnet and may only become stricter at runtime.
- `maximum_accepted_timeout_seconds` is the seller/payment-requirements ceiling.
  The seller controls the requested timeout, so the facilitator always caps it.
- `minimum_actual_atomic` is fixed at zero in this release. Increasing it would
  violate generic `upto`; changing it is rejected by schema.
- `fee_sponsorship` is fixed true for an enabled Stellar scheme in this
  deliverable. An operator can disable a scheme/network, but cannot advertise
  it as conformant while using a client-funded transaction source.

### Facilitator and abuse

Pool size, timeouts, pending cap, health intervals, retries, and circuit
thresholds are tunable. `channel_allocation_strategy` currently accepts only
`postgres_lease`; the field preserves extension without allowing a process-local
unsafe mode. `max_submission_retries` is bounded to 0 or 1. A retry is permitted
only after proof that no prior envelope was submitted.

`sponsor_account` and `channel_accounts` resolve encrypted signer records or KMS
references. Their public addresses, network, and current sequence/balance are
verified at startup. `reserve_budget_before_signing` is fixed true; it is
visible to make the order auditable, not to offer an unsafe alternative.

Fee ceilings can be lower than a calibration profile or can reference a newer
signed profile. `unlimited` is forbidden for all pubnet sponsor budgets and fee
ceilings. Global budgets and `reject_when_budget_store_unavailable` cannot be
disabled on pubnet.

Authentication may be none, API key, or a pluggable signed-request adapter.
Pubnet requires a non-none mode. IP limits supplement keys; they are not treated
as identity behind untrusted proxies.

There is intentionally no `skip_zero_settlements` knob. The earlier proposed
value `true` conflicts with nonce consumption and canonical success responses.
Zero settlement always submits.

### Search and indexing

Weights, providers, candidate counts, timeouts, fallback, model revisions,
dimensions, result limits, relevance threshold, batching, schedules, staleness,
retention, and icon policy are configurable. Weight changes alter quality but
not catalog truth.

The `self-hosted` profile uses local BGE-M3 and disables reranking to reduce
resources. `lightweight` disables semantic and reranking. `hosted` enables its
configured embedding and reranking providers. All retain FTS and the same API.

Changing model ID, immutable revision, tokenizer, pooling, normalization, or
dimension creates a new generation and invokes the shadow migration; it cannot
mutate an active generation. `allow_unreviewed_licenses` is fixed false in
release builds.

`duplicate_changed` may be `version_and_verify` or `reject`; overwrite is not
allowed. `include_unverified` is rejected by production public discovery. The
only public exception is the loopback-only `e2e` profile for canonical harness
fixtures. Authenticated operator analytics may inspect candidates. Security
quarantine always removes a result even from a materialized cursor.

`allowed_filters` is limited to the current Bazaar fields. Asset and price are
structured database columns but are not exposed as private filter parameters.
`browse_order` and `search_order` choose operator defaults; clients cannot send
a non-standard sort parameter. Adding an external asset, price, or sort filter
requires an upstream Bazaar change.

Signed-offer requirements for mutating HTTP and MCP are fixed true because
probing them can cause side effects and an echoed PaymentPayload does not prove
origin/payment-term ownership. `require_signed_offer_for_all` may make policy
stricter by applying the same requirement to GET/HEAD. It cannot weaken the two
fixed requirements.

### Observability and retention

Logging, metrics, tracing, OTLP export, address display, and most retention
periods are operator choices. Secrets, signatures, plaintext keys, API-key
values, and full auth entries are always redacted. Audit retention cannot be
shorter than unresolved-settlement retention.

Address redaction is display/log pseudonymization, not deletion from settlement
correctness records. Transaction hashes remain available for conformance and
reconciliation.

`operator_pricing` is optional off-wire accounting keyed to authenticated API
accounts. It may record a flat settlement price and sponsored-fee markup for
local invoicing; it never changes PaymentRequirements, payment amount, rejection
shape, or settlement priority. The default is free operation. Each operator
documents and configures its own pubnet plan rather than inheriting a hardcoded
hosted-service business model.

## Pubnet startup checks

When any pubnet scheme is enabled, startup requires:

- healthy RPC configuration and not-found quorum;
- canonical audited contract manifest with adequate TTL;
- enabled assets whose contract/decimals match on-chain;
- readable encrypted sponsor and channel keys with sufficient balance;
- non-none caller authentication;
- explicit maximum payments and per-key/global daily sponsor budgets;
- a valid measured fee profile and alert balance;
- PostgreSQL migrations, budget transactions, leases, and idempotency healthy.

Failure exits non-zero before binding the public listener. Search-only pubnet
operation is deployed with pubnet settlement disabled, not as a silently
degraded facilitator.

## Deliberately not configurable

| Invariant | Why |
| --- | --- |
| Recipient/token/network/contract/facilitator/max/time binding | Changing any after signature redirects or enlarges authority. |
| `0 <= actual <= max_amount` | Defines `upto` payment correctness. |
| `allowance == max_amount`, pull max, refund remainder | Prevents residual allowance and makes settlement atomic/terminal. |
| Signature, credential, auth-entry, and exact-tree validation | Authentication is not an operator policy. |
| Host nonce and authorization-ID replay handling | Prevents double settlement and replica races. |
| Transaction and operation source rejection/rebuild | Client-controlled fee sponsorship is unsafe. |
| Enforcing simulation | Record simulation is blind to custom-account auth cost. |
| Event, return, allowance, and balance-delta checks | A successful RPC status alone does not prove the intended payment. |
| Re-verification at settle | Ledger state and requirements may change after verify. |
| Atomic failure/no partial state | Core payment safety. |
| Zero settlement submission | Required to consume the nonce and return a hash. |
| Canonical Bazaar schema and hostile-path validation | Discovery input is attacker controlled. |
| Seller metadata as source of truth | Generated catalog claims would be unauditable. |
| Non-null rejection reason | Required wire behavior and operability. |
| Exact/`upto` payload and response semantics | Stock SDK and E2E compatibility. |
| Permissive-OSI dependency/model allowlist | Self-host redistribution and RFP eligibility. |
