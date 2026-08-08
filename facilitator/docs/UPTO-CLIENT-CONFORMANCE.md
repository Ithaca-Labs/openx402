# Stellar upto client conformance

## Implemented boundary

`@openx402/stellar-upto` implements the canonical x402 v2
`SchemeNetworkClient` and `SchemeNetworkServer` interfaces. The client is
registered on an otherwise unmodified `x402Client`; it does not construct a
private `PaymentPayload` wrapper or add Stellar fields to the wire format.

The client emits exactly:

```json
{ "transaction": "AAAA..." }
```

The signed Soroban invocation binds payer, recipient, SEP-41 token, maximum,
ledger window, facilitator, settlement ID, optional hook, settlement contract,
and network. A server-declared standard `payment-identifier` is enriched before
signing and mapped to `BytesN<32>` with the normative domain-separated SHA-256
derivation.

The source lives in [`packages/stellar-upto`](../../packages/stellar-upto). Its
`UPSTREAM.md` maps the files and exports into `@x402/stellar`. Testnet has a
measured immutable contract default. Pubnet deliberately requires an explicit
audited contract address and RPC configuration.

## Testnet evidence

The live suite creates each upto payload through canonical `x402Client`, sends
it through canonical `HTTPFacilitatorClient`, and settles through the production
facilitator:

| Case | Result | Testnet transaction |
|---|---|---|
| Partial, maximum 10,000 / actual 3,000 | SUCCESS | `eeaee51c8e1368a95d019174b87fc56b7778f88898eb8404fdea484d91e9fd63` |
| Zero, maximum 10,000 / actual 0 | SUCCESS | `315802ef4e2e9e044ca890f955a3a832d7490d9ef342dd3aeebbe1e22dd98cf2` |

Both hashes were independently read from Horizon testnet. The partial run
persisted an enforcing estimate of 4,882,220 stroops; zero persisted 53,904.
The checked-in development fee gate was updated from the stale 150,000 value to
the 5,000,000 measured-profile ceiling. Pubnet values remain disabled examples
and are not presented as calibrated.

## Upstream status

The reusable implementation and testnet proof are shipped in this repository.
It is not yet part of a released `@x402/stellar` version. An upstream x402 PR
and maintainer merge are external release gates; until then, calling the scheme
"canonical upstream Stellar upto" would be inaccurate. The package exists to
remove the private-fixture blocker while that review proceeds.
