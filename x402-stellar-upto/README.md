# x402 `upto` for Stellar

Draft Stellar implementation of the x402 v2 `upto` payment scheme, prepared
for technical review by the Stellar Development Foundation and subsequent
proposal to the x402 Technical Steering Committee.

This repository is not an official Stellar or x402 release. It deliberately
contains only the proposed network specification, Soroban contracts, tests,
and evidence. Facilitator, Bazaar, search, dashboard, and MCP implementations
live elsewhere.

## Review entry points

1. [Proposed specification](spec/scheme_upto_stellar.md)
2. [SDF review brief](docs/SDF_REVIEW.md)
3. [Settlement contract](contracts/upto-settlement/src/lib.rs)
4. [Threat model](docs/THREAT_MODEL.md)
5. [Testnet evidence](evidence/testnet-report.md)
6. [Evidence matrix](evidence/CLAIMS.md)
7. [Frozen testnet Wasm](evidence/artifacts/x402_stellar_upto_settlement.wasm)
8. [Remaining release work](docs/RELEASE_GAPS.md)

## Design summary

- One immutable Soroban settlement contract with no application-defined
  persistent state is required.
- The payer signs recipient, token, maximum, ledger window, facilitator,
  settlement ID, optional hook, settlement contract, and network.
- The facilitator alone chooses and signs `actual`, bounded by the contract.
- Settlement atomically approves, pulls the maximum, pays the actual amount,
  refunds the remainder, and leaves zero allowance.
- Zero settlement executes on-chain and consumes the authorization nonce.
- An optional, versioned settlement hook can reconcile conservative smart-
  account budget reservations. It is not required for ordinary settlement.
- OpenZeppelin composition uses two correlated context rules: the settlement
  root and nested SEP-41 approval.

## Repository layout

```text
spec/                         proposed upstream specification
contracts/upto-settlement/    normative settlement contract
contracts/test-settlement-hook/ adversarial and fee test support
contracts/reconciling-policy/ optional generic hook consumer
contracts/oz-agent-account/   optional OZ real-auth integration fixture
contracts/ed25519-verifier/   OZ external signer fixture
harness/                      reproducible offline and testnet evidence
evidence/                     hashes, measurements, and claim mapping
docs/                         review brief, threat model, and release gaps
```

## Tests

Previously recorded contract and testnet results are preserved rather than
rerun during repository extraction. To reproduce them:

```sh
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cd harness && npm ci && npm test
```

The live harness submits testnet transactions and is intentionally separate:

```sh
cd harness
npm run test:testnet
```

It expects the Stellar CLI identities and deployed test contracts documented
in [the testnet report](evidence/testnet-report.md). Never run it with valuable
keys.

## Status

The design and testnet implementation are ready for SDF review. Pubnet
deployment, canonical x402 client conformance, production fee calibration, and
external audit remain release work and are not claimed here.

The deployment runbook must monitor and extend the TTL of both the contract
instance and Wasm code entries. Immutability removes application-level upgrade
authority; it does not remove Stellar ledger-entry rent or archival.

## License

Apache-2.0. See [LICENSE](LICENSE) and
[dependency licences](evidence/DEPENDENCIES.md).
