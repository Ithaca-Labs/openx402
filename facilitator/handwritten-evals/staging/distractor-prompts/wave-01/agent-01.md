# Step 4 distractor authoring — wave 1, agent 1

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

- Run id: `run-distractors-w01-a01`
- Shard id: `shard-distractors-w01-a01`
- Prompt/task-pack hash: `sha256:40b3d7aba40eb9e9fa19152b9b9fefcb1a262a73c2b55b701314473c99ac74df`
- Output directory: `handwritten-evals/staging/distractors/run-distractors-w01-a01/`
- Wire output: `wire.jsonl`, exactly 100 lines in id order
- Sidecar output: `sidecar.jsonl`, exactly 100 lines in id order

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
| `res-0111` | `provider-111` | exact only |
| `res-0112` | `provider-112` | exact only |
| `res-0113` | `provider-113` | exact only |
| `res-0114` | `provider-114` | exact only |
| `res-0115` | `provider-115` | exact only |
| `res-0116` | `provider-116` | exact only |
| `res-0117` | `provider-117` | exact only |
| `res-0118` | `provider-118` | exact only |
| `res-0119` | `provider-119` | exact only |
| `res-0120` | `provider-120` | exact only |
| `res-0121` | `provider-001` | exact only |
| `res-0122` | `provider-002` | exact only |
| `res-0123` | `provider-003` | exact only |
| `res-0124` | `provider-004` | exact only |
| `res-0125` | `provider-005` | exact only |
| `res-0126` | `provider-006` | exact only |
| `res-0127` | `provider-007` | exact only |
| `res-0128` | `provider-008` | exact only |
| `res-0129` | `provider-009` | exact only |
| `res-0130` | `provider-010` | exact only |
| `res-0131` | `provider-011` | exact only |
| `res-0132` | `provider-012` | exact only |
| `res-0133` | `provider-013` | exact only |
| `res-0134` | `provider-014` | exact only |
| `res-0135` | `provider-015` | exact only |
| `res-0136` | `provider-016` | exact only |
| `res-0137` | `provider-017` | exact only |
| `res-0138` | `provider-018` | exact only |
| `res-0139` | `provider-019` | exact only |
| `res-0140` | `provider-020` | exact only |
| `res-0141` | `provider-021` | exact only |
| `res-0142` | `provider-022` | exact only |
| `res-0143` | `provider-023` | exact only |
| `res-0144` | `provider-024` | exact only |
| `res-0145` | `provider-025` | exact only |
| `res-0146` | `provider-026` | exact only |
| `res-0147` | `provider-027` | exact + upto |
| `res-0148` | `provider-028` | exact only |
| `res-0149` | `provider-029` | exact only |
| `res-0150` | `provider-030` | exact only |
| `res-0151` | `provider-031` | exact only |
| `res-0152` | `provider-032` | exact only |
| `res-0153` | `provider-033` | exact only |
| `res-0154` | `provider-034` | exact only |
| `res-0155` | `provider-035` | exact only |
| `res-0156` | `provider-036` | exact only |
| `res-0157` | `provider-037` | exact only |
| `res-0158` | `provider-038` | exact only |
| `res-0159` | `provider-039` | exact only |
| `res-0160` | `provider-040` | exact only |
| `res-0161` | `provider-041` | exact only |
| `res-0162` | `provider-042` | exact only |
| `res-0163` | `provider-043` | exact only |
| `res-0164` | `provider-044` | exact only |
| `res-0165` | `provider-045` | exact only |
| `res-0166` | `provider-046` | exact only |
| `res-0167` | `provider-047` | exact only |
| `res-0168` | `provider-048` | exact only |
| `res-0169` | `provider-049` | exact only |
| `res-0170` | `provider-050` | exact only |
| `res-0171` | `provider-051` | exact only |
| `res-0172` | `provider-052` | exact only |
| `res-0173` | `provider-053` | exact only |
| `res-0174` | `provider-054` | exact only |
| `res-0175` | `provider-055` | exact only |
| `res-0176` | `provider-056` | exact only |
| `res-0177` | `provider-057` | exact only |
| `res-0178` | `provider-058` | exact only |
| `res-0179` | `provider-059` | exact only |
| `res-0180` | `provider-060` | exact only |
| `res-0181` | `provider-061` | exact only |
| `res-0182` | `provider-062` | exact only |
| `res-0183` | `provider-063` | exact only |
| `res-0184` | `provider-064` | exact only |
| `res-0185` | `provider-065` | exact only |
| `res-0186` | `provider-066` | exact only |
| `res-0187` | `provider-067` | exact only |
| `res-0188` | `provider-068` | exact only |
| `res-0189` | `provider-069` | exact + upto |
| `res-0190` | `provider-070` | exact only |
| `res-0191` | `provider-071` | exact only |
| `res-0192` | `provider-072` | exact only |
| `res-0193` | `provider-073` | exact only |
| `res-0194` | `provider-074` | exact only |
| `res-0195` | `provider-075` | exact only |
| `res-0196` | `provider-076` | exact only |
| `res-0197` | `provider-077` | exact only |
| `res-0198` | `provider-078` | exact only |
| `res-0199` | `provider-079` | exact only |
| `res-0200` | `provider-080` | exact only |

Only `res-0147`, `res-0189` in this shard may contain an `upto` option. Every named exception must contain both `exact` and `upto`; all other records are exact-only.

The hostname for each record is its assigned provider followed by
`.stellar-bazaar.example`. For this shard's first record, `provider-101`, the URL begins
`https://provider-101.stellar-bazaar.example/`.

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

Before finishing, parse both JSONL files, confirm exactly 100 matching
ids, re-read all prose against the 20 family boundaries and ten forbidden capabilities, and verify no
two records in the shard are near-duplicates. Stop after writing this shard; do not inspect or launch
any other agent.
