# Step 5 query authoring — isolated agent 05

Author exactly 20 buyer query records. Do not author resources, query answers, candidates, grades,
qrels, reviews, or retrieval output. This context is fresh; discard it after writing the shard.

Read in full: `handwritten-evals/staging/BRIEF-queries.md`,
`handwritten-evals/spec/families.md`, `handwritten-evals/forbidden-capabilities.md`, and the
`QueryRecordSchema` section of `handwritten-evals/schema/schema-v2.ts`.

Do not read catalog/sidecar files, resource or distractor shards, sibling query prompts/outputs,
queries, qrels, runs, pool files, retrieval code, or ranking output. The table below is the complete
buyer-use-case task pack; there are no placeholders to resolve elsewhere.

- run_id: `run-queries-05`
- shard_id: `shard-queries-05`
- prompt_hash: `sha256:40d53781da359a2a28d25f0ad752731af34a9645bcfe61f87e8b3f5fc9ffe65e`
- output: `handwritten-evals/staging/queries/run-queries-05/queries.jsonl`

Use every table value exactly. `—` means omit that optional field. The capability cell is an
authoring brief, not query text. Never expose benchmark metadata in the query.

| id | split | class | register | family | buyer capability | filters | evaluation_constraints | MCP subtype | MCP facts | forbidden id | forbidden_capability | trap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qry-081 | release | capability | keyword_only | F11 — Web search | site_restricted_search | {} | {} | — | — | — | — | — |
| qry-082 | release | semantic | terse_agent | F12 — Web scraping / extraction | structured_field_extraction | {} | {} | — | — | — | — | — |
| qry-083 | release | structured | verbose_natural | F12 — Web scraping / extraction | page_to_markdown | {"type":"mcp"} | {} | — | — | — | — | — |
| qry-084 | release | price_category | keyword_only | F13 — Attested / signed feeds | signed_price_attestation | {} | {"max_price_usd":0.02} | — | — | — | — | — |
| qry-085 | release | adversarial | terse_agent | F16 — Document parsing / OCR | invoice_field_parse | {} | {} | — | — | — | — | duplicate_provider |
| qry-086 | release | no_result | verbose_natural | null | Video transcoding and streaming packaging | {} | {} | — | — | FC-10 | Video transcoding and streaming packaging | — |
| qry-087 | release | capability | keyword_only | F13 — Attested / signed feeds | attested_randomness | {} | {} | — | — | — | — | — |
| qry-088 | release | semantic | terse_agent | F14 — Analytics & metrics | cohort_retention_metrics | {} | {} | — | — | — | — | — |
| qry-089 | release | structured | verbose_natural | F16 — Document parsing / OCR | handwriting_ocr | {"network":"stellar:testnet","scheme":"upto"} | {} | — | — | — | — | — |
| qry-090 | release | capability | keyword_only | F15 — Identity & KYC | liveness_selfie_check | {} | {} | — | — | — | — | — |
| qry-091 | release | semantic | terse_agent | F16 — Document parsing / OCR | table_extraction | {} | {} | — | — | — | — | — |
| qry-092 | release | structured | verbose_natural | F19 — Translation & language | batch_document_translate | {"network":"stellar:pubnet"} | {} | — | — | — | — | — |
| qry-093 | release | capability | keyword_only | F17 — Geocoding & mapping | reverse_geocode | {} | {} | — | — | — | — | — |
| qry-094 | release | capability | terse_agent | F18 — Weather | hourly_forecast | {} | {} | — | — | — | — | — |
| qry-095 | release | capability | verbose_natural | F19 — Translation & language | language_detect | {} | {} | — | — | — | — | — |
| qry-096 | release | capability | keyword_only | F20 — News & feeds | keyword_news_alerts | {} | {} | — | — | — | — | — |
| qry-097 | release | capability | terse_agent | F1 — On-chain state / block data | tx_receipt_lookup | {} | {} | — | — | — | — | — |
| qry-098 | release | capability | verbose_natural | F2 — Token & market prices | batch_price_quote | {} | {} | — | — | — | — | — |
| qry-099 | release | capability | keyword_only | F3 — DeFi / DEX analytics | tvl_by_protocol | {} | {} | — | — | — | — | — |
| qry-100 | release | capability | terse_agent | F4 — Address & wallet risk scoring | cluster_attribution | {} | {} | — | — | — | — | — |

For every record use provider `anthropic`, the actual exact model/revision and timestamp,
`generation_id: "run-queries-05"`, `review_status: "pending"`, `reviewed_at: null`, and
`owner_note: null`. Write a real, specific use-case rationale. For adversarial assignments add a
specific trap rationale. Validate the 20 JSONL lines, then stop. Never inspect or launch another
authoring context.
