# Step 5 query authoring — isolated agent 10

Author exactly ten buyer query records. Do not author resources, query answers, candidates, grades,
qrels, reviews, or retrieval output. This context is fresh; discard it after writing the shard.

Read in full: `handwritten-evals/staging/BRIEF-queries.md`,
`handwritten-evals/spec/families.md`, `handwritten-evals/forbidden-capabilities.md`, and the
`QueryRecordSchema` section of `handwritten-evals/schema/schema-v2.ts`.

Do not read catalog/sidecar files, resource or distractor shards, sibling query prompts/outputs,
queries, qrels, runs, pool files, retrieval code, or ranking output. The table below is the complete
buyer-use-case task pack; there are no placeholders to resolve elsewhere.

- run_id: `run-queries-10`
- shard_id: `shard-queries-10`
- prompt_hash: `sha256:a42157f0201e704b6fb6baa4403b02eb5c7354be5e301f6a6dcb8e399be1dd54`
- output: `handwritten-evals/staging/queries/run-queries-10/queries.jsonl`

Use every table value exactly. `—` means omit that optional field. The capability cell is an
authoring brief, not query text. Never expose benchmark metadata in the query.

| id | split | class | register | family | buyer capability | filters | evaluation_constraints | MCP subtype | MCP facts | forbidden id | forbidden_capability | trap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qry-091 | release | semantic | terse_agent | F18 — Weather | historical_observations | {} | {} | — | — | — | — | — |
| qry-092 | release | structured | verbose_natural | F19 — Translation & language | batch_document_translate | {"extensions":"bazaar"} | {} | — | — | — | — | — |
| qry-093 | release | capability | keyword_only | F20 — News & feeds | entity_news_timeline | {} | {} | — | — | — | — | — |
| qry-094 | release | capability | terse_agent | F1 — On-chain state / block data | contract_event_log | {} | {} | — | — | — | — | — |
| qry-095 | release | capability | verbose_natural | F2 — Token & market prices | twap_reference_price | {} | {} | — | — | — | — | — |
| qry-096 | release | capability | keyword_only | F3 — DeFi / DEX analytics | lp_yield_history | {} | {} | — | — | — | — | — |
| qry-097 | release | capability | terse_agent | F4 — Address & wallet risk scoring | exposure_breakdown | {} | {} | — | — | — | — | — |
| qry-098 | release | capability | verbose_natural | F5 — Compliance / sanctions screening | pep_adverse_media_check | {} | {} | — | — | — | — | — |
| qry-099 | release | capability | keyword_only | F6 — Regulatory documents | regulation_text_fetch | {} | {} | — | — | — | — | — |
| qry-100 | release | capability | terse_agent | F7 — Macro indicators | yield_curve_snapshot | {} | {} | — | — | — | — | — |

For every record use provider `anthropic`, the actual exact model/revision and timestamp,
`generation_id: "run-queries-10"`, `review_status: "pending"`, `reviewed_at: null`, and
`owner_note: null`. Write a real, specific use-case rationale. For adversarial assignments add a
specific trap rationale. Validate the ten JSONL lines, then stop. Never inspect or launch another
authoring context.
