# Stellar Bazaar v2 — Step 5 query-authoring protocol

Author buyer queries only. Do not inspect the catalog, sidecar, resource shards, retrieval output,
pool, qrels, another query shard, or another author's prompt/output. Your task pack supplies the
buyer capability constraints needed for your ten records. Do not create resources or judgments.

Read `spec/families.md`, `forbidden-capabilities.md`, and the `QueryRecordSchema` section of
`schema/schema-v2.ts` in full. The family file is a boundary specification, not catalog prose.

## Independence and wording

Each prompt runs in a fresh context and produces exactly one shard. Discard the context afterward.
Do not reuse sentence frames. Write ten genuinely independent buyer needs, in the assigned register:

- `terse_agent`: concise operational request, still natural and unambiguous.
- `verbose_natural`: complete buyer context with only useful constraints.
- `keyword_only`: plausible search-box fragments, not a comma-separated copy of metadata.

Never copy capability slugs verbatim into `semantic` or `cold_start` query text. Capability queries
may use ordinary-language capability names. Do not mention family numbers, resource ids, provider
ids, benchmark labels, adversarial labels, forbidden ids, or expected answers in query text.

## Record shape

Write one strict JSON object per line. Use the exact structural values frozen in your assignment.
Only `query`, `generation.model`, optional `generation.temperature`, `generation.generated_at`,
`derived_from.use_case`, and (where assigned) `derived_from.trap` require author-written values.

```json
{
  "query_id": "qry-NNN",
  "split": "development or release",
  "query_class": "assigned class",
  "query": "independently authored buyer wording",
  "filters": {},
  "evaluation_constraints": {},
  "expects_no_result": false,
  "phrasing_register": "assigned register",
  "family": 1,
  "generation": {
    "provider": "anthropic",
    "model": "actual exact model/revision",
    "prompt_hash": "assigned sha256:...",
    "run_id": "assigned run id",
    "shard_id": "assigned shard id",
    "temperature": 0,
    "generated_at": "actual ISO 8601 generation time"
  },
  "derived_from": {
    "kind": "agent_generated",
    "generation_id": "same as generation.run_id",
    "use_case": "specific buyer use case and why the wording tests the assigned class"
  },
  "review_status": "pending",
  "reviewed_at": null,
  "owner_note": null
}
```

Omit `mcp_subtype`, `forbidden_capability`, and `derived_from.trap` unless assigned. Never add extra
keys. New author output is always `pending` with null review fields.

## Class rules

- `capability`: directly express the assigned in-scope buyer capability.
- `semantic`: express it indirectly with a real scenario; do not echo the capability slug.
- `structured`: use the exact assigned nonempty `filters`; wording must agree with them.
- `price_category`: use the exact assigned `max_price_usd`; wording must state that ceiling.
- `mcp`: use `filters.type: "mcp"`, the assigned subtype, and supplied tuple/schema/transport facts.
  Tuple identity names server/tool; tool schema describes accepted input shape; transport names the
  transport; HTTP-vs-MCP makes MCP a genuine requirement. Do not add invented MCP facts.
- `adversarial`: write an honest buyer need. Record the assigned trap kind and what misleading
  signal the grader should resist in `derived_from.trap`; never instruct ranking in the query.
- `cold_start`: make a natural need discoverable from sparse metadata without adding catalog clues.
- `no_result`: set `expects_no_result: true`, `family: null`, and the assigned exact
  `forbidden_capability`. The query must genuinely ask for that absent capability. Do not weaken it
  into a neighboring in-scope family.

## Final checks

Parse the JSONL; confirm ten assigned ids in order; validate every record with `QueryRecordSchema`;
confirm all frozen fields and provenance; check each query is independently worded and 3–512
characters. Stop after the assigned file. Do not run retrieval or grade any candidate.
