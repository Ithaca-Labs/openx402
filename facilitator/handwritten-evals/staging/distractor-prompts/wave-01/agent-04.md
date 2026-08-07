# Step 4 distractor authoring — wave 1, agent 4

You are one fresh, isolated authoring context in wave 1 of 1. Author exactly
100 original HTTP distractor listings for Stellar Bazaar v2. This prompt
prepares corpus records only; do not create queries, qrels, judgments, reviews, or merged catalog
files.

This shard is larger than the original per-agent design (100 records
instead of 10) as a deliberate MVP cost/speed tradeoff, accepted with the understanding that a human
owner will review the merged output afterward rather than relying solely on agent isolation to catch
repetition. That tradeoff makes your own vigilance against self-templating more important, not less:
periodically stop and compare your most recent handful of records against your earlier ones in this
same shard before continuing, since nothing else will catch a drifted pattern until the human review
pass.

## Frozen inputs

Read these files in full before writing:

1. `handwritten-evals/staging/BRIEF-distractors.md`
2. `handwritten-evals/forbidden-capabilities.md`
3. `handwritten-evals/spec/families.md`
4. The wire/catalog/sidecar schemas in `handwritten-evals/schema/schema-v2.ts`

Do not read any other path under `handwritten-evals/staging/`, including sibling shards, labeled
resource shards, other waves, or their prompts. Do not read the merged catalog, queries, qrels,
retrieval output, ranking code, or another author's work.

This is the first wave; start it only with 4 fresh contexts.
This context is new for this wave and must be discarded after this shard. Do not preserve a
template for any later wave.

## Exact assignment

- Run id: `run-distractors-w01-a04`
- Shard id: `shard-distractors-w01-a04`
- Prompt/task-pack hash: `sha256:89c551fbd5b71e1ff27ec7c971739168dfaa7fc28b7c56eec4600f35d61934a8`
- Output directory: `handwritten-evals/staging/distractors/run-distractors-w01-a04/`
- Wire output: `wire.jsonl`, exactly 100 lines in id order
- Sidecar output: `sidecar.jsonl`, exactly 100 lines in id order

Use the following ids, providers, and scheme assignments exactly:

| resource_id | provider_id and hostname prefix | payment schemes |
|---|---|---|
| `res-0401` | `provider-041` | exact only |
| `res-0402` | `provider-042` | exact only |
| `res-0403` | `provider-043` | exact only |
| `res-0404` | `provider-044` | exact only |
| `res-0405` | `provider-045` | exact only |
| `res-0406` | `provider-046` | exact only |
| `res-0407` | `provider-047` | exact only |
| `res-0408` | `provider-048` | exact only |
| `res-0409` | `provider-049` | exact only |
| `res-0410` | `provider-050` | exact only |
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
| `res-0421` | `provider-061` | exact only |
| `res-0422` | `provider-062` | exact only |
| `res-0423` | `provider-063` | exact only |
| `res-0424` | `provider-064` | exact only |
| `res-0425` | `provider-065` | exact only |
| `res-0426` | `provider-066` | exact only |
| `res-0427` | `provider-067` | exact only |
| `res-0428` | `provider-068` | exact only |
| `res-0429` | `provider-069` | exact only |
| `res-0430` | `provider-070` | exact only |
| `res-0431` | `provider-071` | exact only |
| `res-0432` | `provider-072` | exact only |
| `res-0433` | `provider-073` | exact only |
| `res-0434` | `provider-074` | exact only |
| `res-0435` | `provider-075` | exact only |
| `res-0436` | `provider-076` | exact only |
| `res-0437` | `provider-077` | exact only |
| `res-0438` | `provider-078` | exact only |
| `res-0439` | `provider-079` | exact only |
| `res-0440` | `provider-080` | exact only |
| `res-0441` | `provider-081` | exact only |
| `res-0442` | `provider-082` | exact only |
| `res-0443` | `provider-083` | exact only |
| `res-0444` | `provider-084` | exact only |
| `res-0445` | `provider-085` | exact only |
| `res-0446` | `provider-086` | exact only |
| `res-0447` | `provider-087` | exact only |
| `res-0448` | `provider-088` | exact only |
| `res-0449` | `provider-089` | exact only |
| `res-0450` | `provider-090` | exact only |
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
| `res-0461` | `provider-101` | exact only |
| `res-0462` | `provider-102` | exact only |
| `res-0463` | `provider-103` | exact only |
| `res-0464` | `provider-104` | exact only |
| `res-0465` | `provider-105` | exact only |
| `res-0466` | `provider-106` | exact only |
| `res-0467` | `provider-107` | exact only |
| `res-0468` | `provider-108` | exact only |
| `res-0469` | `provider-109` | exact only |
| `res-0470` | `provider-110` | exact only |
| `res-0471` | `provider-111` | exact only |
| `res-0472` | `provider-112` | exact only |
| `res-0473` | `provider-113` | exact only |
| `res-0474` | `provider-114` | exact only |
| `res-0475` | `provider-115` | exact only |
| `res-0476` | `provider-116` | exact only |
| `res-0477` | `provider-117` | exact only |
| `res-0478` | `provider-118` | exact only |
| `res-0479` | `provider-119` | exact only |
| `res-0480` | `provider-120` | exact only |
| `res-0481` | `provider-001` | exact only |
| `res-0482` | `provider-002` | exact only |
| `res-0483` | `provider-003` | exact only |
| `res-0484` | `provider-004` | exact only |
| `res-0485` | `provider-005` | exact only |
| `res-0486` | `provider-006` | exact only |
| `res-0487` | `provider-007` | exact only |
| `res-0488` | `provider-008` | exact only |
| `res-0489` | `provider-009` | exact only |
| `res-0490` | `provider-010` | exact only |
| `res-0491` | `provider-011` | exact only |
| `res-0492` | `provider-012` | exact only |
| `res-0493` | `provider-013` | exact only |
| `res-0494` | `provider-014` | exact only |
| `res-0495` | `provider-015` | exact only |
| `res-0496` | `provider-016` | exact only |
| `res-0497` | `provider-017` | exact only |
| `res-0498` | `provider-018` | exact only |
| `res-0499` | `provider-019` | exact only |
| `res-0500` | `provider-020` | exact only |

Only `res-0416` in this shard may contain an `upto` option. Every named exception must contain both `exact` and `upto`; all other records are exact-only.

The hostname for each record is its assigned provider followed by
`.stellar-bazaar.example`. For this shard's first record, `provider-041`, the URL begins
`https://provider-041.stellar-bazaar.example/`.

## Meaning and originality requirements

Choose the 100 topic areas yourself. They are intentionally not
prescribed per slot. Each must be a plausible, buyer-useful marketplace listing while satisfying
none of the 20 family in-scope definitions and none of FC-01 through FC-10. Topical proximity is
allowed; capability overlap is not. If a reasonable grader could call a listing relevant to any
labeled family, replace it.

Every one of the 100 topic areas must be genuinely different from one another. Do not create variants by
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
- Use `derived_from.kind: "agent_generated"`, `generation_id: "run-distractors-w01-a04"`, and a real
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

Before finishing, parse both JSONL files, confirm exactly 100 matching
ids, re-read all prose against the 20 family boundaries and ten forbidden capabilities, and verify no
two records in the shard are near-duplicates. Stop after writing this shard; do not inspect or launch
any other agent.
