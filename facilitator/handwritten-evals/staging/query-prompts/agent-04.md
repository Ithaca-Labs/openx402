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
- prompt_hash: `sha256:b2e80da5079f6e569b12d2a71b73ee58a4ea5084137503cf5616fbcbedddc31f`
- output: `handwritten-evals/staging/queries/run-queries-04/queries.jsonl`

Use every table value exactly. `—` means omit that optional field. The capability cell is an
authoring brief, not query text. Never expose benchmark metadata in the query.

| id | split | class | register | family | buyer capability | filters | evaluation_constraints | MCP subtype | MCP facts | forbidden id | forbidden_capability | trap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qry-031 | development | no_result | terse_agent | null | Object storage and file hosting | {} | {} | — | — | FC-04 | Object storage and file hosting | — |
| qry-032 | development | capability | verbose_natural | F17 — Geocoding & mapping | forward_geocode | {} | {} | — | — | — | — | — |
| qry-033 | development | semantic | keyword_only | F18 — Weather | current_conditions | {} | {} | — | — | — | — | — |
| qry-034 | development | structured | terse_agent | F19 — Translation & language | text_translate | {"extensions":"bazaar"} | {} | — | — | — | — | — |
| qry-035 | development | mcp | verbose_natural | F5 — Compliance / sanctions screening | sanctions_name_screen | {"type":"mcp"} | {} | tuple_identity | server=sanctions-screen-mcp; tool=screen_name; transport=streamable-http; input_schema_shape=flat_scalars | — | — | — |
| qry-036 | development | no_result | keyword_only | null | Managed relational database queries | {} | {} | — | — | FC-05 | Managed relational database queries | — |
| qry-037 | development | capability | terse_agent | F20 — News & feeds | headline_feed | {} | {} | — | — | — | — | — |
| qry-038 | development | semantic | verbose_natural | F1 — On-chain state / block data | block_header_stream | {} | {} | — | — | — | — | — |
| qry-039 | development | structured | keyword_only | F2 — Token & market prices | ohlcv_candles | {"extensions":"bazaar"} | {} | — | — | — | — | — |
| qry-040 | development | capability | terse_agent | F3 — DeFi / DEX analytics | swap_route_quote | {} | {} | — | — | — | — | — |

For every record use provider `anthropic`, the actual exact model/revision and timestamp,
`generation_id: "run-queries-04"`, `review_status: "pending"`, `reviewed_at: null`, and
`owner_note: null`. Write a real, specific use-case rationale. For adversarial assignments add a
specific trap rationale. Validate the ten JSONL lines, then stop. Never inspect or launch another
authoring context.
