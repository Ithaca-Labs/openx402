# Step 5 query authoring — isolated agent 07

Author exactly ten buyer query records. Do not author resources, query answers, candidates, grades,
qrels, reviews, or retrieval output. This context is fresh; discard it after writing the shard.

Read in full: `handwritten-evals/staging/BRIEF-queries.md`,
`handwritten-evals/spec/families.md`, `handwritten-evals/forbidden-capabilities.md`, and the
`QueryRecordSchema` section of `handwritten-evals/schema/schema-v2.ts`.

Do not read catalog/sidecar files, resource or distractor shards, sibling query prompts/outputs,
queries, qrels, runs, pool files, retrieval code, or ranking output. The table below is the complete
buyer-use-case task pack; there are no placeholders to resolve elsewhere.

- run_id: `run-queries-07`
- shard_id: `shard-queries-07`
- prompt_hash: `sha256:011d7ebe7489e7ef784ad3678a65513828c55084839627dd5d4034c317fceb31`
- output: `handwritten-evals/staging/queries/run-queries-07/queries.jsonl`

Use every table value exactly. `—` means omit that optional field. The capability cell is an
authoring brief, not query text. Never expose benchmark metadata in the query.

| id | split | class | register | family | buyer capability | filters | evaluation_constraints | MCP subtype | MCP facts | forbidden id | forbidden_capability | trap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qry-061 | release | structured | terse_agent | F20 — News & feeds | keyword_news_alerts | {"extensions":"bazaar"} | {} | — | — | — | — | — |
| qry-062 | release | price_category | verbose_natural | F1 — On-chain state / block data | tx_receipt_lookup | {} | {"max_price_usd":0.15} | — | — | — | — | — |
| qry-063 | release | mcp | keyword_only | F9 — LLM inference | streaming_completion | {"type":"mcp"} | {} | tool_schema | server=llm-streaming-completions; tool=stream_chat_completion; transport=sse; input_schema_shape=flat_scalars | — | — | — |
| qry-064 | release | adversarial | terse_agent | F8 — Equities & company data | corporate_actions_feed | {} | {} | — | — | — | — | misleading_tags |
| qry-065 | release | cold_start | verbose_natural | F20 — News & feeds | feed_sentiment_tags | {} | {} | — | — | — | — | — |
| qry-066 | release | no_result | keyword_only | null | Generative image synthesis | {} | {} | — | — | FC-07 | Generative image synthesis | — |
| qry-067 | release | capability | terse_agent | F2 — Token & market prices | batch_price_quote | {} | {} | — | — | — | — | — |
| qry-068 | release | semantic | verbose_natural | F3 — DeFi / DEX analytics | tvl_by_protocol | {} | {} | — | — | — | — | — |
| qry-069 | release | structured | keyword_only | F4 — Address & wallet risk scoring | cluster_attribution | {"extensions":"bazaar"} | {} | — | — | — | — | — |
| qry-070 | release | price_category | terse_agent | F5 — Compliance / sanctions screening | jurisdiction_rule_lookup | {} | {"max_price_usd":0.15} | — | — | — | — | — |

For every record use provider `anthropic`, the actual exact model/revision and timestamp,
`generation_id: "run-queries-07"`, `review_status: "pending"`, `reviewed_at: null`, and
`owner_note: null`. Write a real, specific use-case rationale. For adversarial assignments add a
specific trap rationale. Validate the ten JSONL lines, then stop. Never inspect or launch another
authoring context.
