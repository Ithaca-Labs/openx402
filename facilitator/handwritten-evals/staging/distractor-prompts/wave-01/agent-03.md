# Step 4 distractor authoring — wave 1, agent 3

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

- Run id: `run-distractors-w01-a03`
- Shard id: `shard-distractors-w01-a03`
- Prompt/task-pack hash: `sha256:814a2b8acf065033304176280667bb03cd97c3883490d949d2d5fb1b84b679f7`
- Output directory: `handwritten-evals/staging/distractors/run-distractors-w01-a03/`
- Wire output: `wire.jsonl`, exactly 100 lines in id order
- Sidecar output: `sidecar.jsonl`, exactly 100 lines in id order

Use the following ids, providers, and scheme assignments exactly:

| resource_id | provider_id and hostname prefix | payment schemes |
|---|---|---|
| `res-0301` | `provider-061` | exact only |
| `res-0302` | `provider-062` | exact only |
| `res-0303` | `provider-063` | exact only |
| `res-0304` | `provider-064` | exact only |
| `res-0305` | `provider-065` | exact only |
| `res-0306` | `provider-066` | exact only |
| `res-0307` | `provider-067` | exact only |
| `res-0308` | `provider-068` | exact only |
| `res-0309` | `provider-069` | exact only |
| `res-0310` | `provider-070` | exact only |
| `res-0311` | `provider-071` | exact only |
| `res-0312` | `provider-072` | exact only |
| `res-0313` | `provider-073` | exact only |
| `res-0314` | `provider-074` | exact only |
| `res-0315` | `provider-075` | exact only |
| `res-0316` | `provider-076` | exact only |
| `res-0317` | `provider-077` | exact only |
| `res-0318` | `provider-078` | exact only |
| `res-0319` | `provider-079` | exact only |
| `res-0320` | `provider-080` | exact only |
| `res-0321` | `provider-081` | exact only |
| `res-0322` | `provider-082` | exact only |
| `res-0323` | `provider-083` | exact only |
| `res-0324` | `provider-084` | exact only |
| `res-0325` | `provider-085` | exact only |
| `res-0326` | `provider-086` | exact only |
| `res-0327` | `provider-087` | exact only |
| `res-0328` | `provider-088` | exact only |
| `res-0329` | `provider-089` | exact only |
| `res-0330` | `provider-090` | exact only |
| `res-0331` | `provider-091` | exact only |
| `res-0332` | `provider-092` | exact only |
| `res-0333` | `provider-093` | exact only |
| `res-0334` | `provider-094` | exact only |
| `res-0335` | `provider-095` | exact only |
| `res-0336` | `provider-096` | exact only |
| `res-0337` | `provider-097` | exact only |
| `res-0338` | `provider-098` | exact only |
| `res-0339` | `provider-099` | exact only |
| `res-0340` | `provider-100` | exact only |
| `res-0341` | `provider-101` | exact only |
| `res-0342` | `provider-102` | exact only |
| `res-0343` | `provider-103` | exact only |
| `res-0344` | `provider-104` | exact only |
| `res-0345` | `provider-105` | exact only |
| `res-0346` | `provider-106` | exact only |
| `res-0347` | `provider-107` | exact only |
| `res-0348` | `provider-108` | exact only |
| `res-0349` | `provider-109` | exact only |
| `res-0350` | `provider-110` | exact only |
| `res-0351` | `provider-111` | exact only |
| `res-0352` | `provider-112` | exact only |
| `res-0353` | `provider-113` | exact only |
| `res-0354` | `provider-114` | exact only |
| `res-0355` | `provider-115` | exact only |
| `res-0356` | `provider-116` | exact only |
| `res-0357` | `provider-117` | exact only |
| `res-0358` | `provider-118` | exact + upto |
| `res-0359` | `provider-119` | exact only |
| `res-0360` | `provider-120` | exact only |
| `res-0361` | `provider-001` | exact only |
| `res-0362` | `provider-002` | exact only |
| `res-0363` | `provider-003` | exact only |
| `res-0364` | `provider-004` | exact only |
| `res-0365` | `provider-005` | exact only |
| `res-0366` | `provider-006` | exact only |
| `res-0367` | `provider-007` | exact only |
| `res-0368` | `provider-008` | exact only |
| `res-0369` | `provider-009` | exact only |
| `res-0370` | `provider-010` | exact only |
| `res-0371` | `provider-011` | exact only |
| `res-0372` | `provider-012` | exact only |
| `res-0373` | `provider-013` | exact only |
| `res-0374` | `provider-014` | exact only |
| `res-0375` | `provider-015` | exact only |
| `res-0376` | `provider-016` | exact only |
| `res-0377` | `provider-017` | exact only |
| `res-0378` | `provider-018` | exact only |
| `res-0379` | `provider-019` | exact only |
| `res-0380` | `provider-020` | exact only |
| `res-0381` | `provider-021` | exact only |
| `res-0382` | `provider-022` | exact only |
| `res-0383` | `provider-023` | exact only |
| `res-0384` | `provider-024` | exact only |
| `res-0385` | `provider-025` | exact only |
| `res-0386` | `provider-026` | exact only |
| `res-0387` | `provider-027` | exact only |
| `res-0388` | `provider-028` | exact only |
| `res-0389` | `provider-029` | exact only |
| `res-0390` | `provider-030` | exact only |
| `res-0391` | `provider-031` | exact only |
| `res-0392` | `provider-032` | exact only |
| `res-0393` | `provider-033` | exact only |
| `res-0394` | `provider-034` | exact only |
| `res-0395` | `provider-035` | exact only |
| `res-0396` | `provider-036` | exact only |
| `res-0397` | `provider-037` | exact only |
| `res-0398` | `provider-038` | exact only |
| `res-0399` | `provider-039` | exact only |
| `res-0400` | `provider-040` | exact only |

Only `res-0358` in this shard may contain an `upto` option. Every named exception must contain both `exact` and `upto`; all other records are exact-only.

The hostname for each record is its assigned provider followed by
`.stellar-bazaar.example`. For this shard's first record, `provider-061`, the URL begins
`https://provider-061.stellar-bazaar.example/`.

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
- Use `derived_from.kind: "agent_generated"`, `generation_id: "run-distractors-w01-a03"`, and a real
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
