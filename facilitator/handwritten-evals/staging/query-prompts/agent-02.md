# Step 5 query authoring — isolated agent 02

Author exactly ten buyer query records. Do not author resources, query answers, candidates, grades,
qrels, reviews, or retrieval output. This context is fresh; discard it after writing the shard.

Read in full: `handwritten-evals/staging/BRIEF-queries.md`,
`handwritten-evals/spec/families.md`, `handwritten-evals/forbidden-capabilities.md`, and the
`QueryRecordSchema` section of `handwritten-evals/schema/schema-v2.ts`.

Do not read catalog/sidecar files, resource or distractor shards, sibling query prompts/outputs,
queries, qrels, runs, pool files, retrieval code, or ranking output. The table below is the complete
buyer-use-case task pack; there are no placeholders to resolve elsewhere.

- run_id: `run-queries-02`
- shard_id: `shard-queries-02`
- prompt_hash: `sha256:e5d412148a4034710f28993e1bd0f833a67a1e9354e934aace1b51dc1024ec58`
- output: `handwritten-evals/staging/queries/run-queries-02/queries.jsonl`

Use every table value exactly. `—` means omit that optional field. The capability cell is an
authoring brief, not query text. Never expose benchmark metadata in the query.

| id | split | class | register | family | buyer capability | filters | evaluation_constraints | MCP subtype | MCP facts | forbidden id | forbidden_capability | trap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qry-011 | development | structured | verbose_natural | F7 — Macro indicators | fx_reference_rate | {"type":"mcp"} | {} | — | — | — | — | — |
| qry-012 | development | price_category | keyword_only | F8 — Equities & company data | equity_quote | {} | {"max_price_usd":0.002} | — | — | — | — | — |
| qry-013 | development | mcp | terse_agent | F2 — Token & market prices | historical_price_series | {"type":"mcp"} | {} | tool_schema | server=stellar-price-history-server; tool=get_historical_price_series; transport=sse; input_schema_shape=nested_object | — | — | — |
| qry-014 | development | adversarial | verbose_natural | F2 — Token & market prices | spot_price_lookup | {} | {} | — | — | — | — | false_free_claim |
| qry-015 | development | cold_start | keyword_only | F8 — Equities & company data | filing_index_search | {} | {} | — | — | — | — | — |
| qry-016 | development | no_result | terse_agent | null | Transactional email delivery | {} | {} | — | — | FC-02 | Transactional email delivery | — |
| qry-017 | development | capability | verbose_natural | F5 — Compliance / sanctions screening | sanctions_name_screen | {} | {} | — | — | — | — | — |
| qry-018 | development | semantic | keyword_only | F6 — Regulatory documents | federal_register_search | {} | {} | — | — | — | — | — |
| qry-019 | development | structured | terse_agent | F11 — Web search | related_questions | {"network":"stellar:pubnet","scheme":"upto"} | {} | — | — | — | — | — |
| qry-020 | development | price_category | verbose_natural | F12 — Web scraping / extraction | page_to_markdown | {} | {"max_price_usd":0.005} | — | — | — | — | — |

For every record use provider `anthropic`, the actual exact model/revision and timestamp,
`generation_id: "run-queries-02"`, `review_status: "pending"`, `reviewed_at: null`, and
`owner_note: null`. Write a real, specific use-case rationale. For adversarial assignments add a
specific trap rationale. Validate the ten JSONL lines, then stop. Never inspect or launch another
authoring context.
