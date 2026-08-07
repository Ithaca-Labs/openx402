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
- prompt_hash: `sha256:752c18f9cb44a60f33529556b7229f33767b7ed0118be5471412ede66455d7eb`
- output: `handwritten-evals/staging/queries/run-queries-05/queries.jsonl`

Use every table value exactly. `—` means omit that optional field. The capability cell is an
authoring brief, not query text. Never expose benchmark metadata in the query.

| id | split | class | register | family | buyer capability | filters | evaluation_constraints | MCP subtype | MCP facts | forbidden id | forbidden_capability | trap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qry-041 | development | semantic | verbose_natural | F14 — Analytics & metrics | protocol_usage_metrics | {} | {} | — | — | — | — | — |
| qry-042 | development | structured | keyword_only | F5 — Compliance / sanctions screening | pep_adverse_media_check | {"network":"stellar:pubnet","scheme":"upto"} | {} | — | — | — | — | — |
| qry-043 | development | capability | terse_agent | F15 — Identity & KYC | id_document_verify | {} | {} | — | — | — | — | — |
| qry-044 | development | capability | verbose_natural | F16 — Document parsing / OCR | pdf_text_extract | {} | {} | — | — | — | — | — |
| qry-045 | development | capability | keyword_only | F17 — Geocoding & mapping | forward_geocode | {} | {} | — | — | — | — | — |
| qry-046 | development | capability | terse_agent | F18 — Weather | current_conditions | {} | {} | — | — | — | — | — |
| qry-047 | development | capability | verbose_natural | F19 — Translation & language | text_translate | {} | {} | — | — | — | — | — |
| qry-048 | development | capability | keyword_only | F20 — News & feeds | headline_feed | {} | {} | — | — | — | — | — |
| qry-049 | development | capability | terse_agent | F1 — On-chain state / block data | block_header_stream | {} | {} | — | — | — | — | — |
| qry-050 | development | capability | verbose_natural | F2 — Token & market prices | ohlcv_candles | {} | {} | — | — | — | — | — |

For every record use provider `anthropic`, the actual exact model/revision and timestamp,
`generation_id: "run-queries-05"`, `review_status: "pending"`, `reviewed_at: null`, and
`owner_note: null`. Write a real, specific use-case rationale. For adversarial assignments add a
specific trap rationale. Validate the ten JSONL lines, then stop. Never inspect or launch another
authoring context.
