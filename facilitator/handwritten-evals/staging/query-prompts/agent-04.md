# Step 5 query authoring — isolated agent 04

Author exactly 20 buyer query records. Do not author resources, query answers, candidates, grades,
qrels, reviews, or retrieval output. This context is fresh; discard it after writing the shard.

Read in full: `handwritten-evals/staging/BRIEF-queries.md`,
`handwritten-evals/spec/families.md`, `handwritten-evals/forbidden-capabilities.md`, and the
`QueryRecordSchema` section of `handwritten-evals/schema/schema-v2.ts`.

Do not read catalog/sidecar files, resource or distractor shards, sibling query prompts/outputs,
queries, qrels, runs, pool files, retrieval code, or ranking output. The table below is the complete
buyer-use-case task pack; there are no placeholders to resolve elsewhere.

- run_id: `run-queries-04`
- shard_id: `shard-queries-04`
- prompt_hash: `sha256:6017e98b310cf03d241636abce3d11e233dd80c2ecaaa92431aed86d353f7b34`
- output: `handwritten-evals/staging/queries/run-queries-04/queries.jsonl`

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
| qry-071 | release | mcp | verbose_natural | F14 — Analytics & metrics | top_n_leaderboard | {"type":"mcp"} | {} | transport | server=leaderboard-analytics-mcp; tool=get_top_n_leaderboard; transport=sse; input_schema_shape=enum_union | — | — | — |
| qry-072 | release | adversarial | keyword_only | F9 — LLM inference | json_mode_extraction | {} | {} | — | — | — | — | ranking_instruction |
| qry-073 | release | no_result | terse_agent | null | Speech-to-text transcription | {} | {} | — | — | FC-08 | Speech-to-text transcription | — |
| qry-074 | release | capability | verbose_natural | F9 — LLM inference | json_mode_extraction | {} | {} | — | — | — | — | — |
| qry-075 | release | semantic | keyword_only | F10 — Embeddings & vector ops | batch_embedding | {} | {} | — | — | — | — | — |
| qry-076 | release | structured | terse_agent | F8 — Equities & company data | filing_index_search | {"network":"stellar:pubnet"} | {} | — | — | — | — | — |
| qry-077 | release | price_category | verbose_natural | F9 — LLM inference | summarize_long_document | {} | {"max_price_usd":0.003} | — | — | — | — | — |
| qry-078 | release | mcp | keyword_only | F18 — Weather | severe_alerts | {"type":"mcp"} | {} | http_vs_mcp | server=weather-alerts-mcp; tool=get_severe_alerts; transport=streamable-http; input_schema_shape=flat_scalars | — | — | — |
| qry-079 | release | adversarial | terse_agent | F12 — Web scraping / extraction | headless_render_status | {} | {} | — | — | — | — | unsupported_network_claim |
| qry-080 | release | no_result | verbose_natural | null | Text-to-speech synthesis | {} | {} | — | — | FC-09 | Text-to-speech synthesis | — |

For every record use provider `anthropic`, the actual exact model/revision and timestamp,
`generation_id: "run-queries-04"`, `review_status: "pending"`, `reviewed_at: null`, and
`owner_note: null`. Write a real, specific use-case rationale. For adversarial assignments add a
specific trap rationale. Validate the 20 JSONL lines, then stop. Never inspect or launch another
authoring context.
