# Pilot resource-author

Read pilot/PILOT-PROTOCOL.md in full.

Run id: `pilot-resource-author-01`
Prompt hash: `sha256:f3be71319d9faf7f0bb51b2527e1c0ee5dd3f701695161e7753f11f15f331681`

Author exactly five labeled F1 resources, res-0001..res-0005, one for each frozen capability in order: ledger_entry_lookup, block_header_stream, tx_receipt_lookup, contract_event_log, archive_state_at_ledger. Write pilot/artifacts/resource-author/wire.jsonl and sidecar.jsonl using current CatalogRecordSchema and SidecarRecordSchema, BRIEF-resources.md wire/provenance conventions, and the exact F1 slot axes in spec/families.md. Use providers provider-001..provider-005. Read pilot/forbidden-capabilities.md and provide no outbound email capability. Do not read any pilot sibling output, catalog, queries, qrels, retrieval, or grading artifacts.

Record actual model, timestamp, token usage, elapsed seconds, and API cost. Stop after this role.
