# Conformance Checklist

Wire-level compatibility is a release gate. Passing internal unit tests or a
custom client is not acceptance evidence.

## Required acceptance matrix

| Network | Scheme | Stock client | Confirmed hash | Official E2E |
| --- | --- | --- | --- | --- |
| `stellar:testnet` | `exact` | required | publish before release | required |
| `stellar:testnet` | `upto` | required | publish before release | required |
| `stellar:pubnet` | `exact` | required | publish before release | required |
| `stellar:pubnet` | `upto` | required | publish before release | required |

The evidence manifest records upstream x402 commit, released package versions,
facilitator image digest, configuration hash with secrets removed, network,
asset contract/decimals, settlement contract ID/version/WASM hash, transaction
hash, ledger, timestamp, and terminal E2E output. Hash fields remain explicitly
unfilled until confirmed on-chain; no architecture document invents them.

## Hard assertions

- [ ] An unmodified canonical x402 client completes exact on testnet.
- [ ] An unmodified canonical x402 client completes exact on pubnet.
- [ ] An unmodified canonical x402 client completes `upto` on testnet.
- [ ] An unmodified canonical x402 client completes `upto` on pubnet.
- [ ] `/supported` emits both schemes and networks with
  `extra.areFeesSponsored: true`.
- [ ] The specification payload `{ "transaction": "<base64 XDR>" }` is accepted
  verbatim, without wrappers, aliases, or private fields.
- [ ] A confirmed settlement hash is published for each matrix row.
- [ ] Every `/verify` rejection has a non-empty `invalidReason`.
- [ ] Every `/settle` failure has a non-empty `errorReason` and schema-valid
  transaction/network fields.
- [ ] The official x402 repository E2E suite passes against the testnet
  deployment.
- [ ] The same unmodified suite/configuration path passes against pubnet.
- [ ] HTTP and MCP Bazaar E2E scenarios pass with canonical response shapes.
- [ ] Browse uses `items`; search uses `resources`, `x402Version`, canonical
  pagination, and defined `partialResults`.

"Unmodified" means the released canonical SDK/client package constructs,
verifies, and decodes the wire exchange. Configuration, wallet material, target
URL, and network are inputs; no local patch, forked serializer, response shim,
or test-only compatibility adapter is permitted.

The upstream Bazaar harness runs the facilitator's loopback-only `e2e` profile
because its expected HTTP/MCP fixtures do not carry signed offers. That profile
may expose schema-valid resources from completed harness scenarios, as the
official test requires, but cannot change protocol objects or any payment
security check. Production profiles retain origin-proof requirements.

## Wire snapshots

Golden byte/JSON fixtures cover:

- PaymentRequired, PaymentPayload, `/verify`, `/settle`, and `/supported`;
- exact and `upto`, both networks, success and every rejection family;
- base64 header encoding/decoding and case-sensitive header names;
- Stellar payload XDR with exactly the `transaction` field;
- Bazaar HTTP and MCP resource declarations;
- `EXTENSION-RESPONSES` success, processing, and rejected cases;
- MCP PaymentRequired in structured content and first text content, payment
  `_meta`, and payment-response `_meta`;
- zero actual with amount `"0"` and a non-empty transaction hash.

Fixtures are generated from canonical schemas and then checked into source.
Internal DTOs must serialize exactly to them.

## Payment correctness

- [ ] Exact permits only its canonical Stellar transfer operation/tree.
- [ ] `upto` binds payer, payTo, token, max, time bounds, facilitator, contract,
  and network; facilitator authorization binds actual.
- [ ] Actual 0, below max, and equal max succeed; above max and negative reject.
- [ ] `i128::MAX` does not overflow and fails only for defined balance/policy
  reasons.
- [ ] All amounts remain atomic integer strings with asset-specific decimals;
  Stellar USDC uses seven decimals.
- [ ] Allowance equals max before pull and is zero after success.
- [ ] Pull max, pay actual, and refund remainder produce exact combined deltas.
- [ ] A failed approve, pull, pay, refund, token error, assertion, or panic
  atomically rolls back token and contract state.
- [ ] Failed transactions are charged to sponsor accounting.
- [ ] Missing recipient trustline rejects at verify.
- [ ] Paused, authorization-required, clawback-enabled, ordinary SEP-41, and
  error-returning tokens match the compatibility declaration.
- [ ] G- and C-account payers and recipients pass the committed matrix.

## Authorization and replay

- [ ] Real signed auth entries cover 1-of-1 agent, n-of-n, threshold, weighted
  threshold, multiple signers, passkey/external verifier, default/explicit
  context rule, and revocation.
- [ ] Tests prove mocks are not used as evidence for `__check_auth`.
- [ ] Wrong/missing signer, signature, credential type, nonce, expiration, and
  invocation reject.
- [ ] Extra/missing/reordered nested token calls and malformed trees reject.
- [ ] Changing actual, max, recipient, token, contract, facilitator, or time
  after signing produces the specified accept/reject behavior.
- [ ] Record simulation creates the expected tree; enforcing simulation executes
  and validates it.
- [ ] Replay after success rejects.
- [ ] Replay after failure has a measured, documented outcome and no partial
  balances.
- [ ] Replay of the same payer auth with changed actual rejects after success.
- [ ] Concurrent replicas cannot submit different actuals for one
  `authorization_id`.
- [ ] Concurrent independent facilitator addresses cannot use an authorization
  bound to another address.

The changed-actual and concurrent-facilitator tests publish transaction hashes
and diagnostic XDR as Phase 0 evidence before contract freeze.

## Facilitator resilience

- [ ] Settle re-verifies and ignores a previous verify result.
- [ ] Client source, sequence, operation source, fee, footprint, and resource
  data are rejected/rebuilt.
- [ ] Record simulation is followed by signed enforcing simulation.
- [ ] Resource, inclusion, and total fee ceilings use enforcing results and
  measured profiles.
- [ ] Sponsor budgets transact atomically across replicas.
- [ ] A lost RPC response enters unknown state and polls the persisted hash.
- [ ] Only the identical envelope may be rebroadcast; no unknown payment is
  rebuilt or double-submitted.
- [ ] PENDING, SUCCESS, FAILED, NOT_FOUND quorum, and unknown provider results
  are fault-injected.
- [ ] RPC timeout, provider rate limit, sequence collision, fee surge, dynamic
  storage pricing, sponsor low balance, and stale simulation fail as designed.
- [ ] Multiple channel accounts sustain concurrent settlement without sharing a
  sequence lease.
- [ ] One quarantined channel does not stop the pool.
- [ ] Duplicate requests, changed XDR, changed actual, retry storms, and
  simulation-cache poisoning are rejected or deduplicated.
- [ ] Pubnet starts fail-closed without keys, authentication, budgets, or fee
  profile.
- [ ] Testnet Friendbot behavior is reachable only through the explicit
  development profile.

## Bazaar and search

- [ ] Every candidate passes canonical schema validation before indexing.
- [ ] Invalid optional Bazaar fields soft-drop according to the specification.
- [ ] Route templates are percent-decoded before traversal checks.
- [ ] HTTP and MCP origin proof prevents client-echo listing/payTo/price spoofing.
- [ ] MCP duplicate URL entries remain distinct by tool name.
- [ ] Identical declarations refresh; changed declarations create verified
  versions and retain history.
- [ ] Stale/dead/quarantined entries are demoted or excluded as configured.
- [ ] Stable cursor pages do not reorder under concurrent catalog/model writes.
- [ ] Seller-authored prompt injection remains escaped, bounded, structurally
  labeled, and absent from trusted instructions.
- [ ] Lightweight lexical-only startup works with no model/API account.
- [ ] Embedding and reranking timeouts follow the documented degradation ladder.
- [ ] A model-dimension/revision change cannot mix vectors.
- [ ] Golden reports include recall@k, MRR, nDCG, latency, reranker lift,
  coverage, conversion, and adversarial ranking results.

## Operational evidence

- [ ] Fresh single-command testnet bootstrap on an empty host.
- [ ] Single facilitator image plus one PostgreSQL/pgvector instance only.
- [ ] Offline start from a preloaded model bundle and lexical start without it.
- [ ] Encrypted key creation, backup, restore, and overlapping rotation drill.
- [ ] Two-replica sequence lease and sponsor-budget tests.
- [ ] PostgreSQL migration, logical backup, PITR/portable restore, and reindex
  drill.
- [ ] Contract TTL extension/restore by an independent operator.
- [ ] Signed container/WASM/model manifests and complete SPDX SBOM.
- [ ] License CI reports no denied direct, transitive, container, build-tool, or
  model dependency.

## Spec-change monitoring

During the grant period:

1. pin the tested upstream x402 commit in the evidence manifest and lockfile;
2. run a daily job that fetches upstream and diffs the watched specs, schemes,
   extensions, transports, schemas, SDKs, and E2E harness;
3. open a tracked compatibility issue with affected fixtures/modules for every
   semantic change; never auto-merge protocol changes;
4. run the official E2E suite weekly against both network configurations and on
   every dependency/conformance PR;
5. publish a compatibility matrix and changelog with each facilitator release;
6. ship security/conformance fixes through a reviewed patch release and rerun
   the four-row evidence matrix;
7. notify the TSC when Stellar behavior needs a protocol change rather than
   adding a local field.

The grant's final report includes all weekly results, open upstream issues/PRs,
released conformance updates, and any known divergence.
