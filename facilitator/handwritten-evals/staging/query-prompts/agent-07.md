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
- prompt_hash: `sha256:d5cb9356ed056db05b338ec5be0632e2762824267b960c095ca871689aac864a`
- output: `handwritten-evals/staging/queries/run-queries-07/queries.jsonl`

Use every table value exactly. `—` means omit that optional field. The capability cell is an
authoring brief, not query text. Never expose benchmark metadata in the query.

| id | split | class | register | family | buyer capability | filters | evaluation_constraints | MCP subtype | MCP facts | forbidden id | forbidden_capability | trap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qry-061 | release | structured | terse_agent | F20 — News & feeds | headline_feed | {"type":"mcp","scheme":"upto"} | {} | — | — | — | — | — |
| qry-062 | release | price_category | verbose_natural | F1 — On-chain state / block data | contract_event_log | {} | {"max_price_usd":0.003} | — | — | — | — | — |
| qry-063 | release | mcp | keyword_only | F9 — LLM inference | streaming_completion | {"type":"mcp"} | {} | tool_schema | server=llm-streaming-completions; tool=stream_chat_completion; transport=sse; input_schema_shape=flat_scalars | — | — | — |
| qry-064 | release | adversarial | terse_agent | F8 — Equities & company data | corporate_actions_feed | {} | {} | — | — | — | — | misleading_tags |
| qry-065 | release | cold_start | verbose_natural | F20 — News & feeds | feed_sentiment_tags | {} | {} | — | — | — | — | — |
| qry-066 | release | no_result | keyword_only | null | Generative image synthesis | {} | {} | — | — | FC-07 | Generative image synthesis | — |
| qry-067 | release | capability | terse_agent | F7 — Macro indicators | release_calendar | {} | {} | — | — | — | — | — |
| qry-068 | release | semantic | verbose_natural | F8 — Equities & company data | company_profile_lookup | {} | {} | — | — | — | — | — |
| qry-069 | release | structured | keyword_only | F4 — Address & wallet risk scoring | bulk_address_scoring | {"network":"stellar:testnet","scheme":"upto"} | {} | — | — | — | — | — |
| qry-070 | release | price_category | terse_agent | F5 — Compliance / sanctions screening | jurisdiction_rule_lookup | {} | {"max_price_usd":0.001} | — | — | — | — | — |

For every record use provider `anthropic`, the actual exact model/revision and timestamp,
`generation_id: "run-queries-07"`, `review_status: "pending"`, `reviewed_at: null`, and
`owner_note: null`. Write a real, specific use-case rationale. For adversarial assignments add a
specific trap rationale. Validate the ten JSONL lines, then stop. Never inspect or launch another
authoring context.
