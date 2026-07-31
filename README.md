# openx402

An open source, permissively licensed x402 facilitator for Stellar with a native Bazaar discovery layer — built against the SDF RFP for an [x402](https://github.com/x402-foundation/x402) facilitator with Bazaar (discovery) support on Stellar.

This repository currently holds the architecture and planning baseline; implementation is being built out in phases per [`reference/architecture/phased-build-plan.md`](reference/architecture/phased-build-plan.md).

## Goals

- A production-ready x402 facilitator for Stellar (`verify`, `settle`, `supported`) on both `stellar:testnet` and `stellar:pubnet`, built on the Apache-2.0 `@x402/stellar` package.
- A Stellar-native Bazaar discovery layer so agents can find, price, and pay for x402-protected services without a pre-existing integration.
- An MCP discovery server wrapping the discover/pay/retry loop for agent runtimes.
- Support for both the `exact` and `upto` settlement schemes, with `scheme_upto_stellar.md` contributed upstream.
- Non-custodial, audit-ready, and self-hostable end to end.

See [`reference/rfp.md`](reference/rfp.md) for the full scope of work.

## Architecture

The architecture decision baseline and supporting design docs live under [`reference/architecture/`](reference/architecture):

- [Overview and non-negotiable decisions](reference/architecture/README.md)
- [Phased build plan](reference/architecture/phased-build-plan.md)
- [Core facilitator](reference/architecture/core-facilitator.md)
- [Bazaar and catalog](reference/architecture/bazaar.md)
- [Storage, search, and evaluation](reference/architecture/storage-search-evaluation.md)
- [Stellar `upto` specification and contract](reference/architecture/spec-and-contract.md)
- [MCP support](reference/architecture/mcp.md)
- [Configuration reference](reference/architecture/configuration.md)
- [Conformance checklist](reference/architecture/conformance.md)
- [Dependencies and licensing](reference/architecture/dependencies-and-licensing.md)

## Reference material

`reference/` also contains local checkouts of upstream repos (`x402`, `x402-stellar`, `x402scan`, `stellar-docs`, `stellar-contracts`) used while designing this project. Those checkouts are gitignored here — refer to their upstream repos directly for their source and history.

## License

Apache-2.0. See [LICENSE](LICENSE).
