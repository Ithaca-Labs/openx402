# handwritten-evals

The v2 Stellar Bazaar search benchmark: a hand-authored replacement for the v1 dataset in
`../eval-dataset/`. `BUILD-PLAN.md` in this directory is the authoritative spec; everything else
here implements some section of it.

v1 is not deleted. Per BUILD-PLAN §0.6 it is archived with a note explaining what was tried and why
it was replaced — documenting a measured failure is stronger evidence of rigor than a clean
repository.

---

## The rule that shapes everything here

> **Humans write meaning. Machines write syntax.**
> Never hand-type wire JSON; never machine-generate relevance.

Concretely, a script in `tools/` may:

- emit wire JSON from an authored record (ids, URLs, `accepts` entries, stroop amounts, schema
  scaffolding)
- validate records against `schema/schema-v2.ts`
- compute hashes, freeze the release split, and check distributions
- run retrieval profiles, build the pool, and compute metrics

A script here may **never**:

- invent a capability, a description, a service name, or a tag
- decide that a resource is relevant to a query, or assign a grade
- template a resource from another resource
- generate distractors from a pattern

That last one is not a stylistic preference. v1's `CDP-shaped weather 001` … `030` were mechanically
generated variants of one record, and that is precisely why v1 turned out to be unmeasurable: 30,000
judgments that were category-matching, and a κ that was never computable. Distractors in v2 are
authored individually against a "plausible listing, satisfies no planted capability need" brief
(§1, §9 step 4).

The same rule applies in reverse to relevance: judgments come from humans (`judge: "human"` or
`"curated"`). The only machine-assigned grade permitted is a deterministic hard-filter exclusion,
which is `eligible: false` at grade 0 with a named reason — and that is a `WHERE` clause, not a
relevance opinion (§7).

---

## Layout

| path | contents | who writes it |
|---|---|---|
| `BUILD-PLAN.md` | the spec. Read §0, §2, §3, §4 before authoring anything | — |
| `schema/schema-v2.ts` | the complete v2 zod schema: wire, catalog, sidecar, queries, qrels, pool, calibration, `RELEASE_COUNTS` | human |
| `spec/families.md` | the 20 capability families, their boundaries, and 100 planned resource slots with full axis assignments | human |
| `spec/axes.md` | the §3 axis reference with concrete allowed values; the authoring checklist | human |
| `catalog/` | `catalog-v2.jsonl` (wire) and `sidecar-v2.jsonl` (axes, tags, provenance) | authored meaning, emitted syntax |
| `queries/` | `queries-v2.jsonl` — 100 queries, 50 dev / 50 release | human |
| `qrels/` | `qrels-v2.jsonl` — **only judged pairs**; absence means unjudged | human |
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
| `metamorphic.test.ts` | the six label-free CI invariants (§12.4) |

```sh
npx tsc --noEmit -p tsconfig.json      # the v2 schema module
npx tsc --noEmit -p tools              # the evaluation tools
npx tsx tools/check-schema.ts          # schema refinements
python3 tools/check-families.py        # family spec distributions
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
  means a human read the record and called it irrelevant. A returned resource with no qrel entry is
  unjudged: it contributes 0 to DCG, but it is counted and reported separately via `judged@k`. The
  `pending` judge and the `provisional` flag are both gone — they encoded "unjudged" inside the
  qrels file, which is exactly the conflation v2 removes.
- **`pool-v2.jsonl` exists.** Everything pooled must be judged; the pool file is the completeness
  audit trail, and `unjudgedPooledPairs()` turns that into a gate.
- **Calibration is annotator-vs-annotator.** v1's `agent_grade` presumed an LLM judge. v2 records
  two independent annotators, the adjudicated grade, and `boundary_case` — the 2-vs-3 region where
  the benchmark actually lives.

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
| 0 — v2 schema | done: `schema/schema-v2.ts`, typechecks clean, smoke checks pass |
| 1 — pilot (1 family end to end, measure annotation speed and `judged@10`) | **not started — do this before authoring at scale** |
| 2 — 20 families + axis assignments | done: `spec/families.md`, `spec/axes.md` |
| 3 — author 100 resources | not started |
| 4 — author ~900 distractors, validate no-result exclusion | not started |
| 5 — author 100 queries + pass-1 labels | not started |
| 6–10 — freeze, pool, grade, review, score | not started |

Step 1 is not optional. Scaling an unmeasured process to 100 resources is how v1 produced 30,000
unusable judgments.
