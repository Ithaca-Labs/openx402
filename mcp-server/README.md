# @openx402/mcp-server

Optional, separately deployable agent-facing MCP server for the Stellar x402
facilitator. It searches the facilitator's public Bazaar catalog and runs a
guarded discover → challenge → check → pay → retry loop against cataloged
paid MCP tools on an agent's behalf, under its own client-side budget and
network-security policy.

It is **not** part of the facilitator's payment-critical process: it depends
on the facilitator only through its public, documented HTTP API
(`/discovery/resources`, `/discovery/search`, `/discovery/resource`), never
imports `facilitator/src/*`, and never touches the facilitator's database
directly. MCP catalog validation and indexing stay in `facilitator/` — this
package only *consumes* that catalog and *executes* payments against it.

Not required for the facilitator to start. Operators who don't need
agent-facing MCP leave it disabled.

## Tools

| Tool | Purpose |
|---|---|
| `x402_search_resources` | Canonical Bazaar search/browse (query, filters, limit, cursor) — returns the untouched canonical resource plus a trust wrapper (`ref`, `versionHash`, `provenance`, `status`, `warnings`) per item. |
| `x402_get_resource` | Fetch the current canonical resource + payment options by stable `ref` (never an arbitrary URL), with an optional `expectedVersionHash` staleness check. |
| `x402_call_resource` | Registered only when a signer is configured. Runs the guarded discover-pay-retry loop against one active, cataloged MCP tool: unpaid probe → dual-copy `PaymentRequired` validation → catalog match → budget reservation → sign → paid retry → settlement validation → upstream output + a structured receipt. |

All amounts are decimal-string atomic units, parsed to `bigint` everywhere —
never `JavaScript number` — see `src/budget/budgetPolicy.ts`.

### Error contract

Every tool failure is deterministic, versioned JSON:
`{ schemaVersion: 1, code, message, retryable, details? }`. `code` is one of
the eleven stable values in `src/errors.ts`
(`INVALID_ARGUMENT`, `NO_RESULTS`, `RESOURCE_STALE`, `RESOURCE_CHANGED`,
`UNTRUSTED_REDIRECT`, `PAYMENT_REQUIRED`, `BUDGET_EXCEEDED`,
`PAYMENT_REJECTED`, `SETTLEMENT_UNKNOWN`, `UPSTREAM_TIMEOUT`,
`UPSTREAM_PROTOCOL_ERROR`). Clients branch on `code` only — `message` may
change across releases. `SETTLEMENT_UNKNOWN` is retryable only by *polling*
settlement status, never by authorizing a second payment.

## Transports

- **stdio** — default, for local agent runtimes. May read a Stellar secret
  directly from an environment variable (`signer.mode: env-secret`).
- **Streamable HTTP** (`POST/GET/DELETE /mcp`) — the primary network
  transport.
- **SSE** (`GET /sse`, `POST /messages`) — kept only for compatibility with
  existing x402 E2E fixtures; prefer Streamable HTTP for new integrations.

`GET /healthz` reports `{ status, discovery: "ready", payments: "ready" | "disabled", networks }` so an operator can tell at a glance whether paid
calls are actually possible, distinct from discovery working.

## Security decisions

- **No secret ever arrives as a tool argument.** The zod schemas in
  `src/tools/index.ts` simply have no such field. A `SignerProvider`
  (`src/payment/signerProvider.ts`) supplies key material: `env-secret`
  (stdio only), `external` (delegates signing to a remote HTTPS service —
  the raw key never enters this process), or `encrypted-key` (AES-256-GCM
  keystore decrypted with a key from an env var, mirroring the
  facilitator's own `FACILITATOR_KEY_ENCRYPTION_KEY` convention).
- **Remote transports fail closed.** `config.ts` refuses to start if a
  signer is configured on a non-stdio transport with no bearer API keys
  configured — this package never runs an anonymously accessible payment
  tool holding a payer key. Discovery-only deployments (no signer) need no
  API key at all ("no required API key for public search").
- **`stellar:pubnet` fails closed independently**, at request time in
  `tools/callResource.ts`: a pubnet call is rejected unless the network is
  explicitly enabled, the transport is authenticated (or stdio), and the
  budget store is durable (Postgres) on any non-stdio transport.
- **SSRF-hardened outbound connections** (`src/network/safeFetch.ts`,
  `mcpConnection.ts`): DNS is resolved once and the resulting IP is pinned
  for every socket of that request (closes the DNS-rebinding TOCTOU
  window); loopback, RFC1918/ULA, link-local (incl. `169.254.169.254` cloud
  metadata) and multicast ranges are blocked for IPv4 and IPv6; HTTPS is
  required unless `network_security.allow_insecure_local` is set (local
  dev/test only); redirects are same-origin-only for the discovery client
  and capped; response bytes, JSON depth, timeouts and concurrency are all
  bounded. Liveness/catalog checks use `initialize` + `tools/list` only —
  `tools/call` is never used as a probe, since a broken payment guard could
  execute the tool for real.
- **`mcp://` logical identifiers are not connectable** on their own (the
  Bazaar extension spec's own example resource,
  `mcp://tool/financial_analysis`, names a tool inside an already-established
  session, not a dialable address) — rejected unless the operator has
  explicitly mapped it to a verified HTTPS endpoint in
  `network_security.resolved_mcp_endpoints`.
- **Untrusted seller content stays inert data.** Descriptions, schemas and
  tool output are never concatenated into any instruction, never used to
  generate follow-up calls, never summarized by an LLM. See
  `tests/unit/promptInjection.test.ts`.
- **One official Payment Identifier per invocation**, deterministic from
  the resource reference, version hash, chosen terms and a per-invocation
  nonce (`src/payment/paymentIdentifier.ts`). Only one automatic paid retry
  ever happens; a network-level retry reuses the identical identifier and
  already-signed payload — never a fresh authorization. `SETTLEMENT_UNKNOWN`
  keeps the full budget reservation until a poll resolves it.
- **No reusable Stellar `upto` client exists upstream** (checked against
  `@x402/stellar`, the full upstream x402 monorepo, and this repo's own
  `x402-stellar-upto` project, which ships only a private, unpublished test
  harness). `src/payment/schemeRegistry.ts` keeps the `SchemeNetworkClient`
  interface ready and fails closed with `UptoUnavailableError` /
  `PAYMENT_REJECTED` rather than silently downgrading to `exact` or
  hand-rolling a signer.

See `docs/SMART-ACCOUNTS.md` for the OpenZeppelin smart-account model and
why the runtime budget, the signed x402 maximum, and on-chain policy are
three independent ceilings.

## Configuration

Layered like the facilitator's own config: `config/self-hosted.yaml` +
`*_env`-indirected secrets + a `FACILITATOR_URL`/`PORT` env override. See
the comments in `config/self-hosted.yaml` for every field. Fail-closed
validation happens once, at startup, in `src/config.ts`.

`config/railway.yaml` is the public hosted discovery profile. It uses
Streamable HTTP with `signer.mode: none`, so only search/get are registered and
no MCP API key is needed. See `../deploy/railway/README.md`.

## Running it

```bash
npm ci
npm run build
FACILITATOR_URL=http://localhost:4022 npm start        # stdio, discovery-only
```

Docker Compose (opt-in, never required for the facilitator):

```bash
cd ../facilitator
docker compose --profile mcp up
```

The Compose service selects `config/railway.yaml` because a container needs
Streamable HTTP. `config/self-hosted.yaml` remains the stdio profile for an MCP
process launched directly by a local agent runtime.

## Verification

```bash
npm run typecheck
npm run build
npm test                 # unit (tests/unit) -- fast, no external services
npm run test:integration  # tests/integration -- needs PostgreSQL at MCP_TEST_DATABASE_URL
npm run test:e2e          # tests/e2e -- MCP protocol/transport smoke tests
npm run licenses           # allowlist-checks every locked dependency's license
npm audit --omit=dev
```

Integration tests need PostgreSQL at `MCP_TEST_DATABASE_URL` (default
`postgresql://sachplayz:test@127.0.0.1:55432/mcp_server_test` in this dev
environment; adjust the user for yours). Any Postgres 14+ works — pgvector
is not required, since this package's own schema (`migrations/`) has no
vector columns.

### Live testnet flow

`examples/testnet-e2e` runs the real 8-step flow end to end: unpaid call →
pay via the stock `@x402/mcp` client + `@x402/stellar` exact client → settle
through a real facilitator → confirm `_meta["x402/payment-response"]` →
confirm auto-catalog → find via `/discovery/resources` + `/discovery/search`
→ find and invoke via `x402_search_resources` + `x402_call_resource`. See
that package's README/script comments for how to run it against a local
facilitator + `examples/seller`. It submits one real `stellar:testnet`
transaction; it never touches `stellar:pubnet`.

## What's not here

- Stellar `upto` payments: interface-ready, reported blocked (see above).
  Not a canonical-conformance claim.
