# Step 4 distractor authoring — wave 4, agent 6

You are one fresh, isolated authoring context in wave 4 of 9. Author exactly 10 original HTTP
distractor listings for Stellar Bazaar v2. This prompt prepares corpus records only; do not create
queries, qrels, judgments, reviews, or merged catalog files.

## Frozen inputs

Read these files in full before writing:

1. `handwritten-evals/staging/BRIEF-distractors.md`
2. `handwritten-evals/forbidden-capabilities.md`
3. `handwritten-evals/spec/families.md`
4. The wire/catalog/sidecar schemas in `handwritten-evals/schema/schema-v2.ts`

Do not read any other path under `handwritten-evals/staging/`, including sibling shards, labeled
resource shards, other waves, or their prompts. Do not read the merged catalog, queries, qrels,
retrieval output, ranking code, or another author's work.

Dispatch wave 4 only after every wave 3 context has been discarded.
This context is new for this wave and must be discarded after this shard. Do not preserve a
template for any later wave.

## Exact assignment

- Run id: `run-distractors-w04-a06`
- Shard id: `shard-distractors-w04-a06`
- Prompt/task-pack hash: `sha256:b875e4de8c2f3f49748063471c6904d63e22c2972689894dd23694d112e1350c`
- Output directory: `handwritten-evals/staging/distractors/run-distractors-w04-a06/`
- Wire output: `wire.jsonl`, exactly 10 lines in id order
- Sidecar output: `sidecar.jsonl`, exactly 10 lines in id order

Use the following ids, providers, and scheme assignments exactly:

| resource_id | provider_id and hostname prefix | payment schemes |
|---|---|---|
| `res-0451` | `provider-091` | exact only |
| `res-0452` | `provider-092` | exact only |
| `res-0453` | `provider-093` | exact only |
| `res-0454` | `provider-094` | exact only |
| `res-0455` | `provider-095` | exact only |
| `res-0456` | `provider-096` | exact only |
| `res-0457` | `provider-097` | exact only |
| `res-0458` | `provider-098` | exact only |
| `res-0459` | `provider-099` | exact only |
| `res-0460` | `provider-100` | exact only |

No record in this shard may contain an `upto` option. All 10 are exact-only.

The hostname for each record is its assigned provider followed by
`.stellar-bazaar.example`. For this shard's first record, `provider-091`, the URL begins
`https://provider-091.stellar-bazaar.example/`.

## Meaning and originality requirements

Choose the ten topic areas yourself. They are intentionally not prescribed per slot. Each must be
a plausible, buyer-useful marketplace listing while satisfying none of the 20 family in-scope
definitions and none of FC-01 through FC-10. Topical proximity is allowed; capability overlap is
not. If a reasonable grader could call a listing relevant to any labeled family, replace it.

The ten topic areas must be genuinely different from one another. Do not create variants by
changing names, locations, prices, paths, or adjectives in a shared design. Do not reuse sentence
frames, tag sets, brands with numeric suffixes, or request/response schemas. The v1
`CDP-shaped weather 001` through `030` pattern is explicitly forbidden.

Write original prose and schemas. Do not copy or lightly rewrite CDP marketplace material.

## Non-negotiable record rules

- Every sidecar uses `authorship: "agent"`, `resource_type: "http"`,
  `is_distractor: true`, `is_sparse: false`, `adversarial_kind: null`,
  `family: null`, and `family_slot: null`.
- Omit `axes`, `mcp`, `source_class`, and `adversarial` keys.
- Use `generation.provider: "anthropic"`; record the actual exact model/revision and actual
  generation timestamp; use the run id, shard id, and prompt hash above exactly.
- Use `derived_from.kind: "agent_generated"`, `generation_id: "run-distractors-w04-a06"`, and a real
  rationale explaining the independent capability and why it is outside all families and forbidden
  capabilities.
- Use `review_status: "pending"`, `reviewed_at: null`, and `owner_note: null`.
- Use `is_live: false`, `settlement_verified: false`, `asset_decimals: 7`, and the fixed
  snapshot basis from the brief.
- Use only the fixed Stellar USDC assets and fixture `payTo` from the brief. Compute stroop
  amounts exactly and make the snapshot value equal the minimum payment option.
- Include substantive, independently written service names, descriptions, and tags. Use
  `.example` URLs and `{ "bazaar": {} }` only.
- Do not provide, hint at, tag, or resemble any forbidden capability, including synonyms that are
  not in the deterministic signature list.

Before finishing, parse both JSONL files, confirm exactly 10 matching ids, re-read all prose against
the 20 family boundaries and ten forbidden capabilities, and verify no two records in the shard are
near-duplicates. Stop after writing this shard; do not inspect or launch any other agent.
