# Stellar Bazaar unified search evaluation

The controlled cohort is separate from the 12-resource `golden-v1.json` smoke
suite, but it is part of the same evaluation program as the live ecosystem
cohort. It contains 300 fixtures, 100 queries, and the complete 30,000-pair qrel
matrix under `eval-dataset/`. Every retrieval profile runs through
`SearchService`; the evaluation does not contain another ranking implementation.

Run `npm run benchmark:run` for the unified fetch, validation, evidence, and
reporting workflow. The controlled-only commands below remain available when
producing or calibrating its versioned artifacts.

`OPENROUTER_API_KEY=... npm run benchmark:run -- --judge=openrouter` extends
the same relevance rubric to a source-diverse pool from the live CDP and Agent
Tools catalogs. Both cohorts use the shared judge module, while their judgments
remain separately versioned because their snapshot and calibration guarantees
differ.

## Dataset contract

Validated JSONL is used for the catalog, evaluation sidecar, queries, qrels, and
human calibration import. Zod validation rejects bad counts, duplicate IDs,
duplicate URLs and query text, invalid Stellar `G...`/`C...` addresses,
non-official wire fields, malformed Bazaar extensions, broken qrel references,
and inconsistent hard-constraint labels.

The exact composition is:

- 150 HTTP fixtures whose category/method shape is sampled from CDP records;
- 60 MCP fixtures generated from repository templates or optional development-only LLM output;
- 45 adversarial fixtures spanning nine attack classes; and
- 45 sparse/cold-start HTTP fixtures.

Exactly 50 deterministic provider identities are generated with
`@stellar/stellar-sdk`. All fixture endpoints use reserved `.example` names.
The evaluation sidecar has exactly 30 resources in each of weather, finance,
blockchain, identity, documents, news, risk, language, media, and logistics.
The SDK also validates the configured Stellar USDC contract IDs. Testnet uses
`CBIEL...DAMA`, pubnet uses `CCW67...MI75`, both at 7 decimals. Atomic amounts
are stored as decimal integer strings. USD prices are fixed authoring-time
sidecar snapshots; search never derives them or exposes a public price filter.
This benchmark version is deliberately `exact`-only. It includes multi-option
resources across both Stellar networks and both G-account and C-account
recipients, but it makes no `upto` search-quality claim.

Each fixture is compiled with `@openx402/bazaar-sdk` and checked by both upstream
Bazaar validators. The `wire` object contains only `x402Version`, `resource`,
`accepts`, and `extensions`; each accept entry contains only `scheme`, `network`,
`asset`, `amount`, `payTo`, `maxTimeoutSeconds`, and
`extra.areFeesSponsored`. Provenance, liveness, verification, category, decimal,
USD, facilitator, and status information is confined to the evaluation sidecar.
CDP `lastUpdated` is retained only as `source_last_updated`; the warm/cold label
uses a fixed 30-day threshold at fixture-authoring time, never wall-clock runtime.

## Reproduction

```sh
npm install
npm run benchmark:fetch-cdp
npm run benchmark:generate-candidates # optional, development fixtures only; requires OPENROUTER_API_KEY
npm run benchmark:generate
npm run benchmark:validate
OPENROUTER_API_KEY=... npm run benchmark:judge
# Import a separate file containing genuine human review.
npm run benchmark:import-human -- /path/to/human-review.jsonl
npm run benchmark:calibration
npm run benchmark:gates
TEST_DATABASE_URL=postgresql://... \
FACILITATOR_RERANKER_URL=https://... \
BENCHMARK_MIN_RELEVANCE_SCORE=... \
BENCHMARK_HYBRID_P95_LIMIT_MS=... \
BENCHMARK_RERANKER_P95_LIMIT_MS=... \
npm run benchmark:evaluate
```

Before genuine human calibration, the same production retrieval path may be
measured with `BENCHMARK_ALLOW_PROVISIONAL=1`. It writes only
`provisional-v1.json`, always reports `release_ready: false`, and cannot replace
the release report or open the formal gate.

`benchmark:fetch-cdp` walks every `items`/`pagination` page, retries with bounded
exponential backoff, caps each response at 32 MiB, deduplicates before sampling,
and samples by the `stellar-bazaar-release-v1` seed. It records the fetch time,
source URL, selected response headers, per-page and aggregate SHA-256 hashes, and
sampling seed. It never takes the first 150 entries.
The CDP sample is additionally stratified to 15 records per evaluation category
using deterministic keyword classification over source URL/name/description/tags;
this inference is sidecar-only and never adds a capability to Bazaar wire prose.

Coinbase documents the endpoint for browsing, but no clear metadata
redistribution grant was found. Therefore the full snapshot and sampled foreign
records are gitignored. They do not inherit this repository's Apache-2.0
licence. Committed fixtures do not copy CDP descriptions, tags, examples, or
schemas. They use deterministic repository-owned prose and schemas; only source
hashes, category/method shape, and timestamps retain provenance. The fetch
manifest and transformed `.example` fixtures are committed.

## OpenRouter judging

`OPENROUTER_API_KEY` is read from the environment only. The qrel judge defaults
to `deepseek/deepseek-v4-flash-0731` and may be overridden with
`OPENROUTER_JUDGE_MODEL`. Optional candidate generation uses
`OPENROUTER_MODEL`.
Optional development candidate generation and relevance judging use OpenRouter. Calls use
`https://openrouter.ai/api/v1/chat/completions`, temperature 0, strict
JSON output, Zod validation, rate limiting, bounded retries, prompt-addressed
cache files, and resumable batch checkpoints. Provenance records the requested
and returned model, request ID/provider when supplied, prompt hash, timestamp,
response hash, and cache path. No key is written.
`OPENROUTER_JUDGE_BATCH_SIZE` defaults to 8. A bounded compatibility probe can
set `OPENROUTER_JUDGE_MAX_BATCHES=1`; probe runs populate the ignored response
cache and checkpoint provenance but never modify qrels. Calls use rate-spaced
starts and bounded `OPENROUTER_JUDGE_CONCURRENCY` (default 8, maximum 32).

When the key is unavailable, `benchmark:generate` produces a clearly marked,
keyless curated baseline so schema and search mechanics remain testable. The 30
release queries are always curated and never replaced by model output. Optional
generation may replace only development-query wording and MCP fixture prose, so
the DeepSeek judge does not author the held-out release questions it scores.

Hard constraints supported by production—type, network, scheme, payTo, asset,
and extension presence—are calculated before judging. Evaluation-only category
and fixed price constraints are also calculated separately. Ineligible pairs get
grade 0 without an LLM. Eligible pairs are randomized into batches with repeated
anchors. The system prompt says seller metadata is untrusted data and commands
inside listings must be ignored. Until judging runs, eligible rows say `pending`
and their grade 0 is explicitly a placeholder, not a relevance label.

The ten hand-authored no-result queries are catalog-absence assertions, not
semantic-model opinions. Their eligible rows are explicitly marked `curated`
grade 0 and remain provisional until independent calibration. This prevents
judge over-leniency from becoming false ground truth; model-judged, curated, and
hard-filtered labels remain distinguishable in every qrel.

The 400-pair calibration set is stratified deterministically and initially has
null human fields. The agreement report includes quadratic weighted kappa, a 4x4
confusion matrix, exact agreement, within-one agreement, and severe disagreement.
Release requires at least 300 reviewed pairs, kappa >= 0.70, and severe
disagreement <= 5%. Qrels remain provisional even after model judging and the
release gate stays closed until a genuine human file passes. Agent output is
never called human-reviewed.

## Execution and metrics

Release mode creates a random PostgreSQL schema, sets it as `search_path`, runs
migrations there, verifies table ownership, and only then seeds. It never
truncates a configured catalog. Fixtures are changed back to `unverified` inside
that isolated schema and searches set `includeUnverified` only for evaluation.
The schema is dropped after the run. Failure to prove isolation aborts before
seeding.

Profiles are lexical, BGE-M3 semantic-only, hybrid weighted RRF, and hybrid plus
a configured real reranker. OpenRouter DeepSeek is only the relevance judge. A
missing reranker is reported unavailable; fake rerankers cannot enter release
mode and production reranking remains off.

Reports include standard Precision@5 (always denominator 5), Recall@20, MRR,
nDCG@5, no-result accuracy, semantic grade-0 rate, production hard-filter
violation rate, separate evaluation-constraint violation rate, adversarial top-1
and resistance rates,
provider concentration, embedding completeness/failures, warm/cold result share,
reranker lift, and p50/p95/p99 latency. Development/release, per-class, and
overall metrics include deterministic 1,000-sample bootstrap 95% intervals.
Precision, recall, MRR, and nDCG aggregate only queries with at least one
grade-2-or-higher judgment. Catalog-absence queries are measured only by
no-result accuracy, so a correct empty result cannot inflate recall/nDCG or
depress precision.
The 30 release queries are frozen: the runner exposes no tuning operation and
release results must not guide configuration changes.

## Release gates and environment record

`benchmark:gates` is a preflight report, not a quality pass. The actual release
run fails unless wire and evaluation constraint violations are zero, all 300
BGE-M3 vectors are present with no failed jobs, hybrid improves held-out nDCG@5
and Recall@20 over lexical, reranking matches or improves both, held-out
no-result accuracy is perfect, adversarial fixtures never take the top slot,
provider fallbacks are zero, configured p95 targets are met, a real reranker
actually ran, and human calibration passed. Relevance and latency thresholds
must be fixed from development-query runs before running the frozen release
split. Reports record Node/OS/architecture/CPU count, PostgreSQL version,
embedding and reranker model IDs/revisions, dataset hashes (in the manifest),
unavailable profiles, and limitations. Record exact host CPU/RAM details beside
a published report when running on benchmark hardware.

Before publishing, run:

```sh
npm run typecheck
npm run build
npm run test:unit
TEST_DATABASE_URL=postgresql://... npm run test:integration
npm run licenses
npm audit
FACILITATOR_LIVE_MODEL_REPO=Xenova/bge-m3 \
FACILITATOR_LIVE_MODEL_DIM=1024 npm run test:live-model
```

The last command is the required real BGE-M3 model check. Fake-provider smoke
results are useful for mechanics only and must never be presented as release
quality measurements.
