# Configuration reference

YAML is loaded from `FACILITATOR_CONFIG` (default `config/self-hosted.yaml`). Secret values are read indirectly through the named environment variables.

## Server and storage

| Key | Default | Meaning |
| --- | --- | --- |
| `server.port` | `4022` | HTTP port; `PORT` overrides it. |
| `database_url_env` | `DATABASE_URL` | Environment variable containing the PostgreSQL URL. |
| `api_keys_env` | `FACILITATOR_API_KEYS` | Comma-separated bearer keys. Keyless mode is allowed only without pubnet. |
| `key_encryption_key_env` | `FACILITATOR_KEY_ENCRYPTION_KEY` | Base64 32-byte AES key; mandatory in production. |

## Global limits

| Key | Default | Meaning |
| --- | --- | --- |
| `max_request_bytes` | `262144` | JSON request limit. |
| `max_concurrent_simulations` | `20` | Per-process simulation semaphore. |
| `max_simulations_per_key_per_minute` | `30` | Database-backed API-key or IP rate. |
| `max_sponsored_stroops_per_key_per_day` | `5000000` | Database-backed principal budget. |
| `max_global_sponsored_stroops_per_day` | `200000000` | Database-backed global budget. |
| `max_pending_settlements` | `1000` | Backpressure threshold for unresolved records. |
| `channel_lease_ms` | `30000` | Cross-replica channel lease duration. |
| `settle_poll_ms` | `1000` | Transaction status poll interval. |
| `settle_timeout_ms` | `30000` | Request-time polling deadline; recovery continues later. |

## Bazaar cataloging (`indexing`)

Everything here is catalog policy. None of it can change payment semantics, and
a catalog failure never changes a payment outcome.

| Key | Default | Meaning |
| --- | --- | --- |
| `auto_catalog` | `true` | Catalog observations automatically and advertise `bazaar` in `/supported`. |
| `index_on` | `verified` | `verified` activates a listing after a successful `/verify`; `settled` stores a candidate at verify time and activates only after a confirmed settlement. |
| `require_valid_schema` | `true` | Validate `info` against the declared `schema` with Ajv before cataloging. |
| `duplicate_changed` | `version_and_verify` | Behaviour for a changed declaration: append a new version, or `reject` it. Overwrite is not offered. |
| `stale_after_hours` | `168` | Age after which an unobserved resource is demoted to `stale`. |
| `max_metadata_bytes` | `131072` | Serialized size ceiling for the whole `extensions.bazaar` object. |
| `max_description_length` | `4000` | `resource.description` is truncated to this length, not rejected. |
| `max_schema_bytes` | `65536` | Ceiling for the declared JSON Schema. |
| `max_example_bytes` | `16384` | Ceiling for each declared example (`queryParams`, `body`, `input.example`, `output.example`). |
| `max_json_depth` | `32` | Nesting ceiling for the bazaar extension. |
| `max_tags` | `5` | Tag count ceiling. Values above 5 have no effect: the official `sanitizeTags` truncates to 5 first. |
| `max_tag_length` | `32` | Tag length ceiling. Values above 32 have no effect for the same reason. |
| `max_icon_url_length` | `2048` | `iconUrl` length ceiling. |
| `max_service_name_length` | `32` | `serviceName` length ceiling; the official rule is also 32. |
| `max_route_template_length` | `512` | `routeTemplate` length ceiling before the official grammar check. |
| `fetch_icons` | `false` | Fixed `false`. Icons are never fetched during request processing; only the URL is stored. |
| `inactive_version_retention_days` | `365` | Retention for superseded and quarantined versions. |
| `catalog_observation_retention_days` | `90` | Retention for cataloging observations. |

## Catalog trust boundary (`catalog_security`)

| Key | Default | Meaning |
| --- | --- | --- |
| `require_https_origins` | `true` | Reject a plain-`http` public resource origin. Forced `true` while pubnet is enabled. |
| `allow_local_origins` | `false` | Accept loopback and private-range origins. Only for the local testnet/E2E profile; startup fails if pubnet is enabled while this is `true`. The checked-in `config/self-hosted.yaml` sets it `true` because that profile is the local testnet profile. |

See [catalog trust boundary](CATALOG-TRUST.md) for the full threat model.

## Discovery (`discovery`)

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Serve `GET /discovery/resources` and `GET /discovery/search`. |
| `default_page_size` | `20` | Page size when the caller sends no `limit`. |
| `max_page_size` | `50` | Ceiling; a larger `limit` is clamped, not rejected. |
| `cursor_ttl_minutes` | `15` | Lifetime of an issued cursor. |
| `include_stale` | `false` | Include `stale` resources in responses. |
| `include_unverified` | `false` | Include versions this facilitator never observed a payment for. Forbidden while pubnet is enabled. |
| `cursor_hmac_key_env` | `FACILITATOR_CURSOR_HMAC_KEY` | Base64 key (≥32 bytes) signing discovery cursors. When unset it is derived deterministically from the key-encryption key, so every replica signs identical cursors with no extra secret. |

Only the specification filters are accepted: `type`, `network`, `scheme`,
`payTo`, `extensions`, plus `limit`/`offset`/`cursor`. `asset` is additionally
accepted because it is a structured column here; it is **not** part of the
Bazaar specification, and neither is any price filter. Both are documented as
upstream proposals in [catalog trust boundary](CATALOG-TRUST.md); clients must
not depend on them. There is no client-selectable sort parameter.

## Search (`search`)

Full pipeline reference: [search, indexing and evaluation](SEARCH.md).

### `search.lexical`

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Use the PostgreSQL full-text branch. |
| `language` | `simple` | Text-search configuration. `simple` avoids language guessing; `english` adds stemming and stopword removal. |
| `weight` | `0.7` | Frozen lexical branch weight in reciprocal rank fusion. |
| `candidate_count` | `250` | Candidates retrieved before fusion. |

### `search.semantic`

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Attempt the vector branch. Disabling it is a supported lexical-only deployment. |
| `provider` | `local` | `disabled`, `local`, `remote`, or `fake` (tests only; rejected unless `FACILITATOR_ALLOW_FAKE_PROVIDERS=1`). |
| `model` | `BAAI/bge-m3` | Logical model identity recorded on every vector. |
| `repo` | `Xenova/bge-m3` | Repository holding the loadable ONNX artifact. |
| `revision` | `4de1325…f0858` | Immutable commit sha. Must be a full 40-character sha when `models.require_pinned_revision` is set. |
| `dimension` | `1024` | Validated against what the provider actually returns on every batch. |
| `pooling` | `cls` | `cls` or `mean`. Part of the generation identity. |
| `normalization` | `l2` | `l2` or `none`. Part of the generation identity. |
| `weight` | `0.3` | Frozen semantic branch weight in fusion. |
| `timeout_ms` | `500` | Bound on the query-embedding call; a timeout degrades to lexical. |
| `candidate_count` | `250` | Candidates retrieved before fusion. |
| `max_distance` | `0.9` | Fixed cosine-distance guard when lexical retrieval has no candidate; prevents unrelated nearest-neighbour rows from defeating no-result behavior while allowing hybrid recall expansion when lexical evidence exists. |
| `remote_url_env` | `FACILITATOR_EMBEDDING_URL` | Required when `provider: remote`. |
| `remote_api_key_env` | `FACILITATOR_EMBEDDING_API_KEY` | Optional bearer token. |

### `search.reranking`

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Rerank the fused head. |
| `provider` | `local` | `disabled`, `local`, `remote`, `fake`. |
| `model` | `BAAI/bge-reranker-v2-m3` | Logical identity. |
| `repo` | `""` | ONNX cross-encoder export. Empty by default because none is published for the local runtime; the provider stays degraded and search falls back to hybrid. |
| `revision` | `953dc6f…8d41e` | Immutable commit sha. |
| `top_k` | `30` | How many fused results are reranked. The tail keeps its fused order and never outranks a reranked result. |
| `timeout_ms` | `800` | Bound on the rerank call. |
| `fallback_to_hybrid` | `true` | On timeout, error or unavailability, return fused results. `false` returns nothing instead. |
| `remote_url_env` | `FACILITATOR_RERANKER_URL` | Required when `provider: remote`. |
| `remote_api_key_env` | `FACILITATOR_RERANKER_API_KEY` | Optional bearer token. |

### `search` fusion and limits

| Key | Default | Meaning |
| --- | --- | --- |
| `rrf_k` | `20` | Frozen reciprocal-rank-fusion constant: `score(d) = Σ w_b / (k + rank_b(d))`. |
| `minimum_relevance_score` | `0` | Drop fused results below this score. |
| `default_result_limit` | inherits `discovery.default_page_size` | Page size for `/discovery/search` when the caller sends no `limit`. |
| `maximum_result_limit` | inherits `discovery.max_page_size` | Ceiling; a larger `limit` is clamped. |
| `origin_diversity_limit` | `3` | How many results one origin may hold before being demoted (never dropped). |

### `search.impressions`

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Record what was shown, for conversion and ranking attribution. |
| `retain_query_text` | `true` | Store raw queries for benchmark maintenance and search-quality analysis. Disable when policy forbids query retention. |
| `retention_days` | `90` | Pruned hourly. |

### `search.models`

| Key | Default | Meaning |
| --- | --- | --- |
| `cache_dir` | `.models` | Model cache. Persist it to keep restarts offline-capable. |
| `offline` | `false` | Forbid any download; a missing artifact becomes a degraded state. |
| `dtype` | `q8` | ONNX weight precision, for example `fp32`, `q8`, `q4`. |
| `require_pinned_revision` | `true` | Refuse to start a local provider without a full commit sha. |

### `search.indexing`

| Key | Default | Meaning |
| --- | --- | --- |
| `batch_size` | `32` | Documents per provider call. |
| `worker_concurrency` | `1` | Batches claimed per poll. |
| `poll_ms` | `500` | Queue poll interval. |
| `lease_ms` | `30000` | Job lease; an expired lease is safe to steal. |
| `max_attempts` | `5` | Attempts before a job is dead-lettered. |
| `backoff_base_ms` | `1000` | Exponential backoff base: `base × 2^(attempt-1)`. |
| `backoff_max_ms` | `300000` | Backoff ceiling. |
| `reindex_schedule` | `manual` | `manual`, or `startup` to enqueue missing documents on every boot. |

## Analytics (`analytics`)

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Serve the internal `/analytics/v1` routes. |
| `default_page_size` | `50` | Page size when the caller sends no `limit`. |
| `max_page_size` | `200` | Ceiling for `limit`. |
| `redact_addresses` | `false` | Pseudonymize buyer/seller addresses in responses. Display-only; it never changes stored settlement facts. |

`/analytics/v1` is behind the same bearer authentication as `/verify` and
`/settle`. `/discovery` is public and read-only. Operator-only fields
(status, verification, provenance, observations, rejection reasons) exist only
on the analytics routes and never enter a Bazaar wire response.

## Per-network keys

Each entry under `networks` has the same surface.

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Advertise and serve the network. |
| `rpc_url` | required | Stellar RPC endpoint. |
| `horizon_url` | required | Horizon endpoint for startup account balance checks. |
| `friendbot_url` | none | Testnet Friendbot endpoint. |
| `development_auto_fund` | `false` | Create/fund testnet managed keys; forbidden on pubnet. |
| `channel_account_count` | `10` | Desired dev count and minimum pubnet supplied count. |
| `channel_min_balance_stroops` | `50000000` | Startup minimum for every sponsor/channel account. |
| `sponsor_secret_env` | none | Environment variable used to import a sponsor key. |
| `channel_secrets_env` | none | Environment variable containing comma-separated channel keys. |
| `upto_contract` | none | Settlement contract address. |
| `upto_contract_env` | none | Environment variable containing that address. |
| `fee_ceilings_calibrated` | `false` | Required acknowledgement that enabled-network ceilings are measured. |
| `allowed_settlement_hooks` | `[]` | Contracts a payer may invoke through the optional hook. |
| `max_timeout_seconds` | `300` | Maximum seller-selected timeout and resulting auth expiry window. |
| `assets[].contract` | required | Allowed SEP-41/SAC contract. |
| `assets[].symbol` | required | Operator label; not trusted for settlement. |
| `assets[].decimals` | required | Display/indexing precision; amounts remain integer stroops. |
| `assets[].max_payment` | required | Maximum accepted authorization in atomic token units. |
| `fees.<scheme>.max_resource_fee_stroops` | required | Enforcing simulation resource ceiling. |
| `fees.<scheme>.max_inclusion_fee_stroops` | required | Inclusion fee ceiling. |
| `fees.<scheme>.max_total_fee_stroops` | required | Combined ceiling; must cover the other two. |

Fee profiles exist separately for `exact` and `upto`. Derive them per network from measured p99 legitimate settlements, including supported custom-account and hook profiles. Never enable a network by merely flipping the calibration flag over the example numbers.

## Deliberately fixed invariants

The following are not configurable: x402 version 2 wire shape; non-null rejection reasons; recipient, asset, payer, network, contract, maximum, settlement ID and facilitator binding; `actual >= 0 && actual <= max`; exact auth-tree structure; upto root plus nested approval structure; signed-auth validation; deadline and signature-expiry ordering; record then enforcing simulation; enforcing fee checks; facilitator-as-payer rejection; client source and fee rejection; channel fencing; durable hash-before-send; transaction-hash polling before retry; expected exact transfer events; upto pull/pay/refund events; real on-chain zero settlement; hook self/token rejection; and pubnet development-funding prohibition.

These values define payment correctness, replay behavior, or sponsor safety. Making them tunable would let an operator accidentally produce wire-compatible but insecure settlement.

The catalog adds its own fixed invariants: the official Bazaar schema and
soft-drop rules; percent-decoding `routeTemplate` before traversal and scheme
checks; MCP identity as the (`resource.url`, `input.toolName`) tuple; the ban on
fetching icons during request processing; the ban on one payTo silently
replacing another's active listing; the append-only version and payment-option
history; and the rule that cataloging never turns a valid payment into an
error. `duplicate_changed` may be made stricter (`reject`) but never permissive:
in-place overwrite is not an option.

Search adds its own fixed invariants: only rank positions enter fusion, never a
raw `ts_rank_cd` value against a cosine distance; one active model generation per
index, with a model, revision, dimension, pooling or normalization change
forcing a new generation and an explicit reindex; vectors from different
generations are never compared; embedding dimension is validated on every batch
before storage; no generative model may produce or rewrite indexed text; and
search never fails merely because a model is absent.
