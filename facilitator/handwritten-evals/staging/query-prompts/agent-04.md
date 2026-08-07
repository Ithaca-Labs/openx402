# Step 5 query authoring — isolated agent 04

Author exactly ten buyer query records. Do not author resources, query answers, candidates, grades,
qrels, reviews, or retrieval output. This context is fresh; discard it after writing the shard.

Read in full: `handwritten-evals/staging/BRIEF-queries.md`,
`handwritten-evals/spec/families.md`, `handwritten-evals/forbidden-capabilities.md`, and the
`QueryRecordSchema` section of `handwritten-evals/schema/schema-v2.ts`.

Do not read catalog/sidecar files, resource or distractor shards, sibling query prompts/outputs,
queries, qrels, runs, pool files, retrieval code, or ranking output. The table below is the complete
buyer-use-case task pack; there are no placeholders to resolve elsewhere.

- run_id: `run-queries-04`
- shard_id: `shard-queries-04`
- prompt_hash: `sha256:cbc9320a2ef05ee76f4d9040da1fc6cee51c69df6ca2f2ef58260193244c0a55`
- output: `handwritten-evals/staging/queries/run-queries-04/queries.jsonl`

Use every table value exactly. `—` means omit that optional field. The capability cell is an
authoring brief, not query text. Never expose benchmark metadata in the query.

| id | split | class | register | family | buyer capability | filters | evaluation_constraints | MCP subtype | MCP facts | forbidden id | forbidden_capability | trap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qry-031 | development | no_result | terse_agent | null | Object storage and file hosting | {} | {} | — | — | FC-04 | Object storage and file hosting | — |
| qry-032 | development | capability | verbose_natural | F9 — LLM inference | chat_completion | {} | {} | — | — | — | — | — |
| qry-033 | development | semantic | keyword_only | F10 — Embeddings & vector ops | text_embedding | {} | {} | — | — | — | — | — |
| qry-034 | development | structured | terse_agent | F19 — Translation & language | transliteration | {"scheme":"upto"} | {} | — | — | — | — | — |
| qry-035 | development | mcp | verbose_natural | F5 — Compliance / sanctions screening | sanctions_name_screen | {"type":"mcp"} | {} | tuple_identity | server=sanctions-screen-mcp; tool=screen_name; transport=streamable-http; input_schema_shape=flat_scalars | — | — | — |
| qry-036 | development | no_result | keyword_only | null | Managed relational database queries | {} | {} | — | — | FC-05 | Managed relational database queries | — |
| qry-037 | development | capability | terse_agent | F11 — Web search | web_search_results | {} | {} | — | — | — | — | — |
| qry-038 | development | semantic | verbose_natural | F12 — Web scraping / extraction | page_to_markdown | {} | {} | — | — | — | — | — |
| qry-039 | development | structured | keyword_only | F2 — Token & market prices | historical_price_series | {"type":"mcp"} | {} | — | — | — | — | — |
| qry-040 | development | capability | terse_agent | F13 — Attested / signed feeds | signed_price_attestation | {} | {} | — | — | — | — | — |

For every record use provider `anthropic`, the actual exact model/revision and timestamp,
`generation_id: "run-queries-04"`, `review_status: "pending"`, `reviewed_at: null`, and
`owner_note: null`. Write a real, specific use-case rationale. For adversarial assignments add a
specific trap rationale. Validate the ten JSONL lines, then stop. Never inspect or launch another
authoring context.
