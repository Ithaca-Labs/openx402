# Step 4 distractor authoring — wave 4, agent 2

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

- Run id: `run-distractors-w04-a02`
- Shard id: `shard-distractors-w04-a02`
- Prompt/task-pack hash: `sha256:251bd63b2125710b35c4e6cd6e19628869f22f6c7eab03be1d412c8a1c6635c8`
- Output directory: `handwritten-evals/staging/distractors/run-distractors-w04-a02/`
- Wire output: `wire.jsonl`, exactly 10 lines in id order
- Sidecar output: `sidecar.jsonl`, exactly 10 lines in id order

Use the following ids, providers, and scheme assignments exactly:

| resource_id | provider_id and hostname prefix | payment schemes |
|---|---|---|
| `res-0411` | `provider-051` | exact only |
| `res-0412` | `provider-052` | exact only |
| `res-0413` | `provider-053` | exact only |
| `res-0414` | `provider-054` | exact only |
| `res-0415` | `provider-055` | exact only |
| `res-0416` | `provider-056` | exact + upto |
| `res-0417` | `provider-057` | exact only |
| `res-0418` | `provider-058` | exact only |
| `res-0419` | `provider-059` | exact only |
| `res-0420` | `provider-060` | exact only |

Only `res-0416` in this shard may contain an `upto` option. Every named exception must contain both `exact` and `upto`; all other records are exact-only.

The hostname for each record is its assigned provider followed by
`.stellar-bazaar.example`. For this shard's first record, `provider-051`, the URL begins
`https://provider-051.stellar-bazaar.example/`.

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
- Use `derived_from.kind: "agent_generated"`, `generation_id: "run-distractors-w04-a02"`, and a real
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
