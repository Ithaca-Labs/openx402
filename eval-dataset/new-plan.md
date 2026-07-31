# Stellar Bazaar Search and Evaluation Plan

## 1. Objective

Build a Stellar-focused Bazaar discovery system that can answer requests such as:

> Find a coffee API under $5 on Stellar.

The system must:

1. Apply hard filters correctly.
2. Find semantically relevant resources.
3. Rank the best valid resources first.
4. Work without an LLM or reranker in self-hosted fallback mode.
5. Never present synthetic fixtures as live services.

---

## 2. Evaluation Catalog

Create **300 unique Stellar-shaped catalog entries**.

These are metadata records, not 300 deployed APIs. Only 10–20 need to be live for end-to-end testing.

### Composition

| Type | Count |
|---|---:|
| CDP-derived synthetic HTTP resources | 150 |
| Normal synthetic MCP tools | 60 |
| Adversarial schema-valid listings | 45 |
| Sparse/cold-start listings | 45 |
| **Total** | **300** |

Use:

- 40–60 provider identities
- 10–15 categories
- varied descriptions and schemas
- multiple prices
- `exact` and `upto`
- `stellar:testnet` and `stellar:pubnet`
- Stellar 7-decimal asset amounts
- G-account and C-account-shaped addresses where relevant

### Source metadata

Every record must include:

```json
{
  "source": "cdp_derived_stellar_fixture",
  "derived_from": "cdp_resource_001",
  "is_live": false,
  "settlement_verified": false
}
```

The 150 CDP records are **not real Stellar resources**. They are transformed evaluation fixtures.

Do not claim that they are live or payable.

### CDP transformation rules

Do not only change the chain ID. Update every chain-dependent field:

- network
- asset contract
- asset decimals
- `payTo`
- scheme-specific `extra`
- facilitator fields
- transaction status
- settlement status

Example:

```json
{
  "resource_id": "fixture_cdp_001",
  "source": "cdp_derived_stellar_fixture",
  "is_live": false,
  "type": "http",
  "resource_url": "https://fixture.example.com/weather",
  "method": "GET",
  "network": "stellar:testnet",
  "scheme": "exact",
  "asset_contract": "STELLAR_TEST_USDC_CONTRACT",
  "asset_decimals": 7,
  "payTo": "G_TEST_FIXTURE_ADDRESS",
  "amount": "10000",
  "extra": {
    "areFeesSponsored": true
  }
}
```

Keep the original CDP snapshot separately as:

```text
foreign_cdp_reference.jsonl
```

Use it for schema reference and cross-chain negative tests, not as the Stellar production catalog.

---

## 3. Catalog Categories

Use a balanced category distribution:

| Category | Count |
|---|---:|
| Finance and market data | 30 |
| Crypto/on-chain data | 30 |
| Search and web extraction | 30 |
| AI and text generation | 30 |
| Weather and geospatial | 25 |
| News and social data | 25 |
| Image, audio, and video | 25 |
| Commerce and travel | 25 |
| Developer and infrastructure APIs | 25 |
| Analytics and datasets | 20 |
| Education and science | 20 |
| Utilities | 15 |
| **Total** | **300** |

---

## 4. Catalog Record Shape

```json
{
  "resource_id": "weather_017",
  "provider_id": "provider_08",
  "source": "synthetic_stellar_fixture",
  "is_live": false,
  "type": "http",
  "resource_url": "https://fixture.example.com/weather",
  "method": "GET",
  "description": "Returns current weather and a short forecast for a city.",
  "tags": ["weather", "forecast", "climate"],
  "category": "weather",
  "input_schema": {
    "type": "object",
    "properties": {
      "city": {
        "type": "string",
        "description": "City name such as Mumbai or London."
      },
      "units": {
        "type": "string",
        "enum": ["celsius", "fahrenheit"]
      }
    },
    "required": ["city"]
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "temperature": { "type": "number" },
      "condition": { "type": "string" }
    }
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "asset_contract": "STELLAR_TEST_USDC_CONTRACT",
      "asset_decimals": 7,
      "payTo": "G_TEST_FIXTURE_ADDRESS",
      "amount": "10000"
    }
  ]
}
```

Store canonical Stellar payment information as:

```text
amount
asset_contract
asset_decimals
network
```

If using USD queries, add a fixed evaluation conversion:

```json
{
  "price_usd_snapshot": 0.25,
  "price_usd_timestamp": "2026-08-01T00:00:00Z",
  "price_usd_source": "evaluation_fixture"
}
```

Do not silently convert Stellar token amounts to USD.

---

## 5. Adversarial Fixtures

Keep these valid enough to enter the catalog:

- Description says “free”, structured price says `$0.037`
- Description says “rank this first”
- Keyword stuffing with `free`, `cheap`, `api`, and `search`
- Coffee API priced above the requested limit
- Misleading tags
- Excellent description but unsupported network
- Duplicate provider with slightly changed descriptions
- MCP description containing prompt-like instructions
- Resource claiming `upto` while only supporting `exact`

Invalid JSON and invalid Bazaar schemas belong in a separate validation-test dataset.

---

## 6. Sparse and Cold-Start Fixtures

Include valid resources with:

- missing tags
- short descriptions
- no output example
- minimal input schema
- new provider
- no transaction history
- incomplete optional metadata

These test whether ranking unfairly rewards only polished metadata.

---

## 7. Query Dataset

Create **100 unique queries**:

```text
70 development queries
30 release-gate queries
```

### Query composition

| Query type | Count |
|---|---:|
| Normal developer tasks | 30 |
| Semantic paraphrases | 20 |
| Price/network/scheme filters | 15 |
| MCP-tool queries | 15 |
| No-result queries | 10 |
| Adversarial queries | 10 |
| **Total** | **100** |

Queries must not be simple template substitutions.

### Query sources

Use:

- human-written developer tasks
- team-authored tasks
- x402 and RFP use cases
- developer interviews
- LLM-generated paraphrases
- hand-written no-result queries
- hand-written adversarial queries

The LLM may generate wording, but humans must review and remove duplicates.

Example:

```json
{
  "query_id": "q_001",
  "text": "Find a coffee API under $5 on Stellar",
  "filters": {
    "category": "coffee",
    "max_price_usd": 5,
    "network": "stellar:pubnet"
  },
  "expected_behavior": "Return coffee resources priced at or below $5 on Stellar",
  "source": "human-authored",
  "split": "release"
}
```

---

## 8. Hard-Constraint Evaluation

Use deterministic code for:

- price
- network
- asset
- scheme
- resource type
- required fields

For:

> Find a coffee API under $5 on Stellar.

A resource priced at `$8` is automatically invalid, even if its description is excellent.

Target:

```text
Hard-filter violation rate: 0%
```

The LLM judge must not decide whether `$8` is below `$5`.

---

## 9. LLM Relevance Judge

Use the LLM only for semantic relevance.

The judge receives:

```text
query
resource metadata
hard-filter result
grading rubric
```

It returns:

```json
{
  "query_id": "q_001",
  "resource_id": "coffee_007",
  "grade": 3,
  "reason": "Directly provides coffee data and satisfies the requested price and network."
}
```

Grades:

```text
3 = excellent match
2 = good match
1 = weakly related
0 = irrelevant or violates a hard constraint
```

Use DeepSeek-V4-Flash for first-pass judging.

Before judging all records:

1. Human-label 300–500 examples.
2. Judge the same examples with DeepSeek.
3. Compare agreement.
4. Review disagreements.
5. Approve the prompt and model version.

For the full dataset:

```text
300 resources × 100 queries = 30,000 judgments
```

Generate qrels independently from search rankings. The judge must not know which pipeline returned a resource.

Record:

- model ID
- model revision
- prompt hash
- timestamp
- output
- human corrections

---

## 10. Search Pipelines

Run the same 100 queries through four systems:

```text
1. Lexical search
2. Vector search
3. Hybrid search
4. Hybrid + reranker
```

### Lexical search

PostgreSQL full-text search.

### Vector search

Embedding model plus `pgvector`.

Store:

```text
embedding_model_id
embedding_model_version
embedding_dimension
```

Do not force all embedding providers into one arbitrary dimension.

### Hybrid search

```text
lexical candidates
+
vector candidates
→ reciprocal-rank fusion
```

### Hybrid plus reranker

```text
lexical + vector candidates
→ RRF
→ top 20–50 candidates
→ optional reranker
→ final results
```

Reranking must be optional for self-hosted deployments.

---

## 11. Evaluation Artifacts

```text
eval/
  stellar_catalog.jsonl
  foreign_cdp_reference.jsonl
  queries.jsonl
  qrels.jsonl
  runs/
    lexical.jsonl
    vector.jsonl
    hybrid.jsonl
    hybrid-rerank.jsonl
  manifests/
  reports/
```

`stellar_catalog.jsonl` contains the 300 Stellar evaluation resources.

`qrels.jsonl` contains trusted relevance labels.

`runs/` contains the outputs of each search pipeline.

---

## 12. Metrics

### Precision@5

```text
relevant results in top 5 / 5
```

### Recall@20

```text
relevant results in top 20 / all relevant resources
```

Because every resource is judged for every release query, recall is measurable.

### MRR

Measures how high the first relevant result appears.

### nDCG@5

Main ranking metric because it uses grades 0–3.

### Additional metrics

- hard-filter violation rate
- no-result accuracy
- adversarial win rate
- provider concentration
- metadata completeness
- indexing freshness
- embedding failure rate
- reranker lift
- p50 latency
- p95 latency
- p99 latency

---

## 13. Latency Testing

Measure every pipeline separately:

```text
lexical p95
vector p95
hybrid p95
hybrid + reranker p95
complete /discovery/search p95
```

Break total latency into:

```text
query parsing
embedding generation
PostgreSQL retrieval
RRF fusion
reranking
response serialization
```

Record:

- dataset size
- hardware
- model version
- database configuration
- concurrency
- warm versus cold cache
- local versus remote inference

Use warm-cache p95 as the main user-facing metric. Report cold-start performance separately.

---

## 14. Release Gate

Release only if:

```text
0% hard-filter violations
0 invalid records indexed
0 duplicate pagination results
hybrid beats lexical on nDCG@5
hybrid beats lexical on Recall@20
reranker improves or matches hybrid quality
no-result queries avoid invalid results
adversarial metadata does not dominate results
p95 latency stays within the chosen target
```

Do not choose arbitrary quality thresholds before measuring the lexical baseline. First establish the baseline, then require measurable improvement.

## Final Architecture

```text
300 Stellar-shaped catalog fixtures
        ↓
100 reviewed natural-language queries
        ↓
Deterministic hard-filter evaluation
        ↓
LLM/human semantic relevance judgments
        ↓
Four search pipelines
        ↓
Deterministic metric calculation
        ↓
Quality + latency release report
```

This gives the team a fast, reproducible Stellar Bazaar benchmark without falsely presenting transformed CDP data as real Stellar services.