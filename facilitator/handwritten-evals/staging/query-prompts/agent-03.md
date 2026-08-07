# Step 5 query authoring — isolated agent 03

Author exactly ten buyer query records. Do not author resources, query answers, candidates, grades,
qrels, reviews, or retrieval output. This context is fresh; discard it after writing the shard.

Read in full: `handwritten-evals/staging/BRIEF-queries.md`,
`handwritten-evals/spec/families.md`, `handwritten-evals/forbidden-capabilities.md`, and the
`QueryRecordSchema` section of `handwritten-evals/schema/schema-v2.ts`.

Do not read catalog/sidecar files, resource or distractor shards, sibling query prompts/outputs,
queries, qrels, runs, pool files, retrieval code, or ranking output. The table below is the complete
buyer-use-case task pack; there are no placeholders to resolve elsewhere.

- run_id: `run-queries-03`
- shard_id: `shard-queries-03`
- prompt_hash: `sha256:7c2cc5104e3439da435c4c23ebb349dbf313194a234fd4c7aa13e6e75dee44f1`
- output: `handwritten-evals/staging/queries/run-queries-03/queries.jsonl`

Use every table value exactly. `—` means omit that optional field. The capability cell is an
authoring brief, not query text. Never expose benchmark metadata in the query.

| id | split | class | register | family | buyer capability | filters | evaluation_constraints | MCP subtype | MCP facts | forbidden id | forbidden_capability | trap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qry-021 | development | mcp | keyword_only | F3 — DeFi / DEX analytics | swap_route_quote | {"type":"mcp"} | {} | transport | server=stellar-swap-router-mcp; tool=get_swap_route_quote; transport=streamable-http; input_schema_shape=nested_object | — | — | — |
| qry-022 | development | adversarial | terse_agent | F4 — Address & wallet risk scoring | address_risk_score | {} | {} | — | — | — | — | capability_spoof |
| qry-023 | development | cold_start | verbose_natural | F12 — Web scraping / extraction | structured_field_extraction | {} | {} | — | — | — | — | — |
| qry-024 | development | no_result | keyword_only | null | SMS and telephony message delivery | {} | {} | — | — | FC-03 | SMS and telephony message delivery | — |
| qry-025 | development | capability | terse_agent | F7 — Macro indicators | indicator_series_fetch | {} | {} | — | — | — | — | — |
| qry-026 | development | semantic | verbose_natural | F8 — Equities & company data | equity_quote | {} | {} | — | — | — | — | — |
| qry-027 | development | structured | keyword_only | F15 — Identity & KYC | proof_of_address_check | {"network":"stellar:testnet"} | {} | — | — | — | — | — |
| qry-028 | development | price_category | terse_agent | F16 — Document parsing / OCR | page_classification | {} | {"max_price_usd":0.002} | — | — | — | — | — |
| qry-029 | development | mcp | verbose_natural | F4 — Address & wallet risk scoring | exposure_breakdown | {"type":"mcp"} | {} | http_vs_mcp | server=wallet-exposure-mcp; tool=get_exposure_breakdown; transport=sse; input_schema_shape=array_input | — | — | — |
| qry-030 | development | adversarial | keyword_only | F5 — Compliance / sanctions screening | jurisdiction_rule_lookup | {} | {} | — | — | — | — | scheme_mismatch_claim |

For every record use provider `anthropic`, the actual exact model/revision and timestamp,
`generation_id: "run-queries-03"`, `review_status: "pending"`, `reviewed_at: null`, and
`owner_note: null`. Write a real, specific use-case rationale. For adversarial assignments add a
specific trap rationale. Validate the ten JSONL lines, then stop. Never inspect or launch another
authoring context.
