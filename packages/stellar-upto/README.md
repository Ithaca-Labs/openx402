# `@openx402/stellar-upto`

Reusable x402 v2 `upto` client and server implementations for Stellar. The
source is shaped for contribution to `@x402/stellar`; this temporary package
exists so canonical `x402Client` and resource-server code can use the scheme
before the upstream release lands.

```ts
import { x402Client } from "@x402/core/client";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { createEd25519Signer } from "@x402/stellar";
import { UptoStellarScheme } from "@openx402/stellar-upto/client";

const facilitator = new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL! });
const client = new x402Client().register(
  "stellar:testnet",
  new UptoStellarScheme(createEd25519Signer(process.env.STELLAR_SECRET_KEY!), {
    facilitatorClient: facilitator,
  }),
);
```

The client returns the standard Stellar payload `{ transaction }`. It binds the
payer, recipient, asset, maximum, ledger window, facilitator, settlement ID,
optional hook, contract, and network in Soroban authorization. A declared
standard `payment-identifier` is generated before signing and deterministically
mapped into the contract's `BytesN<32>` settlement ID.

Testnet has a measured immutable contract ID. Pubnet code is implemented but
requires an explicitly configured audited deployment; there is deliberately no
placeholder mainnet contract.

See [`UPSTREAM.md`](UPSTREAM.md) for the merge layout and compatibility rules.
