# SDF technical review brief

## Review objective

Validate the Stellar-specific mechanism before the specification is proposed
to the x402 TSC and before the contract ABI is frozen for external audit. x402
wire-format approval remains the x402 TSC's responsibility.

## Requested decisions

1. **Authorization tree.** Confirm the payer root plus nested SEP-41 `approve`
   tree and the eight-argument `require_auth_for_args` binding.
2. **Ledger clocks.** Confirm the required ordering between contract deadline,
   approval expiration, and `signatureExpirationLedger`.
3. **Zero settlement.** Confirm that an on-chain approve/pull/full-refund
   transaction is the appropriate way to make zero terminal without contract
   storage.
4. **Contract lifecycle.** Review the choice of an immutable,
   permissionlessly deployable contract with no application-defined state,
   network-specific configured IDs, and an operator runbook that maintains
   the contract-instance and Wasm-code TTLs.
5. **Token compatibility.** Review the SEP-41 assumptions, particularly SACs,
   authorization-required assets, pause/clawback behavior, and unusual but
   compliant token implementations.
6. **Hook boundary.** Review the optional `on_settled_v1` ABI, authenticated
   caller, post-callback invariant checks, and payer-owned availability risk.
7. **Audit boundary.** Confirm that the settlement contract, authorization
   parsing, hook boundary, and custom-account execution all belong in scope.

## Resolved OpenZeppelin questions

Boyan from OpenZeppelin confirmed two points after reviewing the measured
authorization shape:

- the account needs two context rules and supplies
  `context_rule_ids = [settlement_rule, token_rule]`; and
- recording simulation does not invoke `__check_auth`, so the policy's
  `enforce()` does not execute in record mode.

The reference integration implements both conclusions. The token rule is
correlated to the settlement reservation and cannot authorize a standalone or
altered approval. The settlement hook treats a missing reservation as a no-op
only for record simulation; enforcing simulation and execution require the
reservation and exact authenticated notice.

See [reviewer feedback](REVIEWER_FEEDBACK.md) and tests P1-P6 in the
[evidence matrix](../evidence/CLAIMS.md).

## Decisions already made

- Ship a Soroban contract; do not baseline a weaker allowance-only design.
- Submit zero settlement on-chain and return a normal transaction hash.
- Bind payer, recipient, token, maximum, network, contract, ledger window,
  facilitator, settlement ID, and optional hook.
- Keep the hook generic, optional, versioned, and off the default critical path.
- Recheck allowance and balance invariants after the hook.
- Reject the settlement contract and token contract as hook addresses.
- Put hook and custom-account cost inside enforcing-simulation fee gates.
- Keep the optional reference policy outside canonical x402 acceptance.

## Evidence available now

- 36 previously recorded passing Rust tests: 25 settlement and 11 real-auth
  account/policy tests.
- Zero, partial, maximum, changed-actual replay, concurrent use, failure/retry,
  custom-account, hook, and real OZ-policy testnet transactions.
- Frozen testnet contract ID and WASM hash.
- Measured no-hook, hook, adversarial hook, and policy fee profiles.
- Offline tests proving signature-preimage binding to network, settlement
  contract, and signature expiration ledger.

## Not requested as approval

This review does not certify pubnet readiness, provide an audit, approve the
x402 wire specification, or establish production fee ceilings. Those items are
listed in [remaining release work](RELEASE_GAPS.md).
