# Smart accounts (OpenZeppelin C-account) and mcp-server

This package never signs against or configures a smart account itself -- it
only needs to know that when the payer behind a configured `SignerProvider`
is an OpenZeppelin smart contract account (a Soroban "C-account", not a
classic Ed25519 "G-account"), the authorization it constructs is checked
against on-chain policy that this process does not control and must not try
to second-guess.

## The model

An OpenZeppelin smart account authorizes a payment through two nested
context rules, both supplied together:

1. **CallContract settlement context rule** -- authorizes the specific
   invocation of the settlement contract (the `exact` SEP-41 `transfer` call,
   or the `upto` settlement contract's authorize/settle entry point) for this
   payment's exact arguments.
2. **Nested SEP-41 `approve` context rule** -- authorizes the token
   contract's own `approve` sub-invocation that the settlement call makes
   underneath it, since a bare CallContract rule for the outer invocation
   does not implicitly authorize the token-level `approve` it triggers.

Both `context_rule_ids` are attached to the authorization entry at signing
time; a signer that only supplies one of the two produces an authorization
Soroban will reject at simulation, not a partially-scoped one that succeeds.

Optionally, a **reconciling spending policy/hook** can be attached to the
account: a Soroban contract that observes settlements (particularly `upto`,
where the authorized maximum and the actual settled amount can differ) and
reconciles the account's spending record after the fact, independent of
whatever `mcp-server`'s own budget bookkeeping believes happened.

## Why this package stays out of it

`mcp-server`'s `SignerProvider` interface (`src/payment/signerProvider.ts`)
only asks for a `ClientStellarSigner` (`address` + `signAuthEntry`). Whether
that signer is a bare Ed25519 key or a smart-account-aware signer that knows
how to attach the right `context_rule_ids` is entirely the concern of the
provider implementation (in practice, the `external` or `encrypted-key`
provider talking to whatever signing service actually manages the smart
account) -- `mcp-server`'s own orchestration code in `tools/callResource.ts`
never inspects or constructs context rules.

## Three independent ceilings

The task's budget model is explicit that these three ceilings never
substitute for one another:

1. **This process's runtime budget** (`src/budget/`) -- an operator- and
   agent-side limit, enforced entirely client-side, before any signing.
2. **The signed x402 maximum** -- the `exact` amount or `upto` maximum this
   process actually authorizes in the payload it signs.
3. **The on-chain smart-account policy** -- whatever context rules and
   reconciling hook are attached to the C-account, enforced by Soroban
   simulation and the facilitator's own settlement path, entirely outside
   this process.

A generous runtime budget does not loosen an on-chain policy that is more
restrictive, and a tight runtime budget is not a substitute for the
facilitator's enforcing simulation or its sponsor fee gate -- `mcp-server`
reserving a conservative maximum locally is a client-side safety margin, not
a claim that the payment is guaranteed to clear on-chain. The facilitator
(`facilitator/src/stellar/upto.ts` and the `exact` scheme's server-side
verification) is the only component that actually enforces the on-chain
policy; this package's checks exist to fail fast and cheaply before ever
reaching that point, never to replace it.
