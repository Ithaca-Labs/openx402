[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/uKrE3J?referralCode=z2BTcK&utm_medium=integration&utm_source=template&utm_campaign=generic)

# openx402

A permissively licensed, self-hostable [x402 v2](https://github.com/x402-foundation/x402)
facilitator for Stellar, with Bazaar cataloging, hybrid discovery, a seller metadata SDK,
and an optional agent-facing MCP server.

The system is designed around two constraints: operators control their infrastructure and
quality settings, while payment correctness remains fixed. The core deployment is one
facilitator process and one PostgreSQL instance. MCP is optional, and no second datastore is
required.

> **Release status:** the hosted profile is a public `stellar:testnet` preview. `exact` has
> canonical-client and live-chain evidence. Stellar `upto` has a working Soroban contract,
> facilitator integration, and testnet evidence, but remains a proposed scheme pending SDF
> review, x402 TSC acceptance, ABI freeze, and audit. Pubnet support is implemented but disabled
> in the checked-in profiles until those gates and pubnet fee calibration are complete.

## What ships

| Component | Purpose | Required? |
| --- | --- | --- |
| [`facilitator/`](facilitator/) | `/verify`, `/settle`, `/supported`, Bazaar discovery, search, analytics, fee sponsorship | Yes |
| PostgreSQL 17 + pgvector | Durable protocol state, keys, channel leases, sponsor budgets, catalog, search vectors | Yes |
| [`mcp-server/`](mcp-server/) | Agent-facing Bazaar search and optional guarded paid MCP execution | No |
| [`@openx402/bazaar-sdk`](packages/bazaar-sdk/) | Typed seller helpers that emit the official Bazaar wire format | Seller-side only |
| [`x402-stellar-upto/`](x402-stellar-upto/) | Proposed Stellar `upto` specification, Soroban contract, tests, and evidence | Required for `upto` |

The facilitator never executes seller code. The seller SDK is a library, not a hosted service.
The MCP server communicates with the facilitator only through its public discovery API.

## Architecture

```text
Buyer / canonical x402 client
              |
              | POST /verify, POST /settle
              v
     +-----------------------+
     | Stellar facilitator   |
     |                       |
     | exact + upto          |
     | Bazaar cataloger      |
     | search/index worker   |
     | analytics API         |
     +-----------+-----------+
                 |
                 v
       PostgreSQL + pgvector
       keys, leases, budgets,
       idempotency, catalog,
       vectors, payment facts

Agents ----> optional MCP server ----> public discovery endpoints
Sellers ---> Bazaar SDK -----------> standard 402 metadata
```

All cross-replica coordination lives in PostgreSQL. The facilitator process is otherwise
stateless and can be replicated with a shared database and encryption key.

## Deploy on Railway

The template creates three services:

1. `Postgres`: private `pgvector/pgvector:pg17` with a persistent volume.
2. `Facilitator`: public HTTP service using remote embeddings.
3. `MCP`: public, discovery-only Streamable HTTP server.

Railway generates the database password and facilitator encryption key. You supply one external
credential:

```text
OPENROUTER_API_KEY
```

The hosted profile calls OpenRouter's OpenAI-compatible embeddings endpoint with
`openai/text-embedding-3-small`. It does not download model weights. Reranking is disabled.
If the embedding provider is unavailable, discovery falls back to PostgreSQL full-text search;
payment routes remain available.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/uKrE3J?referralCode=z2BTcK&utm_medium=integration&utm_source=template&utm_campaign=generic)

Deployment details and the production checklist are in
[`deploy/railway/README.md`](deploy/railway/README.md).

## Self-host with Docker

Requirements:

- Docker Engine with Compose v2
- Approximately 2 GB of free disk for images and PostgreSQL
- No Stellar account and no hosted API account for the default testnet setup

```bash
git clone https://github.com/Ithaca-Labs/openx402.git
cd openx402
cp .env.example .env

# Put these values in .env.
openssl rand -hex 16
openssl rand -base64 32

docker compose up --build -d
```

The first value is `POSTGRES_PASSWORD`. The second is
`FACILITATOR_KEY_ENCRYPTION_KEY`. These are local secrets, not external accounts.

The testnet profile creates the facilitator sponsor and channel accounts, encrypts them in
PostgreSQL, and funds them through Friendbot on first boot. That behavior is testnet-only and is
rejected for pubnet.

Check the stack:

```bash
curl -fsS http://localhost:4022/health/ready
curl -fsS http://localhost:4022/supported
curl -fsS 'http://localhost:4022/discovery/resources?limit=5'
curl -fsS 'http://localhost:4022/discovery/search?query=weather&limit=5'
curl -fsS http://localhost:4522/healthz
```

The stock facilitator image does not contain the optional ONNX runtime or model weights. It
therefore serves lexical search with no model download when using `config/self-hosted.yaml`.
Install `@huggingface/transformers` in a custom image to enable the pinned local BGE-M3 profile,
or configure any OpenAI-compatible remote embedding endpoint. Search degradation is reported by
`/health/ready` and through search observability; it never makes the facilitator unready.

To run only the required core services:

```bash
docker compose up --build -d postgres facilitator
```

## Protocol surface

### Facilitator

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health/live` | Process liveness |
| `GET` | `/health/ready` | Database readiness and search-provider status |
| `GET` | `/supported` | Enabled x402 v2 schemes, networks, signers, extensions, and `areFeesSponsored` |
| `POST` | `/verify` | Verify the canonical `{ paymentPayload, paymentRequirements }` request |
| `POST` | `/settle` | Re-verify, sponsor, submit, poll, and return the canonical settlement response |
| `GET` | `/discovery/resources` | Bazaar browse endpoint with structured filters and cursor pagination |
| `GET` | `/discovery/search` | Ranked Bazaar search |
| `GET` | `/discovery/resource` | Resolve one canonical HTTP or MCP resource identity |
| `GET` | `/analytics/v1/*` | Operator and dashboard data modeled after the public x402scan surface |

`/discovery/*` is public and contains only Bazaar-compatible resource data. `/analytics/v1/*`,
`/verify`, `/settle`, and `/supported` share the configured bearer authentication policy.
The testnet preview intentionally leaves that policy open for canonical-client interoperability;
pubnet startup requires API authentication.

Discovery filters are `type`, `network`, `scheme`, `payTo`, and `extensions`. This implementation
also exposes `asset` as a documented, non-standard filter pending an upstream proposal. It does
not implement a private price filter because price semantics belong in the Bazaar specification.

### Exact settlement

1. Parse the Stellar transaction from the specification's `{ transaction }` payload.
2. Reject client-controlled sources, operation sources, facilitator-as-payer, extra operations,
   malformed auth, wrong recipient, wrong asset, wrong amount, or extra sub-invocations.
3. Run record-mode simulation to establish the footprint.
4. Run enforcing simulation with the signed auth entry so custom `__check_auth` logic executes.
5. Apply resource, inclusion, and total fee ceilings to the enforcing result.
6. Require the exact expected token transfer events.
7. At settlement, repeat verification, lease a channel account, rebuild the transaction, wrap it
   in a sponsor-signed fee bump, persist the envelope and hash, then submit.

### Stellar `upto`

The proposed scheme ships a Soroban settlement contract. SEP-41 allowance alone is not the v1
trust model because it cannot provide the required recipient binding and terminal single-use
settlement behavior.

The payer authorization binds payer, recipient, token, maximum, ledger window, facilitator,
settlement ID, optional versioned settlement hook, settlement contract, and Stellar network. The
facilitator alone selects `actual`, with `0 <= actual <= maximum`.

Settlement atomically:

1. Requires allowance equal to the authorized maximum.
2. Pulls the maximum.
3. Pays the actual amount.
4. Refunds `maximum - actual`.
5. Leaves zero allowance and checks the required token/event deltas.

An actual amount of zero still submits a real contract transaction. This consumes the Stellar
authorization nonce and returns a real transaction hash. Failed transactions revert all contract
and token changes; a failed authorization may be retried while it remains valid. Concurrent
facilitators race on the same host nonce, so at most one succeeds.

The optional settlement hook fires after payment/refund, including for zero settlement. It is
versioned, allowlisted, rejected when it equals the settlement or token contract, and runs inside
enforcing simulation and the facilitator's fee gate. Hook failure is the payer's availability
risk because the payer selected it. The default path has no hook.

The hook can reconcile a smart-account policy that conservatively reserves `maximum` during
authorization and releases `maximum - actual` after settlement. OpenZeppelin composition uses two
correlated context rules: one for the settlement contract root and one for the nested SEP-41
`approve` invocation. The reference reconciling policy is optional and off the payment-critical
release path.

The `upto` trust boundary is explicit: it prevents collection above the signed maximum, but it
does not prove that a seller's reported usage or chosen actual amount is honest.

The reference settlement contract is immutable. It has no constructor, administrator, upgrade
entrypoint, pause switch, token allowlist, or application-defined persistent state. A replacement
is deployed at a new address and selected through facilitator/network configuration. Contract
instance and Wasm entries still have Stellar TTL and rent, so operators must monitor and extend
both entries or restore them after archival.

Read the proposed [Stellar `upto` specification](x402-stellar-upto/spec/scheme_upto_stellar.md),
[SDF review brief](x402-stellar-upto/docs/SDF_REVIEW.md), and
[threat model](x402-stellar-upto/docs/THREAT_MODEL.md).

## Fee sponsorship and failure handling

The facilitator rebuilds the inner transaction with a leased channel account as source. The
channel signs the inner envelope and the sponsor signs the fee-bump envelope, so the buyer needs
only the payment asset. The facilitator pays network fees but is never payer, recipient, or
custodian of seller funds.

Sponsor abuse controls include:

- enforcing-simulation resource, inclusion, and total fee ceilings;
- per-principal and database-backed global daily sponsored-fee budgets;
- simulation rate and concurrency limits;
- bounded pending settlements and submission retries;
- an operator maximum for seller-selected `maxTimeoutSeconds`;
- settlement-hook allowlisting and fee measurement;
- separate exact and `upto` fee profiles.

A PostgreSQL channel pool removes the single-source-account sequence bottleneck. Replicas lease
accounts using row locks and fencing tokens. Before submission, the exact signed envelope and hash
are persisted with the sponsor-budget reservation. If an RPC response is lost, the facilitator
polls the known hash and quarantines the channel until the transaction becomes `SUCCESS` or
`FAILED`; it never rebuilds an unknown settlement with a new sequence number.

The standard `payment-identifier` extension provides request-level idempotency. Identical IDs and
normalized fingerprints return the cached result. Reusing an ID with different payment terms is
rejected with HTTP 409.

## Bazaar cataloging

Cataloging is automatic when a successfully verified or settled payment carries the official
`bazaar` extension. The configured `index_on` stage controls whether verification activates a
listing immediately or settlement is required.

Cataloging happens after the payment decision and is soft-failing. Invalid metadata returns an
official `EXTENSION-RESPONSES` value with `bazaar.status = "rejected"`; it cannot turn a valid
payment into a 5xx.

Seller metadata is untrusted. The facilitator:

- validates with the official `@x402/extensions/bazaar` helpers and JSON Schema 2020-12;
- bounds metadata size, depth, descriptions, schemas, examples, tags, and URLs;
- percent-decodes route templates before traversal checks;
- strips control and bidirectional formatting characters from indexed/display text;
- never fetches seller icon URLs;
- stores provenance as `seller_declared`;
- prevents a different `payTo` from silently taking over an existing listing;
- keys MCP resources by `(resource.url, input.toolName)`;
- keeps append-only resource versions and payment options;
- demotes stale listings from default discovery results.

`payment_observed` proves that this facilitator validated payment terms bound to the listing. It
does not prove origin ownership, description accuracy, or endpoint quality. See the complete
[catalog trust boundary](facilitator/docs/CATALOG-TRUST.md).

## Search

The search pipeline is:

```text
structured filters
      |
PostgreSQL FTS + pgvector candidates
      |
weighted reciprocal rank fusion
      |
optional reranker
      |
deterministic origin diversity and pagination
```

PostgreSQL full-text search uses `ts_rank_cd`; it is not described as BM25. Vector and lexical
scores are never compared directly. RRF combines rank positions, avoiding provider-specific score
normalization.

Embedding identity includes model ID, immutable revision, dimension, pooling, normalization, and
optional artifact checksum. One model generation is active per index. Changing any identity field
creates a new generation and explicit reindex rather than mixing incompatible vectors.

The embedding worker uses the same PostgreSQL database for durable jobs, leases, fencing,
backoff, and dead-letter state. No Redis, external queue, or dedicated vector database is needed.

Degradation is deliberate:

| Available components | Effective search |
| --- | --- |
| Lexical + vector + reranker | Hybrid retrieval, then reranking |
| Lexical + vector | Hybrid retrieval |
| Lexical only | PostgreSQL full-text search |

An LLM never writes or rewrites catalog metadata. Search text is compiled deterministically from
seller-declared fields and normalized payment terms. Read
[`facilitator/docs/SEARCH.md`](facilitator/docs/SEARCH.md) for provider and indexing details.

## Seller integration

Install the published helper:

```bash
npm install @openx402/bazaar-sdk
```

```ts
import { bazaar } from "@openx402/bazaar-sdk";

const weather = bazaar.http({
  description: "Returns the current weather for a city.",
  serviceName: "Weather API",
  tags: ["weather", "forecast"],
  method: "GET",
  query: {
    city: {
      type: "string",
      description: "City name, such as Mumbai or London.",
      required: true,
      example: "Mumbai",
    },
  },
  output: {
    type: "json",
    example: { city: "Mumbai", temperature: 29, condition: "Sunny" },
  },
});

// Put weather.resource and weather.extensions into the standard x402 402 response.
```

The helper delegates to the official Bazaar builder and adds no proprietary wire fields. MCP
metadata reuses the tool's existing `inputSchema`. See the
[`@openx402/bazaar-sdk` guide](packages/bazaar-sdk/README.md) and the
[paid Rock Paper Scissors example](examples/rock-paper-scissors/README.md).

## MCP discovery

The hosted MCP endpoint is discovery-only:

```json
{
  "mcpServers": {
    "openx402": {
      "url": "https://mcp-production-e242.up.railway.app/mcp"
    }
  }
}
```

It registers:

- `x402_search_resources`
- `x402_get_resource`

`x402_call_resource` is registered only when the operator configures a payer signer. A remote MCP
server with a signer must use authentication, a durable PostgreSQL budget store for pubnet, strict
network limits, and explicit pubnet enablement. The server allows one automatic paid retry and
reuses the same payment identifier for network retries.

See [`mcp-server/README.md`](mcp-server/README.md) for the deterministic error contract, SSRF
controls, signer modes, transport options, and smart-account budget composition.

## Configuration

Configuration is YAML selected by `FACILITATOR_CONFIG`, with secrets referenced indirectly through
environment-variable names. Start from:

- [`facilitator/config/self-hosted.yaml`](facilitator/config/self-hosted.yaml)
- [`facilitator/config/railway.yaml`](facilitator/config/railway.yaml)
- [`mcp-server/config/self-hosted.yaml`](mcp-server/config/self-hosted.yaml)
- [`mcp-server/config/railway.yaml`](mcp-server/config/railway.yaml)

Operators can configure networks, asset allowlists, RPC endpoints, sponsor and channel keys,
timeouts, fee ceilings, payment limits, search providers, model identities, ranking weights,
indexing cadence, pagination, authentication, sponsor budgets, concurrency, retention, and address
redaction. Every key and default is documented in the
[configuration reference](facilitator/docs/CONFIGURATION.md).

The following are deliberately not configurable because they define correctness or compatibility:

- x402 v2 wire shapes and non-null rejection reasons;
- payer, recipient, asset, network, settlement-contract, amount, and facilitator binding;
- `actual <= maximum`, exact auth trees, signature validation, and ledger-clock ordering;
- record simulation followed by enforcing simulation and fee checks;
- expected exact transfer and `upto` pull/pay/refund deltas;
- durable hash-before-submit, channel fencing, and poll-before-retry;
- real on-chain zero settlement for Stellar `upto`;
- canonical Bazaar validation, identity, provenance, and soft-failure behavior;
- one active embedding model generation and deterministic seller-derived search text.

## Pubnet activation

Pubnet does not silently inherit testnet defaults. Before enabling `stellar:pubnet`, an operator
must provide:

1. An audited, frozen `upto` contract deployment if `upto` will be advertised.
2. A funded sponsor key and the configured number of funded channel keys.
3. API authentication for sponsor-bearing routes.
4. An asset allowlist with correct contract IDs and decimals.
5. Measured pubnet p99 fee ceilings for each scheme, supported account class, and allowed hook.
6. Contract instance/Wasm TTL monitoring, backup and restore procedures, and key rotation runbooks.

Startup fails closed when pubnet requirements are incomplete. Friendbot and automatic key funding
are never allowed on pubnet.

## Security and operations

- Managed Stellar keys are encrypted with AES-256-GCM using network and address as authenticated
  data.
- All replicas must share PostgreSQL and `FACILITATOR_KEY_ENCRYPTION_KEY`.
- Key rotation refuses to proceed while settlements are unresolved.
- PostgreSQL migrations are forward-only and run before the HTTP listener starts.
- Back up with `pg_dump` and restore with `pg_restore` before starting replicas against a restored
  database.
- Rotate encryption material with an offline re-encryption procedure. Changing the environment
  value under existing ciphertext makes stored keys unreadable.
- Monitor channel and sponsor balances, unresolved settlements, simulation failures, rejected fees,
  sponsor-budget consumption, RPC latency, index backlog, stale resources, and contract/Wasm TTL.

Security boundaries are detailed in:

- [`facilitator/docs/CATALOG-TRUST.md`](facilitator/docs/CATALOG-TRUST.md)
- [`x402-stellar-upto/SECURITY.md`](x402-stellar-upto/SECURITY.md)
- [`x402-stellar-upto/docs/THREAT_MODEL.md`](x402-stellar-upto/docs/THREAT_MODEL.md)
- [`mcp-server/docs/SMART-ACCOUNTS.md`](mcp-server/docs/SMART-ACCOUNTS.md)

Report vulnerabilities privately through the repository's GitHub security advisory flow. Do not
include sponsor keys, payer keys, auth entries, or exploitable transaction payloads in a public
issue.

## Verification and current evidence

Run the package checks independently:

```bash
cd facilitator
npm ci
npm run typecheck
npm test
npm run build
npm run licenses
npm audit --omit=dev

cd ../mcp-server
npm ci
npm run typecheck
npm test
npm run build
npm run licenses
npm audit --omit=dev

cd ../packages/bazaar-sdk
npm ci --workspaces=false
npm test
npm run typecheck
npm run build

cd ../../x402-stellar-upto
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

Integration tests require PostgreSQL. Live tests intentionally submit Stellar testnet
transactions and must never be run with valuable keys.

Recorded testnet evidence:

| Flow | Transaction hash |
| --- | --- |
| Canonical x402 exact client | [`efa579ad...aa532`](https://stellar.expert/explorer/testnet/tx/efa579ad8a9b2fb456dcf7803955d0cf5fc32f8db33329508885f96d493aa532) |
| Exact | [`0f231cf2...770b`](https://stellar.expert/explorer/testnet/tx/0f231cf28791e5acda291d728a3837ef0d7b67baa9c45b80e1bfa764ecd5770b) |
| `upto`, partial | [`638384df...504f`](https://stellar.expert/explorer/testnet/tx/638384dfc73e28c8736a7699b04caa7920b3ea247f269a82eec1f9832f4c504f) |
| `upto`, zero | [`cc9c93d5...0cb`](https://stellar.expert/explorer/testnet/tx/cc9c93d527e125674e5db01d23d38db56aa2cf736012a1bfbcb9597525ade0cb) |
| Exact with successful Bazaar cataloging | [`3ee7fe17...1887`](https://stellar.expert/explorer/testnet/tx/3ee7fe173162619211a736a3b3c3f0b1f60b6a6ea5cb0d25f2140eca98e11887) |

The Bazaar payment returned `bazaar.status = "success"` through
`EXTENSION-RESPONSES`, then appeared in both discovery endpoints. The official x402 E2E runner
passed with its unmodified exact TypeScript client. Upstream does not yet ship a canonical Stellar
`upto` client, so the live `upto` fixture is not presented as official-suite conformance.

No pubnet transaction hash or official pubnet E2E pass is claimed yet. Remaining specification and
release gates are tracked in
[`x402-stellar-upto/docs/RELEASE_GAPS.md`](x402-stellar-upto/docs/RELEASE_GAPS.md).

### Conformance checklist

| Acceptance item | Current state |
| --- | --- |
| Unmodified canonical client completes exact on testnet | Passed, hash published above |
| Unmodified canonical client completes exact on pubnet | Pending pubnet activation |
| Canonical client completes `upto` on testnet | Wire-compatible live fixture passed; reusable upstream client does not exist yet |
| Canonical client completes `upto` on pubnet | Pending upstream client, review, audit, and pubnet activation |
| `/supported` emits Stellar `extra.areFeesSponsored` | Passed for each enabled scheme |
| Specification `{ transaction }` payload accepted verbatim | Implemented and covered by facilitator tests |
| Non-null rejection reason on rejection | Implemented and covered by rejection-path tests |
| Official x402 E2E suite, testnet exact | Passed |
| Official x402 E2E suite, both schemes and networks | Pending upstream Stellar `upto` support and pubnet deployment |

During the grant period, x402 packages remain pinned at reviewed versions. Upstream specification,
SDK, E2E fixture, and Bazaar changes must be reviewed as explicit dependency updates, followed by
wire snapshots, package tests, official E2E tests, and fresh network evidence before release.

### Remaining release path

1. Complete SDF review of the Stellar `upto` authorization tree, contract ABI, ledger clocks,
   settlement hook, and lifecycle.
2. Close the measured release gaps, freeze the ABI and reproducible Wasm, then complete an
   external contract/facilitator security review.
3. Submit `scheme_upto_stellar.md` and the reusable client/facilitator integration to the x402 TSC.
4. Deploy the audited identical Wasm to pubnet and measure production fee distributions.
5. Enable pubnet with funded channels, authenticated access, calibrated budgets, monitoring, and
   published exact/`upto` transaction hashes.
6. Run the unmodified official x402 E2E suite for every supported network and scheme.

The optional dashboard, standalone paid-agent distribution, unusual SEP-41 token variants,
batch settlement, and authorization capture remain outside the payment-critical release path.

## Repository layout

```text
.
|-- facilitator/             payment core, Bazaar, search, analytics
|-- mcp-server/              optional agent-facing MCP service
|-- packages/bazaar-sdk/     published seller metadata helper
|-- x402-stellar-upto/       proposed spec, contracts, tests, evidence
|-- examples/                seller and payment examples
|-- deploy/railway/          hosted deployment guide
|-- docker-compose.yml       self-hosted deployment
|-- .env.example             operator environment template
`-- LICENSE                  Apache-2.0
```

## Project documents

| Subject | Document |
| --- | --- |
| Facilitator design and live evidence | [`facilitator/README.md`](facilitator/README.md) |
| Complete configuration surface | [`facilitator/docs/CONFIGURATION.md`](facilitator/docs/CONFIGURATION.md) |
| Bazaar trust, identity, updates, and liveness | [`facilitator/docs/CATALOG-TRUST.md`](facilitator/docs/CATALOG-TRUST.md) |
| Search and indexing architecture | [`facilitator/docs/SEARCH.md`](facilitator/docs/SEARCH.md) |
| x402scan-equivalent analytics inventory | [`facilitator/docs/X402SCAN-INVENTORY.md`](facilitator/docs/X402SCAN-INVENTORY.md) |
| Stellar `upto` proposal | [`x402-stellar-upto/spec/scheme_upto_stellar.md`](x402-stellar-upto/spec/scheme_upto_stellar.md) |
| Contract review package | [`x402-stellar-upto/README.md`](x402-stellar-upto/README.md) |
| MCP architecture and operation | [`mcp-server/README.md`](mcp-server/README.md) |
| Railway deployment | [`deploy/railway/README.md`](deploy/railway/README.md) |
| Dependency licenses | [`facilitator/THIRD_PARTY_LICENSES.md`](facilitator/THIRD_PARTY_LICENSES.md) |

## License

Apache-2.0. See [`LICENSE`](LICENSE).

The runtime dependency tree is checked against a permissive-license allowlist. AGPL components,
including OpenZeppelin Relayer and its x402 plugin, are not used. Model weights have separate
licenses: BAAI/bge-m3 is MIT, and the local runtime is optional rather than a required dependency.
