# Step 5 query authoring — isolated agent 01

Author exactly ten buyer query records. Do not author resources, query answers, candidates, grades,
qrels, reviews, or retrieval output. This context is fresh; discard it after writing the shard.

Read in full: `handwritten-evals/staging/BRIEF-queries.md`,
`handwritten-evals/spec/families.md`, `handwritten-evals/forbidden-capabilities.md`, and the
`QueryRecordSchema` section of `handwritten-evals/schema/schema-v2.ts`.

Do not read catalog/sidecar files, resource or distractor shards, sibling query prompts/outputs,
queries, qrels, runs, pool files, retrieval code, or ranking output. The table below is the complete
buyer-use-case task pack; there are no placeholders to resolve elsewhere.

- run_id: `run-queries-01`
- shard_id: `shard-queries-01`
- prompt_hash: `sha256:33a22bda8d3e8b5721fe13d4eb8af1629081b3c9e0ead699d46be1f911abacc3`
- output: `handwritten-evals/staging/queries/run-queries-01/queries.jsonl`

Use every table value exactly. `—` means omit that optional field. The capability cell is an
authoring brief, not query text. Never expose benchmark metadata in the query.

| id | split | class | register | family | buyer capability | filters | evaluation_constraints | MCP subtype | MCP facts | forbidden id | forbidden_capability | trap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qry-001 | development | capability | terse_agent | F1 — On-chain state / block data | ledger_entry_lookup | {} | {} | — | — | — | — | — |
| qry-002 | development | semantic | verbose_natural | F2 — Token & market prices | spot_price_lookup | {} | {} | — | — | — | — | — |
| qry-003 | development | structured | keyword_only | F3 — DeFi / DEX analytics | pool_reserves_snapshot | {"extensions":"bazaar"} | {} | — | — | — | — | — |
| qry-004 | development | price_category | terse_agent | F4 — Address & wallet risk scoring | address_risk_score | {} | {"max_price_usd":0.15} | — | — | — | — | — |
| qry-005 | development | mcp | verbose_natural | F1 — On-chain state / block data | tx_receipt_lookup | {"type":"mcp"} | {} | tuple_identity | server=stellar-tx-receipt-server; tool=lookup_transaction_receipt; transport=streamable-http; input_schema_shape=flat_scalars | — | — | — |
| qry-006 | development | adversarial | keyword_only | F1 — On-chain state / block data | block_header_stream | {} | {} | — | — | — | — | keyword_stuffing |
| qry-007 | development | cold_start | terse_agent | F1 — On-chain state / block data | contract_event_log | {} | {} | — | — | — | — | — |
| qry-008 | development | no_result | verbose_natural | null | Wallet key custody and transaction signing | {} | {} | — | — | FC-01 | Wallet key custody and transaction signing | — |
| qry-009 | development | capability | keyword_only | F5 — Compliance / sanctions screening | sanctions_name_screen | {} | {} | — | — | — | — | — |
| qry-010 | development | semantic | terse_agent | F6 — Regulatory documents | federal_register_search | {} | {} | — | — | — | — | — |

For every record use provider `anthropic`, the actual exact model/revision and timestamp,
`generation_id: "run-queries-01"`, `review_status: "pending"`, `reviewed_at: null`, and
`owner_note: null`. Write a real, specific use-case rationale. For adversarial assignments add a
specific trap rationale. Validate the ten JSONL lines, then stop. Never inspect or launch another
authoring context.
