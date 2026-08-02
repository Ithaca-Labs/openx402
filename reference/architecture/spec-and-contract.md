# Stellar `upto` Specification and Contract

## Normative document structure

The upstream contribution `specs/schemes/upto/scheme_upto_stellar.md` follows
the x402 scheme implementation template:

1. status, authors, dependencies, terminology, and conformance language;
2. supported CAIP-2 network identifiers and SEP-41 asset identifiers;
3. roles and trust model;
4. PaymentRequirements and PaymentPayload;
5. canonical settlement contract IDs and version discovery;
6. transaction and Soroban authorization-tree construction;
7. payer construction/signing algorithm;
8. facilitator `/verify` algorithm;
9. resource-server metering and `/settle` algorithm;
10. zero-actual behavior and response;
11. errors and existing x402 rejection-reason mapping;
12. exact event, balance, and return-value validation;
13. fee sponsorship and `extra.areFeesSponsored`;
14. replay, expiry, concurrency, and smart-account security;
15. test vectors and testnet/pubnet conformance transactions.

The proposal is submitted to the x402 TSC before the implementation is called
conformant. Price filtering is a separate Bazaar proposal. Neither waits on or
silently modifies the deployed v2 wire format.

## Wire format

The only Stellar payload is accepted verbatim:

```json
{
  "x402Version": 2,
  "scheme": "upto",
  "network": "stellar:testnet",
  "payload": {
    "transaction": "<base64 transaction envelope XDR>"
  }
}
```

There is no payment ID, contract ID, nonce, actual, fee, source account, or
operator-policy field added to x402. The transaction contains the contract call
and Soroban auth entries. `PaymentRequirements.amount` is the authorized
maximum during verification and the metered actual during settlement, following
generic `upto` semantics.

Successful settlement returns the standard amount, payer, network, and real
transaction hash. A zero actual returns amount `"0"` and the hash of the
submitted nonce-consuming contract transaction. Failure returns the standard
failed shape with network, empty or known transaction hash as specified by the
current schema, and a non-null reason.

## Contract ABI

The frozen candidate ABI is:

```text
settle(
  payer: Address,
  pay_to: Address,
  token: Address,
  max_amount: i128,
  valid_after: u32,
  deadline: u32,
  facilitator: Address,
  actual: i128
) -> SettlementResult
```

`valid_after` and `deadline` are Stellar ledger sequences, which give the token
allowance and contract one deterministic expiry clock. The client derives the
window from `maxTimeoutSeconds` and current network ledger state. The normative
spec defines the rounding and maximum-ledger-age algorithm and test vectors;
the TSC must accept this Stellar-native equivalent of the generic time window
before freeze.

The ordering is:

`allowance expiration_ledger = deadline >= settlement ledger`, and
`signatureExpirationLedger <= deadline`.

An authorization with `current_ledger < valid_after` or
`current_ledger > deadline` is invalid. The operator's maximum accepted
`maxTimeoutSeconds` bounds the derived window and nonce rent. Longer windows are
not an implementation convenience: they cost the sponsor more.

`SettlementResult` contains a fixed contract version and actual amount. The
contract emits one versioned settlement event with payer, payTo, token,
facilitator, max, and actual. Standard token events remain authoritative for
transfer validation.

## Atomic algorithm

The contract:

1. rejects a payer or payTo equal to the settlement contract, invalid time
   window, negative amount, or `actual > max_amount`;
2. calls `payer.require_auth_for_args` for
   `(pay_to, token, max_amount, valid_after, deadline, facilitator)`;
3. calls `facilitator.require_auth()`, binding all eight call arguments,
   including `actual`;
4. records relevant SEP-41 balances;
5. invokes `approve(payer, settlement_contract, max_amount, deadline)` inside
   the payer's authorization tree;
6. reads the allowance and requires it to equal `max_amount` exactly;
7. invokes `transfer_from` to pull `max_amount` from payer into the contract;
8. transfers `actual` to `pay_to` when actual is non-zero;
9. refunds `max_amount - actual` to payer when the remainder is non-zero;
10. requires allowance zero and validates the combined balance deltas, including
    address-alias cases;
11. emits the settlement event and returns the result.

All contract-as-spender/token calls use Soroban's current-contract
authorization. A pre-existing larger allowance cannot survive because the
post-approve equality check and pull-max sequence are mandatory. The contract
does not call zero-value token transfers, since compliant tokens may still
handle zero differently; zero actual nevertheless performs approve, pull, and
full refund to consume authorization.

Soroban transaction atomicity covers approve, pull, pay, refund, balance
assertions, and events. A failed token call, refund, assertion, or panic leaves
no partial balance, approval, contract event, or successful nonce consumption.
The transaction fee may still be charged.

The contract checks net balance changes rather than requiring an absolute zero
starting balance, so an unrelated token donation cannot permanently brick
settlement. Each successful invocation retains no funds from that invocation.

## Authorization tree

The expected payer tree has exactly the settlement invocation as root and the
normative nested token authorization calls. The top-level payer credential binds
the six immutable settlement arguments; the nested `approve` also binds its
expiration. `actual` is intentionally absent from payer authorization and is
selected by the facilitator under the signed maximum. The facilitator
credential binds the full call, including actual.

Verification rejects:

- missing, additional, reordered, or malformed invocations;
- wrong address, signer, signature, credential type, nonce, expiration, network,
  contract, function, token, recipient, facilitator, maximum, or time bounds;
- an auth entry copied into a transaction with different arguments;
- future `valid_after`, expired deadline/signature, and reused nonce;
- client-controlled source/operation source, resource data, or fee data.

For a classic G-account, the normal Stellar signature authorizes the entry. For
a C-account, enforcing simulation executes its `__check_auth`. OpenZeppelin
smart accounts support explicit context-rule IDs, delegated keys,
simple/weighted thresholds, and external signer verifiers such as passkeys.
The client must select a rule for every context; a default rule is not silently
substituted for a missing explicit selection.

The x402-specific spending policy matches the canonical settlement contract and
function, decodes the context arguments, and charges the signed `max_amount`
against the agent's budget. It may also restrict token, payTo, facilitator, and
deadline. Charging max rather than unsigned actual prevents a facilitator from
escaping the smart-account budget. Revocation removes the delegated signer or
context rule.

OpenZeppelin policy mocks do not exercise `__check_auth`; all policy acceptance
tests use real Soroban auth entries and enforcing simulation.

## Replay and concurrent settlement

Soroban's host credential nonce is the on-chain single-use primitive. Allowance
consumption is atomic hygiene but is not claimed to stop a newly signed
authorization. A new auth entry is a new authorization.

The facilitator derives an off-chain `authorization_id` from network, payer
credential address, nonce, expiration, and signed root tree, excluding actual.
It has a unique database constraint. The first settlement attempt fixes actual;
a concurrent request with the same authorization and a different actual is a
conflict. This prevents two replicas from racing before either reaches the host.

After success, replay of the auth entry with the same or changed actual must
fail host nonce validation. The changed-actual claim is a hash-backed Phase 0
test and contract-freeze gate. If that test contradicts the host guarantee, the
contract cannot freeze until a TSC-reviewed replacement single-use design
exists; the project will not paper over it with a facilitator-local claim.

A failed on-chain invocation rolls back all transaction effects, so the expected
host behavior is that its nonce is not persisted as consumed and the signed
entry remains usable until expiration. The facilitator nevertheless makes a
known terminal failed attempt idempotent and does not automatically resubmit it.
The real-auth matrix measures this expectation because retry policy must never
convert an unknown or failed envelope into an untracked new one.

Different facilitator addresses cannot settle one entry because the payer binds
the facilitator. Replicas of the bound facilitator share PostgreSQL state. Two
independent operators must not share a facilitator key; if they do, host nonce
protection selects at most one successful transaction, but both may incur a
failed fee.

## Contract lifecycle

### Deployment and initialization

Release engineering builds deterministic WASM in a pinned toolchain, publishes
source, compiler/container digest, WASM hash, tests, SBOM, and audit commit, and
deploys the exact bytes to testnet and pubnet. A release multisig may perform
deployment, but gains no contract capability. There is no constructor state or
initializer.

### Administration and upgrade

The contract is immutable and has no admin, upgrade, pause, or privileged
allowlist function. This removes a hosted governance dependency and compromised
admin-key risk. The consequence is that a defect cannot be paused or patched in
place; facilitators must stop advertising/accepting the affected version and
move to a newly audited contract.

### Storage and TTL

There are no payment, nonce, allowlist, or admin entries. Contract code and
instance TTL still require maintenance. A permissionless maintenance command
and facilitator health job restore/extend the canonical contract before the
readiness floor. Each operator can pay this rent, so liveness does not depend on
one maintainer. Operators may disable automatic maintenance only if readiness
still refuses an unsafe TTL.

Host nonce entries and token allowance storage follow Soroban/token rules and
are paid through the transaction resources. The short signature/window policy
limits rent.

### Tokens and emergency response

The contract accepts any contract satisfying the committed SEP-41 behavior.
Facilitators apply their configured token allowlist, decimals, and compatibility
status off-chain. Paused, authorization-required, clawback-enabled, and
error-returning assets are detected by verification/enforcing simulation and
the compatibility suite.

Emergency response is an off-chain fail-closed denylist and readiness action:
operators stop accepting a contract version or token. No single party can pause
all independent deployments.

### Version discovery and replacement

`version()` and the settlement event expose the contract version. A signed,
content-addressed release manifest and SDK constants map network and mechanism
version to canonical contract ID and WASM hash. This is packaged with the
client; it is not fetched from one hosted registry and is not added to
`/supported`.

Replacement deploys a new immutable ID. SDKs support an overlap manifest with
old and new IDs, new clients construct the new version, facilitators verify both
during a dated migration window, and old acceptance ends only after published
notice. Historical settlements retain contract ID/version. There is no state to
migrate.

This design does not foreclose batch settlement: a future scheme may point to a
separate escrow/voucher contract and store. It receives its own protocol review,
double-spend design, custody analysis, and audit.

## Audit scope

The independent review covers:

- settlement contract ABI, auth calls/tree, token calls, time/amount arithmetic,
  balance assertions, events, rollback, TTL, and reproducible deployment;
- facilitator parsing, auth-entry validation, record/enforcing simulation
  sequence, rebuild, event/balance checks, fee gates, idempotency, and keys;
- G- and C-account policies, including real-auth threshold/passkey cases;
- canonical Bazaar parsing and hostile discovery/origin trust boundary;
- the exact tagged dependencies and toolchain.

The original RFP audit estimate assumed no new contract and is invalid for this
design. Budget and schedule must explicitly add Soroban contract review,
remediation, and re-review after contract freeze.

## Required contract and mechanism tests

The release matrix covers:

- actual 0, below max, equal max, above max, negative, and `i128::MAX`;
- seven-decimal SAC USDC and ordinary SEP-41 tokens with differing decimals;
- insufficient payer balance, missing recipient trustline at verify, expired
  allowance/window, authorization-required, paused, clawback-enabled,
  error-returning, and unusual compliant token storage;
- G- and C-account payer/recipient, self-recipient aliasing, and forbidden
  settlement-contract recipient;
- failed approve, pull, pay, refund, assertion, and mid-execution panic;
- zero residual allowance, expected balance/event deltas, no partial changes,
  approval rollback, and no retained per-call balance;
- replay after success, after failure, and with different actual;
- 1-of-1 delegated agent, n-of-n, threshold, weighted threshold, passkey,
  multiple signer, default and explicit context rules, and revocation;
- missing/wrong/malformed auth entries and every signed argument mutation;
- record simulation tree equality and enforcing simulation execution;
- stale simulation, RPC uncertainty, fee surge, sequence collision, multiple
  channel accounts, and concurrent attempts.

Property tests cover all valid amount triples and time ordering. Fuzzing targets
XDR/auth trees and token return/event data. Mutation testing must demonstrate
that removal of every invariant causes a test failure.

## Primary implementation evidence

The flow relies on Stellar's documented signed-invocation sequence: record
simulation, sign auth entries, enforcing simulation, fee-payer rebuild, enforce,
sign, and submit
([Stellar signing guide](https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations)).
The host supplies replay protection for `require_auth` credentials
([authorization reference](https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization)),
and failed transaction effects are discarded atomically
([simulation reference](https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/transaction-simulation)).
The live Phase 0 tests remain mandatory because the RFP asks narrower replay and
fee questions than these general guarantees answer.
