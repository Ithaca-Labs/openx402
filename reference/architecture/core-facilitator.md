# Core Facilitator

## Service decomposition

The deployable is a modular monolith with explicit internal interfaces:

| Module | Responsibility |
| --- | --- |
| Wire adapters | Canonical HTTP `/verify`, `/settle`, `/supported`, Bazaar endpoints, MCP transport, and response headers |
| Protocol kernel | x402 version dispatch, scheme registry, schema parsing, stable rejection mapping |
| Stellar mechanisms | Exact and `upto` payload/auth-tree verification and transaction construction |
| Settlement orchestrator | Idempotency state machine, simulations, fee checks, channel allocation, submission, recovery |
| Sponsor manager | Channel leases, encrypted signers, rotations, fee reservations, daily budgets |
| Catalog | Bazaar validation, provenance, origin probing, versioning, liveness |
| Search/indexing | Durable jobs, canonical text, embeddings, FTS/vector retrieval, RRF, reranking |
| Analytics | Settlement and catalog read models for dashboard-compatible views |
| Operations | Configuration, health/readiness, metrics, logs, traces, migrations, scheduled jobs |

Each module is a package with no transport knowledge below the wire-adapter
layer. PostgreSQL is accessed through repositories with transaction boundaries
owned by the calling workflow. This permits a future operator to split modules,
but avoids imposing a broker or second datastore on every self-host.

The buyer is always the token payer in the signed Soroban invocation. A channel
account is the rebuilt inner transaction source and consumes its sequence; a
separate sponsor key signs the fee-bump envelope and pays XLM. The fee-bump
source has no transaction sequence bottleneck. Neither account becomes the
payment source or can redirect signed token movement, and the buyer needs no
XLM. The settlement contract holds tokens only transiently inside one atomic
invocation; the facilitator never takes custody.

## `/supported`

The response is generated from the schemes that passed startup readiness, not
merely from configuration. Each enabled network publishes exact and `upto`
entries with:

```json
{
  "x402Version": 2,
  "scheme": "upto",
  "network": "stellar:testnet",
  "extra": { "areFeesSponsored": true }
}
```

It also reports the canonical extension and signer fields required by the
current x402 schema. No contract ID, fee limit, API-key policy, or search feature
is added to this object. A contract ID is selected by the versioned Stellar
mechanism package and normative scheme document.

An unready network is not advertised. If pubnet is configured but keys, budgets,
contract health, fee calibration, or RPC quorum are missing, startup fails
closed rather than silently removing pubnet.

## Extensions and transports

The extension registry uses the upstream parsers and mutation rules:

- Bazaar is validated and cataloged as described in the Bazaar document;
- `payment-identifier`, when present, is stored as a correlation/idempotency
  hint but never replaces the Soroban credential nonce or authorization ID;
- offer-and-receipt can strengthen catalog provenance and settlement evidence
  without changing payment correctness;
- auth hints remain seller hints and never relax signer/auth-tree validation;
- HTTP message signatures are verified/preserved by the canonical transport and
  are not repurposed as Stellar authorization.

`/supported` advertises only extensions whose canonical implementation is
enabled and passing fixtures. HTTP and MCP are Phase 1 transports. A2A can use
the same transport-neutral protocol kernel later, but is not silently claimed
as a grant deliverable.

## `/verify`

End-to-end ordering is client record-mode simulation, client auth-entry signing,
facilitator record-mode reconstruction, facilitator enforcing-mode simulation,
fee gate, rebuild/sign, and submit. No facilitator signature or submission
occurs before the signed enforcing result passes.

The common flow is:

1. Strictly parse the request and reject unknown protocol versions, network,
   scheme, malformed XDR, non-canonical addresses, and unsupported assets.
2. Match the payload to the complete `PaymentRequirements`: network, asset,
   payee, scheme, maximum or exact amount, timeout, and Stellar contract.
3. Reject any client-controlled transaction source or operation source that
   would survive reconstruction. Exact permits the one canonical invoke-host
   transfer. `upto` permits only the normative settlement tree and its exact
   SEP-41 sub-invocations.
4. Validate the payer, signatures, credential type, nonce, expiration, auth-tree
   shape, signer address, invocation arguments, and absence of extra
   sub-invocations. The facilitator cannot be the payer.
5. Validate current ledger time/sequence, operator maximum timeout, maximum
   payment, asset support, payer balance, and recipient ability to receive.
   A missing G-account trustline is rejected here, not deferred to settlement.
6. Rebuild a read-only candidate with current ledger state. Record-mode
   simulation is used only to obtain/refresh footprint and resource data.
7. Re-simulate in enforcing mode with the signed auth entries. Apply resource,
   inclusion, and total fee ceilings to the enforcing result, never the
   record-mode estimate.
8. Validate the simulated contract return value, exact transfer events, balance
   deltas, zero residual allowance, and no contract balance retained by the
   invocation.
9. Return `isValid: true`, or `isValid: false` with a non-null canonical
   `invalidReason`.
10. Independently soft-process an echoed Bazaar resource. Catalog failure never
    changes payment validity; its status is reported through
    `EXTENSION-RESPONSES`.

Record simulation is not a security gate because it does not execute custom
`__check_auth`. Enforcing simulation is mandatory for G- and C-account payers
alike, so there is no configurable fast path that can accidentally admit an
expensive smart account.

The client chooses `signatureExpirationLedger` only after recording the
invocation tree and before signing. That expiry can increase nonce rent that the
record simulation did not price. The facilitator therefore derives and checks
the permitted expiry from `maxTimeoutSeconds`, preserves the signed entry
unchanged, and applies its fee gate only after enforcing simulation sees the
final signed expiration.

## `/settle`

Settlement re-runs every payment correctness check from `/verify`; a prior
verify response is not trusted or cached as authorization.

1. Parse and derive a deterministic authorization ID from the payer credential
   nonce/root tree, excluding `actual`, and a payment fingerprint that includes
   network, scheme, requirements, the authorization ID, and actual.
2. In one PostgreSQL transaction, reserve the unique authorization ID and create
   or load the idempotency record. The first settle fixes actual. A later use
   with a different actual or request XDR is a conflict, not a retry.
3. If terminal, return the stored canonical response. If another replica owns a
   live attempt, wait briefly or return the same pending outcome internally;
   never submit a second transaction.
4. Re-verify, reserve sponsor budget atomically, and obtain a channel-account
   lease.
5. Fetch the channel's on-chain sequence while its database row is locked.
   Rebuild the complete transaction with that channel account as source. Ignore
   all client fee, source, sequence, footprint, and resource data.
6. Record-simulate to refresh resources, reconstruct the auth tree, attach the
   client's signatures, and enforcing-simulate the final invocation.
7. Validate events, return value, balances, smart-account execution cost, and
   resource/inclusion/total fee ceilings. Recheck the ledger bounds immediately
   before signing.
8. Select the inclusion fee from live network state under the configured
   ceiling. Sign the rebuilt inner transaction with the leased channel key,
   then wrap and sign the fee-bump envelope with the sponsor key.
9. Persist the exact envelope XDR, transaction hash, channel, sequence, ledger
   bounds, and sponsor reservation before sending it to RPC.
10. Submit once, poll by hash to a terminal ledger result, validate the result
    metadata, and store the canonical settle response.

The same pipeline is used for `actual = 0`; zero is not a local shortcut.

## Settlement state machine

Durable states are:

`RECEIVED -> VERIFIED -> RESERVED -> BUILT -> SUBMITTED -> SUCCESS | FAILED`

`SUBMITTED_UNKNOWN` means an RPC response was lost or providers disagree. It is
not failure and is never a reason to construct a replacement transaction.
Background reconciliation polls the stored hash across configured RPC
providers, then may rebroadcast only the byte-identical envelope. The channel
lease and sponsor reservation remain held while the result could still land.

After the transaction's ledger bounds have expired and a configured RPC quorum
reports `NOT_FOUND`, reconciliation marks it `FAILED_NOT_INCLUDED`, releases the
sequence quarantine, and returns a non-null failure reason. A client may start a
new authorization only after that terminal response.

Known pre-submission failures release the budget and lease. Confirmed successful
and failed submissions charge the budget because failed Stellar transactions
also consume fees. Unknown submissions retain their full reservation.

## Channel-account pool

Channel accounts are mandatory because a transaction source sequence serializes
submission:

- `channel_accounts` holds public key, encrypted signer reference, status,
  network, last observed sequence, lease owner, lease expiry, and balance state.
- allocation uses `SELECT ... FOR UPDATE SKIP LOCKED`, then commits a lease with
  a fencing token; all later writes require that token;
- one channel has at most one unresolved envelope;
- an unknown envelope quarantines only its channel, allowing the remaining pool
  to progress;
- sequence refresh occurs under the lease and after every `BAD_SEQ` or
  `TRY_AGAIN_LATER`;
- a retry may rebuild only when the previous attempt is proven not submitted.
  Submission uncertainty permits identical rebroadcast, never a new envelope;
- replicas coordinate entirely through PostgreSQL. Process-local mutexes are
  permitted only as an optimization;
- pool health reports available, leased, quarantined, low-balance, and draining
  channels separately.

Rotation adds new channels, waits for old channels to have no unknown attempts,
marks them draining, and removes their encrypted key references only after the
retention window. Sponsor accounts and keys use the same overlap procedure.

These fenced PostgreSQL row leases are the distributed sequence locks. They are
correct across replicas sharing the deployment database and do not rely on
sticky routing or one elected process.

## Abuse controls

The service authenticates pubnet callers and supports key and IP rate policies,
but correctness does not depend on identity. Before sponsor reservation it
enforces:

- maximum exact/max/actual amount and maximum accepted timeout;
- enforcing-simulation resource fee, inclusion fee, and total fee ceilings;
- atomic per-key and global daily sponsored-fee budgets in PostgreSQL;
- global and per-key simulation rate, concurrency, queue, and timeout limits;
- pending-settlement and per-payer concurrency limits;
- no facilitator-as-payer and no client-controlled transaction fields;
- bounded body/XDR/metadata sizes and JSON depth;
- circuit breakers for RPC failure, fee surge, and sponsor low balance.

Self-dealing remains possible, so per-key budgets are insufficient and a global
budget is always enforced. Pubnet authentication and budget values are required
startup inputs. Testnet may be keyless because the exposed resource is compute,
but still uses global concurrency and simulation limits.

Fee ceilings are signed calibration artifacts derived separately per network
from p99.9 legitimate enforcing-simulation and confirmed-cost distributions,
including smart-account payers, plus a documented safety margin. The release
does not ship invented numeric ceilings. An operator may choose a lower ceiling
or replace the profile with a newer measured one; no configuration disables the
gate.

## RPC and failure handling

RPC providers are ordered and health-scored. Reads may fail over; submission
uses one provider then hash polling across providers. Provider disagreement
produces `SUBMITTED_UNKNOWN`, not resubmission with new sequence data.

| Failure | Behavior |
| --- | --- |
| Timeout before envelope persistence | Fail without submission; release lease/budget. |
| Timeout after persistence, before send result | Treat as unknown and poll stored hash. |
| `PENDING` | Poll with capped exponential backoff and jitter. |
| `SUCCESS` | Validate ledger, events, return, balances, fee, and hash; persist success. |
| `FAILED` | Persist result XDR/diagnostics and canonical non-null reason; charge actual fee. |
| Unknown RPC status | Preserve unknown, alert, and reconcile; never guess success/failure. |
| Rate limit | Open provider circuit and use another for reads/polling; do not fan out submissions. |
| Sequence collision | Refresh under lease; rebuild only if prior envelope is proven unsent. |
| Fee surge | Reject before signing if inclusion or total ceiling would be exceeded. |
| Sponsor low balance | Remove account from allocation and fail readiness when capacity is insufficient. |
| Stale simulation | Re-simulate with current footprint/resources before signing. |

Stable internal reason codes map to the existing x402 reason strings. Diagnostic
detail is logged under a correlation ID and is not added to protocol objects.
Every rejection path has a non-empty reason; schema tests enumerate the map.

## Key storage and boot modes

The default distribution provides:

- a local encrypted keystore on a persistent volume, with a separately mounted
  master secret and `0600` permissions;
- optional Vault/KMS-style signer adapters behind the same interface;
- no plaintext keys in YAML, database rows, logs, images, or crash reports;
- address-preserving audit records and configurable display redaction;
- rotation and recovery commands that do not require a hosted control plane.

`docker compose --profile testnet-dev up` is the zero-account path. The explicit
profile generates a facilitator and channel pool, stores them encrypted, and
funds them through Friendbot. It refuses to run against pubnet.

The normal `docker compose up` does not call Friendbot. If pubnet is enabled and
the sponsor/channel configuration is absent, unreadable, underfunded, or
unmeasured, the process exits non-zero before serving settlement.

Model download is asynchronous and never gates settlement. Lexical search is
ready once migrations finish.

## Self-facilitation packaging

The same protocol kernel and orchestrator are published in two forms:

1. the standalone service image; and
2. an embeddable resource-server package that mounts handlers and reuses the
   host PostgreSQL connection.

The embedded form is not a reduced-trust path. It uses the same transaction
rebuild, enforcing simulation, channel leases, budgets, migrations, and reason
mapping. Sellers can self-facilitate without using a central operator, while a
small deployment can still run one process and one database.
