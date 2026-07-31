# Remaining release and conformance work

There are no unresolved design questions from the OpenZeppelin review. The
following evidence is still required before a production release or final x402
acceptance.

## Before ABI freeze and audit

- SDF review of the authorization tree, ledger clocks, hook boundary, token
  assumptions, and immutable lifecycle.
- Explicit testnet boundary measurements where `signatureExpirationLedger` is
  before, equal to, and after the contract deadline, including rent at the
  operator's maximum timeout.
- Live issued-USDC SAC coverage and representative authorization-required,
  paused/clawback, and error-returning SEP-41 cases.
- Representative delegated-address, passkey, threshold, and weighted-threshold
  account compositions. The current live signer evidence is Ed25519.
- Production fee distributions by network, account class, and supported hook.
- Exercise restoration after actual archival on a disposable test deployment,
  then publish production monitoring thresholds and the maintenance runbook.
- Freeze the ABI and reproducible WASM, then commission an external audit.

## Before final x402 acceptance

- x402 TSC approval of `scheme_upto_stellar.md`.
- A reusable Stellar `upto` client/server/facilitator implementation in one
  canonical x402 SDK.
- An unmodified canonical client completing `/verify` and `/settle` on testnet
  and pubnet.
- Official x402 E2E coverage on both networks.
- Published exact and `upto` transaction hashes on both networks.
- Frozen non-null rejection-reason mapping for every rejection path.
- Deployment of the audited identical WASM to a canonical pubnet contract ID.

## Facilitator work already implemented outside this repository

The sibling facilitator implements the standard `payment-identifier`
fingerprint, stable `upto` maximum across verify/settle, cached responses,
conflict rejection, durable envelope/hash storage, channel quarantine, and
known-hash polling after a lost RPC response. Those tests are recorded in
[facilitator evidence](../evidence/FACILITATOR.md), but facilitator source is
deliberately outside this contract/spec review repository.
