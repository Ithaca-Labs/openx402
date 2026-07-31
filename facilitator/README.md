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

See [configuration](docs/CONFIGURATION.md) and [dependency licences](THIRD_PARTY_LICENSES.md).

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run licenses
npm audit --omit=dev
npm run test:live
```

The live test uses the stock `@x402/stellar` exact client and canonical HTTP facilitator client, then exercises partial and zero Stellar upto settlements. Published testnet hashes from the latest run:

- exact: `c544dbceaedebd08429f29d42cd9834e47e4a611450e09a0980d38fa4a4beb31`
- upto partial: `0d30bcb75ba420d94f68aee0bac609d1496e9b56ecf1b203877334931c887740`
- upto zero: `7ff23e2e8b004365e9910a136ecd8778dd16c36dd8c4d598edeaf5432cdb1fef`

The official x402 E2E runner also passed with its unmodified TypeScript fetch client, HTTP payment middleware, and `ExactStellarScheme`. Its testnet transaction is `efa579ad8a9b2fb456dcf7803955d0cf5fc32f8db33329508885f96d493aa532`. Upstream does not yet provide a canonical Stellar upto client, so upto is covered by the wire-compatible live fixture rather than claimed as an official-suite case.

Pubnet is implemented and fail-closed but intentionally not exercised by the live test.
