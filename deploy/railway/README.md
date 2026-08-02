[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/uKrE3J?referralCode=z2BTcK&utm_medium=integration&utm_source=template&utm_campaign=generic)

# Railway deployment

The one-click template deploys the hosted testnet profile as three services:

```text
Public MCP discovery ----private HTTP----+
                                         |
                                         v
Public Facilitator ----------------> PostgreSQL + pgvector
                                      private network + volume
```

The facilitator process runs migrations and the embedding worker. A separate worker, Redis,
hosted vector database, and dashboard are not required. PostgreSQL is private. Only the
facilitator and MCP services receive public domains.

## One-click deployment

1. Open the template.
2. Enter `OPENROUTER_API_KEY`.
3. Deploy the project.
4. Wait for `Postgres`, then `Facilitator`, then `MCP` to become healthy.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/uKrE3J?referralCode=z2BTcK&utm_medium=integration&utm_source=template&utm_campaign=generic)

Railway generates and seals the database password and the 32-byte facilitator encryption key.
The hosted profile uses OpenRouter for embeddings, never downloads local model weights, and keeps
reranking disabled. The MCP service is discovery-only and holds no payer key.

## Service configuration

The template is pinned to a tested Git commit. The repository's `railway.json` files provide build
and health settings; the template also persists those settings so they remain visible and stable in
the generated project.

### Postgres

| Setting | Value |
| --- | --- |
| Image | `pgvector/pgvector:pg17` |
| Public networking | Disabled |
| Volume mount | `/var/lib/postgresql/data` |
| Restart policy | On failure, up to 10 retries |

```dotenv
PORT=5432
POSTGRES_DB=openx402
POSTGRES_USER=openx402
POSTGRES_PASSWORD=${{secret(32)}}
PGDATA=/var/lib/postgresql/data/pgdata
DATABASE_URL=postgresql://${{POSTGRES_USER}}:${{POSTGRES_PASSWORD}}@${{RAILWAY_PRIVATE_DOMAIN}}:${{PORT}}/${{POSTGRES_DB}}
```

`PGDATA` must point to a subdirectory of the volume. Mount roots can contain filesystem metadata,
and PostgreSQL refuses to initialize a non-empty data directory.

### Facilitator

| Setting | Value |
| --- | --- |
| Source root | Repository root |
| Dockerfile | `facilitator/Dockerfile` |
| Railway config | `/facilitator/railway.json` |
| Health check | `/health/ready`, 300 seconds |
| Restart policy | Always |
| Graceful drain | 35 seconds |
| Public target port | `4022` |

```dotenv
PORT=4022
NODE_ENV=production
FACILITATOR_CONFIG=config/railway.yaml
DATABASE_URL=${{Postgres.DATABASE_URL}}
FACILITATOR_EMBEDDING_URL=https://openrouter.ai/api/v1/embeddings
OPENROUTER_API_KEY=<required, sealed>
FACILITATOR_KEY_ENCRYPTION_KEY=${{secret(43, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/")}}=
```

The profile enables testnet exact and the deployed testnet `upto` contract. It creates encrypted
sponsor/channel keys and funds them through Friendbot on first boot. It leaves pubnet disabled.

`FACILITATOR_API_KEYS` is intentionally unset for the public testnet deployment so an unmodified
x402 client can call the service. Fee, simulation, concurrency, per-principal, and global sponsor
limits still apply. Never enable pubnet in this public-keyless profile.

### MCP

| Setting | Value |
| --- | --- |
| Source root | `/mcp-server` |
| Dockerfile | `Dockerfile` |
| Railway config | `/mcp-server/railway.json` |
| Health check | `/readyz`, 120 seconds |
| Restart policy | Always |
| Public target port | `4522` |

```dotenv
PORT=4522
NODE_ENV=production
MCP_SERVER_CONFIG=config/railway.yaml
FACILITATOR_URL=http://${{Facilitator.RAILWAY_PRIVATE_DOMAIN}}:${{Facilitator.PORT}}
```

The MCP server registers only `x402_search_resources` and `x402_get_resource`. It does not register
`x402_call_resource`, contain a payer key, or need an MCP API key.

## Verify a deployment

Replace the hostnames with the generated Railway domains:

```bash
FACILITATOR_URL=https://your-facilitator.up.railway.app
MCP_URL=https://your-mcp.up.railway.app

curl -fsS "$FACILITATOR_URL/health/ready"
curl -fsS "$FACILITATOR_URL/supported"
curl -fsS "$FACILITATOR_URL/discovery/resources?limit=5"
curl -fsS "$FACILITATOR_URL/discovery/search?query=weather&limit=5"
curl -fsS "$MCP_URL/healthz"
curl -fsS "$MCP_URL/readyz"
```

Expected facilitator search health is:

- lexical: ready;
- semantic: ready when OpenRouter credentials are valid;
- vector support: true.

If OpenRouter is temporarily unavailable, search reports partial/degraded results and falls back
to PostgreSQL full-text retrieval. This does not make payment endpoints unavailable.

Expected MCP health contains `payments: "disabled"`. That is the intended public discovery state.

For a protocol-level MCP smoke test:

```bash
curl -fsS -X POST "$MCP_URL/mcp" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## MCP client configuration

```json
{
  "mcpServers": {
    "openx402": {
      "url": "https://your-mcp.up.railway.app/mcp"
    }
  }
}
```

## Production hardening

The provided template is a testnet preview. Before adapting it to pubnet:

1. Configure bearer authentication for facilitator sponsor-bearing routes.
2. Import a funded pubnet sponsor and the configured number of channel accounts.
3. Replace disabled example fee ceilings with measured pubnet p99 values.
4. Configure the pubnet asset allowlist and audited `upto` contract.
5. Set a stable cursor HMAC key if cursors must survive service replacement.
6. Configure alerts for balances, sponsor budgets, fee rejections, unknown settlements, RPC
   failures, channel availability, and contract/Wasm TTL.
7. Configure PostgreSQL backups and test restoration.
8. Keep Postgres private and never expose secrets through public service variables or build args.

Pubnet startup is designed to fail closed when authentication, signing material, channel count,
fee calibration, or contract configuration is incomplete.

## Updating the template

After changing a Dockerfile, Railway config, environment contract, or service dependency:

1. Deploy the repository commit to the existing template project.
2. Verify all health endpoints.
3. Run an exact testnet payment carrying Bazaar metadata.
4. Confirm the resource appears in browse and ranked search.
5. Confirm MCP `tools/list` exposes only the intended tools.
6. Generate or update the template from the verified project.
7. Deploy it into a fresh Railway project before publishing.

Keep variable descriptions, generated secrets, health checks, private references, persistent
volume settings, and the exact case-sensitive service names in the template. Railway users should
configure deployments through template variables and service settings, not by editing Dockerfiles.
