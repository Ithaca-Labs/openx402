# Step 5 query authoring — isolated agent 06

Author exactly ten buyer query records. Do not author resources, query answers, candidates, grades,
qrels, reviews, or retrieval output. This context is fresh; discard it after writing the shard.

Read in full: `handwritten-evals/staging/BRIEF-queries.md`,
`handwritten-evals/spec/families.md`, `handwritten-evals/forbidden-capabilities.md`, and the
`QueryRecordSchema` section of `handwritten-evals/schema/schema-v2.ts`.

Do not read catalog/sidecar files, resource or distractor shards, sibling query prompts/outputs,
queries, qrels, runs, pool files, retrieval code, or ranking output. The table below is the complete
buyer-use-case task pack; there are no placeholders to resolve elsewhere.

- run_id: `run-queries-06`
- shard_id: `shard-queries-06`
- prompt_hash: `sha256:bbc27d90d3ac46c382e3f1f68bf20f1a89d65647e0abe20bef4b31117d2028b4`
- output: `handwritten-evals/staging/queries/run-queries-06/queries.jsonl`

Use every table value exactly. `—` means omit that optional field. The capability cell is an
authoring brief, not query text. Never expose benchmark metadata in the query.

| id | split | class | register | family | buyer capability | filters | evaluation_constraints | MCP subtype | MCP facts | forbidden id | forbidden_capability | trap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qry-051 | release | capability | keyword_only | F3 — DeFi / DEX analytics | swap_route_quote | {} | {} | — | — | — | — | — |
| qry-052 | release | semantic | terse_agent | F4 — Address & wallet risk scoring | tx_risk_screen | {} | {} | — | — | — | — | — |
| qry-053 | release | structured | verbose_natural | F16 — Document parsing / OCR | table_extraction | {"type":"mcp"} | {} | — | — | — | — | — |
| qry-054 | release | price_category | keyword_only | F17 — Geocoding & mapping | reverse_geocode | {} | {"max_price_usd":0.003} | — | — | — | — | — |
| qry-055 | release | mcp | terse_agent | F7 — Macro indicators | fx_reference_rate | {"type":"mcp"} | {} | tuple_identity | server=fx-reference-rates-mcp; tool=get_fx_reference_rate; transport=streamable-http; input_schema_shape=flat_scalars | — | — | — |
| qry-056 | release | adversarial | verbose_natural | F6 — Regulatory documents | regulation_text_fetch | {} | {} | — | — | — | — | prompt_injection |
| qry-057 | release | cold_start | keyword_only | F17 — Geocoding & mapping | reverse_geocode | {} | {} | — | — | — | — | — |
| qry-058 | release | no_result | terse_agent | null | Hosted code execution sandbox | {} | {} | — | — | FC-06 | Hosted code execution sandbox | — |
| qry-059 | release | capability | verbose_natural | F5 — Compliance / sanctions screening | address_watchlist_check | {} | {} | — | — | — | — | — |
| qry-060 | release | semantic | keyword_only | F6 — Regulatory documents | rule_docket_timeline | {} | {} | — | — | — | — | — |

For every record use provider `anthropic`, the actual exact model/revision and timestamp,
`generation_id: "run-queries-06"`, `review_status: "pending"`, `reviewed_at: null`, and
`owner_note: null`. Write a real, specific use-case rationale. For adversarial assignments add a
specific trap rationale. Validate the ten JSONL lines, then stop. Never inspect or launch another
authoring context.
