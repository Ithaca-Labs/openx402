# Evidence matrix

This index connects specification claims to included tests or published
testnet transactions. Previously executed results are preserved in
[the testnet report](testnet-report.md).

## Settlement contract tests

| ID | Included test evidence |
| --- | --- |
| T1 | `settles_below_maximum_and_consumes_allowance`: exact auth tree, eight payer-bound arguments, nested approval, event, deltas, zero allowance |
| T2 | `zero_settlement_is_onchain_terminal_work` |
| T3 | Full maximum, every integer actual from 0 through 100, and payer equal to recipient |
| T4 | Negative, above-maximum, zero maximum, reversed window and invalid-ledger rejection |
| T5 | Inclusive `valid_after` and `deadline` boundaries |
| T6 | Facilitator-as-payer rejection and pre-existing larger allowance consumption |
| T7 | Insufficient balance and `i128::MAX` atomic failure |
| T8 | Ordinary six-decimal SEP-41 token settlement |
| T9 | Injected approval, pull, recipient transfer and refund failures roll back |
| T10 | Additive-approval token rejection without mutating prior allowance |
| T11 | Zero/partial hook calls and duplicate `(payer, settlement_id)` rejection |
| T12 | Hook failure and missing hook interface are atomic payer-owned failures |
| T13 | Post-hook mutation and reentry rejection |
| T14 | Settlement contract and token cannot be hooks |
| T15 | Direct hook notice without settlement caller authorization fails |

## Real-auth OpenZeppelin tests

| ID | Included test evidence |
| --- | --- |
| P1 | Real `__check_auth` runs two context rules and reserves maximum |
| P2 | Partial and zero notices reconcile reserved maximum to actual |
| P3 | Duplicate ID rejection and record-mode missing-reservation no-op |
| P4 | Over-budget, wrong signer and wrong settlement contract rejection |
| P5 | Token rule cannot authorize standalone approval |
| P6 | Approval spender, amount and expiration must match reservation |

The tests call real `try_invoke_contract_check_auth` with a rule-bound Ed25519
digest. Soroban auth mocks are not used for these policy assertions.

## Offline authorization binding

| ID | Included test evidence |
| --- | --- |
| B1 | `authorization signature is bound to the Stellar network` |
| B2 | `authorization signature is bound to the settlement contract` |
| B3 | `authorization signature is bound to signatureExpirationLedger` |

Run with `cd harness && npm ci && npm test`.

## Live testnet evidence

| ID | Observation | Hash/result |
| --- | --- | --- |
| L1 | Zero settlement | `e6b3b9012ebe5e7808c2c7fa74e47c7386fb3a9e11a76f4fba8358b4397c76ba` |
| L2 | Partial settlement | `f80ade7fb080337392d11fd60535d0c37f296447c1aa4cf3ca3f9310224d7920` |
| L3 | Maximum settlement | `662d3863e78632a335d73e758050150e4522a1aeb43efee8e657ef899bdeb60e` |
| L4 | Changed actual accepted before first use; subsequent identical and changed-actual replay rejected | `b5292911043c47fcbaca195dc2a4bb283cb8c720e5bb8dcd8c31c81f3a2c423d` |
| L5 | Concurrent use produced one success and one failure | `4d3d6805e0fb0c827d4f9dfca339978d43b6aae3dda2c4ccda06ef61f05e445c`; `0bd51e4eb8f81be9003aeb04fc2cc448bdac7f7780fddb9e31b83eff3df082ab` |
| L6 | Custom-account cap/CPU enforcement and valid settlement | `1edaefd90de512ee00a198fbc762981c3a0082a5c68a869ba42ccc8eedd0e685` |
| L7 | Failed attempt then identical successful retry | `701b9350e13c2d2f8e7c16d6f2eb1517ea74326cc5774485624bfceb0bf7e5ad`; `330249fd9a281a5f27a005a1642e108f91cce6a5a40387e25ac09baea6c62dac` |
| L8 | Hook fee profiles and adversarial fee-gate rejection | See testnet report |
| L9 | OZ maximum reservation reconciled to partial actual | `9569422fd4fed8bdff13432e729ef1287f0ecec8ea1e9bffcaa7bb46a098da65` |
| L10 | OZ zero releases full new reservation | `6d239761641c2f58f70b25e108ae768a61e8ec1a573cae296c1d6947dbec2ee4` |
| L11 | Contract instance and Wasm code TTLs independently extended and confirmed through RPC | `976f86fa60a5d6b9ec2122380435171f9e89a1e3c9ebc47981d24e88af9b1f2d`; `54beeee989334342f9d75e6987ef3d4d70042d9108c5864b5140e258fc2092e2` |

## Review confirmations

| ID | Confirmation |
| --- | --- |
| R1 | OpenZeppelin confirmed two correlated context rules and both rule IDs |
| R2 | OpenZeppelin confirmed record mode does not invoke `__check_auth`/policy `enforce()` |

See [reviewer feedback](../docs/REVIEWER_FEEDBACK.md).
