# Step 4 distractor authoring — wave 1, agent 1

You are one fresh, isolated authoring context in wave 1 of 9. Author exactly 10 original HTTP
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

This is the first wave; start it only with ten fresh contexts.
This context is new for this wave and must be discarded after this shard. Do not preserve a
template for any later wave.

## Exact assignment

- Run id: `run-distractors-w01-a01`
- Shard id: `shard-distractors-w01-a01`
- Prompt/task-pack hash: `sha256:e8a7c7c94e74f5e311224e44b3ab05392272d21bd6afbffb58ada01431f2615f`
- Output directory: `handwritten-evals/staging/distractors/run-distractors-w01-a01/`
- Wire output: `wire.jsonl`, exactly 10 lines in id order
- Sidecar output: `sidecar.jsonl`, exactly 10 lines in id order

Use the following ids, providers, and scheme assignments exactly:

| resource_id | provider_id and hostname prefix | payment schemes |
|---|---|---|
| `res-0101` | `provider-101` | exact only |
| `res-0102` | `provider-102` | exact only |
| `res-0103` | `provider-103` | exact only |
| `res-0104` | `provider-104` | exact only |
| `res-0105` | `provider-105` | exact only |
| `res-0106` | `provider-106` | exact only |
| `res-0107` | `provider-107` | exact only |
| `res-0108` | `provider-108` | exact only |
| `res-0109` | `provider-109` | exact only |
| `res-0110` | `provider-110` | exact only |

No record in this shard may contain an `upto` option. All 10 are exact-only.

The hostname for each record is its assigned provider followed by
`.stellar-bazaar.example`. For this shard's first record, `provider-101`, the URL begins
`https://provider-101.stellar-bazaar.example/`.

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
- Use `derived_from.kind: "agent_generated"`, `generation_id: "run-distractors-w01-a01"`, and a real
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
