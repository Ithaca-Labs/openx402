# Upstream contribution layout

The implementation targets these additions in the x402 monorepo:

```text
typescript/packages/mechanisms/stellar/src/upto/client/scheme.ts
typescript/packages/mechanisms/stellar/src/upto/client/index.ts
typescript/packages/mechanisms/stellar/src/upto/server/scheme.ts
typescript/packages/mechanisms/stellar/src/upto/server/index.ts
specs/schemes/upto/scheme_upto_stellar.md
```

Before merge, replace this package's public imports with the equivalent local
`../../signer`, `../../utils`, and `../../shared` imports used by Stellar exact;
the scheme logic and wire output do not change. Add `./upto/client` and
`./upto/server` exports to the canonical package.

The contribution must not add contract, facilitator, hook, or settlement ID
fields to the x402 JSON format. Pubnet activation remains gated on publishing
and auditing the immutable contract deployment.
