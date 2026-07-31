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

