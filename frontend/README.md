# openx402 dashboard

Public, read-only dashboard for the facilitator's Bazaar catalog and observed
Stellar settlement data. It does not contain fixture metrics and does not call
the chain or database directly.

## Development

Run a facilitator on port 4022, then start the dashboard:

```bash
npm ci
FACILITATOR_INTERNAL_URL=http://127.0.0.1:4022 npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

`FACILITATOR_INTERNAL_URL` is read only by the Next.js server. On Railway it
points at the facilitator's private domain, so the browser never needs internal
network access. `FACILITATOR_API_KEY` is optional and is only needed if the
facilitator operator protects analytics with bearer authentication.

URL resolution order is `FACILITATOR_INTERNAL_URL`, `FACILITATOR_URL`, then
`http://127.0.0.1:4022`. All three variables are server-only. Never create a
`NEXT_PUBLIC_FACILITATOR_API_KEY` variable.

Health check: `GET /api/health`.

## Production

The production Docker image uses Next.js standalone output and listens on the
Railway-provided `PORT` over IPv4 and IPv6. See
[`../deploy/railway/README.md`](../deploy/railway/README.md) for the complete
multi-service deployment.

```bash
npm run lint
npm run build
docker build -t openx402-dashboard .
```

## Vercel

Create a Vercel project with these settings:

- Root directory: `frontend`
- Framework preset: Next.js
- Build command: `npm run build`
- Required environment variable:
  `FACILITATOR_URL=https://facilitator-production-8430.up.railway.app`
- Optional environment variable: `FACILITATOR_API_KEY`

The dashboard does not require PostgreSQL, OpenRouter, MCP signer keys, Stellar
secret keys, or Railway private networking. The browser never calls the
facilitator directly and must not receive facilitator credentials.

After deployment, verify `/api/health` returns HTTP 200 and a sanitized `ready`
payload. Smoke-test these production paths:

```text
/
/discover
/discover?q=weather
/all
/marketplace
/transactions
/facilitators
/networks
/ecosystem
/api/health
```

If the Vercel CLI is not already installed and authenticated, deploy from the
repository root with:

```bash
cd frontend
npx vercel login
npx vercel link
printf '%s' 'https://facilitator-production-8430.up.railway.app' | npx vercel env add FACILITATOR_URL production
npx vercel --prod
```

Add `FACILITATOR_API_KEY` through the same server-side environment settings only
when the facilitator requires it. Do not prefix it with `NEXT_PUBLIC_`.
