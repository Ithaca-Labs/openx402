# Step 4 distractor authoring — wave 1, agent 2

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

- Run id: `run-distractors-w01-a02`
- Shard id: `shard-distractors-w01-a02`
- Prompt/task-pack hash: `sha256:df52de7bafb18c65e536fbc8fe0d3159170f2ddb6f7cb36da994d2e10a79f111`
- Output directory: `handwritten-evals/staging/distractors/run-distractors-w01-a02/`
- Wire output: `wire.jsonl`, exactly 100 lines in id order
- Sidecar output: `sidecar.jsonl`, exactly 100 lines in id order

Use the following ids, providers, and scheme assignments exactly:

| resource_id | provider_id and hostname prefix | payment schemes |
|---|---|---|
| `res-0201` | `provider-081` | exact only |
| `res-0202` | `provider-082` | exact only |
| `res-0203` | `provider-083` | exact only |
| `res-0204` | `provider-084` | exact only |
| `res-0205` | `provider-085` | exact only |
| `res-0206` | `provider-086` | exact only |
| `res-0207` | `provider-087` | exact only |
| `res-0208` | `provider-088` | exact only |
| `res-0209` | `provider-089` | exact only |
| `res-0210` | `provider-090` | exact only |
| `res-0211` | `provider-091` | exact only |
| `res-0212` | `provider-092` | exact only |
| `res-0213` | `provider-093` | exact only |
| `res-0214` | `provider-094` | exact only |
| `res-0215` | `provider-095` | exact only |
| `res-0216` | `provider-096` | exact only |
| `res-0217` | `provider-097` | exact only |
| `res-0218` | `provider-098` | exact only |
| `res-0219` | `provider-099` | exact only |
| `res-0220` | `provider-100` | exact only |
| `res-0221` | `provider-101` | exact only |
| `res-0222` | `provider-102` | exact only |
| `res-0223` | `provider-103` | exact only |
| `res-0224` | `provider-104` | exact only |
| `res-0225` | `provider-105` | exact only |
| `res-0226` | `provider-106` | exact only |
| `res-0227` | `provider-107` | exact only |
| `res-0228` | `provider-108` | exact only |
| `res-0229` | `provider-109` | exact only |
| `res-0230` | `provider-110` | exact only |
| `res-0231` | `provider-111` | exact only |
| `res-0232` | `provider-112` | exact only |
| `res-0233` | `provider-113` | exact only |
| `res-0234` | `provider-114` | exact only |
| `res-0235` | `provider-115` | exact only |
| `res-0236` | `provider-116` | exact only |
| `res-0237` | `provider-117` | exact only |
| `res-0238` | `provider-118` | exact only |
| `res-0239` | `provider-119` | exact only |
| `res-0240` | `provider-120` | exact only |
| `res-0241` | `provider-001` | exact only |
| `res-0242` | `provider-002` | exact only |
| `res-0243` | `provider-003` | exact only |
| `res-0244` | `provider-004` | exact only |
| `res-0245` | `provider-005` | exact only |
| `res-0246` | `provider-006` | exact only |
| `res-0247` | `provider-007` | exact only |
| `res-0248` | `provider-008` | exact only |
| `res-0249` | `provider-009` | exact only |
| `res-0250` | `provider-010` | exact only |
| `res-0251` | `provider-011` | exact only |
| `res-0252` | `provider-012` | exact only |
| `res-0253` | `provider-013` | exact only |
| `res-0254` | `provider-014` | exact only |
| `res-0255` | `provider-015` | exact only |
| `res-0256` | `provider-016` | exact only |
| `res-0257` | `provider-017` | exact only |
| `res-0258` | `provider-018` | exact only |
| `res-0259` | `provider-019` | exact only |
| `res-0260` | `provider-020` | exact only |
| `res-0261` | `provider-021` | exact only |
| `res-0262` | `provider-022` | exact only |
| `res-0263` | `provider-023` | exact only |
| `res-0264` | `provider-024` | exact only |
| `res-0265` | `provider-025` | exact only |
| `res-0266` | `provider-026` | exact only |
| `res-0267` | `provider-027` | exact only |
| `res-0268` | `provider-028` | exact only |
| `res-0269` | `provider-029` | exact only |
| `res-0270` | `provider-030` | exact only |
| `res-0271` | `provider-031` | exact only |
| `res-0272` | `provider-032` | exact only |
| `res-0273` | `provider-033` | exact only |
| `res-0274` | `provider-034` | exact only |
| `res-0275` | `provider-035` | exact only |
| `res-0276` | `provider-036` | exact only |
| `res-0277` | `provider-037` | exact only |
| `res-0278` | `provider-038` | exact only |
| `res-0279` | `provider-039` | exact only |
| `res-0280` | `provider-040` | exact only |
| `res-0281` | `provider-041` | exact only |
| `res-0282` | `provider-042` | exact only |
| `res-0283` | `provider-043` | exact only |
| `res-0284` | `provider-044` | exact only |
| `res-0285` | `provider-045` | exact only |
| `res-0286` | `provider-046` | exact only |
| `res-0287` | `provider-047` | exact only |
| `res-0288` | `provider-048` | exact only |
| `res-0289` | `provider-049` | exact only |
| `res-0290` | `provider-050` | exact only |
| `res-0291` | `provider-051` | exact only |
| `res-0292` | `provider-052` | exact only |
| `res-0293` | `provider-053` | exact only |
| `res-0294` | `provider-054` | exact only |
| `res-0295` | `provider-055` | exact only |
| `res-0296` | `provider-056` | exact only |
| `res-0297` | `provider-057` | exact only |
| `res-0298` | `provider-058` | exact only |
| `res-0299` | `provider-059` | exact only |
| `res-0300` | `provider-060` | exact only |

No record in this shard may contain an `upto` option. All 10 are exact-only.

The hostname for each record is its assigned provider followed by
`.stellar-bazaar.example`. For this shard's first record, `provider-081`, the URL begins
`https://provider-081.stellar-bazaar.example/`.

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
- Use `derived_from.kind: "agent_generated"`, `generation_id: "run-distractors-w01-a02"`, and a real
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
