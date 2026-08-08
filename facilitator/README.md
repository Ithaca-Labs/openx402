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

## Self-facilitation inside a resource server

The package also exports an in-process implementation of the canonical
`FacilitatorClient` interface. It uses the same verification, settlement,
PostgreSQL idempotency, distributed channel leases, fee budgets and recovery as
the standalone HTTP service; only the network hop is removed.

```ts
import { createEmbeddedFacilitator } from "@openx402/stellar-facilitator";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";

const facilitator = await createEmbeddedFacilitator();
const resourceServer = new x402ResourceServer(facilitator)
  .register("stellar:testnet", new ExactStellarScheme());

app.use(paymentMiddleware(routes, resourceServer));
process.on("SIGTERM", () => void facilitator.close());
```

Configuration and PostgreSQL remain mandatory because replay protection,
idempotency, global sponsorship budgets and channel sequence locks must survive
process restarts and work across replicas. The complete runnable example is in
[`examples/self-facilitating-resource-server`](examples/self-facilitating-resource-server).

The example was exercised with the stock `@x402/fetch` wrapper against a fresh
PostgreSQL database: the unpaid request returned 402, the paid retry returned
the resource, and the embedded facilitator persisted testnet transaction
`0ae048a68dec91c359bd640e8d165176238da45f3a393d5b9fa99c398e4c627f` as successful.

## Architecture

One stateless HTTP process owns protocol parsing and orchestration. PostgreSQL owns idempotency, cross-replica channel leases and fencing tokens, sponsor budgets, rate windows, encrypted managed keys, and the settlement audit trail. Stellar RPC supplies simulation and submission; Horizon is used only for startup native-balance checks. No additional datastore is required.

`/verify` delegates the Stellar `exact` protocol interpretation and record-mode simulation to the Apache-2.0 `@x402/stellar` facilitator scheme. A local hardening adapter then validates the unmodified `{ transaction }` payload, payment terms, exact authorization tree, auth expiration, and expected SEP-41 token events before an enforcing simulation with the signed auth entries. Only the enforcing fee is compared with the resource, inclusion, and total ceilings. The adapter tolerates unrelated contract events that `@x402/stellar` 2.20.0 currently over-rejects, but still requires exactly one matching transfer event from the configured asset.

`/settle` re-runs the upstream-backed verification, leases a channel with `FOR UPDATE SKIP LOCKED`, rebuilds the verified invocation with that channel as source, and signs an outer fee bump with the sponsor. The package's one-shot `settle()` is intentionally not called because it selects and submits before an operator can durably store the exact envelope. Here the envelope XDR and transaction hash are committed with the budget reservation before submission. A lost RPC response is resolved by polling that hash; the channel stays quarantined until `SUCCESS` or `FAILED`, so the service never rebuilds or double-submits an unknown transaction.

The upto path binds payer, recipient, token, network passphrase, settlement contract, maximum, ledger window, facilitator, settlement ID, and optional versioned hook. Actual may vary from zero through maximum. Zero uses a real contract transaction, consumes the nonce, and returns a real hash. The facilitator requires the exact pull/pay/refund event sequence. Settlement hooks are allowlisted, cannot be the settlement or token contract, and execute inside enforcing simulation and its fee gate.

Generic token behavior, atomic-unit handling, restricted-asset failures, and the tested compatibility boundary are documented in [docs/SEP41.md](docs/SEP41.md).

## Bazaar catalog and discovery

A payment that carries the `bazaar` extension is also a catalog observation.
Cataloging runs after the payment has been decided, in a step that catches
everything: a bad declaration produces an official `EXTENSION-RESPONSES` header
with `bazaar.status = "rejected"` and a stable reason, never a failed payment.
`index_on` defaults to `verified`; `settled` records a candidate at verify time
and activates it only after a confirmed settlement.

`GET /discovery/resources` and `GET /discovery/search` serve the official browse
and search shapes. Filters are the specification set (`type`, `network`,
`scheme`, `payTo`, `extensions`) plus `asset` and an asset-bound `maxPrice`
expressed in atomic units. These extensions are documented as upstream
proposals. Cursors are opaque HMAC
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

Ranked responses carry `x-search-session-id`. Supplying that header on a later
exact `GET /discovery/resource` records explicit fetch-after-search feedback;
the same signed-cursor session spans every page and empty searches are retained.

Embeddings are produced off the request path by a worker that claims durable
jobs from the same PostgreSQL queue with `FOR UPDATE SKIP LOCKED` and fencing
tokens, with batching, exponential backoff and dead-lettering. One model
generation is active at a time; changing the model, revision, dimension,
pooling or normalization creates a new generation with its own typed storage, so
incompatible vectors can never be mixed.

```sh
npm run index -- status      # generations, queue depth, provider health
npm run index -- reindex     # explicit migration after a model change
```

See [search and indexing](docs/SEARCH.md) for the fusion formula,
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

- exact: `b3756fb22af22d172fbf0a6efde84c7228b4aae980829abfb7227ff2e3b72e67`
- upto partial (canonical `x402Client` + reusable scheme): `eeaee51c8e1368a95d019174b87fc56b7778f88898eb8404fdea484d91e9fd63`
- upto zero (canonical `x402Client` + reusable scheme): `315802ef4e2e9e044ca890f955a3a832d7490d9ef342dd3aeebbe1e22dd98cf2`
- cataloged exact: `5d65ecc30098e6e4d895f80a35ef746b105e6e2034a7843e9a281da77456fae3`

That last payment returned `bazaar.status = "success"` on both `/verify` and `/settle`, and its resource was then returned by `GET /discovery/resources` and matched by `GET /discovery/search?query=weather` with the accepts entry equal to the terms actually paid.

The official x402 E2E runner also passed with its unmodified TypeScript fetch client, HTTP payment middleware, and `ExactStellarScheme`. Its testnet transaction is `efa579ad8a9b2fb456dcf7803955d0cf5fc32f8db33329508885f96d493aa532`.

The reusable Stellar upto client in `@openx402/stellar-upto` is registered on an
otherwise unmodified canonical `x402Client`; the live test no longer constructs
the transaction through a private fixture. It is kept as a separate,
upstream-shaped package until the same source is merged into `@x402/stellar`.

After moving production exact verification onto `@x402/stellar`, a fresh zero-account Docker deployment was regression-tested with the stock exact client. The direct exact payment settled as `a20a88fd1ce7c72ba45664f95727c9ebf0ef44c9389e92bdb0b091a3fd18626d`; a second exact payment carrying Bazaar metadata settled as `931315bac2622d182efd97ef2704f02ec962b1acc67c6c3e99f8e998ba782056` and appeared in discovery search.

Pubnet is implemented and fail-closed but intentionally not exercised by the live test.
