# Railway deployment

This repository deploys as four Railway services in one project:

```text
Dashboard  --private HTTP--+
                           +-- Facilitator --private SQL-- PostgreSQL + pgvector
MCP search --private HTTP--+
```

Only `Dashboard`, `Facilitator`, and `MCP` receive public domains. PostgreSQL
is private and has a persistent volume. The facilitator process runs database
migrations and the embedding worker, so there is no required worker service or
second datastore.

The only external credential a user supplies is `OPENROUTER_API_KEY`. Railway
generates the database password and the 32-byte facilitator encryption key.
The hosted profile uses OpenRouter embeddings and has local inference disabled,
so it never downloads model weights.

## Create the project

Railway's `railway.json` describes one service deployment, not an entire
multi-service project. Create these services once in Railway, verify them, then
use **Project Settings -> Generate Template from Project** to publish the
one-click template.

Use these exact, case-sensitive service names so the reference variables below
resolve as written.

### 1. Postgres

- Source: Docker image `pgvector/pgvector:pg17`
- Public networking: disabled
- Volume mount: `/var/lib/postgresql/data`
- Variables:

```dotenv
PORT=5432
POSTGRES_DB=openx402
POSTGRES_USER=openx402
POSTGRES_PASSWORD=${{secret(32)}}
PGDATA=/var/lib/postgresql/data/pgdata
DATABASE_URL=postgresql://${{POSTGRES_USER}}:${{POSTGRES_PASSWORD}}@${{RAILWAY_PRIVATE_DOMAIN}}:${{PORT}}/${{POSTGRES_DB}}
```

> **`PGDATA` is required, not optional.** The volume mounts directly at
> `/var/lib/postgresql/data`, which contains a `lost+found` directory, and
> `initdb` refuses to initialise a non-empty data directory:
>
> ```
> initdb: error: directory "/var/lib/postgresql/data" exists but is not empty
> initdb: detail: It contains a lost+found directory, perhaps due to it being a mount point.
> ```
>
> Pointing `PGDATA` at a subdirectory of the mount resolves it. Without this the
> container crash-loops while Railway still reports the deployment as `SUCCESS`,
> and the facilitator fails later with `Connection terminated due to connection
> timeout` during migration.

### 2. Facilitator

- Source: this GitHub repository
- Root directory: `/`
- Config file path: `/facilitator/railway.json`
- Public networking: enabled, target port `4022`
- Variables:

```dotenv
PORT=4022
NODE_ENV=production
FACILITATOR_CONFIG=config/railway.yaml
DATABASE_URL=${{Postgres.DATABASE_URL}}
FACILITATOR_EMBEDDING_URL=https://openrouter.ai/api/v1/embeddings
OPENROUTER_API_KEY=<required user input; seal this variable>
FACILITATOR_KEY_ENCRYPTION_KEY=${{secret(43, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/")}}=
```

Leave `FACILITATOR_API_KEYS` unset for the testnet-hosted demo. This allows an
unmodified x402 client and the public dashboard to call the facilitator with no
operator-specific credential. Fee, concurrency, per-principal, and global
sponsor limits still apply. Before enabling pubnet, configure API keys, sponsor
and channel secrets, an audited pubnet `upto` contract, and measured pubnet fee
ceilings; the checked-in profile otherwise refuses to enable it.

### 3. MCP

- Source: this GitHub repository
- Root directory: `/mcp-server`
- Config file path: `/mcp-server/railway.json`
- Public networking: enabled, target port `4522`
- Variables:

```dotenv
PORT=4522
NODE_ENV=production
MCP_SERVER_CONFIG=config/railway.yaml
FACILITATOR_URL=http://${{Facilitator.RAILWAY_PRIVATE_DOMAIN}}:${{Facilitator.PORT}}
```

This hosted MCP deployment intentionally registers only
`x402_search_resources` and `x402_get_resource`. It has no payer signer and
does not advertise `x402_call_resource`, so it is safe to expose publicly
without another API key.

### 4. Dashboard

- Source: this GitHub repository
- Root directory: `/frontend`
- Config file path: `/frontend/railway.json`
- Public networking: enabled, target port `3000`
- Variables:

```dotenv
PORT=3000
NODE_ENV=production
FACILITATOR_INTERNAL_URL=http://${{Facilitator.RAILWAY_PRIVATE_DOMAIN}}:${{Facilitator.PORT}}
```

The dashboard fetches data on the Next.js server over Railway's private
network. Browser clients never receive the private facilitator hostname or the
OpenRouter key. It displays only public catalog and observed payment data.

## Verify the deployment

Generate Railway domains for `Facilitator`, `MCP`, and `Dashboard`, then run:

```bash
curl -fsS "https://<facilitator-domain>/health/ready"
curl -fsS "https://<facilitator-domain>/supported"
curl -fsS "https://<facilitator-domain>/discovery/resources?limit=5"
curl -fsS "https://<mcp-domain>/healthz"
curl -fsS "https://<dashboard-domain>/api/health"
```

Expected MCP health for this profile is `payments: "disabled"`; that is the
intended discovery-only state. Expected facilitator search health is remote
semantic inference plus PostgreSQL vector support. If OpenRouter is unavailable,
search degrades to PostgreSQL full-text search while payment routes remain live.

## Template release checklist

- Keep all four services in one Railway project and environment.
- Keep PostgreSQL private and attach its persistent volume.
- Mark `OPENROUTER_API_KEY` required and sealed in the template composer.
- Add descriptions to every template variable.
- Generate public domains for the three HTTP services only.
- Deploy the template into a fresh project before publishing it.
- Confirm no `@huggingface/transformers` package or model cache exists in the
  facilitator runtime image.
- Run a real testnet exact payment carrying Bazaar metadata, then confirm the
  resource appears in both discovery and dashboard search.
