# SEP-41 compatibility

The facilitator treats payment amounts as signed `i128` atomic units from the
x402 wire payload. It never assumes that every token has seven decimals and it
never converts an amount during verification or settlement. Each allowlisted
asset declares its contract, symbol, decimals, and operator maximum in config;
seven-decimal USDC and XLM SACs are defaults, not protocol special cases.

## Exact

`exact` delegates baseline Stellar verification and record simulation to
`@x402/stellar`. The local hardening pass then requires a three-argument SEP-41
`transfer(from, to, amount)` invocation, validates the signed authorization
tree, runs enforcing simulation, applies the fee ceilings, and requires exactly
one matching transfer event from the configured token contract.

Other contract events are permitted. Additional topics on a standard transfer
event are permitted. A malformed transfer event, a missing transfer, a second
transfer, or any difference in payer, recipient, token, or atomic amount is
rejected. This supports tokens and custom accounts that emit audit or policy
events without weakening the expected-balance invariant.

## Upto

The settlement contract uses the standard SEP-41 `approve`, `allowance`,
`transfer_from`, `transfer`, and `balance` surface. It asserts that approval
produces exactly `max_amount`, pulls the maximum, pays `actual`, refunds the
remainder, and checks the terminal allowance and balances. Every token failure
reverts approval and all balance changes atomically.

## Evidence

| Case | Evidence |
| --- | --- |
| SAC exact payment and fee sponsorship | Real testnet stock-client settlement `a20a88fd1ce7c72ba45664f95727c9ebf0ef44c9389e92bdb0b091a3fd18626d` |
| Bazaar-carrying exact payment | Real testnet settlement `931315bac2622d182efd97ef2704f02ec962b1acc67c6c3e99f8e998ba782056` |
| Non-seven-decimal atomic amounts | TypeScript exact event test and six-decimal ordinary SEP-41 Soroban token test |
| Extra token/account events and extra transfer topics | TypeScript exact event tests |
| Missing, duplicate, malformed, wrong-recipient, and wrong-amount events | TypeScript exact rejection tests |
| Ordinary contract token with persistent allowance storage | Soroban upto settlement test |
| Approval, pull, recipient transfer, and refund failures | Soroban atomic rollback tests |
| Authorization-restricted SAC payer or recipient | Soroban deauthorization and atomic rollback tests |
| Clawback-capable SAC | Soroban settlement followed by admin clawback test |
| Additive/non-conforming approval behavior | Soroban rejection with pre-existing allowance preserved |
| `i128::MAX` and insufficient balance | Soroban atomic failure tests |

Run the relevant suites with:

```sh
cd facilitator
npx vitest run tests/unit/exact-upstream.test.ts tests/unit/sep41.test.ts tests/unit/common.test.ts

cd ../x402-stellar-upto
cargo test --workspace
```

## Deliberate boundary

The facilitator supports SEP-41 interface-compatible tokens whose successful
payment produces the standard transfer event and the requested balance delta.
Fee-on-transfer, rebasing, or otherwise non-conserving token semantics are
rejected even if the contract exposes SEP-41 method names. Accepting them would
make the seller receive less than the signed x402 amount and would violate the
payment correctness invariant. A paused, frozen, deauthorized, expired, or
error-returning token fails during enforcing simulation at `/verify`; the
facilitator does not defer that predictable failure to `/settle`.
