# openx402

An open source, permissively licensed [x402](https://github.com/x402-foundation/x402) facilitator
for Stellar with a native Bazaar discovery layer — built against the SDF RFP for an x402 facilitator
with Bazaar support on Stellar.

Non-custodial, audit-ready, and self-hostable end to end. No API key is required to run it.

```
                      +-- MCP server (agents) ---+
                                                 |
  buyer / agent  -->  facilitator  -->  PostgreSQL + pgvector
                       verify · settle · discovery · search
```

## What you get

- **Facilitator** — `verify`, `settle`, `supported` on `stellar:testnet` and `stellar:pubnet`,
  built on the Apache-2.0 `@x402/stellar` package. Supports both the `exact` and `upto` settlement
  schemes.
- **Bazaar discovery** — resources are cataloged automatically on first settlement, then searchable.
- **Real ranking** — lexical (PostgreSQL FTS) + semantic (pgvector) fused with Reciprocal Rank
  Fusion, with an optional cross-encoder reranking stage. Not a filtered list.
- **MCP server** — wraps discovery for agent runtimes. Runs discovery-only or with paid execution.

---

## Quick start

Requires Docker and about 2 GB of free disk.

```bash
git clone https://github.com/Ithaca-Labs/openx402.git
cd openx402
cp .env.example .env

# fill in the two required values
openssl rand -hex 16     # -> POSTGRES_PASSWORD
openssl rand -base64 32  # -> FACILITATOR_KEY_ENCRYPTION_KEY

docker compose up -d
```

Then:

```bash
curl -fsS localhost:4022/health/ready
curl -fsS localhost:4022/supported
curl -fsS "localhost:4022/discovery/resources?limit=5"
curl -fsS localhost:4522/healthz
```

That's a complete stack: PostgreSQL with pgvector, the facilitator, and the MCP server. **No
external API calls** — the default profile runs a local embedding model.

---

## Deployment options

### 1. Docker Compose — full local control

The quick start above. Local embeddings, nothing leaves your machine.

### 2. Railway — hosted

Three services: PostgreSQL, facilitator, MCP. See [`deploy/railway/README.md`](deploy/railway/README.md)
for the exact service configuration.

The hosted profile uses a remote embeddings endpoint instead of local inference, so it never
downloads model weights and starts in seconds. It needs one credential — an embeddings API key.

### 3. Manual

Node 24+, PostgreSQL 17 with the `pgvector` extension. Each service reads a YAML config selected by
`FACILITATOR_CONFIG` / `MCP_SERVER_CONFIG` and takes secrets from the environment. See
[`facilitator/config/self-hosted.yaml`](facilitator/config/self-hosted.yaml) — it is commented
throughout.

---

## Choosing a search profile

Search is the part most catalogs leave unimplemented, so it is configurable rather than fixed.
Set `FACILITATOR_CONFIG` in `.env`:

| profile | embeddings | external calls | notes |
|---|---|---|---|
| **local** (default) | `BAAI/bge-m3` via ONNX, 1024-dim | none | larger image, slower cold start |
| **remote** | any OpenAI-compatible endpoint | yes | fast start, needs an API key |
| **lexical only** | none | none | smallest footprint, keyword ranking only |

The local runtime (`@huggingface/transformers`) is an **optional peer dependency**. If it is not
installed the facilitator still boots, serves lexical results, and `/health/ready` reports exactly
what is missing rather than failing opaquely.

To use a remote provider, point it anywhere OpenAI-compatible:

```dotenv
FACILITATOR_CONFIG=config/railway.yaml
FACILITATOR_EMBEDDING_URL=https://openrouter.ai/api/v1/embeddings
FACILITATOR_EMBEDDING_API_KEY=sk-...
```

Changing the embedding model creates a **new index generation** and reindexes, rather than mixing
vectors across models. Nothing silently degrades.

---

## Running without payments

Both services run discovery-only when no signing material is configured:

- Leave `STELLAR_*_SPONSOR_SECRET` unset — the facilitator verifies and catalogs but never settles.
- Leave `MCP_SIGNER_ENCRYPTION_KEY` and `STELLAR_SECRET_KEY` unset — the MCP server exposes
  `x402_search_resources` and `x402_get_resource` only.

This is the right default for a public discovery mirror.

---

## Endpoints

**Facilitator** (`:4022`)

| path | purpose |
|---|---|
| `/health/live`, `/health/ready` | liveness, readiness |
| `/supported` | schemes, networks, signers |
| `/verify`, `/settle` | x402 core |
| `/discovery/resources` | catalog search — `q`, `limit`, `offset`, filters |
| `/analytics/v1/search/status` | index generation, worker, queue depth |

**MCP** (`:4522`)

| path | purpose |
|---|---|
| `/healthz` | status, payment mode, networks |
| `/readyz` | readiness |
| `/mcp` | streamable HTTP transport |

---

## Repository layout

```
facilitator/    x402 facilitator, Bazaar catalog, search
mcp-server/     MCP discovery server
packages/       @openx402/bazaar-sdk
deploy/         deployment guides
examples/       sample paid services
```

### Other branches

`main` carries only what you need to run the stack. Development material lives elsewhere:

| branch | contents |
|---|---|
| `full-stack` | everything — plus `frontend/` (Next.js explorer), `brand/`, `tasks/`, `reference/` |
| `assets/brandkit` | brand assets and guidelines |

The explorer dashboard is **not required** to self-host — the facilitator and MCP server are
complete without it.

---

## Development

```bash
cd facilitator && npm install && npm test
cd mcp-server  && npm install && npm test
```

Integration tests need a PostgreSQL instance with `pgvector`. `docker compose up -d postgres`
provides one.

---

## License

Apache-2.0. See [LICENSE](LICENSE).

Third-party model weights are covered by their own licenses — `BAAI/bge-m3` is MIT, distributed via
the `Xenova/bge-m3` ONNX export and pinned by commit SHA.
