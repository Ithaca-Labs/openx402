# Seventeen cyclic Stellar x402 APIs

One Express server exposes seventeen paid GET endpoints. Wallet `N` owns endpoint `N`;
wallet `N-1` buys it, with wallet 17 buying wallet 1's endpoint. Payments use
canonical Circle USDC on Stellar testnet. Stable per-service prices range from
`750` to `6600` atomic units (0.000075 to 0.00066 USDC).

## 1. Create wallets, fund XLM, and add trustlines

```bash
npm run wallets:setup
```

Secrets are written with owner-only permissions to gitignored
`wallets.private.json`. The API server reads only `wallets.public.json`.

Fund all seventeen addresses with testnet USDC using the Circle faucet, or distribute
one USDC to each from a disposable testnet wallet that already holds USDC:

```bash
USDC_FUNDER_SECRET=S... npm run wallets:setup
```

Never pass `USDC_FUNDER_SECRET` to the API server.

For a phrase restored into Stellar CLI Secure Store, keep the key non-exportable:

```bash
USDC_FUNDER_IDENTITY=openx402-testnet-treasury npm run wallets:setup
```

## 2. Start ngrok, then the seller

```bash
ngrok http 4788
```

```bash
FACILITATOR_URL=https://facilitator.stellarx402.xyz \
SELLER_PUBLIC_URL=https://YOUR-NGROK-DOMAIN.ngrok-free.app \
npm run server
```

The seller needs only public wallet addresses from `wallets.public.json`.

## 3. Verify and buy

```bash
curl -i https://YOUR-NGROK-DOMAIN.ngrok-free.app/api/time

SELLER_ORIGIN=https://YOUR-NGROK-DOMAIN.ngrok-free.app npm run client
```

The client waits six seconds between successful settlements so facilitator
channel sequences can advance. Set `INTER_REQUEST_DELAY_MS=0` for burst testing.

The client requires all seventeen local secrets because each generated wallet signs one
purchase. It validates each advertised pay-to address, canonical USDC contract,
amount, HTTP 200 response, and 64-character settlement transaction hash.

The buyer uses a 20-ledger auth lifetime. This avoids false
`invalid_stellar_auth_expiration_too_far` failures when the hosted facilitator's
RPC head trails the public RPC used by `@x402/stellar`; the seller still advertises
the facilitator's 300-second testnet maximum.

`purchases.public.json` records one Horizon-confirmed transaction per endpoint.

For a resumable hosted-facilitator stress run with Horizon-confirmed public
proofs and a persistent random target of 3–9 distinct buyers per service:

```bash
SELLER_ORIGIN=https://YOUR-NGROK-DOMAIN.ngrok-free.app npm run stress
```

The current stress run uses varied per-service transaction targets totaling 92
across all seventeen services. It picks each next endpoint randomly while
guaranteeing the same endpoint never appears twice in a row. The persisted proof
log makes the run resumable and keeps the successful order auditable.
