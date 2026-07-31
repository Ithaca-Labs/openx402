# Threat model

## Security objective

For one payer authorization, transfer no more than `max_amount`, only to the
bound recipient in the bound token, and make every successful settlement
terminal while leaving no contract balance or allowance.

The design does not prove that seller-reported usage is honest. `upto` limits
the seller's charge; it does not attest to metering.

## Trust boundaries

| Actor | Trusted for | Not trusted for |
| --- | --- | --- |
| Payer | Chosen maximum, recipient, token, window and optional hook | Paying facilitator fees |
| Seller | Choosing `actual <= max_amount` | Honest usage reporting |
| Facilitator | Selecting `actual`, rebuilding and submitting | Changing payer-bound fields |
| Token | SEP-41 behavior | Ordinary implementation details beyond validated invariants |
| Settlement hook | Optional payer-selected reconciliation | Availability or bounded execution cost |
| RPC provider | Transport and observations | Finality without transaction-hash reconciliation |

## Contract invariants

- `max_amount > 0` and `0 <= actual <= max_amount`.
- Payer authorization binds every field except `actual`; facilitator
  authorization binds the complete invocation.
- Approval equals exactly `max_amount` before pull and zero after pull.
- Contract token balance is unchanged at return.
- Payer and recipient deltas equal `actual`, including payer equal to recipient.
- Hook execution occurs after pull/pay/refund and before the final event.
- Allowance and balance invariants are rechecked after a hook returns.
- Every failure reverts token changes, hook changes, and settlement event.
- A successful zero settlement is an on-chain terminal transaction.

## Principal attacks and controls

| Attack | Control |
| --- | --- |
| Recipient, token, maximum, contract, network or window substitution | Signed root, credential, nested invocation, and network preimage binding |
| Seller charges above maximum | Contract range check before token calls |
| Reuse after success | Soroban host nonce consumption |
| Concurrent facilitators | Same nonce permits at most one successful transaction |
| Failed attempt becomes terminal | Failed transaction rolls back nonce; definitive failure may retry |
| Larger or additive allowance survives | Exact allowance equality check followed by full pull |
| Partial token state on failure | Soroban atomic rollback and injected failure tests |
| Malicious hook mutates balances | Post-hook balance and allowance revalidation |
| Hook reenters settlement | Self-hook rejection plus authorization-tree and nonce boundary |
| CPU-burning account or hook drains sponsor | Enforcing simulation, fee ceilings, budgets and concurrency limits |
| Hook does not implement ABI | Payer-owned atomic availability failure |
| Token rule bypasses spending policy | Correlation to settlement reservation and exact approval arguments |
| Lost RPC response causes double submission | Persist envelope/hash before send and poll known hash |
| Contract instance or Wasm reaches archival TTL | Monitor both ledger entries, extend before archival, and alert well before the maintenance threshold |

## Residual risks

- Seller metering dishonesty remains inherent to `upto`.
- Token implementations outside tested SEP-41 behavior require compatibility
  qualification.
- Payer-selected hooks can make payments unavailable and increase simulated
  cost, though the facilitator rejects over-ceiling execution before submission.
- Contract logic creates no application storage, but the deployed instance and
  Wasm code still require rent-backed TTL maintenance. Archival causes an
  availability failure until restoration; it does not strand contract-held
  payment funds because the settlement contract retains none.
- Production deployment remains unaudited and is not endorsed for pubnet.
