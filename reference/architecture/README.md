# Stellar x402 Facilitator Architecture

Status: architecture decision baseline  
Protocol baseline: `x402` commit `ee1b148de4a8` (2026-07-30)  
Stellar baseline: `x402-stellar` commit `7a96df856f53` (2026-07-21)  
OpenZeppelin baseline: `stellar-contracts` commit `56d6e5b91aed` (2026-07-27)  
x402scan baseline: `x402scan` commit `fd93913adc2d` (2026-07-30)

## Decision

Ship one modular facilitator process and one PostgreSQL database with pgvector. The
same process owns the x402 wire endpoints, settlement orchestration, Bazaar
catalog, search, background jobs, analytics API, and optional in-process model
inference. PostgreSQL owns durable workflow state, locks, budgets, catalog data,
vectors, and settlement records. There is no Redis, vector database, broker,
hosted model, hosted indexer, or hosted key service in the required path.

On-chain, ship one small immutable, stateless Soroban `upto` settlement contract
per network. It atomically approves, pulls the maximum, pays the actual amount,
refunds the remainder, and leaves no allowance or contract balance. Exact
continues to use the canonical SEP-41 transfer design. Everything not required
for atomic payment correctness remains off-chain and forkable.

This decomposition favors self-hosting over independent service scaling. The
trade-off is that search and settlement share a failure domain. Module
boundaries and database-backed jobs permit later separation without making it a
deployment requirement.

## Workload target

The storage and execution paths are designed for the observed x402 shape:
roughly 198,000 transactions against about $23,000 daily volume, many sub-cent
payments and an approximately $0.12 average, a catalog around 2,000 sellers,
burst traffic, and severe buyer/server concentration (54 buyers produced
122,000 transactions at one server). Consequences are a mandatory channel pool,
append-only and idempotent settlement writes, database-wide sponsor budgets,
bounded queues, and no assumption that low monetary value means low abuse cost.

The catalog remains in the low thousands. PostgreSQL FTS and pgvector are
sufficient; a separate search cluster, vector service, streaming platform, or
web-scale sharding design would make self-hosting worse without serving this
workload.

## Non-negotiable decisions

1. The external x402 wire format remains canonical. Stellar adds only
   `extra.areFeesSponsored`. Operator policy failures use existing, non-null
   rejection reasons.
2. Both `stellar:testnet` and `stellar:pubnet`, and both `exact` and `upto`, are
   release gates.
3. `actual = 0` submits the normal `upto` contract transaction. It consumes the
   Soroban authorization nonce and returns a real transaction hash. Skipping it
   would make zero settlement facilitator-local and allow later non-zero use.
4. The `upto` contract has no admin, upgrade function, pause authority,
   allowlist, or payment-state storage. Replacement means a new audited contract
   ID and an overlap migration.
5. One active embedding model generation is queried at a time. A model change
   builds and evaluates a shadow generation, then atomically changes the active
   generation. Dimensions are stored, checked, and indexed per generation.
6. Ranked pagination is materialized in PostgreSQL as an expiring search
   session. The cursor identifies a frozen ordered result set, so concurrent
   catalog writes cannot reorder later pages.
7. Mainnet cannot start settlement without sponsor keys, API authentication,
   explicit sponsor budgets, and a measured fee-ceiling profile. Testnet
   Friendbot bootstrap is an explicit development profile only.
8. Seller-authored metadata is untrusted provenance-bearing data. It is never
   promoted to instructions and no LLM may invent or rewrite catalog facts.
9. The project, contract, containers, runtime dependencies, and bundled model
   weights must pass a permissive-OSI allowlist. AGPL, GPL, LGPL, SSPL, BSL,
   non-commercial, source-available, and custom model terms are release
   blockers.

## Open-question resolutions

| Question | Resolution |
| --- | --- |
| Zero actual | Submit the atomic contract call, including approve/pull/refund, to consume the nonce; return its hash and amount `"0"`. |
| Same auth entry, different actual | Soroban host nonce protection should reject it after the first successful use because `actual` does not change the credential nonce. A live changed-actual replay test is a contract-freeze gate; no release may rely on the claim until the hash-backed test passes. |
| Two facilitators submit concurrently | The payer binds the facilitator address, so different facilitators cannot use one authorization. Replicas sharing one identity coordinate through PostgreSQL idempotency and channel leases. If the same identity is operated without shared state, the host accepts at most one nonce; the loser can still pay a failed fee, so sharing an identity across independent deployments is unsupported. |
| Contract upgrade/admin | None. Immutable deployment, reproducible WASM hash, new contract ID for replacement, and an overlap window. |
| Lost RPC response | Persist envelope hash and XDR before submission, poll by hash, and only rebroadcast that identical envelope. Never rebuild or allocate a new sequence for an unknown result. |
| Embedding changes | Shadow generation, complete backfill, offline evaluation, concurrent index build, atomic active-generation switch, rollback retention, then garbage collection. |
| Metadata provenance | Store seller declaration, observation source, origin-probe status, timestamps, and optional signed-offer verification separately. Bazaar stays wire-compatible; dashboard and MCP wrappers expose provenance without changing x402 objects. |
| No-transaction `upto` response | Not applicable: zero settlement is submitted and has a hash. |
| OpenZeppelin policy arguments | The policy interface receives `soroban_sdk::auth::Context`, including `Context::Contract.args`. A purpose-built settlement spending policy can inspect `max_amount`; its tests must use real auth entries. |
| Ranked cursor stability | Materialized, TTL-bound search sessions in PostgreSQL with resource ID as final tie-breaker and an HMAC-authenticated opaque cursor. |
| Duplicate catalog entries | A stable resource key has append-only versions. Identical content refreshes `last_seen`; changed content creates a candidate version and replaces the active version only after validation and origin proof. |
| Missing Bazaar price filter | Do not add a private filter. Submit a typed price-filter proposal upstream; until accepted, price intent may influence natural-language ranking but is not exposed as a non-standard request field. |

## Documents

- [Phased build plan](./phased-build-plan.md)
- [Core facilitator](./core-facilitator.md)
- [Bazaar and catalog](./bazaar.md)
- [Storage, search, and evaluation](./storage-search-evaluation.md)
- [Stellar `upto` specification and contract](./spec-and-contract.md)
- [MCP support](./mcp.md)
- [Configuration reference](./configuration.md)
- [Conformance checklist](./conformance.md)
- [Dependencies and licensing](./dependencies-and-licensing.md)

## Security invariants

The following are code invariants, not configuration: recipient, token,
contract, network, facilitator, maximum, actual, and time-window bindings;
`0 <= actual <= max_amount`; `allowance == max_amount` before pull; no leftover
allowance; signature and auth-tree validation; host nonce behavior; transaction
source and operation-source validation; enforcing simulation; expected event and
balance deltas; re-verification at settlement; canonical Bazaar validation;
non-null rejection reasons; atomic rollback; exact and `upto` semantics; and
wire compatibility.

Configuration is allowed to make policy stricter. It can never bypass these
checks, change their meaning, or convert a failed check into a warning.

## Evidence still required before contract freeze

The architecture accepts the measured facts in the RFP. Three additional live
tests are release-blocking:

1. replay one signed auth entry with a changed `actual`;
2. concurrently submit that entry from two replicas using the same facilitator
   identity and record both terminal results and charged fees;
3. derive per-network fee-ceiling profiles from p99.9 enforcing simulations and
   confirmed transactions covering G-account and adversarial C-account payers.

These are measurements, not design options. A surprising result reopens the
affected design before audit.
