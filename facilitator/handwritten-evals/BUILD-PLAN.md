# Stellar Bazaar Search Benchmark — Build Plan v2

Hand-authored replacement for the v1 dataset. Supersedes `manifests/dataset-v1.json`.

**Core principle:** humans write meaning, machines write syntax.
Never hand-type wire JSON; never machine-generate relevance.

> **Revision note.** This plan was revised after external review. Corrected: unjudged is now a
> first-class state distinct from grade 0 (§10); MCP resources and queries restored (§3, §4, §6);
> release-set CI leakage removed (§12); the v2 schema is fully specified rather than sketched (§0);
> three unsound metamorphic invariants replaced with six valid ones (§12); effort estimates raised
> from 16 h to 30–50 h (§9); κ reporting stratified (§8); BM25 implementation pinned (§10); v1
> archived rather than deleted (§0).
>
> **Second revision.** `source_class` retired in favour of orthogonal fields, since the categories
> overlap (§0.2b); `no_result` queries now require capability exclusion against the distractor
> corpus (§6); relevance thresholds and nDCG gains pinned explicitly, infAP dropped, `judged@k`
> threshold moved from an invented 0.7 to a pilot-derived figure (§10); distractors are authored
> individually rather than script-generated, per the syntax-only rule (§1, §9).

---

## 0. Step 0 — complete v2 schema

The current `src/search/release/schema.ts` blocks this plan. Define the **entire** v2 schema before
authoring anything; a mid-authoring schema change invalidates completed work.

### 0.1 Identifier widths

| field | v1 | v2 | why |
|---|---|---|---|
| `resource_id` | `/^res-\d{3}$/` | `/^res-\d{4}$/` | v1 caps at res-999; the corpus is 1,000 records |
| `provider_id` | `/^provider-\d{2}$/` | `/^provider-\d{3}$/` | v1 caps at 100 providers |
| `query_id` | `/^qry-\d{3}$/` | unchanged | 100 queries fits |

Renumber existing IDs during migration; do not mix widths.

### 0.2 Enum changes

```
AcceptsSchema.scheme          : z.literal("exact")  ->  z.enum(["exact", "upto"])
SupportedFiltersSchema.scheme : z.literal("exact")  ->  z.enum(["exact", "upto"])
SupportedFiltersSchema.type   : keep z.enum(["http", "mcp"])

QueryRecordSchema.query_class:
  add "mcp"  ->  ["capability", "structured", "semantic", "price_category",
                  "adversarial", "no_result", "cold_start", "mcp"]

QrelRecordSchema.judge:
  ["deterministic", "openrouter", "curated", "pending"]
  -> ["deterministic", "human", "curated"]        (openrouter/pending retired)
```

### 0.2b Retire `source_class` — the categories overlap

`source_class` is a single enum, but the categories it tries to express are **not mutually
exclusive**: a resource can be MCP *and* adversarial, or sparse *and* a distractor. Any single-enum
encoding forces a false choice and makes the counts fail to sum.

Delete `source_class` and `adversarial: boolean`. Replace with orthogonal fields:

```ts
{
  authorship:      z.enum(["human"]),            // provenance of the *meaning*
  resource_type:   z.enum(["http", "mcp"]),      // transport, NOT provenance
  is_distractor:   z.boolean(),                  // unlabeled corpus padding
  is_sparse:       z.boolean(),                  // minimal metadata
  adversarial_kind: AdversarialKind.nullable(),  // null = not adversarial
}
```

`adversarial_kind: null` replaces the `adversarial` boolean entirely, so the v1 `superRefine`
enforcing consistency between the two fields is deleted.

**`generated_mcp` was never provenance.** MCP is a resource type. Conflating transport with
authorship is a v1 modelling error; do not carry it forward.

### 0.3 Qrel semantics — unjudged is not grade 0

**The single most important schema change.** v1 conflated "judged irrelevant" with "never looked at."

- `qrels-v2.jsonl` contains **only judged pairs.** Grade 0 there means *a human read this and
  determined it irrelevant.*
- A returned resource with no qrel entry is **unjudged** — a distinct state. It contributes 0 to
  DCG (unavoidable) but is counted and reported separately via `judged@k`.
- Add `pool-v2.jsonl` recording exactly which pairs entered the pool and from which systems.
  Everything pooled must be judged; the file is the completeness audit trail.

Replace the v1 `superRefine` that requires OpenRouter judgment:

```
if (value.eligible && value.judge === "deterministic") -> error   // DELETE
if (value.eligible && value.judge !== "human" && value.judge !== "curated") -> error   // ADD
```

`eligible: false` still means a deterministic hard-filter exclusion at grade 0.

### 0.4 RELEASE_COUNTS v2

```ts
export const RELEASE_COUNTS = {
  resources: { labeled: 100, distractor: 900, total: 1_000 },
  resource_types: { http: 85, mcp: 15 },
  queries: { development: 50, release: 50, total: 100 },
  qrels: { estimated: 3_500, exhaustive: false },   // pooled, not cross-product
  providers: 120,
  // Orthogonal tags over the 100 labeled resources. These deliberately overlap
  // and do NOT sum to 100 — a resource may be both MCP and adversarial.
  labeled_tags: {
    adversarial: 15,
    sparse:      10,
    mcp:         15,
  },
} as const;
```

Assert `labeled = 100` and `distractor = 900` independently. The `labeled_tags` counts are
overlapping minimums, never a partition.

### 0.5 Calibration schema

`HumanCalibrationSchema` currently requires `agent_grade`, which assumes an LLM judge. Replace:

```ts
{
  query_id, resource_id,
  annotator_a_grade: 0..3,
  annotator_b_grade: 0..3 | null,
  adjudicated_grade: 0..3 | null,
  annotator_a: string, annotator_b: string | null,
  reviewed_at: datetime | null,
  boundary_case: boolean,        // true when either grade is 2 or 3
  notes: string | null,
}
```

### 0.6 Archive, do not delete

Move to `archive/v1/`, preserved with a `README.md` explaining what was tried and why it was
replaced:

`qrels/qrels-v1.jsonl`, `manifests/openrouter-qrels-v1.jsonl`, `prompts/judge-v1.0.0.txt`,
`src/cli/judge-release-qrels.ts`, `reports/calibration-v1.json`, `reports/position-consistency*.json`.

Documenting a measured failure — 30,000 judgments that turned out to be category-matching, κ never
computable — is stronger evidence of methodological rigor than a clean repository.

Keep `tests/fixtures/search/golden-v1.json` in place. It is the format template.

---

## 1. Scope

| artifact | count | labeled? |
|---|---|---|
| Labeled core resources | 100 (85 HTTP / 15 MCP) | yes |
| Distractor resources | ~900 | **no — unjudged, not grade 0** |
| Queries | 100 (50 dev / 50 release) | — |
| Judgments | ~3,500 pooled | yes |

Distractors make retrieval hard. At 100 documents a top-20 result returns 20% of the corpus and
every system looks identical; at 1,000 it returns 2%.

**Distractors are unjudged, not irrelevant.** A distractor can be genuinely relevant — semantic
retrieval is exactly the mechanism that would surface one. See §10.

**Distractors are authored, never templated.** Scripts produce syntax only. Each distractor is
written individually against a "plausible listing, satisfies no planted capability need" brief.
Script-templating them recreates the v1 failure — `CDP-shaped weather 001` through `…030` were
mechanically generated variants, and that is precisely why v1 was unmeasurable. Authoring is not
human-time-bound, so this costs calendar time, not review hours.

---

## 2. Capability families

Derived from tag and term-frequency analysis over 14,669 live CDP x402 listings
(`raw-generation-output/foreign_cdp_reference.jsonl`). Counts are supporting evidence.

| # | Family | Evidence in real corpus |
|---|---|---|
| 1 | On-chain state / block data | `on-chain(357)`, `chain(1133)` |
| 2 | Token & market prices | `market-data(299)`, `price(1837)` |
| 3 | DeFi / DEX analytics | `defi(212)`, `glassnode(297)` |
| 4 | Address & wallet risk scoring | `risk(1020)`, `score(815)` |
| 5 | Compliance / sanctions screening | `compliance(281)` |
| 6 | Regulatory documents | `federal-register(167)`, `regulations(166)` |
| 7 | Macro indicators | `macro(245)` |
| 8 | Equities & company data | `stocks(198)` |
| 9 | LLM inference | `llm(194)`, `inference(165)` |
| 10 | Embeddings & vector ops | `ai(496)` |
| 11 | Web search | `search(1267)` |
| 12 | Web scraping / extraction | `web(619)` |
| 13 | Attested / signed feeds | `attested(188)` |
| 14 | Analytics & metrics | `analytics(483)`, `metrics(297)` |
| 15 | Identity & KYC | thin — disclose as gap |
| 16 | Document parsing / OCR | thin — disclose as gap |
| 17 | Geocoding & mapping | thin — disclose as gap |
| 18 | Weather | thin — disclose as gap |
| 19 | Translation & language | thin — disclose as gap |
| 20 | News & feeds | thin — disclose as gap |

Families 15–20 are genuinely sparse in the live ecosystem. Include them for coverage and **say so
in the writeup** — that disclosure is a credibility asset.

**5 resources per family = 100.**

---

## 3. Differentiation axes

Every labeled resource must differ from its family siblings on **at least two** axes. If two differ
on nothing a buyer would care about, one is a distractor, not a labeled resource.

| axis | values | basis |
|---|---|---|
| Capability | the specific thing it does | — |
| **Resource type** | **`http` / `mcp`** | **product capability, not ecosystem frequency** |
| Input method | GET / POST | 9,649 / 4,993 (≈2:1) |
| Input shape | query params / JSON body / path | — |
| Output shape | json, text, score, list, status | `json(2109)`, `text(1263)`, `score(815)` |
| Coverage | single-chain / multi-chain / regional / global | `across(873)` |
| Freshness | live / hourly / daily / historical snapshot | `live(1400)` |
| Price tier | 0, 0.001, 0.002, 0.003, 0.005, 0.01, 0.02, 0.05, 0.1, 0.15 USDC | use these exact tiers |
| Network | `stellar:testnet` / `stellar:pubnet` | — |
| Scheme set | see §4 | — |
| Attestation | signed / unsigned | `attested(188)` |

**On `resource_type`:** all 14,669 sampled real listings are `http`. That describes today's
ecosystem, not this product — MCP discovery is an explicit product promise and the benchmark must
demonstrate it. Ecosystem sparsity is a fact to disclose, not a reason to omit the capability.

---

## 4. Distribution targets

### Resource type (labeled core, 100)

| type | count |
|---|---|
| `http` | 85 |
| `mcp` | 15 |

MCP resources must vary on MCP-specific attributes: tool tuple identity, tool schema shape,
transport (stdio vs streamable HTTP), and tool count. Spread them across ≥8 families so `type: mcp`
is not a proxy for one capability.

> A `type: mcp` filtered query pools to only 15 candidates — rankable but thin. If MCP discovery is
> a headline claim, consider 80/20 instead.

### Scheme (labeled core, 100)

Scheme is **per payment option**, not per resource — 40% of real listings carry 2+ `accepts`
entries, and 75 of the 84 real `upto` listings also offer `exact`.

| group | count | rationale |
|---|---|---|
| `exact` only | 70 | realistic majority |
| `exact` + `upto` on same resource | 22 | mirrors the dominant real pattern |
| `upto` only | 8 | the only group where a scheme filter changes the answer set |

Real corpus is 0.57% `upto`. This is a deliberate ~50× oversample because `upto` is the product
differentiator. **State it as a design choice** — never as a distribution claim. Keep the 900
distractors ~99% `exact`-only so the full corpus lands near 3%.

**Anti-correlation rule:** spread the 30 `upto` resources across all 20 families, all price tiers,
both methods, and both resource types. If `upto` correlates with quality or description length, the
retriever learns a spurious signal and the benchmark silently lies. Same for `mcp` and `network`.

### Adversarial (~15 of 100)

`adversarial_kind` already exists in `SidecarRecordSchema`:
`prompt_injection`, `keyword_stuffing`, `false_free_claim`, `misleading_tags`,
`unsupported_network_claim`, `scheme_mismatch_claim`, `duplicate_provider`, `capability_spoof`,
`ranking_instruction`

Use ≥6 distinct kinds. These are your planted grade-0 negatives — without them a bad ranking and a
good one can score identically.

### Sparse (~10 of 100)

Minimal metadata: no `description`, no `tags`, terse `serviceName`. Tests graceful degradation. The
real corpus has 168 listings with no description.

---

## 5. Wire generation constraints

Enforced by `WireSchema`:

- `resource.url` hostname **must** end in `.example` (reserved TLD)
- `serviceName` ≤ 32 chars, `tags` ≤ 5, `description` ≤ 4,000 chars
- `accepts` min 1, max 3
- `asset` must equal the network's configured USDC:
  - testnet `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`
  - pubnet `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`
- `payTo` a valid Stellar G or C address
- `asset_decimals` 7; `price_usd_snapshot.basis` `fixed_fixture_minimum_option_value`

Provenance: `derived_from.kind = "curated"` with a `generation_id`. Record family and axis rationale
in a notes file.

**Licensing:** do not copy CDP prose or schemas, even lightly reworded. The manifest already commits
to this. Derive axes; write original text.

---

## 6. Queries

100 total, **50 development / 50 release**.

At n=30 the confidence interval on nDCG@10 is roughly ±0.08 while the differences being measured are
~0.04. 50 is the minimum defensible release size.

| class | count | notes |
|---|---|---|
| `capability` | 30 | plain capability need |
| `structured` | 14 | exercises `filters` (network, scheme, type) |
| `semantic` | 14 | paraphrase / indirect phrasing, low lexical overlap |
| `price_category` | 9 | uses `evaluation_constraints.max_price_usd` |
| `mcp` | 9 | **new** — see below |
| `adversarial` | 9 | should surface the honest resource, not the trap |
| `no_result` | 10 | `expects_no_result: true`, capability absent by design |
| `cold_start` | 5 | sparse-metadata targets |

### MCP query class (9 queries)

Must cover, at minimum:

- **Tuple identity** — finding a specific MCP tool by its `(server, tool)` identity
- **Tool schema** — querying by input/output schema shape
- **Transport** — stdio vs streamable HTTP
- **HTTP-vs-MCP disambiguation** — same capability available both ways; query specifies which

Split across dev and release proportionally.

### No-result queries — capability exclusion is mandatory

A `no_result` query asserts that **no resource in the entire corpus** satisfies its need. With 900
unjudged distractors that assertion is unsafe by default: a distractor may accidentally provide the
capability, the system correctly returns it, and the benchmark scores correct behavior as a failure.

For **all ten** `no_result` queries, all three steps are required:

1. **Forbid the capability in the distractor authoring brief.** Maintain an explicit
   `forbidden-capabilities.md` listing every no-result capability; every distractor authoring pass
   receives it and must avoid those capabilities.
2. **Validate the exclusion deterministically.** A script scans the full 1,000-record corpus for the
   forbidden capabilities — keyword, tag, and schema signatures — and fails the build on any hit.
   This is syntax checking, so a script is the correct tool.
3. **Manually audit the full catalog** for those specific capabilities before freezing. Automated
   signature matching will not catch a paraphrase; a human pass over 1,000 short descriptions,
   scoped to ten capabilities, will.

Record the audit result in the gate report. An unvalidated `no_result` query is worse than no
`no_result` query at all — it produces a confidently wrong number.

### Authoring rules

1. Write the query **before** looking at the catalog, from a buyer use case. Then find its answers.
   Browsing while authoring produces queries you already know retrieve well.
2. Record real provenance in `derived_from` — family, use case, trap. v1 has
   `{"generation_id":"query-author-v2","kind":"curated"}` on all 100, which is a placeholder.
   Reviewers ask about this first.
3. If you cannot find an answer, that is a finding: mark `expects_no_result` or log a coverage gap.
4. Vary phrasing register — terse agent-style, verbose natural language, keyword-only.

---

## 7. Grading rubric

| grade | meaning |
|---|---|
| **3** | Satisfies the exact capability and every stated constraint. A buyer picks this first. |
| **2** | Provides the capability but mismatches a secondary attribute — coverage too narrow, freshness too stale, awkward input shape. Usable, not ideal. |
| **1** | Same family, different capability. Related but does not answer the need. |
| **0** | Different capability, a planted trap, or prose that contradicts structured fields. **Explicitly judged** — not the same as unjudged. |

**Filters are not relevance.** `network`, `scheme`, `type`, `asset`, and `price` are `WHERE` clauses
— assert them in code, never spend a human grade on them. Grade relevance only over candidates that
already pass the filter. v1 burned judgment on exactly this; the damage is visible in rationales
like `"evaluation-only price constraint"`.

**The 2-vs-3 boundary is where the benchmark lives.** Concentrate review effort there.

---

## 8. Labeling procedure

### Pass 1 — during authoring (~6–8 labels/query)
While writing each query, name from corpus knowledge: the 3s, 2s, 1s, and planted 0s.

### Pass 2 — pooled adjudication (~28 candidates/query)

1. Run **five** systems: lexical, semantic, hybrid, reranked, **and BM25** (§10)
2. Union the top-20 from each, dedupe
3. **Strip profile attribution and shuffle** — grading must be blind
4. Grade every pooled candidate
5. Record the pool in `pool-v2.jsonl` with contributing systems

Family triage keeps this tractable: candidates from a non-target family are usually quick 0s.

### Pass 2b — unpooled audit

Randomly sample **~20 topically related but unpooled** resources per 10 queries and judge them. If
audited relevance is materially above zero, pooling is too shallow — increase depth and re-pool.
This is the empirical check on the unjudged assumption.

### Pass 3 — independent review (release only)

Both annotators grade all 50 release queries independently. Adjudicate disagreements and record
resolutions.

**Report κ stratified, not as a single number.** A pool dominated by obvious 0s inflates weighted κ
even when annotators disagree badly at the boundary:

- weighted κ across all pooled candidates
- **weighted κ restricted to relevant-family candidates** (the meaningful figure)
- exact agreement rate
- full 4×4 grade confusion matrix
- **disagreement rate specifically among grade 2 and 3 pairs**

Target κ ≥ 0.6 on the restricted set, not the full pool.

### Rationales
Required on **release** judgments only.

---

## 9. Build order

| # | Step | Output | Est. |
|---|---|---|---|
| 0 | Complete v2 schema + archive v1 (§0) | valid schema | 2 h |
| 1 | **Pilot: 1 family, 5 resources, 5 queries, end to end — time the grading and measure `judged@10`** | validated format, measured rate, **empirical `judged@k` threshold** | 2 h |
| 2 | Define 20 families + axis assignments | family spec | 2 h |
| 3 | Author 100 resources (85 HTTP / 15 MCP) | catalog + sidecar | 8 h |
| 4 | Author ~900 distractors individually (never templated, §1) + validate no-result exclusion (§6) | corpus at 1,000 | authored |
| 5 | Author 100 queries + pass-1 labels | queries file | 8 h |
| 6 | **Freeze release split, hash into manifest** | frozen | 30 min |
| 7 | Run 5 systems, build pool | `pool-v2.jsonl` | script |
| 8 | Pass-2 blind grading + unpooled audit | `qrels-v2.jsonl` | 12 h |
| 9 | Pass-3 independent review + stratified κ | calibration report | 15 h |
| 10 | Score, significance, report | final report | script |

**30–50 person-hours across two people.** The earlier 16 h estimate assumed family triage collapsed
nearly every judgment to seconds; that does not survive genuine rationales and adjudication.

**The pilot must measure actual annotation speed** and the remaining estimates re-derived from it.
Steps 4, 7, and 10 are mechanical.

**Do the pilot.** Scaling a broken process to 100 is how v1 produced 30,000 unusable judgments.

---

## 10. Metrics & reporting

### Unjudged handling

Judgments are **incomplete by construction**. Every reported figure must make that visible:

- **`judged@10` and `judged@20`** — fraction of returned results carrying a real judgment. Report
  alongside every nDCG figure. A low value means nDCG is not trustworthy and the fix is deeper
  pooling, not a better retriever.
- **`bpref`** alongside nDCG@10 — designed for incomplete judgments and the standard response to
  shallow pooling.
- **Do not report infAP.** It requires a sampled pool with known inclusion probabilities. Unless a
  proper sampling design is implemented, an infAP figure is not interpretable.
- Unjudged results contribute 0 to DCG but are **counted and reported separately** from explicit
  grade 0.

### Relevance thresholds — pin these explicitly

Every metric that reduces graded judgments to binary relevance needs a stated cutoff. Do not leave
these implicit:

| metric | relevance threshold |
|---|---|
| MRR | grade ≥ 2 |
| Recall@k | grade ≥ 2 |
| bpref | grade ≥ 2 |
| judged@k | any judgment present (grade 0–3) |

**nDCG gain values: `0, 1, 3, 7`** for grades 0, 1, 2, 3 — i.e. `2^g − 1`. This matches the existing
implementation at `src/search/evaluate.ts:52`; state it in the report rather than leaving readers to
infer the gain function.

bpref is fundamentally binary, so its cutoff is a reported parameter, not an implementation detail.

### Primary
nDCG@10, MRR, bpref. Top-heavy and tolerant of incomplete judgments.

### Secondary — do not gate
Recall@20, directional only. With incomplete judgments recall is systematically understated. v1 made
recall the primary gate with ~30 relevant per query, where recall@1 was mathematically capped at
0.077.

### Also report
violations@k (planted 0s in top-k), no-result accuracy, per-`query_class` breakdown (including
`mcp`), latency p50/p95/p99.

### Significance
Paired permutation test or bootstrap CI over per-query scores. Report *p* and the interval, never
bare point estimates. At n=50 some comparisons will be non-significant — say so.

### BM25 baseline

Production uses PostgreSQL `ts_rank_cd`, which is **not** BM25 — a different scoring function.
Add a real BM25 run as a comparability baseline.

- Use a permissively licensed, **evaluation-only** implementation
- **Do not** add a production extension or datastore for the baseline
- BM25 participates in pooling (§8) but is not a deployment target

---

## 11. Release gates

Extend `reports/release-gates-v1.json` → `release-gates-v2.json`:

- [ ] All records schema-valid under v2; zero wire validation errors
- [ ] 100 labeled resources (85 HTTP / 15 MCP), 100 queries, release split frozen and hashed
- [ ] Every labeled resource differs from family siblings on ≥2 axes
- [ ] `upto`, `mcp`, and `network` show no correlation with family, price tier, or method
- [ ] ≥6 distinct `adversarial_kind` values present
- [ ] ≥4 MCP query sub-types covered (tuple, schema, transport, disambiguation)
- [ ] Pool covers top-20 of all five systems; `pool-v2.jsonl` complete
- [ ] Unpooled audit performed; audited relevance rate reported
- [ ] `judged@10` meets the **pilot-derived** threshold (§9 step 1); the figure is reported with its
      derivation, never presented as a universal constant
- [ ] `no_result` capability exclusion validated deterministically **and** manually audited (§6)
- [ ] Relevance thresholds and nDCG gain values stated in the report (§10)
- [ ] Grading performed blind
- [ ] Stratified κ reported; ≥0.6 on relevant-family candidates
- [ ] Rationales present on all release judgments
- [ ] Significance tests reported alongside point estimates
- [ ] BM25 baseline present
- [ ] Limitations section written

Publishing a gate report that says `blocked` with honest reasons is more credible than one claiming
everything passes.

---

## 12. Maintenance — "quality over time"

The RFP asks how quality is evaluated **over time**. A frozen snapshot is necessary but not
sufficient.

### 12.1 Holdout discipline

| set | when it runs |
|---|---|
| **Development (50)** | every commit, in CI |
| **Release (50)** | milestones and final reports only |

Running the release set on every commit leaks the holdout — developers inevitably tune against
whatever they see. Keep release judgments **inaccessible to normal tuning code**; expose only the
generated final report. Treat any release-set run as a recorded event.

### 12.2 Production query logging

Capture query text, returned IDs, and the resource fetched afterward. Fetch-after-search is implicit
relevance feedback and becomes the query source that eventually replaces hand-authoring.

### 12.3 Re-pool on change

When a new retrieval profile is added or the catalog grows materially, **re-pool and grade the new
candidates.** Skipping this penalizes any new system for surfacing relevant documents nobody judged
— the most common way a hand-labeled set silently goes stale.

### 12.4 Metamorphic invariants in CI

Zero labels, every commit. These hold universally:

1. **Filter soundness** — every returned resource satisfies all hard filters (network, scheme, type,
   asset, max price).
2. **Threshold soundness** — no result scores below the configured `minimumRelevanceScore`.
3. **Determinism** — repeated identical requests return identical ordering.
4. **Pagination integrity** — paging through a result set yields no duplicates and no omissions.
5. **Stuffing resistance** — a controlled clone of resource X with keywords stuffed into its
   description must not outrank X.
6. **Degradation ladder** — provider failure follows the documented fallback path
   (semantic unavailable → lexical; reranker unavailable → hybrid), with the reported
   `degraded` state matching what actually happened.

> **Retracted from the previous revision** — these are *not* invariants and would produce false
> failures:
> - *"A resource ranks #1 for its own `serviceName`"* — fails whenever service names collide.
> - *"Filtering only shrinks the result set, never reorders"* — false under RRF: removing documents
>   shifts rank positions, changing fused scores for everything remaining.
> - *"A near-duplicate must not outrank the original"* — no such obligation exists.

Invariants 1 and 2 would have caught the v1 descending-ID padding tail; invariant 6 covers the class
of defect the embedding-generation assignment bug belonged to.

---

## Known limitations (state these in the submission)

- Synthetic corpus; resources are hand-authored, not live listings
- Single ecosystem (Stellar); real x402 traffic is ~90% EVM/Solana
- `upto` deliberately oversampled ~50× versus the live ecosystem
- MCP resources (15) exceed live-ecosystem frequency (0 in the 14,669 sampled) — deliberate, to
  cover a product capability
- **Judgments are incomplete**; recall is understated, `judged@k` is reported, bpref is preferred
- n=50 release queries; small effects will not reach significance
- No click or conversion validation until production traffic accrues
