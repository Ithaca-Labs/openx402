# Rock Paper Scissors x402 smoke test

This example uses the npm-published `@openx402/bazaar-sdk` and stock x402
Express/Stellar packages. `index.ts` is the paid seller and `client.ts` is the
paying client.

The hosted catalog rejects loopback and plain-HTTP resource URLs. Set
`SELLER_PUBLIC_URL` to an HTTPS tunnel that forwards to local port 4788.

```bash
npm install

SELLER_PUBLIC_URL=https://your-tunnel.example \
SELLER_PAY_TO=G... \
npm run server

SELLER_URL=https://your-tunnel.example/play \
BUYER_SECRET_KEY=S... \
npm run client
```
