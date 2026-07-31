# Scheme: `upto` on Stellar

## Status and versions

- Status: draft for SDF and x402 TSC review
- x402 version: `2`
- Networks: `stellar:testnet`, `stellar:pubnet`
- Assets: SEP-41 token contracts, including Stellar Asset Contracts (SACs)
- Settlement: one immutable Soroban contract invocation per authorization

This profile deliberately ships a Soroban settlement contract. A bare SEP-41
allowance lets a spender choose the destination and leaves unused allowance
claimable. It therefore cannot provide recipient binding, atomic
pull/pay/refund, or terminal single-use settlement by itself.

The normative requirements below are limited to behavior exercised by the
evidence in [Evidence](#evidence). Work not yet measured is listed in
[Open questions](#open-questions), not promoted to a requirement.

## Trust model

`upto` caps what the resource server can charge for one request. It does not
prove that the server's usage report is honest. The payer authorizes a maximum,
and the server chooses `actual` at settlement. A payer that does not trust the
server's metering should use a lower maximum, a smart-account spending policy,
or decline the resource.

The facilitator sponsors XLM fees but is not the payer and never takes custody.
The settlement contract temporarily holds the authorized maximum within one
atomic invocation, pays `actual`, and refunds the remainder.

## Payment requirements and payload

This profile adds no x402 wire fields. `PaymentRequirements` uses the standard
v2 fields:

```json
{
  "scheme": "upto",
  "network": "stellar:testnet",
  "amount": "10000000",
  "asset": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "payTo": "GASEB65O47AVT6RMSKH455M4WU3L7S2C7B6RCT5VXEXCLKPPHVW6TG7Y",
  "maxTimeoutSeconds": 60,
  "extra": {
    "areFeesSponsored": true
  }
}
```

At verification, `amount` is the authorized maximum. At settlement, it is the
actual amount selected by the resource server. Both are base-unit integer
strings; implementations obtain decimals from the SEP-41 token and do not
assume that every asset has seven decimals.

The `PaymentPayload.payload` shape is identical to Stellar `exact`:

```json
{
  "transaction": "AAAAAgAAA..."
}
```

`transaction` is the base64 transaction-envelope XDR containing one
`invokeHostFunction` operation and its signed Soroban authorization entries.
The client transaction source and fee bid are placeholders. The facilitator
rebuilds the transaction with a channel account as source.

### Contract address discovery

The settlement contract ID is a network/SDK configuration constant, not a
server-provided x402 wire field. An implementation **MUST** use the configured
contract ID for the selected network and **MUST NOT** trust or negotiate a
settlement contract ID from `PaymentPayload` or `extra`. `[T1, H1]`

The reference testnet ID is published below. A self-hosted fork may use its own
deployment by changing client SDK, seller, and facilitator configuration
together. That preserves wire compatibility and operator independence, at the
cost of requiring participating clients to install the fork's configuration.
A canonical pubnet ID remains release work until deployment and audit.

## Settlement contract

The deployed contract exposes one function:

```rust
pub fn settle(
    payer: Address,
    pay_to: Address,
    token: Address,
    max_amount: i128,
    valid_after: u32,
    deadline: u32,
    facilitator: Address,
    settlement_id: BytesN<32>,
    settlement_hook: Option<Address>,
    actual: i128,
) -> Settlement
```

`valid_after`, `deadline`, and authorization expiry are ledger sequence
numbers, not Unix timestamps.

The contract has no constructor, persistent storage, admin, pause switch, or
upgrade function. A replacement is a new contract address and versioned
facilitator configuration. This keeps self-hosting independent of an upstream
operator and makes the audited bytecode immutable.

### Authorization tree and field binding

The payer authorization root is this contract's `settle` invocation. The payer
uses `require_auth_for_args` over:

```text
(pay_to, token, max_amount, valid_after, deadline, facilitator,
 settlement_id, settlement_hook)
```

The payer credential identifies `payer`. The authorization root identifies the
settlement contract. Soroban's signature preimage identifies the network. The
facilitator uses `require_auth()` and therefore authorizes all ten invocation
arguments, including `actual`.

An implementation **MUST** bind payer, recipient, token asset, maximum,
validity window, facilitator, settlement ID, optional settlement hook,
settlement contract, and Stellar network exactly as above; it **MUST NOT**
accept an authorization after any one of those values is substituted.
`[T1, T11, L4, H1, B1, B2]`

`actual` is intentionally absent from the payer's signed argument list, so the
resource server can meter after verification. It remains bounded by
`max_amount` in the contract and is signed by the facilitator.

The payer's authorization **MUST** contain exactly one nested invocation:
`token.approve(payer, settlement_contract, max_amount, deadline)`. Extra,
missing, or altered sub-invocations **MUST** be rejected. `[T1]`

### Settlement identifier

`settlement_id` is a signed, fixed-width contract argument; it is not a new
x402 JSON field. When the standard `payment-identifier` extension is present,
clients derive it as:

```text
SHA-256("x402:payment-identifier:v1\0" || UTF-8(extension.info.id))
```

The extension remains the facilitator's idempotency key. The facilitator binds
it to the normalized request fingerprint specified by that extension, returns
the cached result for an identical retry, and returns HTTP 409 for the same ID
with a different fingerprint. The on-chain `settlement_id` lets an optional
hook use the same logical payment as its reservation key without changing the
x402 wire format. `[F1]`

For `upto`, the fingerprint's stable amount is the signed `max_amount`, not the
phase-dependent settlement-time `requirements.amount`. The chosen `actual` is
stored in the settlement result associated with the ID. Otherwise the normal
verify-to-settle transition would incorrectly look like conflicting ID reuse.
`[F1]`

When the extension is absent, the client generates a fresh random 32-byte
value. Uniqueness then rests on client discipline, just as uniqueness of the
extension ID does. A spending hook can use `(payer, settlement_id)` as its key
and reject a collision; the duplicate-key test demonstrates that backstop.
`[T11]`

### Validity clocks

The three Stellar expiry clocks use this ordering:

```text
current_ledger <= signatureExpirationLedger <= deadline
deadline == approve.expiration_ledger
valid_after <= current_ledger <= deadline
```

The client **MUST** set `signatureExpirationLedger` no later than `deadline`,
and the SEP-41 approval expiration **MUST** equal `deadline`.
`[T1, T5, H1, B3]`

The contract treats both `valid_after` and `deadline` as inclusive and **MUST**
reject a reversed window, a ledger before `valid_after`, or a ledger after
`deadline`. `[T4, T5]`

Using one ledger deadline for the contract and allowance makes it impossible
for allowance lifetime to outlive the signed settlement window. Keeping the
auth-entry expiry no later than that deadline also bounds host-nonce rent.

### Atomic settlement algorithm

For every accepted invocation, the contract **MUST** perform these steps in
one Soroban transaction: `[T1, T2, T3, T9, T11, T12, T13]`

1. Validate `max_amount > 0` and `0 <= actual <= max_amount`.
2. Validate the inclusive ledger window and forbidden addresses, including
   rejecting `settlement_hook` when it equals the settlement contract or token.
3. Authenticate the payer's eight bound arguments and the facilitator's
   complete ten-argument invocation.
4. Call `approve(payer, contract, max_amount, deadline)`.
5. Assert `allowance(payer, contract) == max_amount`.
6. Pull all of `max_amount` with `transfer_from`.
7. Pay `actual` to `pay_to`.
8. Refund `max_amount - actual` to `payer`.
9. Assert the allowance is zero, the contract balance is unchanged, and payer
   and recipient balance deltas are exactly `actual`.
10. If `settlement_hook` is present, call its versioned `on_settled_v1`
    interface, including when `actual == 0`.
11. After the hook returns, reassert allowance zero and all balance invariants
    from step 9.
12. Emit the settlement event.

The equality assertion in step 5 **MUST** be retained. It rejects tokens whose
approval behavior leaves a different allowance and prevents a larger
pre-existing allowance from surviving settlement. `[T6, T10]`

Every token failure or contract panic **MUST** roll back approval, allowance,
pull, payment, refund, balance changes, and events atomically. `[T7, T9, L7]`

The contract **MUST** accept `actual == 0`, `actual == max_amount`, and every
integer between them, and **MUST** reject negative values, values above the
maximum, zero or negative maxima, and arithmetic overflow without partial
state. `[T2, T3, T4, T7, L1, L2, L3]`

### Optional settlement hook

The hook is a generic protocol integration point: an optional contract notified
of the amount that settled. It is not an OpenZeppelin-specific budget-policy
field. The v1 interface is:

```rust
pub struct SettlementNoticeV1 {
    pub actual: i128,
    pub max_amount: i128,
    pub pay_to: Address,
    pub payer: Address,
    pub settlement_id: BytesN<32>,
    pub token: Address,
}

pub fn on_settled_v1(notice: SettlementNoticeV1, caller: Address)
```

The hook authenticates `caller` as the trusted settlement contract. The direct
contract invocation satisfies `caller.require_auth()` under Soroban's invoker
authorization rules. A hook that reserves `max_amount` during smart-account
authorization can release `max_amount - actual` after settlement, keyed by
`(payer, settlement_id)`. `[T11, T15]`

`SettlementNoticeV1` makes the v1 ABI readable; it is not an extensibility
mechanism. Adding a field changes the contract ABI. A future interface uses a
new entrypoint such as `on_settled_v2` and a new settlement-contract version.

The hook runs after pull, payment, refund, and the first invariant check. It
**MUST** run for zero settlement as well as non-zero settlement, and a hook
failure **MUST** revert the complete settlement atomically. `[T11, T12]`

After a successful callback, the settlement contract **MUST** recheck the zero
allowance and exact payer, recipient, and settlement-contract balance
invariants before emitting success. This prevents a hook from changing the
payment outcome inside the callback window. `[T13]`

At hook entry, the settlement contract has already refunded the remainder,
holds no payment balance, and has zero allowance. Reentry with the original
payer authorization is also outside that authorization's recorded invocation
tree and fails; the host nonce makes the authorization terminal after the
outer transaction succeeds. `[T13, L4]`

The contract **MUST** reject a hook equal to its own address or the token
address. The first check removes the obvious self-referential reentry shape;
the second prevents the token from being invoked as an unrelated hook while
token invariants are being enforced. `[T14, H1]`

A payer that signs a nonexistent hook, an incompatible hook, or a hook that
intentionally fails has chosen an authorization that cannot settle. That
availability failure is the payer's risk; it is not facilitator custody or an
operator-selected third-party dependency. `[T12]`

The hook is optional and `None` is the default path. The ABI and call site ship
with this contract. The measured OpenZeppelin-compatible reference policy is
an optional integration and remains outside canonical-client acceptance and
the settlement critical path.

### Zero settlement

Zero settlement is not an off-chain shortcut. The facilitator **MUST** submit a
real contract transaction that approves, pulls, refunds the full maximum,
consumes the Soroban authorization nonce, emits an event with `actual == 0`,
and produces a transaction hash. `[T2, L1]`

This costs a network fee, but it preserves the generic `upto` guarantee that
every successful settlement is terminal. It also avoids inventing contract
storage solely for zero values and gives stock clients the same response shape
for all amounts.

### Failure, retry, replay, and concurrency

A transaction that reaches the ledger with status `FAILED` is atomic and does
not consume its Soroban authorization nonce. The identical authorization
**MAY** be retried after the failure cause is removed. `[T9, L7]`

A successful settlement **MUST** consume the payer and facilitator
authorization nonces. Replaying the same entries, including replay with a
different `actual`, **MUST** fail. `[L4]`

If two facilitator channel accounts concurrently submit the same payer
authorization, at most one transaction **MUST** succeed; the other resolves
`FAILED` after the winning transaction consumes the nonce. `[L5]`

Before submission, the facilitator persists the signed envelope, transaction
hash, payment identifier/fingerprint, and channel lease atomically. After a
lost or unknown RPC response it **MUST** poll that known hash to a definitive
status and **MUST NOT** rebuild or submit a different transaction for the same
settlement while the status is unknown. Identical identifier retries return
the cached result; conflicting reuse returns HTTP 409. `[F1]`

## Verification

Verification parses but does not trust the client transaction source, fee,
Soroban footprint, or resource fee.

A facilitator **MUST** reject a payload unless it contains one
`invokeHostFunction` operation calling the configured settlement contract's
`settle` function with the exact ten-argument shape above. `[T1, H1]`

It **MUST** parse all amounts as signed `i128`, compare the signed
`max_amount` with the verification-time requirement, and compare `actual` with
the settlement-time requirement. It **MUST** reject `actual < 0`,
`actual > max_amount`, and any mismatch in network, token, recipient, payer,
facilitator, validity window, settlement ID, settlement hook, contract, or
authorization tree. `[T1, T4, T11, L4, H1]`

It **MUST** reject the facilitator as payer and **MUST** ignore client-controlled
transaction fee and source values when rebuilding. `[T6, H1]`

Recording-mode simulation is used to obtain the expected authorization tree.
After the client signs, the facilitator **MUST** run enforcing-mode simulation
before submission. Record-mode simulation alone is insufficient because it
does not execute a custom account's `__check_auth`; enforcing mode does and can
reject an over-budget or CPU-exhausting account. `[L6]`

The facilitator sponsors the whole transaction, including settlement-hook
execution. A payer can therefore sign a CPU-burning hook and attempt to spend
the facilitator's XLM, the same attack class as an expensive `__check_auth`
from a different call path. The settlement hook is inside the fee gate:
enforcing simulation executes it, its cost appears in `minResourceFee`, and the
facilitator **MUST** reject before submission when that result exceeds the
operator's resource-fee or total-fee ceiling. `[L8]`

Settle **MUST** repeat all verification against current ledger state, rebuild
with a facilitator-controlled channel account, refresh Soroban transaction
data from enforcing simulation, and submit the rebuilt transaction. `[H1]`

## Settlement response

All successful settlements, including `actual == 0`, have a ledger transaction.
The response therefore uses the ordinary v2 shape:

```json
{
  "success": true,
  "transaction": "e6b3b9012ebe5e7808c2c7fa74e47c7386fb3a9e11a76f4fba8358b4397c76ba",
  "network": "stellar:testnet",
  "payer": "GDARFSRGVVCWSZRS4KYJBHAYUJGG5KXHKJKY5KY7AQUI5UKLPIW2WUOK"
}
```

On success, `transaction` **MUST** be the 64-character hash of the confirmed
Stellar transaction, `network` **MUST** equal the accepted CAIP-2 network, and
`payer` **MUST** be the token payer rather than the fee-sponsoring channel
account. `[L1, F1]`

There is no successful response without a transaction hash in this profile.
Every rejection **MUST** use a non-null x402 rejection reason; the exact
wire-level reason mapping remains an implementation conformance item in
[Open questions](#open-questions). `[F1]`

## Smart-account spending policies

A Stellar C-account receives the full authorization `Context`, including this
contract's arguments and nested token approval. An agent policy can therefore:

- allow only the configured settlement contract and `settle` function;
- allow only approved token contracts and recipients;
- inspect and reserve `max_amount`, not facilitator-selected `actual`;
- enforce a per-request, rolling-period, or lifetime budget;
- restrict `valid_after`, `deadline`, and the facilitator;
- combine those rules with threshold, weighted-threshold, or delegated agent
  signer policies.

Conservative accounting reserves the signed `max_amount` during the policy's
`enforce()` call because the payer does not authorize `actual` and the seller
may choose any amount up to the cap. A hook-aware policy can then release
`max_amount - actual` from the reservation when the authenticated
`on_settled_v1` callback arrives. The reservation is keyed by
`(payer, settlement_id)`, and duplicate keys are rejected. `[T11, P1, P2, L9]`

A compatible policy matches the settlement root and nested `approve`
invocation, not a direct SEP-41 `transfer`. The current OpenZeppelin
spending-limit policy hard-codes a `transfer` function and amount argument
position, so an x402-aware policy is required.

The measured OZ authorization exposes two contexts: the eight-argument
settlement root and the nested token approval. `AuthPayload.context_rule_ids`
requires one explicit rule ID per context. The reference account therefore
uses two rules with the same agent signer and policy:

```text
rule 0: CallContract(settlement_contract) + reconciling policy
rule 1: CallContract(token_contract)      + reconciling policy
```

Rule 1 is not a general token permission. The policy accepts only `approve`
from the smart account to the configured settlement contract and requires its
amount and expiration to match the pending reservation created by rule 0. A
standalone approval, altered amount, altered spender, or altered expiration is
rejected. This correlation prevents the token rule from becoming a route
around the budget. `[P1, P5, P6, R1]`

Record-mode simulation runs the hook but does not execute `__check_auth`.
Consequently, the reference hook treats a missing reservation as a no-op: no
policy state exists to release. Enforcing simulation and execution run rule 0,
rule 1, and then the hook in order, so an existing reservation still requires
the configured settlement caller and an exact notice. Duplicate settled IDs
remain rejected. `[P2, P3, L9, L10, R2]`

The live evidence uses a real OZ `AuthPayload` and Ed25519 verifier. The agent
signs `SHA-256(host_signature_payload || context_rule_ids.to_xdr())`; mocks are
not used for the authorization checks. The reference policy implements a
fixed-ledger-window budget. Rolling and lifetime policies can consume the same
versioned hook without changing x402 or the settlement ABI.

## Contract lifecycle

The reference contract is immutable and has no application-defined persistent
state:

- no administrator or upgrade authority;
- no contract storage entries created by the settlement path;
- no token allowlist in contract state;
- no emergency pause;
- deployment is permissionless;
- supported contract IDs and bytecode hashes are operator configuration.

The deployed contract instance and Wasm code are nevertheless persistent
Stellar ledger entries with TTL and rent. An operator **MUST** monitor and
extend both entries before archival. If either entry is archived, settlement
is unavailable until the deployment entries are restored. TTL maintenance is
an external operational transaction and does not introduce an administrator,
upgrade key, or application state. The party submitting maintenance pays its
fees. `[L11]`

The facilitator **MUST** use an explicitly configured contract ID and bytecode
version for each network and **MUST NOT** discover or accept a contract ID from
the client payload. `[T1, H1]`

Changing the contract creates a new scheme implementation version. Operators
can run old and new versions in parallel during migration; authorizations are
not portable because the contract address is signed.

## Reference deployment

Testnet reference:

| Item | Value |
| --- | --- |
| Contract | `CDEI3W6ZFW6BFSU37VL265OSOGKSM3BR3TZVUR5NZ4UER6FOMVJUKOOT` |
| WASM SHA-256 | `2416d2b4d524908031b4b43cc0947898c506f8b769ff889bb78bae03cebe6419` |
| Deployment transaction | `6e3bf23dd7cfcab66db684c4fce4089b5b05e6f845b67c8d7040114fc1496da8` |
| Deployment ledger | `3895887` |
| Measurement hook | `CBBQTCJ4VOFJSNJ2AVDWNMBQVDPGOKQTJZHMRCWVMPX4KDPL4RETBNQI` |
| Measurement hook WASM | `32b7c92c31d1bb57a43c6c75ea29da260fa5fd0d3ecd6886d68a5feeb8cab855` |
| Measurement hook deployment | `7180dfaa77c565eedf5ae5fa70422f745986727b11bda06033498b09aabd776f` |
| OZ Ed25519 verifier | `CDQUKL5ONG6YORXLN3N7MX4LCO3PDHWTTNM6W6G5L4XDSRJZB5OS6R2X` |
| OZ verifier WASM | `63ead439a59eb2b65d9d3736bb142ecd741a3690cd40568251b14b023777701d` |
| Reconciling policy | `CCEMDZHPJFLT2UX63PKI6YZHLCCR243PRVOE56BOVCE6S4654QFITYBY` |
| Policy WASM | `cb054a0728b45f7db2ff93e13bd5f0336f2c6b998e30d25fc55e1753f4a5a1fe` |
| OZ test account | `CBFHWZ4IIMYYGOYRTVRFFBSUOUP76HDS7CQYHUTSXY2IKFNTWFSTWZWO` |
| Account WASM | `22541f40eec2011452bd6e5cd6683c084b6a504cc137507699f930c8a4ff413a` |

No pubnet contract is claimed by this draft.

## Evidence

### Contract tests

Tests are in
[`contracts/upto-settlement/src/test.rs`](../contracts/upto-settlement/src/test.rs).

| ID | Test |
| --- | --- |
| T1 | `settles_below_maximum_and_consumes_allowance` asserts the exact two-root auth tree, payer's eight bound args, nested approval, deltas, event, and zero allowance. |
| T2 | `zero_settlement_is_onchain_terminal_work` |
| T3 | `settles_full_maximum`, `every_actual_from_zero_through_maximum_preserves_invariants`, and `payer_may_equal_recipient_without_breaking_balance_checks` |
| T4 | `rejects_all_invalid_amounts_and_windows` |
| T5 | `validity_bounds_are_inclusive` |
| T6 | `rejects_facilitator_as_payer_atomically` and `preexisting_larger_allowance_is_overwritten_and_consumed` |
| T7 | `insufficient_balance_rolls_back_approval_and_transfers` and `i128_max_fails_without_partial_state` |
| T8 | `ordinary_six_decimal_sep41_token_settles` |
| T9 | injected approval, pull, recipient transfer, and refund failure tests |
| T10 | `additive_approval_token_is_rejected_without_mutating_prior_allowance` |
| T11 | `hook_runs_for_zero_and_partial_settlements` and `duplicate_payer_and_settlement_id_is_rejected_atomically` |
| T12 | `hook_failure_reverts_the_entire_settlement` and `missing_hook_interface_is_the_payers_atomic_failure` |
| T13 | `post_hook_invariants_reject_recipient_balance_mutation` and `hook_reentry_with_the_original_payer_is_not_in_the_auth_tree` |
| T14 | `settlement_contract_and_token_are_invalid_hooks` |
| T15 | `direct_hook_notice_without_settlement_caller_auth_is_rejected` |

OZ policy tests use real `try_invoke_contract_check_auth` calls and signed
rule-bound digests in
[`contracts/oz-agent-account/src/test.rs`](../contracts/oz-agent-account/src/test.rs).

| ID | Test |
| --- | --- |
| P1 | `real_check_auth_runs_context_rule_and_reserves_maximum` |
| P2 | `settlement_notice_releases_unused_budget_and_keeps_actual` and `zero_settlement_releases_the_full_reservation` |
| P3 | `duplicate_id_is_rejected_after_reconciliation` and `missing_reservation_is_a_record_simulation_no_op` |
| P4 | `real_check_auth_rejects_an_over_budget_maximum`, `wrong_agent_signature_is_rejected`, and `context_rule_rejects_a_different_settlement_contract` |
| P5 | `token_rule_cannot_authorize_a_standalone_approval` |
| P6 | `token_approval_must_match_the_settlement_reservation` |

### Testnet transactions

The reproducible harness is [`harness/live-test.js`](../harness/live-test.js).

| ID | Observation | Transaction hash |
| --- | --- | --- |
| L1 | Zero settlement succeeded on-chain | `e6b3b9012ebe5e7808c2c7fa74e47c7386fb3a9e11a76f4fba8358b4397c76ba` |
| L2 | Partial settlement succeeded | `f80ade7fb080337392d11fd60535d0c37f296447c1aa4cf3ca3f9310224d7920` |
| L3 | Maximum settlement succeeded | `662d3863e78632a335d73e758050150e4522a1aeb43efee8e657ef899bdeb60e` |
| L4 | Changed `actual` before first use succeeded; changed-actual and identical replay then failed | `b5292911043c47fcbaca195dc2a4bb283cb8c720e5bb8dcd8c31c81f3a2c423d` |
| L5 | Concurrent submission of one auth entry through two channel accounts produced exactly one success | success `4d3d6805e0fb0c827d4f9dfca339978d43b6aae3dda2c4ccda06ef61f05e445c`; failed `0bd51e4eb8f81be9003aeb04fc2cc448bdac7f7780fddb9e31b83eff3df082ab` |
| L6 | Custom C-account enforced argument cap and CPU budget, then valid policy settlement succeeded | `1edaefd90de512ee00a198fbc762981c3a0082a5c68a869ba42ccc8eedd0e685` |
| L7 | Forced on-chain failure did not consume auth; identical entries succeeded after restoring balance | failed `701b9350e13c2d2f8e7c16d6f2eb1517ea74326cc5774485624bfceb0bf7e5ad`; retry `330249fd9a281a5f27a005a1642e108f91cce6a5a40387e25ac09baea6c62dac` |
| L8 | Enforcing fee gate measured no hook, no-op, stateful, and CPU-burning hooks; the burner was rejected before submission | no hook `60a967e1c8b5f1460b2ace5bf7fc5f9f28f4859ff46fd11abcffc50bbb87ad3e`; no-op `5840bcdd1a54f9d50d28d4f4eaf69f740d590c05f9786efea853db6e9d784cfb`; stateful `2303f16d33a15b730c495a4bffb74b6ac8223c72aeb9a223e8b54245304d3b63` |
| L9 | Real OZ policy reserved 10,000,000 and reconciled to 3,000,000 actual | `9569422fd4fed8bdff13432e729ef1287f0ecec8ea1e9bffcaa7bb46a098da65` |
| L10 | Real OZ policy handled zero, released the full new reservation, and kept prior committed spend unchanged | `6d239761641c2f58f70b25e108ae768a61e8ec1a573cae296c1d6947dbec2ee4` |
| L11 | Contract-instance and Wasm-code TTLs were independently extended and confirmed through RPC | instance `976f86fa60a5d6b9ec2122380435171f9e89a1e3c9ebc47981d24e88af9b1f2d`; code `54beeee989334342f9d75e6987ef3d4d70042d9108c5864b5140e258fc2092e2` |

Hook fee profile from the same run:

| Profile | Enforcing `minResourceFee` | Submitted fee charged | Result |
| --- | ---: | ---: | --- |
| No hook | 60,422 | 48,813 | SUCCESS |
| Authenticated no-op hook | 61,987 | 50,352 | SUCCESS |
| Stateful hook | 64,714 | 53,079 | SUCCESS |
| 1,000-iteration SHA-256 hook | 67,507 | not submitted | rejected by the 64,747 test ceiling |
| OZ policy, partial (warm state) | 1,055,399 | 916,115 | SUCCESS |
| OZ policy, zero (warm state) | 1,051,618 | 912,472 | SUCCESS |

`H1` is the live harness assertion suite. It checks recording then enforcing
simulation, recipient substitution, invalid amounts, replay, concurrency,
custom-account policy behavior, hook behavior and fee gating, fee observations,
and failure retry.

`F1` is the facilitator integration evidence recorded in
[`evidence/FACILITATOR.md`](../evidence/FACILITATOR.md).

### Offline binding tests

The focused tests in [`harness/binding.test.js`](../harness/binding.test.js)
construct the complete settlement plus nested-approval authorization tree and
use the Stellar SDK's canonical authorization preimage builder.

| ID | Test |
| --- | --- |
| B1 | A testnet signature does not verify against the pubnet preimage. |
| B2 | Substituting the settlement contract changes the preimage and invalidates the signature. |
| B3 | Changing `signatureExpirationLedger` changes the preimage and invalidates the signature. |

### External review

| ID | Confirmation |
| --- | --- |
| R1 | OpenZeppelin confirmed that the settlement root and nested approval use two context rules and both rule IDs. |
| R2 | OpenZeppelin confirmed that record simulation does not invoke `__check_auth`, so policy `enforce()` does not run. |

The review record is
[`docs/REVIEWER_FEEDBACK.md`](../docs/REVIEWER_FEEDBACK.md).

## Open questions

The following items are intentionally non-normative until measured:

1. Deploy the frozen WASM to pubnet and publish zero, partial, and maximum
   settlement hashes.
2. Run an unmodified canonical x402 client through `/verify` and `/settle` on
   both networks and freeze the non-null rejection-reason mapping.
3. Test signature-expiration boundaries independently from the contract
   deadline, including network fee/rent at the configured maximum timeout.
4. Test delegated-address, passkey, threshold, and weighted-threshold signer
   compositions. The current live evidence uses one external Ed25519 signer.
5. Extend live coverage beyond the native SAC to issued USDC SAC, ordinary
   SEP-41 tokens, authorization-required assets, paused/clawback assets, and
   unusual but compliant token implementations.
6. Measure p99 inclusion-fee and resource-fee ceilings per network,
   smart-account class, and supported production hook. The test ceiling above
   proves enforcement behavior; it is not a production default.
7. Freeze the ABI after SDF/x402 review and complete an external security audit
   before any production deployment.

## References

- [Generic `upto` scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/upto/scheme_upto.md)
- [Stellar `exact` scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_stellar.md)
- [Payment identifier extension](https://github.com/x402-foundation/x402/blob/main/specs/extensions/payment_identifier.md)
- [SEP-41 token interface](https://stellar.org/protocol/sep-41)
- [Soroban authorization](https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization)
- [Signing Soroban invocations](https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations)
- [Extending contract Wasm TTL](https://developers.stellar.org/docs/build/guides/conventions/extending-wasm-ttl)
- [Soroban state archival](https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/state-archival)
- [OpenZeppelin Stellar smart accounts](https://github.com/OpenZeppelin/stellar-contracts/tree/main/packages/accounts)
