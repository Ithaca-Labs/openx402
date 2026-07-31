# Phased Build Plan

## Dependency order

The critical path is:

`protocol proof -> contract/spec freeze -> security review -> audited contract IDs
-> stock-client conformance -> pubnet release`

Contract review is serial after freeze. The developer guide also has an external
review dependency; adding engineers cannot shorten either interval. Contract and
guide drafts therefore begin earlier than their apparent feature order.

## Phase 0: proof and freeze inputs

Deliverables:

- freeze the protocol and repository baselines listed in the architecture index;
- implement live changed-actual replay and concurrent-facilitator measurements;
- build the fee-calibration corpus on testnet and pubnet for G-accounts, normal
  smart accounts, and budget-adversarial smart accounts;
- write normative `scheme_upto_stellar.md` and test vectors before contract code;
- freeze the contract ABI, auth tree, return value, event set, errors, and
  canonical deployment procedure;
- establish the SPDX dependency allowlist, model manifests, SBOM generation,
  provenance signing, and an explicit AGPL deny test;
- extend the canonical x402 E2E scenario model for Stellar `upto`;
- draft the developer guide and send it to external review.

Exit criteria: all replay claims have transaction hashes, fee defaults are based
on measured distributions rather than guessed numbers, the TSC has an early
spec draft, and no contract interface question remains open.

## Phase 1A: contract and mechanism

This is the first implementation phase because audit cannot start before it.

- implement the immutable stateless Soroban settlement contract;
- implement G-account and C-account auth trees, including nested SEP-41 calls;
- implement the purpose-built OpenZeppelin smart-account spending policy;
- add unit, property, fuzz, mutation, real-auth, rollback, malicious-token, and
  differential tests;
- implement the Stellar `upto` client and facilitator scheme modules;
- test every settlement, authorization, and token case in the RFP;
- produce reproducible WASM, source/SBOM attestations, and testnet deployment;
- freeze and submit the contract and settlement path for independent audit.

The security review starts at contract freeze and runs serially. Findings reopen
the freeze, are fixed, retested, and re-reviewed before canonical pubnet
deployment.

## Phase 1B: core facilitator

- package the modular monolith and PostgreSQL migrations;
- expose canonical `/verify`, `/settle`, and `/supported`;
- integrate exact and `upto` on both networks;
- implement record simulation, client signing, enforcing re-simulation, event
  and balance checks, fee gates, rebuild, sign, submit, and poll;
- implement channel-account leases, idempotency, transaction-hash recovery,
  database-backed sponsor budgets, bounded retry, circuit breakers, and
  low-balance handling;
- implement encrypted local keys, optional KMS adapters, key rotation, and the
  explicit testnet Friendbot bootstrap profile;
- add the self-facilitation library entry point and single-command Compose
  package;
- add metrics, traces, structured audit logs, backup/restore, and readiness
  checks.

Exit criteria: stock clients complete exact and `upto` on testnet under
concurrency and fault injection, and a fresh machine boots testnet with one
command and no account or API-key setup.

## Phase 1C: Bazaar, search, and MCP protocol support

- implement canonical browse and search endpoints, stable cursors, and filters;
- validate Bazaar metadata before any index write;
- implement hostile-input handling, route-template decoding checks, HTTP/MCP
  origin probes, catalog status/liveness, and `EXTENSION-RESPONSES`;
- publish HTTP and MCP seller helpers that compile readable declarations to the
  official extension shape;
- add PostgreSQL FTS, BGE-M3 local inference, pgvector retrieval, RRF, provider
  fallbacks, and optional reranking;
- implement embedding generation migration and air-gapped model bundles;
- implement the golden-set and adversarial evaluation runner;
- catalog MCP resources keyed by `(resource.url, input.toolName)` and exercise
  the MCP PaymentRequired/payment retry transport;
- add the read-only analytics endpoints needed by an x402scan-equivalent
  dashboard, while leaving the dashboard UI to Phase 2.

Exit criteria: a lexical-only installation and an embedding-enabled installation
both pass Bazaar E2E tests; model failure never prevents settlement or lexical
search.

## Phase 1D: conformance, operations, and documentation

- run the unmodified canonical clients for the four network/scheme combinations;
- publish four confirmed transaction hashes and the exact E2E command/output;
- run the official x402 E2E suite against testnet and pubnet configurations;
- exercise all non-null rejection and wire snapshots;
- load-test burst traffic, channel fairness, catalog writes, and thousands of
  listings in PostgreSQL;
- complete disaster recovery, key rotation, replica, RPC outage, and
  air-gapped-install drills;
- incorporate the independent developer-guide review;
- close security-review findings and publish the audit report and limitations.

## Phase 1E: production release

- deploy the exact audited WASM to canonical testnet and pubnet IDs;
- publish signed images, checksums, SPDX SBOMs, model manifests, migration
  instructions, and operator runbooks;
- release the Apache-2.0 facilitator, contract, seller SDK, examples, and
  conformance artifacts;
- enable spec-drift monitoring for the remainder of the grant period.

Pubnet settlement readiness remains closed until the operator supplies sponsor
keys, account authentication, budgets, RPC endpoints, and the signed measured
fee profile.

## Phase 2 and optional work

The following are explicitly outside the acceptance critical path:

- **Phase 2:** standalone MCP discovery server. The Phase 1 facilitator already
  supports MCP cataloging and discovery.
- **Phase 2:** x402scan-equivalent dashboard UI over the Phase 1 analytics API.
- **Phase 2:** buyer/agent SDK beyond the examples and E2E client needed for
  conformance.
- **Phase 2:** unusual SEP-41 variants beyond the committed compatibility
  matrix.
- **Optional:** `doctor` command sharing the catalog validator and
  `EXTENSION-RESPONSES` reason catalog.
- **Future separate project:** batch settlement and authorization capture. This
  requires an escrow contract, durable voucher store, double-spend prevention,
  explicit custody analysis, and a separate audit.

Deferring these items keeps audit and wire conformance on the critical path
without making their eventual deployment depend on a hosted operator.
