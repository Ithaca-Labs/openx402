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
