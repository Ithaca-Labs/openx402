# Storage, Search, and Evaluation

## PostgreSQL is the system of record

PostgreSQL 17 with pgvector is the only required datastore. Tables use UUIDv7
identifiers, UTC timestamps, integer atomic token amounts, and explicit network,
asset contract, symbol, and decimal columns. Amounts are never JavaScript
numbers or floating-point database values.

### Core tables

| Table | Important fields |
| --- | --- |
| `resources` | stable key, type, resource URL, HTTP method, MCP tool name, origin, status, active version ID, first/last seen, last seen paid |
| `resource_versions` | resource ID, canonical metadata JSON, declaration hash, description, service name, tags, schema, provenance, proof status/time, created/activated/retired time |
| `payment_options` | version ID, network, scheme, asset contract/symbol/decimals, payTo, price atomic, timeout, extra, verification status |
| `search_documents` | version/payment option ID, resource URL, method, tool name, description, tags, network, asset, scheme, payTo, price, status, deterministic human text, weighted high/medium/low lexical fields and `tsvector` |
| `resource_embeddings` | document ID, model generation, model ID, model revision, dimension, vector, source-text hash, created time |
| `catalog_observations` | version, source type, verify/settlement ID, origin result, observed hash, time |
| `index_jobs` | job kind, entity/version, generation, attempt, lease/fencing token, next run, error |
| `search_model_generations` | provider, model ID, immutable revision/checksum, dimension, pooling/normalization, status, metrics, activated time |
| `search_sessions` | query/filter hash, model generation, expiry, degraded branches, result count, HMAC key version |
| `search_session_items` | session ID, ordinal, resource/version/payment option, component ranks, RRF score, rerank score |
| `search_impressions` | session/query, selected result/version, position, caller pseudonym, time |
| `settlements` | fingerprint, payment identifier when present, payer, payTo, network, scheme, asset/decimals, max/actual, resource version, state, transaction hash, ledger, fee, timestamps |
| `settlement_attempts` | settlement, channel, sequence, XDR/hash, simulation/result diagnostics, submitted/polled times |
| `channel_accounts` | network, address, encrypted signer reference, state, lease/fencing token, on-chain sequence/balance |
| `sponsor_budget_buckets` | scope/key, UTC period, limit, reserved, charged, version |
| `api_keys` | key hash, policy, state, rotation metadata |

Raw XDR, result metadata, and original declarations have bounded retention.
Hashes and the minimal accounting/audit record remain after payload deletion.
Search and settlement joins use the exact resource version that was observed.

The required filter columns are materialized in `search_documents`; filters do
not inspect JSON. A resource with three accepts entries has three searchable
payment-option documents but is deduplicated to one Bazaar resource in the final
result.

## Schema and operations

SQL migrations are forward-only, checksummed, and protected by a PostgreSQL
advisory lock. Each release documents whether a migration is transactional,
online, or requires a short maintenance window. Destructive column removal is a
later release after dual-read/dual-write compatibility.

Self-host backup uses `pg_dump` for portable backups and documented WAL/PITR for
larger installations. The runbook includes encrypted backup storage, restore
into an empty database, migration to the current release, model-cache restore or
rebuild, transaction-count/hash reconciliation, and a quarterly restore drill.
Embeddings are disposable derived data; settlements, catalog versions, keys
references, sponsor budgets, and idempotency state are not.

## Indexing pipeline

1. Catalog activation writes the version, structured payment documents, and a
   durable indexing job in one transaction.
2. A PostgreSQL worker claims jobs using `FOR UPDATE SKIP LOCKED` and a fencing
   token. A crashed worker's lease expires safely.
3. Metadata is deterministically compiled into readable text. Raw JSON is never
   embedded and no generative model participates.
4. FTS is immediately available from the normalized text.
5. If the active embedding provider is ready, documents are batched, embedded,
   dimension/checksum validated, and upserted for that model generation.
6. Failure records a bounded retry and leaves the document lexically searchable.
7. A change to searchable metadata produces a new source hash and job; identical
   hashes are no-ops.

Canonical text follows a stable, versioned formatter:

```text
Service: Weather API
Description: Returns current weather and forecasts for a city.
Type: HTTP GET
Parameters:
- city: City name, required.
- units: Temperature units, celsius or fahrenheit.
Output: JSON containing temperature, condition, and forecast.
Tags: weather, forecast, climate
Payment: Stellar USDC, exact, 0.001 USDC
```

Only seller-declared facts and normalized payment requirements appear. Missing
fields are omitted, not inferred. Examples are length-bounded and marked as
examples.

## Model layout

The design chooses **one active model generation per index**. Separate active
columns per provider would multiply index and migration complexity without
benefit at a catalog of a few thousand resources.

`resource_embeddings.embedding` uses pgvector's untyped `vector`, while every
row records `model_id`, immutable `model_revision`, `dimension`, and generation.
A check constraint matches the row dimension to the generation. The active
generation receives an expression/partial HNSW index such as
`(embedding::vector(1024))` scoped to that generation. Queries cast to the
declared dimension and never compare vectors from different generations.

The local default is `BAAI/bge-m3`, 1024 dimensions, at a pinned model revision
and checksum. CPU ONNX inference runs inside the facilitator process; it is not
a second service. The cache contains the tokenizer, ONNX files, manifest,
license, upstream revision, checksums, pooling rule, and normalization rule.
Local reranking uses the same provider interface and is off by default.

Model files may be:

- downloaded from a configured mirror at first boot without an account;
- pre-fetched by an image build;
- mounted as an air-gapped, checksum-verified bundle.

Download failure leaves FTS ready and is visible in health/metrics. It never
prevents `/verify`, `/settle`, `/supported`, or lexical discovery.

Hosted embedding and reranking are adapters, not required dependencies.
Credentials are provider-specific secret references. NVIDIA/Nemotron is allowed
only as an adapter target for a specifically named model whose weights pass the
project's permissive-OSI review; no NVIDIA model is bundled or selected by
default.

## Hybrid retrieval

Search executes:

1. validate and apply the standard network, scheme, payTo, type, and extension
   filters plus internal status/liveness constraints;
2. retrieve lexical candidates with PostgreSQL weighted FTS, using a
   parameterized phrase-plus-token tsquery and `ts_rank_cd`;
3. retrieve semantic candidates by cosine distance within the active model
   generation;
4. combine rank positions using weighted reciprocal-rank fusion:
   `sum(weight / (rrf_k + rank))`;
5. deduplicate payment-option documents to resources, retaining matching
   options;
6. optionally rerank the top candidate set;
7. apply minimum relevance, origin diversity, liveness, deterministic resource
   ID tie-break, and result limit;
8. materialize the ordered candidates as a search session.

PostgreSQL FTS is accurately described as FTS with `ts_rank_cd`; it is not BM25.
No BM25 extension is required because it would add packaging and licensing
surface for a small catalog. pgvector HNSW remains inside PostgreSQL. Operators
may use exact vector scan during small-catalog evaluation, but this changes
performance only, not ranking semantics.

For "find a cheap API that gives Mumbai weather", the standard network filter
constrains the network, FTS matches seller text such as weather and Mumbai,
embeddings connect climate to weather, declared structured asset/price options
inform bounded query-intent features, and RRF merges the candidate ranks. Asset
and price do not become private Bazaar request filters, and interpretation never
changes the seller's declared value. The production fusion profile is frozen at
lexical/semantic weights `0.7`/`0.3`, `rrf_k = 20`, and candidate pools of 250
(300 for the isolated release benchmark). Evaluation output records per-branch
candidate counts and query-shape diagnostics so regressions can be attributed
to recall or fusion ordering. A fixed cosine-distance guard of `0.9` applies
when lexical retrieval has no candidate, preserving genuine no-result behavior;
lexically supported queries retain the full semantic candidate pool for recall.

## Degradation and timeout semantics

| Available components | Result |
| --- | --- |
| lexical + vector + reranker | Hybrid RRF, then reranked |
| lexical + vector | Hybrid RRF |
| lexical only | FTS result |
| vector only by explicit operator choice | Semantic result; not a shipped profile |

Reranker timeout falls back to hybrid when configured. Embedding timeout falls
back to lexical. A provider can be changed in either direction between local and
hosted without changing stored catalog truth or API shape.

`partialResults` is `true` when another materialized page exists or an enabled
retrieval branch/candidate build timed out or hit a safety cap. It is `false`
only when the requested page is the complete result of all enabled branches.
The response records no proprietary degradation field; operators observe branch
degradation in metrics and the trusted analytics API.

## Stable ranked cursors

A live SQL query cannot provide stable relevance pages while resources and
embeddings change. The first search therefore materializes up to the configured
session candidate cap in `search_session_items`, ordered by final score and
resource ID. The opaque cursor contains only session ID, next ordinal, expiry,
and key version plus HMAC.

Later pages read that frozen list, then omit resources that have become
quarantined or tombstoned for security. Such omission sets `partialResults`.
Sessions expire after the configured TTL and are deleted by a PostgreSQL job.
No MVCC snapshot is kept open and no Redis cursor store is required.

## Model migration

1. Register a `BUILDING` generation with immutable model revision, checksums,
   dimension, tokenizer, pooling, and normalization.
2. Backfill all active documents into the shadow generation using durable jobs.
3. Check row counts, dimensions, source hashes, and deterministic embedding
   fixtures.
4. Build the generation's pgvector index concurrently.
5. Run golden, adversarial, latency, and resource-cost evaluation against both
   generations.
6. Require the documented quality/non-regression gates and operator approval.
7. Atomically change the active generation in one database transaction.
8. Keep the prior generation queryable for rollback through the retention
   window, then drop its index and rows.

No query mixes old and new dimensions, and rollback never requires recomputing
the old model.

## Evaluation deliverable

The repository includes a versioned golden set of:

- natural-language query;
- allowed structured filters;
- relevant resource IDs with graded relevance;
- expected exclusions and rationale;
- hard lexical, semantic, multilingual, price-intent, cold-start, and no-result
  cases.

Reports contain recall@1/3/5/10, MRR, nDCG@k, precision, no-result rate,
component and end-to-end p50/p95/p99 latency, index time, CPU/memory, and model
revision. Recall@k is the primary gate because an agent chooses from the first
few results.

Every reranker release reports its lift and regressions against hybrid-alone.
Hosted and self-host profiles are evaluated separately; hosted quality is not
presented as self-host quality.

Search impressions use a random identifier and exact resource version. A later
settlement through the same facilitator records whether an impressed result was
selected, time-to-settlement, amount, success, and repeat use. Reports show
search-to-verify and search-to-settle conversion by position and query class.
Raw agent queries have bounded retention and can be disabled; aggregate
conversion remains possible.

Adversarial suites include repeated keywords, irrelevant popular tags,
competitor names, prompt-injection prose, extreme descriptions, duplicate
origins, misleading price language, and rapid metadata churn. Defenses include
per-field token caps, tag deduplication, no seller-defined boost, provenance and
liveness requirements, origin diversity, and bounded behavioral signals.
Conversion is an evaluation signal first; it is not an automatic ranking boost
during cold start, which would entrench the first sellers.

At launch, coverage is the principal constraint. Reports show catalog size and
query coverage beside ranking metrics so a high score on a tiny catalog cannot
be mistaken for ecosystem utility.
