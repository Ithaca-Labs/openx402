# Stellar Bazaar Golden Search Dataset v1.0.0

Immutable English-only offline benchmark generated from the pinned authoring inputs in
`../source-fixtures/` and judged with the injection-resistant prompt in `../prompts/`.

## Release inventory

- Catalog: 1000 resource versions (800 HTTP, 200 MCP).
- Queries: 200 (140 development, 60 release gate).
- Qrels: 1145 explicit graded judgments; grades 2 and 3 are positive for binary metrics.
- Lifecycle: {'active': 901, 'quarantined': 30, 'stale': 69}.

## Query taxonomy coverage

- `adversarial_metadata`: 25
- `cold_start`: 25
- `lexical_intent`: 75
- `no_result`: 25
- `origin_diversity`: 25
- `price_language`: 50
- `semantic_paraphrase`: 50
- `structured_filter`: 125

Each class occurs in both splits. Searchable fields contain realistic sparse, misleading,
and keyword-stuffed declarations. `authoring_notes` mark synthetic deceptive fixtures and
must be removed before indexing; they never state an expected result or grade.

## Validation and judging

From `eval-dataset/`, run `python3 validate_dataset.py`. The validator is offline and checks
canonical bytes, hashes, counts, IDs, exact pinned versions, filter types, no-result qrels,
ordering, taxonomy coverage, and transport balance.

`llm_judge.py` creates a new judgment artifact and never overwrites this release. It requires
an OpenAI-compatible endpoint and an exact model revision supplied by the operator. Published
artifacts are immutable; corrections require a new semantic dataset version.
