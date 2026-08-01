# Stellar x402 facilitator

Self-hosted x402 v2 facilitator core for `stellar:testnet` and `stellar:pubnet`. It supports `exact` and the Soroban-backed Stellar `upto` scheme, sponsors transaction fees without taking custody, and stores all distributed state in PostgreSQL.

## Start locally

The development profile needs no Stellar account or API key. It creates encrypted testnet sponsor and channel keys in PostgreSQL and funds missing accounts through Friendbot.

```sh
docker compose up --build
```

The service listens at `http://localhost:4022`. Check `GET /health/ready` and `GET /supported`. Development auto-funding is forbidden on pubnet.

For a process-based start:

```sh
npm ci
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/facilitator
npm run build
npm start
```

## Architecture

One stateless HTTP process owns protocol parsing and orchestration. PostgreSQL owns idempotency, cross-replica channel leases and fencing tokens, sponsor budgets, rate windows, encrypted managed keys, and the settlement audit trail. Stellar RPC supplies simulation and submission; Horizon is used only for startup native-balance checks. No additional datastore is required.

`/verify` validates the unmodified `{ transaction }` payload, payment terms, exact authorization tree, auth expiration, and expected token events. It performs auth-free record simulation followed by enforcing simulation with the signed auth entries. Only the enforcing fee is compared with the resource, inclusion, and total ceilings.

`/settle` re-verifies everything, leases a channel with `FOR UPDATE SKIP LOCKED`, rebuilds the transaction with that channel as source, and signs an outer fee bump with the sponsor. The exact envelope XDR and transaction hash are committed with the budget reservation before submission. A lost RPC response is resolved by polling that hash; the channel stays quarantined until `SUCCESS` or `FAILED`, so the service never rebuilds or double-submits an unknown transaction.

The upto path binds payer, recipient, token, network passphrase, settlement contract, maximum, ledger window, facilitator, settlement ID, and optional versioned hook. Actual may vary from zero through maximum. Zero uses a real contract transaction, consumes the nonce, and returns a real hash. The facilitator requires the exact pull/pay/refund event sequence. Settlement hooks are allowlisted, cannot be the settlement or token contract, and execute inside enforcing simulation and its fee gate.

## Bazaar catalog and discovery

A payment that carries the `bazaar` extension is also a catalog observation.
Cataloging runs after the payment has been decided, in a step that catches
everything: a bad declaration produces an official `EXTENSION-RESPONSES` header
with `bazaar.status = "rejected"` and a stable reason, never a failed payment.
`index_on` defaults to `verified`; `settled` records a candidate at verify time
and activates it only after a confirmed settlement.

`GET /discovery/resources` and `GET /discovery/search` serve the official browse
and search shapes. Filters are the specification set (`type`, `network`,
`scheme`, `payTo`, `extensions`) plus `asset`, and there is no price filter —
both divergences are documented as upstream proposals. Cursors are opaque HMAC
tokens pinning a catalog watermark;
`catalog_next_version()` assigns versions under a row lock held to commit, so
version order equals commit order and a page cannot shift, duplicate or skip a
row while other replicas write.

Seller metadata is untrusted, client-echoed data. It is bounded, validated with
the official `@x402/extensions/bazaar` helpers, percent-decoded before traversal
checks, stripped of control and bidi characters for display, and stored with
`provenance = 'seller_declared'`. Icons are never fetched. One `payTo` can never
silently replace another's active listing. See
[catalog trust boundary](docs/CATALOG-TRUST.md).

`/analytics/v1` serves the operator dashboard data (overview, timeseries,
breakdowns, transactions, buyers, sellers, concentration, origins, resources,
observability) behind the same bearer authentication as the payment routes.
Operator-only status, verification and provenance fields live only there and
never enter a Bazaar wire response. See the
[x402scan field inventory](docs/X402SCAN-INVENTORY.md).

## Search

Ranking is hybrid: PostgreSQL full-text candidates and pgvector cosine
candidates fused by weighted reciprocal rank fusion, with optional cross-encoder
reranking of the top k. Only rank positions enter fusion — a `ts_rank_cd` score
and a cosine distance are never compared directly. The lexical branch is FTS with
`ts_rank_cd`, not BM25.

Every optional stage degrades on its own and says so: an embedding timeout,
a missing model, an unavailable reranker or a PostgreSQL server without pgvector
all fall back to full-text results with `partialResults: true`. Lexical search
works with zero API keys, zero accounts and no downloaded weights.

Embeddings are produced off the request path by a worker that claims durable
jobs from the same PostgreSQL queue with `FOR UPDATE SKIP LOCKED` and fencing
tokens, with batching, exponential backoff and dead-lettering. One model
generation is active at a time; changing the model, revision, dimension,
pooling or normalization creates a new generation with its own typed storage, so
incompatible vectors can never be mixed.

```sh
npm run index -- status      # generations, queue depth, provider health
npm run index -- reindex     # explicit migration after a model change
npm run evaluate             # recall@k, MRR, nDCG, violations, latency, lift
```

See [search, indexing and evaluation](docs/SEARCH.md) for the fusion formula,
the degradation matrix, model licences and pinned revisions.

Sellers declare their metadata with [`@openx402/bazaar-sdk`](../packages/bazaar-sdk),
whose `bazaar.http()` and `bazaar.mcp()` compile readable configuration into the
official wire format by delegating to the upstream builders.

## Fee sponsorship

The channel signs the rebuilt inner transaction. The sponsor signs a fee-bump envelope and pays both resource and inclusion fees; it is never payer or recipient. Enforcing simulation executes custom accounts and settlement hooks before a budget is reserved. PostgreSQL enforces per-principal and global daily budgets across replicas. Failed submitted transactions still consume the reserved budget because they still charge network fees.

Fee ceilings are fail-closed configuration. An enabled network must set `fee_ceilings_calibrated: true`; pubnet must also provide an audited upto contract, an API key, a sponsor, and the requested number of funded channels. The checked-in pubnet fee values are disabled examples, not production defaults.

## Operations

Keys use AES-256-GCM at rest with network and address as authenticated data. Set `FACILITATOR_KEY_ENCRYPTION_KEY` to a base64-encoded 32-byte key in production. The development fallback key is rejected by production mode.

```sh
# Drain traffic first; rotation refuses while any settlement is unresolved.
STELLAR_SECRET=S... npm run keys -- rotate-sponsor stellar:pubnet
STELLAR_SECRET=S... npm run keys -- add-channel stellar:pubnet
npm run keys -- disable-channel stellar:pubnet G...
```

Run all replicas with the same PostgreSQL database and encryption key. Back up the database with `pg_dump`; restore it with `pg_restore` before starting any facilitator replica. Rotate encryption material using an offline database re-encryption procedure, not by changing the environment variable under existing ciphertext.

See [configuration](docs/CONFIGURATION.md), [catalog trust boundary](docs/CATALOG-TRUST.md),
[search](docs/SEARCH.md), [x402scan field inventory](docs/X402SCAN-INVENTORY.md)
and [dependency licences](THIRD_PARTY_LICENSES.md).

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run licenses
npm audit --omit=dev
npm run test:live         # real testnet settlements
npm run evaluate          # retrieval quality report
npm run test:live-model   # optional: real ONNX weights, not part of CI
```

Integration tests need PostgreSQL 17 at `TEST_DATABASE_URL` (default
`postgresql://postgres:test@127.0.0.1:55432/facilitator_test`). Use the pgvector
image so the semantic tests run; plain `postgres:17-alpine` exercises the
lexical-only path instead:

```sh
docker run -d --name x402-test-pg -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=facilitator_test -p 55432:5432 pgvector/pgvector:pg17
```

The live test uses the stock `@x402/stellar` exact client and canonical HTTP facilitator client, exercises partial and zero Stellar upto settlements, and then makes a fourth exact payment carrying seller Bazaar metadata to check the `EXTENSION-RESPONSES` header and both discovery endpoints. Published testnet hashes from the latest run:

- exact: `0f231cf28791e5acda291d728a3837ef0d7b67baa9c45b80e1bfa764ecd5770b`
- upto partial: `638384dfc73e28c8736a7699b04caa7920b3ea247f269a82eec1f9832f4c504f`
- upto zero: `cc9c93d527e125674e5db01d23d38db56aa2cf736012a1bfbcb9597525ade0cb`
- cataloged exact: `3ee7fe173162619211a736a3b3c3f0b1f60b6a6ea5cb0d25f2140eca98e11887`

That last payment returned `bazaar.status = "success"` on both `/verify` and `/settle`, and its resource was then returned by `GET /discovery/resources` and matched by `GET /discovery/search?query=weather` with the accepts entry equal to the terms actually paid.

The official x402 E2E runner also passed with its unmodified TypeScript fetch client, HTTP payment middleware, and `ExactStellarScheme`. Its testnet transaction is `efa579ad8a9b2fb456dcf7803955d0cf5fc32f8db33329508885f96d493aa532`. Upstream does not yet provide a canonical Stellar upto client, so upto is covered by the wire-compatible live fixture rather than claimed as an official-suite case.

Pubnet is implemented and fail-closed but intentionally not exercised by the live test.
