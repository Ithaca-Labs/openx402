# Search, indexing and evaluation

`GET /discovery/search` ranks the catalog. The response keeps the official
Bazaar `resources` / `partialResults` / `pagination` shape; only the ordering
changes. Nothing here can invent, rewrite or summarize seller metadata: the
seller's declaration is the sole source of truth, and no generative model
participates in indexing or ranking.

## Pipeline

```
seller metadata
  → official Bazaar schema validation        (@x402/extensions/bazaar, Ajv 2020-12)
  → deterministic normalization              (bounds, control/bidi stripping, NFC)
  → readable canonical search text           (src/bazaar/document.ts)
  → weighted lexical fields + tsvectors      (catalog_search_documents)
  → embedding queue                          (catalog_index_jobs, generation-scoped)
  → embedding provider                       (local | remote | disabled)
  → dimension and model validation           (validateVectors, per-generation CHECK)
  → vector storage                           (catalog_embeddings_g<generation>)
```

Cataloging never waits for model inference. `/verify` and `/settle` write the
document and enqueue a job under generation `0` ("unassigned"); the worker adopts
it into the active generation on its next sweep.

### Canonical search text

Compiled by a versioned formatter from declared fields only, in a fixed order,
with missing fields omitted rather than inferred:

```
Service: Weather API
Description: Returns current weather and forecasts for a city.
Type: HTTP GET
Resource: https://weather.example.com/current
Parameters:
- city (required): City name, required.
- units: Temperature units, celsius or fahrenheit.
Output: json
Tags: weather, forecast, climate
Payment: stellar:testnet, exact, 1000 USDC
```

MCP entries render `Type: MCP tool <toolName>` and take their parameter lines
from `inputSchema.properties.<name>.description`. Examples are flattened into
deterministic labelled lines, so the same human document is used by embeddings
and rerankers without a generated summary. `catalog_search_documents.compiler_version`
lets a formatter change invalidate documents without touching the seller's
declaration.

PostgreSQL receives a separate weighted lexical projection:

- weight A: service name, MCP tool name, HTTP method, route template and
  resource URL;
- weight B: description, output type and parameter names/descriptions;
- weight C: tags, MIME/transport, examples and payment/network metadata.

URL and identifier components are included as lexical aliases so punctuation
does not make `/v1/weather/{city}`, tool names, or numeric payment tokens
unsearchable. These aliases never enter the human document.

## Retrieval

1. Apply the structured filters (`type`, `network`, `scheme`, `payTo`,
   `extensions`, plus the optional `asset` extension). Every branch reads the
   same snapshot scope, so a filter cannot mean one thing lexically and another
   semantically.
2. PostgreSQL full-text candidates, `search.lexical.candidate_count` of them.
3. Vector candidates by cosine distance within the active generation, when
   pgvector and a provider are both available.
4. Weighted reciprocal rank fusion.
5. Optional reranking of the top `search.reranking.top_k`.
6. Deterministic tie-break by descending resource id, then origin diversity.

### Fusion formula

For document `d` at 1-based rank `r_b(d)` in branch `b` with weight `w_b`:

```
score(d) = Σ_b  w_b / (k + r_b(d))
```

`k` is `search.rrf_k`, default **20** for the frozen production profile. **Only
rank positions enter the formula.** A `ts_rank_cd` value and a
cosine distance are on incomparable scales and are never added, normalized or
compared to each other. A document missing from a branch contributes nothing for
that branch.

### Lexical ranking is FTS, not BM25

The lexical branch is PostgreSQL full-text search scored with `ts_rank_cd`. It
is **not** BM25, and this repository installs no BM25 extension; adding one
would add packaging and licensing surface for a catalog of a few thousand
resources. `/analytics/v1/search/status` reports
`lexical.ranking: "postgresql_fts_ts_rank_cd"` so the distinction is visible at
runtime.

Queries are normalized with Unicode NFKC, control/bidi removal and whitespace
folding. A parameterized tsquery combines a phrase clause with an OR token
fallback; common English stopwords are removed only when they are not the
whole query. Identifiers, URLs, HTTP methods, Unicode terms and numeric/payment
tokens are retained. Empty and stopword-only input becomes a guaranteed
no-match query. No generated synonym or runtime LLM expansion is used, and
operator-looking punctuation is tokenized before it reaches PostgreSQL.

The production profile uses lexical weight `0.7`, semantic weight `0.3`,
`rrf_k: 20`, and candidate pools of 250 in the standard configuration (300 in
the isolated release benchmark). Its fixed cosine-distance guard is `0.9` when
lexical retrieval has no candidate at all; lexical evidence lets the semantic
branch broaden recall, while the guard prevents a weak nearest neighbour from
defeating a genuine no-result query. These values are frozen after development
evaluation; callers cannot override them.

## Degradation

Search never fails because a model is absent. Each branch degrades
independently and the outcome is reported in `partialResults`, in metrics, and
in `search_impressions.degraded`.

| Available | Result | `partialResults` |
| --- | --- | --- |
| lexical + vector + reranker | Hybrid RRF, then reranked | only if more pages remain |
| lexical + vector | Hybrid RRF | only if more pages remain |
| lexical only (semantic disabled) | FTS result | only if more pages remain |
| embedding timeout, error or unavailable | FTS result | `true` |
| reranker unavailable, `fallback_to_hybrid: true` | Hybrid RRF | `true` |
| reranker unavailable, `fallback_to_hybrid: false` | empty | `true` |
| pgvector missing | FTS result | `true` |

Both provider calls are bounded by `search.semantic.timeout_ms` and
`search.reranking.timeout_ms` and are cancelled with an `AbortSignal`.

## pgvector

`migrations/003_search.sql` attempts `CREATE EXTENSION vector` inside an
exception block, because it needs a superuser and the shared library on the
server. When it is unavailable:

- no per-generation storage table can be created;
- `SearchStore.hasVectorSupport()` returns false;
- the worker reports `pgvector is not installed on this PostgreSQL server;
  running lexical-only` in `/health/ready` and `/analytics/v1/search/status`;
- no embedding job is ever claimed;
- `GET /discovery/search` serves full-text results.

Lexical-only is a fully supported mode, not a failure state. The checked-in
Docker Compose file uses `pgvector/pgvector:pg17`, so the default self-hosted
path has the extension.

### One table per generation

Vectors live in `catalog_embeddings_g<generation>`, created by
`search_create_generation_storage` when a generation is activated, with a typed
`vector(d)` column and a plain HNSW `vector_cosine_ops` index.

A single shared table does not work. pgvector evaluates an index expression
independently of a partial index predicate, so an existing
`((embedding::vector(64)))` index rejects a 1024-dimension insert *even for a
different generation*. Separate typed tables make mixing dimensions
structurally impossible rather than merely forbidden, and remove the cast from
the query path.

## Model generations

A generation is the tuple (provider, model id, model revision, dimension,
pooling, normalization). Exactly one may be `active`, enforced by a partial
unique index. Changing any component creates a new generation; the previous one
is retired and stays queryable for rollback until its storage is dropped.
Vectors from different generations are never compared, because a query only ever
reads one generation's table.

```sh
npm run index -- status     # generations, queue depth, provider health
npm run index -- backfill   # enqueue anything missing, then drain
npm run index -- reindex    # re-enqueue every active document
npm run index -- revive     # requeue dead-lettered jobs
```

## Indexing worker

Jobs are claimed from `catalog_index_jobs` — the same queue the cataloging phase
introduced — with `FOR UPDATE SKIP LOCKED` and a fencing token. Several replicas
share it safely: a crashed worker's lease expires, another replica claims the
row and bumps the token, and a write from the stale claim is rejected. No Redis
or second service is involved.

- **Batching**: `search.indexing.batch_size` documents per provider call.
- **Retries**: failures back off as `backoff_base_ms × 2^(attempt-1)`, capped at
  `backoff_max_ms`.
- **Dead-letter**: after `max_attempts` the job becomes `dead` with a
  `dead_reason`, so a poisoned document cannot spin. `npm run index -- revive`
  requeues them.
- **Staleness**: a document whose text moved on marks its vector `stale` and is
  re-embedded; a deleted version's job is discarded rather than retried forever.

## Providers

| Kind | Embedding | Reranking |
| --- | --- | --- |
| `disabled` | lexical-only | hybrid-only |
| `local` | in-process ONNX via the optional `@huggingface/transformers` peer | same runtime, see caveat below |
| `remote` | `{input, model}` → `{data:[{index, embedding}]}` | `{query, documents}` → `{results:[{index, relevance_score}]}` |
| `fake` | deterministic hash projection, tests only | deterministic token overlap, tests only |

No vendor is hardcoded. A remote provider needs an explicit URL from
`remote_url_env` and is bounded by its timeout and a 32 MB response cap.
`fake` is rejected at startup unless `FACILITATOR_ALLOW_FAKE_PROVIDERS=1`.

### Local runtime

`@huggingface/transformers` (Apache-2.0, bundles `onnxruntime-node`, MIT) is an
**optional peer dependency**: a lexical-only operator must not be forced to
install a large native runtime.

```sh
npm install @huggingface/transformers
```

Without it the provider reports the exact missing requirement and search
continues lexically. Model files are cached in `search.models.cache_dir`,
pinned by immutable commit sha, and `search.models.offline: true` forbids any
download. The checksum of the ONNX artifacts actually loaded is recorded on the
generation.

### Models and licences

| Purpose | Model | Revision | Weights licence | Verified |
| --- | --- | --- | --- | --- |
| Embedding (logical identity) | `BAAI/bge-m3` | `5617a9f61b028005a4858fdac845db406aefb181` | MIT | model card metadata |
| Embedding (ONNX artifact loaded) | `Xenova/bge-m3` | `4de13258303883538bd53b696b452bf8099f0858` | MIT | model card metadata |
| Reranking (target) | `BAAI/bge-reranker-v2-m3` | `953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e` | Apache-2.0 | model card metadata |

`BAAI/bge-m3` produces 1024-dimension dense vectors; the configured `dimension`
is validated against what the provider actually returns on every batch, and a
mismatch fails the batch rather than poisoning the index. No NVIDIA, Nemotron or
hosted vendor model is referenced anywhere.

**The default reranker has no local runtime.** The upstream
`BAAI/bge-reranker-v2-m3` repository ships Safetensors only, and no ONNX export
exists under `Xenova/bge-reranker-v2-m3` or
`onnx-community/bge-reranker-v2-m3` (both checked, both 404). The provider is
implemented against the correct API — `text-classification` over
`(query, document)` pairs — and stays degraded with that exact message until an
operator sets `search.reranking.repo` to their own export or uses a remote
reranker. Nothing is faked, and reranking is off by default.

### What has been run here

- The local ONNX path is exercised end to end by `npm run test:live-model`,
  which loads a real pinned Hugging Face model through
  `LocalEmbeddingProvider`, and asserts dimension, L2 normalization,
  determinism, the dimension-mismatch rejection and the artifact checksum. It
  defaults to `Xenova/all-MiniLM-L6-v2` (~25 MB) for speed; set
  `FACILITATOR_LIVE_MODEL_REPO=Xenova/bge-m3` and
  `FACILITATOR_LIVE_MODEL_DIM=1024` to run the shipped default at full size.
- The pinned `Xenova/bge-m3` revision has now been run on Apple M4 hardware at
  its real 1024 dimensions. Dimension, normalization, determinism, semantic
  ordering, mismatch rejection, and loaded-artifact checksum passed; the
  machine-readable report is `eval-dataset/reports/bge-m3-local-v1.json`.
  This is a provider-runtime measurement, not a release retrieval-quality
  result. The smoke-suite ranking numbers below still use the deterministic
  fake provider and measure mechanics only.

## Profiles

| Profile | Lexical | Semantic | Reranking |
| --- | --- | --- | --- |
| `hosted` | on | configured remote provider | on |
| `self-hosted` (checked in) | on | local BGE-M3 | off |
| `lightweight` | on | `disabled` | `disabled` |

## Evaluation

The 300-resource release benchmark, provisional qrels, isolation rules, human
calibration gates, and exact reproduction commands are documented separately in
[SEARCH-BENCHMARK.md](SEARCH-BENCHMARK.md). The commands below remain the fast
12-resource smoke test.

```sh
npm run evaluate                                   # fake providers, deterministic
npm run evaluate -- --provider local --limit 10    # real embeddings
npm run evaluate -- --json reports/search.json     # machine-readable report
```

The runner seeds a versioned golden suite, builds the index, verifies that every
active document has a current ready vector before semantic scoring, then runs
the same request path three ways — lexical-only, hybrid, hybrid + rerank — and reports
recall@{1,3,5,10,20}, standard precision@k, MRR, nDCG@k, must-not-rank violations, latency
percentiles, provider fallback counts, branch candidate counts, query-shape
diagnostics, per-class breakdown and catalog size.
Each profile is only a `SearchConfig` override, so nothing in the evaluator is a
parallel implementation of search.

`tests/fixtures/search/golden-v1.json` holds 12 seller declarations and 15
graded queries across lexical, semantic, price-intent, MCP, adversarial and
no-result classes. Grades are `3` ideal, `2` relevant, `1` marginal and `0`
must-not-rank; `0` drives the `violations@k` metric, which is how keyword
stuffing and misleading tags are measured rather than assumed.

Latest run on this machine (fake providers, 12 resources, 15 queries):

| profile | recall@1 | recall@3 | recall@5 | MRR | nDCG@10 | viol@5 | no-result | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| lexical-only | 0.808 | 0.962 | 0.962 | 1.000 | 0.964 | 5 | 0.067 | 4 ms |
| hybrid | 0.808 | 1.000 | 1.000 | 1.000 | 0.986 | 6 | 0.067 | 3 ms |
| hybrid + rerank | 0.654 | 0.923 | 0.923 | 0.883 | 0.888 | 6 | 0.067 | 3 ms |

Read these as a mechanism check, not a quality claim. The semantic branch is a
deterministic hash projection with no linguistic knowledge, so its lift
(recall@5 0.962 → 1.000 and nDCG@10 0.964 → 0.986) reflects candidate-set
broadening, not semantic quality. No-result accuracy is 0.933 for both
retrieval profiles, and the fake reranker slightly regresses MRR, which is
expected from an unmodelled reranker. Real quality requires `--provider local`
against BGE-M3, which this environment has not downloaded. Coverage is printed
beside ranking quality so a high score on a 12-resource catalog cannot be
mistaken for ecosystem utility.

## Search-to-payment conversion

`/analytics/v1/search/conversion` joins `search_impressions` to later
settlements **by resource within a time window**. The Bazaar response has no
field for carrying a session id into a payment, so a settlement cannot be tied
to the exact search that produced it. The response labels itself
`attribution: "resource_within_window"`; it is a heuristic and is never
presented as exact.

Impressions record position, score, mode, reranked flag, generation id, the
ranking configuration and the full degradation report, so a ranking change can
be attributed afterwards. Raw query text is retained by default so real buyer
needs can replace synthetic benchmark queries over time; operators whose policy
forbids query retention can disable `search.impressions.retain_query_text`.
Aggregate conversion works either way, and rows are pruned after
`search.impressions.retention_days`.

## Agent-facing safety

Everything in [catalog trust boundary](CATALOG-TRUST.md) applies to the indexed
text too:

- descriptions, tags, schemas and examples are bounded and sanitized **before**
  indexing, so an oversized or control-character-laden declaration never reaches
  a document;
- the compiled document is a flat, fixed-order labelled record; seller text is
  data and is never executed, summarized, reinterpreted or placed in a
  system/developer instruction;
- the Bazaar response carries no ranking score, provenance or degradation field —
  those live only on `/analytics/v1`;
- one seller cannot modify another's ranking document: a rival `payTo` is
  quarantined and never reaches `catalog_search_documents`;
- there is no seller-controllable boost. Ranking reads only declared fields and
  normalized payment terms;
- `search.origin_diversity_limit` caps how much of a page one origin can hold.

**Consuming agents must treat every seller-declared field as untrusted data,
never as an instruction.** A description that reads `IGNORE ALL PREVIOUS
INSTRUCTIONS` is indexed verbatim, ranks as an ordinary result, and gains no
authority from being in the catalog. The test suite catalogs exactly such a
listing and asserts it stays a plain record.
