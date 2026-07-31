# Stellar `upto` testnet report

Date: 2026-07-31

Toolchain: Stellar CLI `26.0.0`, Rust `1.96.1`, settlement deployment SDK
`26.1.1`, reference policy SDK `27.0.2`,
Stellar JavaScript SDK `16.2.0`.

## Frozen artifact

| Item | Value |
| --- | --- |
| Contract ID | `CDEI3W6ZFW6BFSU37VL265OSOGKSM3BR3TZVUR5NZ4UER6FOMVJUKOOT` |
| WASM SHA-256 | `2416d2b4d524908031b4b43cc0947898c506f8b769ff889bb78bae03cebe6419` |
| Deployment transaction | `6e3bf23dd7cfcab66db684c4fce4089b5b05e6f845b67c8d7040114fc1496da8` |
| Deployment ledger | `3895887` |
| Deployment source | `GBH4XOITPPRP5XLZC3J6YAYEIEXDA5JULNLPTJYFULESK7OFNCEYGNAJ` |
| Deployment salt | `248c6f0ca5a9d66488132e2be450b5dec9f73f92a5f8b61e152c7ff62d07eaa8` |
| Network | `stellar:testnet` |
| Token | Native XLM SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

The exact deployed Wasm and checksum are included under
[`evidence/artifacts`](artifacts/SHA256SUMS).

The contract is immutable and creates no application-defined storage. It has
no constructor, admin, upgrade, pause, or allowlist. Its signed ABI includes a
32-byte settlement ID and an optional versioned settlement hook. As with every
Soroban deployment, its contract-instance and Wasm-code ledger entries still
have TTL and rent; restoration rehearsal and a production operator maintenance
runbook remain release work.

### Contract TTL maintenance

The contract instance and Wasm code are separate persistent entries and were
extended independently by 120,960 ledgers. The instance-only command did not
extend the code entry, so the production runbook must maintain both.

| Entry | Transaction | Fee charged | Confirmed live-until ledger |
| --- | --- | ---: | ---: |
| Contract instance | `976f86fa60a5d6b9ec2122380435171f9e89a1e3c9ebc47981d24e88af9b1f2d` | 5,544 | 4,024,794 |
| Wasm code | `54beeee989334342f9d75e6987ef3d4d70042d9108c5864b5140e258fc2092e2` | 281,808 | 4,024,803 |

The RPC confirmation was read at ledger 3,903,845 and also confirmed the code
entry hash as
`2416d2b4d524908031b4b43cc0947898c506f8b769ff889bb78bae03cebe6419`.
Restoration from actual archival was not exercised and remains release work.

Measurement hook:

| Item | Value |
| --- | --- |
| Contract ID | `CBBQTCJ4VOFJSNJ2AVDWNMBQVDPGOKQTJZHMRCWVMPX4KDPL4RETBNQI` |
| WASM SHA-256 | `32b7c92c31d1bb57a43c6c75ea29da260fa5fd0d3ecd6886d68a5feeb8cab855` |
| Upload transaction | `4c9e560c7771169f34c9a672f45cd4b08c822c146fe71fb0a4240f34a27f8ff5` |
| Deployment transaction | `7180dfaa77c565eedf5ae5fa70422f745986727b11bda06033498b09aabd776f` |
| Deployment ledger | `3895944` |
| Deployment source | `GASEB65O47AVT6RMSKH455M4WU3L7S2C7B6RCT5VXEXCLKPPHVW6TG7Y` |
| Deployment salt | `2222222222222222222222222222222222222222222222222222222222222222` |

## Dependency licences

The resolved Cargo and npm dependency graphs were enumerated from
`cargo metadata` and installed package manifests. Every declared licence was
permissive (Apache-2.0, MIT, BSD, Zlib, Unicode, Unlicense, or compatible
dual-licence expressions); no AGPL, GPL, or LGPL dependency was present.

Direct dependencies:

| Dependency | Version | Licence |
| --- | --- | --- |
| `soroban-sdk` | `26.1.1` and `27.0.2` | Apache-2.0 |
| `@stellar/stellar-sdk` | `16.2.0` | Apache-2.0 |
| `stellar-accounts` | Git revision `56d6e5b9` | MIT |

No model or model weights are part of this contract or test harness.

## Contract tests

Command:

```sh
cargo test --workspace
```

Result: 36 passed, 0 failed. Clippy also passed with warnings denied: 25
settlement tests and 11 real-auth smart-account/policy tests.

Covered:

- zero, partial, maximum, negative, above-maximum, and `i128::MAX` amounts;
- every actual integer from zero through a maximum of 100;
- inclusive validity bounds and invalid windows;
- exact payer and facilitator authorization trees;
- allowance equality before pull and zero allowance after pull;
- pre-existing and nonstandard additive allowances;
- insufficient balance and injected approve, pull, pay, and refund failures;
- atomic rollback of allowance, balances, and events;
- payer equal to recipient;
- six-decimal ordinary SEP-41 token behavior;
- hook notification for zero and partial settlement;
- successful invoker authentication, rejection of a forged direct notice,
  duplicate `(payer, settlement_id)` rejection, and payer-owned hook failure;
- post-hook allowance and balance revalidation;
- rejection of self-referential and token-address hooks;
- reentry with the original payer outside the signed auth tree.
- OZ rule-bound Ed25519 signatures through real `__check_auth`;
- correlated settlement and nested-token context rules;
- maximum reservation and actual reconciliation, including zero;
- over-budget, duplicate-ID, wrong-key, and wrong-contract rejection;
- rejection of standalone or mismatched token approvals;
- the record-simulation missing-reservation no-op.

## Integrated live run

Command:

```sh
cd harness
npm ci
npm run test:testnet
```

All hashes and fees below were confirmed independently through Stellar RPC.

| Case | Status | Hash | Fee charged |
| --- | --- | --- | ---: |
| `actual == 0` | SUCCESS | `e6b3b9012ebe5e7808c2c7fa74e47c7386fb3a9e11a76f4fba8358b4397c76ba` | 45,178 |
| `0 < actual < max` | SUCCESS | `f80ade7fb080337392d11fd60535d0c37f296447c1aa4cf3ca3f9310224d7920` | 48,811 |
| `actual == max` | SUCCESS | `662d3863e78632a335d73e758050150e4522a1aeb43efee8e657ef899bdeb60e` | 47,807 |
| Changed actual before first use | SUCCESS | `b5292911043c47fcbaca195dc2a4bb283cb8c720e5bb8dcd8c31c81f3a2c423d` | 48,811 |
| Concurrent submission winner | SUCCESS | `4d3d6805e0fb0c827d4f9dfca339978d43b6aae3dda2c4ccda06ef61f05e445c` | 48,811 |
| Concurrent submission loser | FAILED | `0bd51e4eb8f81be9003aeb04fc2cc448bdac7f7780fddb9e31b83eff3df082ab` | 34,815 |
| Forced insufficient balance | FAILED | `701b9350e13c2d2f8e7c16d6f2eb1517ea74326cc5774485624bfceb0bf7e5ad` | 34,815 |
| Same auth after restoring balance | SUCCESS | `330249fd9a281a5f27a005a1642e108f91cce6a5a40387e25ac09baea6c62dac` | 48,811 |
| Valid custom-account policy | SUCCESS | `1edaefd90de512ee00a198fbc762981c3a0082a5c68a869ba42ccc8eedd0e685` | 47,409 |

The harness also confirmed without submitting transactions:

- negative and above-maximum actual values fail recording simulation;
- self-referential and token-address hooks fail recording simulation;
- changing the recipient after payer signing fails enforcing simulation;
- identical replay and replay with changed actual fail after first success;
- a custom C-account rejects a signed maximum above its policy cap;
- a CPU-burning `__check_auth` passes record simulation but fails enforcing
  simulation;
- record-mode resource fees were effectively identical for normal and
  CPU-burning custom-account policy paths (`270605` for both).

### Settlement-hook fee gate

The facilitator pays for hook execution because it sponsors the whole
transaction. The harness runs the hook during enforcing simulation and applies
the fee ceiling before assembly or submission.

| Profile | Enforcing `minResourceFee` | Charged | Hash/result |
| --- | ---: | ---: | --- |
| No hook | 60,422 | 48,813 | `60a967e1c8b5f1460b2ace5bf7fc5f9f28f4859ff46fd11abcffc50bbb87ad3e` |
| Authenticated no-op hook | 61,987 | 50,352 | `5840bcdd1a54f9d50d28d4f4eaf69f740d590c05f9786efea853db6e9d784cfb` |
| Stateful hook | 64,714 | 53,079 | `2303f16d33a15b730c495a4bffb74b6ac8223c72aeb9a223e8b54245304d3b63` |
| 1,000 SHA-256 iterations | 67,507 | not submitted | rejected by test ceiling 64,747 |

### OpenZeppelin reconciling policy

The optional reference integration pins OpenZeppelin Stellar Contracts commit
`56d6e5b91aed828051163cebd92dab6c3ca2fa92` and deploys three independent
contracts:

| Item | Contract/WASM | Deployment transaction |
| --- | --- | --- |
| Ed25519 verifier | `CDQUKL5ONG6YORXLN3N7MX4LCO3PDHWTTNM6W6G5L4XDSRJZB5OS6R2X` / `63ead439a59eb2b65d9d3736bb142ecd741a3690cd40568251b14b023777701d` | `e13d1f0dcd150329fb1d70ad6932b01b9bc4e58d6a54722f6ef09276632f7b9f` |
| Reconciling policy | `CCEMDZHPJFLT2UX63PKI6YZHLCCR243PRVOE56BOVCE6S4654QFITYBY` / `cb054a0728b45f7db2ff93e13bd5f0336f2c6b998e30d25fc55e1753f4a5a1fe` | `82196498348fabee8efdb60251e78482447aeb4408c07f6d278cc473973632ab` |
| OZ agent account | `CBFHWZ4IIMYYGOYRTVRFFBSUOUP76HDS7CQYHUTSXY2IKFNTWFSTWZWO` / `22541f40eec2011452bd6e5cd6683c084b6a504cc137507699f930c8a4ff413a` | `312b6e70b193069876ca255b5150c4609a4b2d3a1e82f4e17169ed6fa500c255` |

The recorded auth tree contains two contexts. Rule 0 pins the settlement
contract; rule 1 pins the token contract and permits only the approval matching
rule 0's reservation. The agent signed the OZ digest with a real Ed25519 key.

| Case | Hash/result | Record fee | Enforcing fee | Charged |
| --- | --- | ---: | ---: | ---: |
| Partial, `max=10,000,000`, `actual=3,000,000` | `9569422fd4fed8bdff13432e729ef1287f0ecec8ea1e9bffcaa7bb46a098da65` | 274,116 | 1,055,399 | 916,115 |
| Zero, `max=10,000,000`, `actual=0` | `6d239761641c2f58f70b25e108ae768a61e8ec1a573cae296c1d6947dbec2ee4` | 270,345 | 1,051,618 | 912,472 |
| Same settlement ID with a fresh nonce | rejected in simulation | - | - | - |
| Maximum above remaining policy budget | rejected in enforcing simulation | - | - | - |

The first partial settlement against cold policy state measured enforcing
`minResourceFee=1,480,125` and charged 1,285,442 stroops. This cold/warm spread
and the roughly 1.05M warm cost make the policy opt-in; it cannot share the
no-hook production fee ceiling.

Record simulation skips `__check_auth` but executes the hook. The policy must
therefore no-op when no reservation exists. During enforcing simulation and
execution, the reservation exists; exact notice, caller, token approval,
duplicate, and budget checks remain enforced.

This is a functional fee-gate test, not a production ceiling recommendation.
Production defaults require p99 measurements by network, payer class, and
supported hook.

## Decisions supported by the run

1. Zero settlement is a real approve-pull-refund transaction. It consumes the
   host nonce and always returns a normal transaction hash.
2. The payer signs recipient, token, maximum, validity bounds, facilitator,
   settlement ID, and optional hook. The auth credential binds payer, the
   invocation root binds contract, and the signature preimage binds network.
   The facilitator signs all ten arguments, including actual.
3. Failed transactions revert nonce and token changes, so a retry can succeed
   after a definitive `FAILED`. Failed transactions still charge the sponsor.
4. Concurrent use of one authorization through distinct channel accounts
   yields one success and one failure.
5. Enforcing simulation is required for custom accounts; record simulation is
   not a security gate.
6. A real OZ smart-account policy conservatively reserves the payer's signed
   maximum. The authenticated optional hook releases `max - actual` after
   settlement, including the full reservation for zero.
7. The hook is generic and versioned, fires for zero, and is optional. Callback
   failure is the signing payer's availability risk. Post-callback allowance
   and balance invariants are rechecked before success.
8. Hook execution is facilitator-sponsored and therefore belongs inside the
   same enforcing-simulation fee gate as custom-account authentication.

## Not yet claimed

- pubnet deployment or transaction hashes;
- unmodified canonical-client `/verify` and `/settle` completion;
- finalized rejection-reason mapping;
- issued USDC SAC, authorization-required, paused, or clawback token coverage;
- production fee ceilings or audit completion;
- delegated-address, passkey, threshold, and weighted-threshold policy
  composition;
The OpenZeppelin two-rule and record-simulation questions were subsequently
confirmed and are recorded in
[`docs/REVIEWER_FEEDBACK.md`](../docs/REVIEWER_FEEDBACK.md). The remaining items
stay non-normative in the scheme document.
