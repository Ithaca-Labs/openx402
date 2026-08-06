# Step 5 query authoring — isolated agent 08

Author exactly ten buyer query records. Do not author resources, query answers, candidates, grades,
qrels, reviews, or retrieval output. This context is fresh; discard it after writing the shard.

Read in full: `handwritten-evals/staging/BRIEF-queries.md`,
`handwritten-evals/spec/families.md`, `handwritten-evals/forbidden-capabilities.md`, and the
`QueryRecordSchema` section of `handwritten-evals/schema/schema-v2.ts`.

Do not read catalog/sidecar files, resource or distractor shards, sibling query prompts/outputs,
queries, qrels, runs, pool files, retrieval code, or ranking output. The table below is the complete
buyer-use-case task pack; there are no placeholders to resolve elsewhere.

- run_id: `run-queries-08`
- shard_id: `shard-queries-08`
- prompt_hash: `sha256:d609872c7f1c636d79c39fcc72d144231012362c2405b9e3c89ed070e068bd1c`
- output: `handwritten-evals/staging/queries/run-queries-08/queries.jsonl`

Use every table value exactly. `—` means omit that optional field. The capability cell is an
authoring brief, not query text. Never expose benchmark metadata in the query.

| id | split | class | register | family | buyer capability | filters | evaluation_constraints | MCP subtype | MCP facts | forbidden id | forbidden_capability | trap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qry-071 | release | mcp | verbose_natural | F14 — Analytics & metrics | top_n_leaderboard | {"type":"mcp"} | {} | transport | server=leaderboard-analytics-mcp; tool=get_top_n_leaderboard; transport=sse; input_schema_shape=enum_union | — | — | — |
| qry-072 | release | adversarial | keyword_only | F9 — LLM inference | json_mode_extraction | {} | {} | — | — | — | — | ranking_instruction |
| qry-073 | release | no_result | terse_agent | null | Speech-to-text transcription | {} | {} | — | — | FC-08 | Speech-to-text transcription | — |
| qry-074 | release | capability | verbose_natural | F6 — Regulatory documents | comment_period_alerts | {} | {} | — | — | — | — | — |
| qry-075 | release | semantic | keyword_only | F7 — Macro indicators | fx_reference_rate | {} | {} | — | — | — | — | — |
| qry-076 | release | structured | terse_agent | F8 — Equities & company data | filing_index_search | {"extensions":"bazaar"} | {} | — | — | — | — | — |
| qry-077 | release | price_category | verbose_natural | F9 — LLM inference | summarize_long_document | {} | {"max_price_usd":0.15} | — | — | — | — | — |
| qry-078 | release | mcp | keyword_only | F18 — Weather | severe_alerts | {"type":"mcp"} | {} | http_vs_mcp | server=weather-alerts-mcp; tool=get_severe_alerts; transport=streamable-http; input_schema_shape=flat_scalars | — | — | — |
| qry-079 | release | adversarial | terse_agent | F12 — Web scraping / extraction | headless_render_status | {} | {} | — | — | — | — | unsupported_network_claim |
| qry-080 | release | no_result | verbose_natural | null | Text-to-speech synthesis | {} | {} | — | — | FC-09 | Text-to-speech synthesis | — |

For every record use provider `anthropic`, the actual exact model/revision and timestamp,
`generation_id: "run-queries-08"`, `review_status: "pending"`, `reviewed_at: null`, and
`owner_note: null`. Write a real, specific use-case rationale. For adversarial assignments add a
specific trap rationale. Validate the ten JSONL lines, then stop. Never inspect or launch another
authoring context.
