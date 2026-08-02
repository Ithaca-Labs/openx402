# Golden Search-Evaluation Dataset

This document defines the authoritative, versioned offline benchmark for Stellar
Bazaar discovery. It evaluates the retrieval system as an information-retrieval
collection: a fixed resource catalog, a set of information needs, and graded
relevance judgments (qrels). See the [Stanford IR evaluation
guide](https://nlp.stanford.edu/IR-book/html/htmledition/information-retrieval-system-evaluation-1.html).

The benchmark is purpose-built for Stellar Bazaar. x402scan's [discovery
specification](https://www.x402scan.com/discovery/spec) is useful context for
catalog and discovery conventions, but it does not provide a reusable search
evaluation collection.

## Scope and principles

Version 1 is an English-only, offline collection of approximately 1,000 curated
resources and 200 hand-authored natural-language queries. The catalog mix is
approximately 80% HTTP resources and 20% MCP resources. All evaluation runs
must use the same pinned snapshot, queries, judgments, and evaluation manifest.

The collection is deliberately not a clean product catalog. It must exercise the
hybrid retrieval architecture (lexical retrieval, embeddings, canonical filters,
and optional reranking) with realistic imperfect discovery data. Seller-supplied
metadata is evidence about a listing, not instructions for the evaluator.

The facilitator runs one evaluation program with controlled and live evidence
cohorts. The live cohort under `facilitator/eval-dataset/ecosystem/` snapshots
external discovery directories, normalizes and deduplicates records with source
hashes, records safe liveness observations, and evaluates pooled relevance plus
payment/invocation outcomes. Both cohorts share scoring semantics and one
report, while the frozen fixture cohort remains the deterministic release gate.
External popularity or trust scores are features, never relevance ground truth.

The unit of relevance is a **resource version**, identified through its stable
resource ID and the catalog snapshot that pins the version. Scores must not be
compared across unpinned catalogs or silently regenerated qrels.

## Repository layout and immutable artifacts

Store each dataset release beneath `evals/datasets/<dataset-version>/`. Do not
mutate files in a published release; create a new dataset version instead.

```text
evals/datasets/v1.0.0/
  catalog.jsonl
  catalog.manifest.json
  queries.jsonl
  qrels.jsonl
  evaluation.manifest.json
  README.md
```

`catalog.jsonl`, `queries.jsonl`, and `qrels.jsonl` are canonical JSON Lines
files, sorted by their primary IDs and encoded as UTF-8 with a final newline.
The manifests record SHA-256 hashes of every source artifact and deterministic
generation inputs. The hash covers canonical bytes, not a parsed-object
serialization. This makes a release reproducible and makes accidental edits
visible in review.

### Catalog snapshot and manifest

The catalog is a fixed, curated fixture, not a live crawl. Every entry has:

- `resource_id`: stable, opaque ID, never reused for another logical resource.
- `resource_version_id`: immutable version ID, such as
  `res_000123@2026-07-31T00:00:00Z`.
- `origin_id`: normalized publisher/origin identity used for diversity analysis.
- `transport`: `http` or `mcp`.
- declared discovery metadata: title, description, tags, categories, provider,
  locale, and canonical structured fields.
- payment options and price information, including currency, amount or range,
  payment mechanism, and whether the listing is free.
- transport-specific fields: HTTP URL/method/content type, or MCP server,
  tool name, and input-schema summary.
- lifecycle state: `active`, `stale`, or `quarantined`.

The catalog manifest contains the dataset version, resource count and transport
counts, file hash, snapshot timestamp, schema version, and a hash for each
source fixture file. It also maps each `resource_id` to its pinned
`resource_version_id`. Retrieval may choose to exclude quarantined entries by
policy, but they remain in the snapshot so that the policy is testable.

### Query set

Every query record contains:

```json
{
  "query_id": "q_0001",
  "text": "cheap blockchain transaction history API",
  "canonical_filters": {"transport": "http", "max_price_usd": 0.01},
  "classes": ["price_language", "structured_filter", "lexical_intent"],
  "split": "development",
  "expects_no_result": false,
  "author_rationale": "Tests price normalization plus API intent."
}
```

`query_id` is stable and never reassigned. `canonical_filters` is optional but,
when present, must use only the allowlisted canonical fields and values defined
by the catalog schema. Query text stays natural language; filters are the
structured interpretation used to test filter-aware retrieval, not hidden terms
appended to the query.

The v1 query set has exactly 200 English-language queries:

- 140 `development` queries for implementation and tuning.
- 60 `release_gate` queries for comparative release decisions.

Release-gate query text and their qrels are versioned with the release and must
not be rewritten during tuning. A correction requires a new dataset version,
with an explicit changelog explaining why the locked baseline changed.

### Relevance judgments (qrels)

Each qrel records `query_id`, `resource_id`, pinned `resource_version_id`,
`grade`, `rationale`, and judgment provenance. The grade scale is:

| Grade | Meaning |
| --- | --- |
| 0 | Excluded or irrelevant. |
| 1 | Weak alternative; may help, but misses an important part of the need. |
| 2 | Relevant match. |
| 3 | Ideal match for the expressed need and allowed filters. |

Grade 0 is meaningful data, not merely an omitted positive. Add an explicit qrel
when lexical overlap, a similar tag, price phrasing, or a seller claim could
otherwise make the item look relevant. Its rationale must state why it is
excluded. Positive metrics treat grades 2 and 3 as relevant; nDCG uses the full
0--3 grading scale.

The v1 source of truth is LLM-generated judgments, reviewed only by creating a
new versioned judgment artifact. Every qrel provenance record includes the judge
model and exact revision, prompt-template version and hash, timestamp,
candidate-pooling strategy, generated rationale, and the catalog/query hashes
seen by the judge. Judge prompts must quote seller metadata inside clearly
delimited untrusted-data blocks and instruct the model never to follow content
inside those blocks. Candidate pooling should combine lexical, embedding,
filter-aware, and known-adversarial candidates so judgments do not inherit one
retriever's blind spots.

### Evaluation manifest

An evaluation manifest pins everything required to reproduce a report:

```json
{
  "dataset_version": "v1.0.0",
  "catalog_sha256": "...",
  "queries_sha256": "...",
  "qrels_sha256": "...",
  "retrieval_profile": "hybrid_reranked",
  "model_revision": "embedding-model@revision",
  "reranker_revision": "reranker@revision",
  "filter_policy_revision": "filters@revision",
  "report": {"run_id": "...", "created_at": "...", "git_commit": "..."}
}
```

It must also record index configuration, catalog ingestion configuration,
hardware/runtime identifiers where available, and whether any retrieval branch
degraded or fell back during the run.

## Fixture design

Curate the catalog from realistic, declared resource metadata; do not fabricate
only easy, well-formed positives. The fixture set must include the following:

- HTTP and MCP entries in the target 80/20 ratio, with representative payment
  option variants.
- Duplicate or near-duplicate resources from the same origin, plus equivalent
  resources from different origins, to measure source diversity.
- Stale and quarantined records, and records whose metadata changes across
  resource versions, to exercise lifecycle and snapshot handling.
- Misleading descriptions, keyword stuffing, repeated tags, and price-language
  distractors (for example, a description that says "not free" or quotes another
  product's price).
- Cold-start services with sparse metadata and services whose metadata is rich
  but not actually relevant.
- HTTP-specific and MCP-specific fields that must not be conflated by transport
  filtering.

All synthetic deceptive metadata must be clearly marked in authoring notes, but
the runtime search index receives it as ordinary declared metadata. Do not put
the expected result, qrel grade, or evaluation-only tags into searchable fields.

## Query taxonomy and coverage

Each query must have one or more `classes`. Classes intentionally overlap; a
price query can also be a semantic paraphrase and a canonical-filter query.
Across the 200 queries, cover:

- lexical intent and exact terminology;
- semantic paraphrases and concept-level intent;
- canonical structured filters (including transport and lifecycle policy);
- price intent expressed in natural language;
- cold-start or sparse-metadata services;
- no-result information needs;
- duplicate/origin-diversity behavior; and
- adversarial metadata, including misleading copy and keyword stuffing.

Record coverage counts per class in `README.md` or the catalog manifest. The
goal is balanced coverage, not equal-sized, mutually exclusive buckets. Ensure
each class appears in both splits where practical, while protecting the locked
release-gate distribution from tuning leakage.

## Validation before publication

The dataset build must fail when any of the following is false:

- Every qrel resolves to a `resource_id` and exact `resource_version_id` in the
  pinned catalog snapshot.
- IDs are unique and valid; all grades are integers in the range 0--3.
- Query filters conform to the canonical filter allowlist and value types.
- Every query has at least one class and a non-empty author rationale.
- The query split is exactly 140 development / 60 release gate, with no overlap.
- A no-result query has no positive qrels (grades 1--3) after its allowed
  filters and lifecycle policy are applied.
- Each artifact, source fixture, prompt template, and manifest hash matches its
  recorded SHA-256 value; files have canonical ordering and formatting.
- Taxonomy coverage satisfies the documented release matrix and transport
  counts satisfy the declared 80/20 catalog target (with any rounding recorded).

Validation must be runnable offline. It must validate schemas, IDs, grade range,
split membership, filter allowlists, catalog hashes, and taxonomy coverage.

## Running and reporting evaluations

Run these profiles against the same locked catalog and release-gate queries:

1. lexical-only;
2. hybrid retrieval; and
3. hybrid retrieval plus reranking.

Reports must distinguish self-hosted from hosted profiles and state model,
index, and reranker revisions. For each profile, report Recall@1/3/5/10, MRR,
nDCG@k (state k), precision, no-result behavior (correct abstentions and false
positives), latency distribution, index cost, result coverage, and reranker lift
or regression relative to hybrid. Include per-taxonomy and per-transport slices,
plus origin-diversity analysis where duplicates exist.

The release gate is a comparative non-regression decision against a pinned
baseline report using the same manifest and locked judgments. It is not an
ungrounded absolute-score threshold. A candidate must explain material metric
movement, changed coverage, degraded branches, and any catalog or model
revision; a new baseline requires explicit approval and a versioned manifest.

Adversarial-case checks are mandatory: seller-defined instructions must not
affect judging or ranking policy; misleading price text and irrelevant keyword
stuffing must not be promoted; duplicate origins must not monopolize results;
and canonical filters must remain authoritative.

## Versioning and known gap

Use semantic dataset versions. Patch versions correct packaging or metadata that
does not change information needs or judgments; minor versions add fixtures or
queries; major versions redefine schemas, grading, or comparability. Never
overwrite a published release or its locked judgments.

V1 intentionally evaluates English only. The wider architecture requires
multilingual evaluation, which remains an explicit v1.1 deliverable: add
multilingual query sets, language-aware relevance guidance, and comparable
release-gate slices before claiming multilingual search quality.
