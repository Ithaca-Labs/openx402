# Unified evaluation program: live ecosystem cohort

The live ecosystem catalog is one evidence cohort in the
`x402-evaluation-v1` program. The other cohort is the frozen
`stellar-bazaar-release-v1` catalog. They run through one workflow and appear
in one report, while retaining distinct provenance and release semantics.

## What it measures

The benchmark keeps two signals separate:

- **Relevance:** pooled graded judgments over recommendation rankings.
- **Utility/trust:** liveness, payment verification, settlement, invocation,
  response validity, latency, cost, safety, and end-to-end task success.

Popularity and trust scores from external directories are recorded as features,
not used as relevance ground truth.

## Dataset layout

```text
eval-dataset/ecosystem/
  catalog/catalog-v1.jsonl
  queries/queries-v1.jsonl
  judgments/judgments-v1.jsonl
  outcomes/outcomes-v1.jsonl
  runs/recommendations-v1.jsonl
  manifests/dataset-v1.json
  raw/                         # ignored third-party responses
  reports/
```

The normalized catalog deduplicates records by transport and normalized URL,
then retains all source attributions and SHA-256 fingerprints. Raw third-party
responses are local-only because redistribution terms are not assumed.

## Run the evaluation program

From `facilitator/`:

```sh
npm run benchmark:run
```

That command fetches and normalizes configured directories, seeds the shared
information needs, probes bounded liveness, validates both cohorts, evaluates
available evidence, and writes
`eval-dataset/reports/evaluation-program-v1.json`.

To build and judge a live candidate pool in the same run:

```sh
OPENROUTER_API_KEY=... npm run benchmark:run -- --judge=openrouter
```

The live adapter creates a deterministic recommendation run over the complete
normalized CDP, Agent Tools, and other configured catalogs. For each query it
pools the best candidates while reserving representation from every fetched
source. Deterministic safety, liveness, transport, payment, and category
constraints are applied before OpenRouter. The remaining pairs use the same
validated relevance-judge module as the controlled cohort.

If a newly generated controlled cohort still has pending eligible qrels, the
same command invokes its OpenRouter judge first. Already completed controlled
qrels are not paid for again. The workflow then judges the live pool and emits
both judge counts in the combined report.

The default pool is 20 resources per query rather than the full catalog/query
Cartesian product. With 100 queries this caps the initial pool at 2,000 pairs.
Configure cost and throughput with:

```sh
ECOSYSTEM_JUDGE_POOL_SIZE=10 \
OPENROUTER_JUDGE_BATCH_SIZE=8 \
OPENROUTER_JUDGE_CONCURRENCY=4 \
OPENROUTER_JUDGE_MAX_BATCHES=1 \
OPENROUTER_API_KEY=... \
npm run benchmark:run -- --no-fetch --no-probe --judge=openrouter
```

`OPENROUTER_JUDGE_MAX_BATCHES` is useful for a bounded compatibility run. A
partial pool is persisted and clearly reported as `partial_judgments`; removing
the limit resumes through prompt-addressed response caches without repaying for
completed calls. Every batch records model, provider, request, prompt hash,
response hash, timestamp, and cache path. The key is never persisted.

Use `--no-fetch` or `--no-probe` for an offline rerun. The lower-level commands
remain available for artifact import and debugging:

```sh
npm run benchmark:import-ecosystem -- eval-dataset/ecosystem judgments /path/to/judgments.jsonl
npm run benchmark:import-ecosystem -- eval-dataset/ecosystem outcomes /path/to/outcomes.jsonl
npm run benchmark:run -- --no-fetch --no-probe --recommendations=/path/to/recommendations.jsonl
```

The fetch command reads the public CDP Bazaar, x402.direct, and Agent Tools
endpoints by default. Optional sources can be enabled with
`ECOSYSTEM_X402SCAN_URL` and `ECOSYSTEM_OPENX402_URL`. Override any default
with `ECOSYSTEM_CDP_URL`, `ECOSYSTEM_X402_DIRECT_URL`, or
`ECOSYSTEM_AGENT_TOOLS_URL`.

A source failure is recorded in the manifest while other sources continue. The
command fails only when every configured source fails or no record has a valid
HTTP(S) resource URL.

`benchmark:probe-ecosystem` performs bounded `HEAD` requests only. It never
creates a wallet, sends an x402 payment, or invokes a paid operation. HTTP 402,
authentication challenges, redirects, and 405 are recorded as reachable; 4xx
and 5xx responses outside those cases are failures. It probes at most 500
resources by default; use `ECOSYSTEM_PROBE_LIMIT=0` for a full catalog probe.

## Judgment and run contracts

`queries-v1.jsonl` contains natural-language needs and canonical filters.
`judgments-v1.jsonl` uses grades 0–3 and separately labels operational
eligibility. A semantically relevant but unsafe, stale, or unreachable service
must receive grade 0 with a non-eligible label.

`runs/recommendations-v1.jsonl` is the adapter boundary for a recommender:

```json
{
  "query_id": "eco-qry-0001",
  "ranked_resource_ids": ["eco-0123456789abcdef"],
  "latency_ms": 38,
  "selected_resource_id": "eco-0123456789abcdef"
}
```

`outcomes-v1.jsonl` records the actual selected-service payment and invocation
result. The evaluator reports ranking quality separately from paid task
completion so a popular or semantically similar but broken service cannot look
successful merely because it ranked highly.

## Evidence and release policy

The combined report is complete only when the controlled judgments are final
and the complete live pool has judgments plus a recommendation run. Missing live
judgments are reported as incomplete evidence; they are never interpreted as
irrelevance or successful no-result queries. The controlled cohort remains the
deterministic release gate inside the program. Live temporal evidence augments
that decision but never replaces frozen qrels, and external popularity scores
never become labels.
