# Differentiation axes — authoring checklist

BUILD-PLAN §3, with the abstract axis values resolved to the concrete enums in
`schema/schema-v2.ts`. Use this while authoring a resource; use `families.md` to know which values
that resource's slot was assigned.

**The rule (§3).** Every labeled resource must differ from each of its family siblings on **at least
two** axes. If two differ on nothing a buyer would care about, one is a distractor, not a labeled
resource.

`axisDifferences()` in `schema/schema-v2.ts` computes the difference set; the release gate runs it
over all 10 pairs in every family.

---

## The eleven axes

| # | axis | field | allowed values | notes |
|---|---|---|---|---|
| 1 | Capability | `axes.capability` | free slug, ≤64 chars, unique within its family | the specific thing it does; see the family's boundary |
| 2 | Resource type | `axes.resource_type` | `http`, `mcp` | transport, **not** provenance (§0.2b) |
| 3 | Input method | `axes.input_method` | `GET`, `POST`, `not_applicable` | §3 cites 9,649 GET / 4,993 POST (≈2:1) |
| 4 | Input shape | `axes.input_shape` | `query_params`, `json_body`, `path`, `tool_arguments` | — |
| 5 | Output shape | `axes.output_shape` | `json`, `text`, `score`, `list`, `status` | §3 cites `json(2109)`, `text(1263)`, `score(815)` |
| 6 | Coverage | `axes.coverage` | `single_chain`, `multi_chain`, `regional`, `global` | §3 cites `across(873)` |
| 7 | Freshness | `axes.freshness` | `live`, `hourly`, `daily`, `historical` | §3 cites `live(1400)` |
| 8 | Price tier | `axes.price_tier` | `0`, `0.001`, `0.002`, `0.003`, `0.005`, `0.01`, `0.02`, `0.05`, `0.1`, `0.15` | §3: "use these exact tiers" |
| 9 | Network | `axes.networks` | `["stellar:testnet"]`, `["stellar:pubnet"]`, or both | derived from `accepts` |
| 10 | Scheme set | `axes.scheme_set` | `exact_only`, `exact_and_upto`, `upto_only` | derived from `accepts`; see §4 |
| 11 | Attestation | `axes.attestation` | `signed`, `unsigned` | §3 cites `attested(188)` |

### Axis-by-axis rules

**2 — Resource type.** All 14,669 sampled real listings are `http`. That describes today's
ecosystem, not this product. 15 of the 100 are `mcp` by design, spread over 15 distinct families
(§4 asks for ≥8) so `type: mcp` is not a proxy for one capability. Disclose the oversample; never
present it as a distribution claim.

**3 & 4 — Input method and shape on MCP.** An MCP tool call is neither a GET nor a POST. MCP slots
take `input_method: not_applicable` and `input_shape: tool_arguments`, and are excluded from the
GET:POST ratio. See "Conflicts" below.

**8 — Price tier.** The tier is the **minimum** `accepts` option value and must equal
`price_usd_snapshot.value`, whose `basis` is `fixed_fixture_minimum_option_value`. On the wire the
amount is in stroops: `amount = tier * 10^7`, so `0.002` USDC is `"20000"`.

**9 — Network.** A resource offering both networks carries two `accepts` entries, one per network,
each with that network's configured USDC contract. `accepts` is capped at 3 entries, so
`both networks + exact_and_upto` is the maximum configuration.

**10 — Scheme set.** Scheme is **per payment option**, not per resource. 40% of real listings carry
2+ `accepts` entries and 75 of the 84 real `upto` listings also offer `exact`. Targets over the 100
labeled resources:

| group | count |
|---|---|
| `exact` only | 70 |
| `exact` + `upto` on the same resource | 22 |
| `upto` only | 8 |

The real corpus is 0.57% `upto`. The ~50× oversample is a **deliberate design choice** because
`upto` is the product differentiator — state it that way, never as a distribution claim. Keep the
900 distractors ~99% `exact`-only so the full 1,000-record corpus lands near 3%.

---

## Anti-correlation rule (§4) — mandatory

Spread the 30 `upto`-bearing resources across all 20 families, all price tiers, both input methods
and both resource types. **Same for `mcp` and `network`.** If `upto` correlates with quality,
description length, price or family, the retriever learns a spurious signal and the benchmark
silently lies.

Checklist before freezing:

- [ ] every family carries at least one `upto`-bearing resource
- [ ] `upto` appears at ≥8 of the 10 price tiers
- [ ] the share of MCP slots that are `upto`-bearing is within a few points of the overall 30%
- [ ] `mcp` appears in ≥8 families and at ≥8 price tiers
- [ ] `mcp`, `upto`, `sparse` and adversarial each land near the overall testnet/pubnet/both split
- [ ] no tag concentrates on one slot position or one price tier

`families.md` carries the computed evidence for each of these.

---

## MCP-specific axes (§4)

MCP resources must additionally vary on these, or `type: mcp` collapses into one product:

| field | allowed values |
|---|---|
| `mcp.server_name` | free, ≤64 chars |
| `mcp.tool_name` | free, ≤64 chars |
| `mcp.transport` | `streamable-http`, `sse` |
| `mcp.tool_count` | 1–32 |
| `mcp.input_schema_shape` | `flat_scalars`, `nested_object`, `array_input`, `enum_union`, `no_input` |

The `(server_name, tool_name)` pair is the tuple identity the §6 MCP query class searches on; keep
all 15 tuples distinct.

---

## Orthogonal tags (§0.2b) — not axes

These are independent booleans/enums, not a partition. A resource may carry several.

| field | values | meaning |
|---|---|---|
| `authorship` | `agent` | provenance of the **meaning**; exact model/run metadata is also required |
| `is_distractor` | boolean | unlabeled corpus padding; unjudged, **not** grade 0 |
| `is_sparse` | boolean | no `description`, no `tags`, terse `serviceName` |
| `adversarial_kind` | enum \| `null` | `null` means not adversarial; there is no separate boolean |

`adversarial_kind` values — use **≥6 distinct** across the ~15 adversarial resources:

`prompt_injection`, `keyword_stuffing`, `false_free_claim`, `misleading_tags`,
`unsupported_network_claim`, `scheme_mismatch_claim`, `duplicate_provider`, `capability_spoof`,
`ranking_instruction`

Constraints worth stating: `false_free_claim` needs a price tier above 0 (nothing false about a
genuinely free resource), `duplicate_provider` needs a second resource sharing its `provider_id`,
and `scheme_mismatch_claim` needs prose or a service name that contradicts the `accepts` schemes.

---

## Wire constraints (§5) — assert on every record

- [ ] `resource.url` hostname ends in `.example`
- [ ] `serviceName` ≤ 32 chars
- [ ] `tags` ≤ 5
- [ ] `description` ≤ 4,000 chars
- [ ] `accepts` between 1 and 3 entries
- [ ] `asset` equals the network's configured USDC
      — testnet `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`
      — pubnet `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`
- [ ] `payTo` is a valid Stellar G or C address
- [ ] `asset_decimals` is `7`
- [ ] `price_usd_snapshot.basis` is `fixed_fixture_minimum_option_value`
- [ ] `derived_from.kind` is `agent_generated` with exact model revision, prompt hash, run ID,
      shard ID, generation timestamp, and a real rationale
- [ ] no CDP prose or schemas copied, even lightly reworded (§5 licensing)

---

## Per-resource authoring checklist

1. Read the family boundary in `families.md`. Confirm the capability is **in scope** for this family
   and not inside its not-in-scope list.
2. Copy the slot's eleven axis values from the family table.
3. Write original prose against the capability. Do not browse the catalog for phrasing.
4. If the slot is `sparse`: no description, no tags, terse `serviceName`. Nothing else changes.
5. If the slot has an `adversarial_kind`: plant exactly that trap and nothing else. It is a grade-0
   negative — it must look plausible and be wrong.
6. If the slot is `mcp`: assign the five MCP axes and check the tuple is unique across all 15.
7. Run the wire-constraint checklist above.
8. Run `axisDifferences()` against the four siblings. Every pair must return ≥2.

---

## Conflicts with v1 and with BUILD-PLAN prose

Recorded here rather than silently resolved.

1. **Freshness enum.** v1's sidecar `freshness` is `warm` / `cold` — an index-staleness notion.
   §3's Freshness axis is `live` / `hourly` / `daily` / `historical` — a data-recency notion. v2 keeps
   one field with the §3 values, because §3 is the axis authors differentiate on. Anything that
   consumed `warm`/`cold` needs remapping, and `EvaluationConstraintsSchema.freshness` moves to the
   §3 enum with it.

2. **Input method on MCP.** §3 lists Input method as `GET` / `POST` on the evidence of HTTP
   listings, but §3 also makes `mcp` a first-class resource type. The two cannot both hold for an
   MCP slot. v2 adds `not_applicable` and `tool_arguments` rather than forcing a fake verb, and
   excludes MCP slots from the ~2:1 GET:POST ratio.

3. **`EvaluationConstraintsSchema.source_class`.** v1 lets a query constrain on `source_class`,
   which §0.2b retires. v2 replaces it with `resource_type`; the remaining orthogonal tags
   (`is_sparse`, `adversarial_kind`, `is_distractor`) are deliberately **not** query-constrainable —
   they are properties of the benchmark, not of a buyer's need.

4. **`labeled_tags` do not sum to 100.** §0.4 says so explicitly, and `families.md` plans three
   deliberate overlaps (sparse+adversarial, mcp+adversarial, mcp+sparse) to prove the orthogonal
   encoding is load-bearing rather than decorative. Never assert a sum over these counts.
