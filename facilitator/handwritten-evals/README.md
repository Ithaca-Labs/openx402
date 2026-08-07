# handwritten-evals

The v2 Stellar Bazaar search benchmark: an isolated-agent-authored, human-reviewed replacement for
the v1 dataset in `../eval-dataset/`. `BUILD-PLAN.md` is the authoritative spec; everything else
here implements some section of it.

v1 is not deleted. Per BUILD-PLAN §0.6 it is archived with a note explaining what was tried and why
it was replaced — documenting a measured failure is stronger evidence of rigor than a clean
repository.

---

## The rule that shapes everything here

> **Fresh-context agents write meaning. Deterministic programs validate syntax. The owner accepts
> every artifact.**
>
> No authoring agent sees another author's output. No grader sees retrieval-system identity, rank,
> score, authoring context, or another grader's decision.

Claude subagents may independently author resources, distractors, queries, semantic grades,
rationales, critiques, and adjudication drafts. Every run records its model revision, prompt hash,
run ID, shard ID, and review status. The same agent may not author and grade the same work.

A deterministic program in `tools/` may:

- emit wire JSON from an authored record (ids, URLs, `accepts` entries, stroop amounts, schema
  scaffolding)
- validate records against `schema/schema-v2.ts`
- compute hashes, freeze the release split, and check distributions
- run retrieval profiles, build the pool, and compute metrics

A deterministic program may **never** invent semantic content or relevance. An authoring agent may
never:

- read another authoring agent's shard
- read retrieval runs, qrels, or release answers while authoring
- grade its own resource or query
- template a resource from another resource
- generate distractors from a pattern

That last one is not a stylistic preference. v1's `CDP-shaped weather 001` … `030` were mechanically
generated variants of one record, and that is precisely why v1 turned out to be unmeasurable: 30,000
judgments that were category-matching, and a κ that was never computable. Distractors in v2 are
produced in small shards by fresh-context agents against a "plausible listing, satisfies no planted
capability need" brief (§1, §9 step 4).

Relevance comes from two isolated grading agents and a separate adjudicator, followed by owner
review. The benchmark is reported as **agent-authored, human-reviewed**, not human-authored ground
truth. Deterministic hard-filter exclusions remain `eligible: false` at grade 0 with a named reason;
they are `WHERE` clauses, not relevance opinions (§7).

---

## Layout

| path | contents | who writes it |
|---|---|---|
| `BUILD-PLAN.md` | the spec. Read §0, §2, §3, §4 before authoring anything | — |
| `schema/schema-v2.ts` | the v2 zod schema: wire, catalog, sidecar, queries, qrels, pool, calibration, `RELEASE_COUNTS` | maintainer |
| `spec/families.md` | the 20 capability families, their boundaries, and 100 planned resource slots with full axis assignments | maintainer |
| `spec/axes.md` | the §3 axis reference with concrete allowed values; the authoring checklist | maintainer |
| `catalog/` | `catalog-v2.jsonl` (wire) and `sidecar-v2.jsonl` (axes, tags, provenance) | isolated author agents + owner review |
| `queries/` | `queries-v2.jsonl` — 100 queries, 50 dev / 50 release | isolated query agents + owner review |
| `qrels/` | `qrels-v2.jsonl` — **only judged pairs**; absence means unjudged | isolated graders/adjudicator + owner review |
| `pool/` | `pool-v2.jsonl` — which pairs entered the pool and from which systems | script |
| `manifests/` | dataset manifest, frozen release split, content hashes | script |
| `reports/` | release gates, stratified κ, metric reports | script |
| `tools/` | validators and generators. Syntax only | script |

Empty directories are placeholders for build-order steps that have not run yet (§9).

### `tools/`

| tool | what it does |
|---|---|
| `check-schema.ts` | runtime smoke check of `schema/schema-v2.ts`: accepts well-formed records of each kind, rejects the specific v1 mistakes v2 removes |
| `check-families.py` | parses `spec/families.md` back out and re-runs every §3 and §4 gate checkable from it |
| `scoring.ts` | metrics over incomplete judgments — nDCG@10, MRR, bpref, `judged@k` (§10) |
| `bm25.ts` | evaluation-only BM25 comparability baseline (§10) |
| `agreement.ts` | stratified κ and the grade confusion matrix (§8 pass 3) |
| `significance.ts` | paired permutation test and bootstrap CI (§10) |
| `merge-distractors.ts` | validates and merges Step 4 shards; scans the complete catalog for forbidden capabilities (§6) |
| `metamorphic.test.ts` | the six label-free CI invariants (§12.4) |
| `release-gates-v2.ts` | validates present artifacts, reports §9 build status, and blocks absent §11 release evidence |

```sh
npx tsc --noEmit -p tsconfig.json      # the v2 schema module
npx tsc --noEmit -p tools              # the evaluation tools
npx tsx tools/check-schema.ts          # schema refinements
python3 tools/check-families.py        # family spec distributions
npm run benchmark:v2:status            # write the current blocked/ready gate report
```

Two tsconfigs, deliberately. The one in this directory covers `schema/`; `tools/tsconfig.json`
covers the evaluation tools, which are excluded from the service build so an evaluation-only BM25
implementation can never ship in production. Both resolve dependencies from
`facilitator/node_modules`.

---

## What the schema changes, and why

`schema/schema-v2.ts` is a **standalone module**. It does not modify the production v1 schema at
`../src/search/release/schema.ts`, which stays authoritative until the v2 dataset is authored and
frozen. Summary of the differences (BUILD-PLAN §0):

- **Identifier widths.** `res-\d{4}` and `provider-\d{3}` — v1 caps at res-999 and 100 providers,
  and the v2 corpus is 1,000 records over 120 providers.
- **`scheme` is an enum.** `exact | upto`, on both `accepts` and the query filter. v1 pinned it to
  the `exact` literal, which made the product's differentiating scheme unrepresentable.
- **`source_class` is gone.** Its categories were never mutually exclusive — a resource can be MCP
  *and* adversarial, or sparse *and* a distractor — so a single enum forced a false choice and made
  the counts fail to sum. Replaced by orthogonal `authorship`, `resource_type`, `is_distractor`,
  `is_sparse` and `adversarial_kind` (nullable; `null` means not adversarial, and there is no
  separate boolean to contradict it).
- **Unjudged is a first-class state.** `qrels-v2.jsonl` contains only judged pairs. Grade 0 there
  means isolated graders inspected the record and called it irrelevant. A returned resource with no qrel entry is
  unjudged: it contributes 0 to DCG, but it is counted and reported separately via `judged@k`. The
  `pending` judge and the `provisional` flag are both gone — they encoded "unjudged" inside the
  qrels file, which is exactly the conflation v2 removes.
- **`pool-v2.jsonl` exists.** Everything pooled must be judged; the pool file is the completeness
  audit trail, and `unjudgedPooledPairs()` turns that into a gate.
- **Calibration is isolated-grader vs isolated-grader.** v2 records two independent agent grades,
  a separate adjudication, owner review status, and `boundary_case` — the 2-vs-3 region where the
  benchmark actually lives. Agreement measures consistency, not human ground-truth validity.

The v1 wire constraints are all preserved unchanged: `.example` hostnames, `serviceName` ≤ 32,
`tags` ≤ 5, `description` ≤ 4,000, `accepts` 1–3, network-matched USDC contract, valid Stellar G or
C `payTo`, `asset_decimals` 7.

Two v2 additions beyond the literal text of §0, both there to make §11 gates decidable by script
rather than by eye: a structured `axes` object on labeled sidecar records (so "differs from family
siblings on ≥2 axes" and the anti-correlation checks are computable), and an `mcp` object carrying
the tool tuple, transport, tool count and schema shape that §4 requires MCP resources to vary on.
Known conflicts between §3's axis values and the v1 field enums are listed at the end of
`spec/axes.md` rather than silently resolved.

---

## Status

| step (§9) | state |
|---|---|
| 0 — v2 schema and v1 archive | done: current schema validates; specified v1 artifacts are preserved under `archive/v1/`; the golden wire fixture remains active |
| 1 — mandatory end-to-end pilot | **blocked**: no pilot artifacts, measured `judged@10` threshold, exclusion-audit cost, dual grading, or owner review exist |
| 2 — 20 families + axis assignments | done: `spec/families.md`, `spec/axes.md` |
| 3 — author 100 resources | partial: all 100 labeled records are merged and schema-valid; all 100 sidecars remain `review_status: "pending"`, and release-grade provenance/owner acceptance is absent |
| 4 — author ~900 distractors, validate no-result exclusion | package ready, authoring blocked: shared brief, scanner, assignment policy, and 90 isolated prompts exist; 0/900 distractors authored; the current 100-record catalog has zero deterministic forbidden-signature hits |
| 5 — author 100 queries + pass-1 labels | package ready, authoring not started: 10 isolated query prompts and 10 concrete anchor-aware blind pass-1 grader prompts are generated; 0/100 queries |
| 6–10 — freeze, pool, grade, review, score | not started |

Run `npm run benchmark:v2:status` for the evidence-backed snapshot in
`reports/release-gates-v2.json`. Missing semantic or owner-review evidence is always reported as
blocked, never inferred. Step 1 remains mandatory before any full-scale authoring wave is launched.
