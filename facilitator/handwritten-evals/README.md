# handwritten-evals

The v2 Stellar Bazaar search benchmark: an isolated-agent-authored, human-reviewed replacement for
the v1 dataset. `BUILD-PLAN.md` is the authoritative spec; everything else here implements some
section of it.

v1 is not deleted. Per BUILD-PLAN §0.6 it is archived at `archive/v1/`, with a note explaining what
was tried and why it was replaced — documenting a measured failure is stronger evidence of rigor
than a clean repository.

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
| `BUILD-PLAN.md` | the spec. Read §0, §2, §3, §4 before authoring anything; the revision-note log at the end tracks every scope/architecture change with rationale | — |
| `schema/schema-v2.ts` | the v2 zod schema: wire, catalog, sidecar, queries, qrels, pool, calibration, `RELEASE_COUNTS`, and the pool-build vs scored system split (`POOL_BUILD_SYSTEMS`, `SCORED_SYSTEMS`, `ALL_RUN_SYSTEMS`) | maintainer |
| `spec/families.md` | the 20 capability families, their boundaries, and 100 planned resource slots with full axis assignments | maintainer |
| `spec/axes.md` | the §3 axis reference with concrete allowed values; the authoring checklist | maintainer |
| `forbidden-capabilities.md` | the 10 out-of-scope capabilities (FC-01..FC-10) that `no_result` queries target and the catalog must never satisfy | maintainer |
| `query-config.ts` | the frozen 100-query assignment policy (split/class/family/filters/anchors) shared by prompt generation and merge validation | maintainer |
| `distractor-config.ts` | the frozen 400-distractor shard/assignment policy | maintainer |
| `catalog/` | `catalog-v2.jsonl` (wire) and `sidecar-v2.jsonl` (axes, tags, provenance) — 100 labeled + 400 distractors, all `review_status: approved` | isolated author agents + owner review |
| `queries/` | `queries-v2.jsonl` — 100 queries, 50 dev / 50 release, all `review_status: approved` | isolated query agents + owner review |
| `staging/` | ephemeral agent-authoring workspace: authoring briefs, generated per-agent prompt packs, raw per-shard outputs (`staging/resources/`, `staging/distractors/`, `staging/queries/`), and pass-1 seed grading packs (`staging/query-pass1/`). Not part of the frozen dataset — everything here either gets merged into `catalog/`/`queries/` or stays as a build-time audit trail | isolated agents (raw output) / scripts (merge input) |
| `qrels/` | development qrels only; pair-level release judgments remain sealed outside this tree. Empty — Step 8 (grading) has not run | isolated graders/adjudicator + owner review |
| `pool/` | `pool-v2.jsonl` — which pairs entered the judgment pool and from which of the three pool-build systems (`bm25`, `exact_dense`, `hybrid_exact`). Empty — Step 7 (pool build) has not run | script |
| `manifests/` | `dataset-v2.json` (frozen §6 manifest: counts, content hashes of every frozen input) and `release-queries-v2.json` (release query IDs + hashes, no judgments) — both now written; see `manifests/README.md` for the freeze/holdout contract | script |
| `reports/` | `forbidden-capability-audit-v2.json` (done, `overall_passed: true`) and `release-gates-v2.json` (build-status snapshot); final metric/significance reports land here once Step 10 runs | script |
| `archive/v1/` | the retired v1 dataset, preserved per BUILD-PLAN §0.6 | — |
| `tools/` | validators, generators, and CLIs. Syntax and arithmetic only — never invents semantic content | script |

### `tools/`

Each pipeline stage is a paired `<thing>.ts` (pure logic + zod schema, unit-tested) plus, where it
touches the filesystem, a `run-<thing>.ts` / `<thing>` CLI wrapper.

| stage | core module | CLI |
|---|---|---|
| schema smoke test | — | `check-schema.ts` |
| family spec re-derivation | — | `check-families.py` |
| Step 3 resource merge | `merge-resources.ts` | (same file) |
| Step 4 distractor merge + forbidden-capability scan | `merge-distractors.ts`, `forbidden-scanner.ts` | (same files) |
| §6 forbidden-capability audit (blind, opaque, owner sign-off) | `forbidden-capability-audit.ts` | `run-forbidden-capability-audit.ts` |
| Step 5 query merge + pass-1 seed prep | `merge-queries.ts`, `query-pass1.ts` | (same files) |
| §4/§11 distribution + anti-correlation audit | `distribution-audit-v2.ts` | `run-distribution-audit-v2.ts` |
| Step 6 dataset freeze + release-query index | `manifest-v2.ts` | `freeze-manifest-v2.ts` |
| holdout / sealed release-run discipline | `holdout-v2.ts` | `release-run-ledger-v2.ts` |
| Step 7 pool build (exact methods only — `bm25`/`exact_dense`/`hybrid_exact`) and production system scoring inputs | `pool.ts` | `build-pool.ts` |
| pool freshness binding across all 6 run systems | `pool-snapshot-v2.ts` | (same file) |
| Step 8 two-way blind grading + adjudication | `grading-pipeline.ts` | `run-grading-pipeline.ts` |
| Pass 2b unpooled audit | `unpooled-audit.ts` | (same file) |
| metrics: nDCG@10/MRR/bpref/`judged@k`, BM25 baseline, stratified κ, significance | `scoring.ts`, `bm25.ts`, `agreement.ts`, `significance.ts` | — |
| Step 10 evaluation report + owner sign-off | `report-v2.ts` | `generate-report-v2.ts`, `finalize-report-v2.ts` |
| §11 release gate status | `release-gates-v2.ts` | (same file) |
| §12.4 label-free CI invariants (needs a live Postgres+pgvector) | `metamorphic.test.ts` | — |
| §12.1 development-only CI scoring | — | `development-ci-v2.ts` |

```sh
npx tsc --noEmit -p tsconfig.json      # the v2 schema module
npx tsc --noEmit -p tools/tsconfig.json # the evaluation tools
npx tsx tools/check-schema.ts          # schema refinements
python3 tools/check-families.py        # family spec distributions
npm run benchmark:v2:status            # write the current blocked/ready gate report
```

Two tsconfigs, deliberately. The one in this directory covers `schema/`; `tools/tsconfig.json`
covers the evaluation tools, which are excluded from the service build so an evaluation-only BM25
implementation can never ship in production. Both resolve dependencies from
`facilitator/node_modules`.

---

## Results (development split)

50 queries, 1442 owner-reviewed judgments. Full numbers: `reports/dev-evaluation-v2-simplified.json`
(fusion tuning) and `reports/embedding-bakeoff-v2.json` (embedding models). Charts: `reports/charts/`.

**Fusion tuning — validated on both a stand-in implementation and real production code.** Naive
equal-weight RRF (production's shipped default: lexical weight 0.7, semantic weight 0.3, `rrf_k`
20) underperforms the stronger single signal alone. A semantic-favored, tighter-`k` weighting
(0.2/0.8, `rrf_k` 6) fixes it and beats every single-mode baseline:

| system | nDCG@10 (stand-in) | nDCG@10 (real facilitator search) |
|---|---|---|
| lexical only | 0.674 (BM25) | 0.533 (`ts_rank_cd`) |
| semantic/dense only | 0.843 (OpenAI `text-embedding-3-large`) | 0.716 (self-hosted `bge-m3`) |
| hybrid, shipped default | 0.795 | 0.611 — **worse than semantic alone** |
| hybrid, tuned | 0.847 | 0.724 |

The real-production run seeds an isolated Postgres+facilitator instance with this dataset's 500
resources via `src/search/harness.ts`'s `seedSuite` and runs the actual `SearchService` code path
(`facilitator/tools/eval-real-search.mts`) — not a mock.

**Embedding model bakeoff** — OpenAI `text-embedding-3-large`/`-small`, Qwen3-Embedding-8B, and
Voyage-4, scored on quality and single-query latency (`facilitator/handwritten-evals/tools/embedding-bakeoff.mts`):

| model | nDCG@10 | p50 latency | p95 latency |
|---|---|---|---|
| Qwen3-Embedding-8B | 0.835 | 3,152 ms | 13,035 ms |
| Voyage-4 | 0.823 | 704 ms | 869 ms |
| OpenAI `text-embedding-3-large` | 0.818 | 968 ms | 1,251 ms |
| OpenAI `text-embedding-3-small` | 0.774 | 688 ms | 797 ms |

Qwen3-Embedding-8B has the best raw quality but a p95 latency (13s) that rules it out for
live query embedding; Voyage-4 is the best quality/latency balance for production use.

### Reproducing

```sh
# fusion tuning against the stand-in benchmark (bm25 + OpenAI dense)
npx tsx tools/score-embedding-bakeoff.mts   # requires staging/embeddings/bakeoff-*.json (see below)

# embedding model bakeoff (needs OPENROUTER_API_KEY)
npx tsx tools/embedding-bakeoff.mts

# real production facilitator search (needs an isolated Postgres+pgvector instance --
# see facilitator/compose.yaml; never point DATABASE_URL at a shared/production database)
cd ../.. && npx tsx facilitator/tools/eval-real-search.mts

# charts
uv run --with matplotlib --with numpy python3 tools/plot-benchmark-charts.py
uv run --with matplotlib --with numpy python3 tools/plot-quality-vs-latency.py
```

### What's public vs. sealed

Public in this repo: the 500-resource catalog, all 100 queries (both splits), development-split
qrels (owner-reviewed, `qrels/development-v2.jsonl`), and every report/chart referenced above.

**Sealed and NOT in this repo:** the release-split qrels — the answer key for the 50-query holdout
set. They live at an out-of-tree location precisely so a system can be scored against them blind,
later, without having trained or tuned against the answer key. See `tools/holdout-v2.ts` for the
isolation mechanism (`STELLAR_BAZAAR_RELEASE_QRELS_PATH`, checked to reject any path inside this
tree). If you're extending this benchmark, do the same: never commit release judgments here.

---

## What the schema changes, and why

`schema/schema-v2.ts` is a **standalone module**. It does not modify the production v1 schema at
`../src/search/release/schema.ts`, which stays authoritative until the v2 dataset is authored and
frozen. Summary of the differences (BUILD-PLAN §0):

- **Identifier widths.** `res-\d{4}` and `provider-\d{3}` — v1 caps at res-999 and 100 providers;
  the v2 corpus is currently scoped to 500 records (MVP cut from 900 distractors to 400, see
  BUILD-PLAN sixth revision) over up to 120 providers.
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
- **`pool-snapshot-v2.json` proves freshness.** It binds the frozen catalog/query hashes, committed
  retrieval profiles and implementation sources, all five system runs, and exact pool bytes. Any
  change fails scoring until the systems are rerun, new candidates are pooled, and grading updates.
- **Development runs in CI; release stays sealed.** `npm run benchmark:v2:development-ci` scores
  exactly 50 development queries on every commit once the dataset freeze exists. Release qrels
  live outside this tree and are reachable only through an explicitly recorded holdout run.
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
| 1 — pilot | removed from the build order (optional, non-blocking); see BUILD-PLAN fifth revision note |
| 2 — 20 families + axis assignments | done: `spec/families.md`, `spec/axes.md` |
| 3 — author 100 resources | done: all 100 labeled records authored by isolated agents, hand-reviewed, `review_status: approved` |
| 4 — author 400 distractors (MVP scope cut from 900, see BUILD-PLAN sixth revision), validate no-result exclusion | done: all 400 distractors authored, hand-reviewed for leakage/templating, `review_status: approved`; §6 forbidden-capability audit passed (`reports/forbidden-capability-audit-v2.json`, `overall_passed: true`) |
| 5 — author 100 queries + pass-1 labels | done: all 100 queries authored by 5 isolated agents, hand-reviewed, `review_status: approved`. Pass-1 seed grading complete, 700/700 pairs (`staging/query-pass1/report-v2.json`, status `pass`) |
| 6 — freeze release split, hash into manifest | done: `manifests/dataset-v2.json` status `pass` (500 resources, 100 queries, all query-class targets met), `manifests/release-queries-v2.json` written (IDs + hashes only) |
| 7 — run pool-build systems, build pool | done: `bm25`/`exact_dense`/`hybrid_exact` pool-build systems run; production `lexical`/`semantic`/`hybrid` scored separately on an isolated Postgres+facilitator instance against the resulting pool (never used to build it), see Results above |
| 8–10 — grade, review, score | done for development split (1442 owner-reviewed judgments, real production search scored, see Results); release-split grading complete and owner-reviewed but its qrels stay sealed out-of-tree (see "What's public vs. sealed" above) — release-split *scoring* is intentionally deferred until search strategy is finalized |

Run `npm run benchmark:v2:status` for the evidence-backed snapshot in
`reports/release-gates-v2.json`. Missing semantic or owner-review evidence is always reported as
blocked, never inferred. Step 1 remains mandatory before any full-scale authoring wave is launched.
