# Step 5 query authoring — isolated agent 05

Author exactly ten buyer query records. Do not author resources, query answers, candidates, grades,
qrels, reviews, or retrieval output. This context is fresh; discard it after writing the shard.

Read in full: `handwritten-evals/staging/BRIEF-queries.md`,
`handwritten-evals/spec/families.md`, `handwritten-evals/forbidden-capabilities.md`, and the
`QueryRecordSchema` section of `handwritten-evals/schema/schema-v2.ts`.

Do not read catalog/sidecar files, resource or distractor shards, sibling query prompts/outputs,
queries, qrels, runs, pool files, retrieval code, or ranking output. The table below is the complete
buyer-use-case task pack; there are no placeholders to resolve elsewhere.

- run_id: `run-queries-05`
- shard_id: `shard-queries-05`
- prompt_hash: `sha256:d97fbfa9c2d0aa76cd5dc2035e440c00a386c90d3fdd7c2a0ddc809a738841f9`
- output: `handwritten-evals/staging/queries/run-queries-05/queries.jsonl`

Use every table value exactly. `—` means omit that optional field. The capability cell is an
authoring brief, not query text. Never expose benchmark metadata in the query.

| id | split | class | register | family | buyer capability | filters | evaluation_constraints | MCP subtype | MCP facts | forbidden id | forbidden_capability | trap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qry-041 | development | semantic | verbose_natural | F4 — Address & wallet risk scoring | tx_risk_screen | {} | {} | — | — | — | — | — |
| qry-042 | development | structured | keyword_only | F5 — Compliance / sanctions screening | address_watchlist_check | {"extensions":"bazaar"} | {} | — | — | — | — | — |
| qry-043 | development | capability | terse_agent | F6 — Regulatory documents | rule_docket_timeline | {} | {} | — | — | — | — | — |
| qry-044 | development | capability | verbose_natural | F7 — Macro indicators | release_calendar | {} | {} | — | — | — | — | — |
| qry-045 | development | capability | keyword_only | F8 — Equities & company data | company_profile_lookup | {} | {} | — | — | — | — | — |
| qry-046 | development | capability | terse_agent | F9 — LLM inference | json_mode_extraction | {} | {} | — | — | — | — | — |
| qry-047 | development | capability | verbose_natural | F10 — Embeddings & vector ops | batch_embedding | {} | {} | — | — | — | — | — |
| qry-048 | development | capability | keyword_only | F11 — Web search | site_restricted_search | {} | {} | — | — | — | — | — |
| qry-049 | development | capability | terse_agent | F12 — Web scraping / extraction | structured_field_extraction | {} | {} | — | — | — | — | — |
| qry-050 | development | capability | verbose_natural | F13 — Attested / signed feeds | attested_randomness | {} | {} | — | — | — | — | — |

For every record use provider `anthropic`, the actual exact model/revision and timestamp,
`generation_id: "run-queries-05"`, `review_status: "pending"`, `reviewed_at: null`, and
`owner_note: null`. Write a real, specific use-case rationale. For adversarial assignments add a
specific trap rationale. Validate the ten JSONL lines, then stop. Never inspect or launch another
authoring context.
