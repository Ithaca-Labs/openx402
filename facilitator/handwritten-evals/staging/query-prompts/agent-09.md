# Step 5 query authoring — isolated agent 09

Author exactly ten buyer query records. Do not author resources, query answers, candidates, grades,
qrels, reviews, or retrieval output. This context is fresh; discard it after writing the shard.

Read in full: `handwritten-evals/staging/BRIEF-queries.md`,
`handwritten-evals/spec/families.md`, `handwritten-evals/forbidden-capabilities.md`, and the
`QueryRecordSchema` section of `handwritten-evals/schema/schema-v2.ts`.

Do not read catalog/sidecar files, resource or distractor shards, sibling query prompts/outputs,
queries, qrels, runs, pool files, retrieval code, or ranking output. The table below is the complete
buyer-use-case task pack; there are no placeholders to resolve elsewhere.

- run_id: `run-queries-09`
- shard_id: `shard-queries-09`
- prompt_hash: `sha256:0fdf2804a20ffef6a4f87beda41b34a3020cd14329f8f578e59d46717cc573e6`
- output: `handwritten-evals/staging/queries/run-queries-09/queries.jsonl`

Use every table value exactly. `—` means omit that optional field. The capability cell is an
authoring brief, not query text. Never expose benchmark metadata in the query.

| id | split | class | register | family | buyer capability | filters | evaluation_constraints | MCP subtype | MCP facts | forbidden id | forbidden_capability | trap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qry-081 | release | capability | keyword_only | F10 — Embeddings & vector ops | similarity_score | {} | {} | — | — | — | — | — |
| qry-082 | release | semantic | terse_agent | F11 — Web search | image_search | {} | {} | — | — | — | — | — |
| qry-083 | release | structured | verbose_natural | F12 — Web scraping / extraction | screenshot_capture | {"extensions":"bazaar"} | {} | — | — | — | — | — |
| qry-084 | release | price_category | keyword_only | F13 — Attested / signed feeds | signature_verification | {} | {"max_price_usd":0.15} | — | — | — | — | — |
| qry-085 | release | adversarial | terse_agent | F16 — Document parsing / OCR | invoice_field_parse | {} | {} | — | — | — | — | duplicate_provider |
| qry-086 | release | no_result | verbose_natural | null | Video transcoding and streaming packaging | {} | {} | — | — | FC-10 | Video transcoding and streaming packaging | — |
| qry-087 | release | capability | keyword_only | F14 — Analytics & metrics | funnel_conversion_report | {} | {} | — | — | — | — | — |
| qry-088 | release | semantic | terse_agent | F15 — Identity & KYC | business_registry_lookup | {} | {} | — | — | — | — | — |
| qry-089 | release | structured | verbose_natural | F16 — Document parsing / OCR | invoice_field_parse | {"extensions":"bazaar"} | {} | — | — | — | — | — |
| qry-090 | release | capability | keyword_only | F17 — Geocoding & mapping | route_eta | {} | {} | — | — | — | — | — |

For every record use provider `anthropic`, the actual exact model/revision and timestamp,
`generation_id: "run-queries-09"`, `review_status: "pending"`, `reviewed_at: null`, and
`owner_note: null`. Write a real, specific use-case rationale. For adversarial assignments add a
specific trap rationale. Validate the ten JSONL lines, then stop. Never inspect or launch another
authoring context.
