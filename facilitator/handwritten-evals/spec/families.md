# Capability families and resource slots

The 20 families of BUILD-PLAN §2, each with its capability boundary and its five planned resource
slots. Every slot carries a full §3 axis assignment and a note naming the axes that separate it
from its siblings.

**This file plans slots. It does not author resources.** Descriptions, service names, tags and the
adversarial payloads are written later, per slot, against the boundary stated here.

Slot *n* of family *f* takes resource id number `(f-1)*5 + n`, so family 1 owns res-0001..res-0005,
family 20 owns res-0096..res-0100. Distractors take res-0101..res-0500 (MVP scope cut from
res-0101..res-1000 — 400 distractors, not 900; see BUILD-PLAN sixth revision).

---

## How to read the axis tables

Columns are the §3 axes. See `axes.md` for allowed values and the authoring checklist.

- **price (USDC)** — one of the ten §3 tiers, and the *minimum* `accepts` option value, which is
  what `price_usd_snapshot.value` must equal.
- **network(s)** — `both` means two `accepts` entries, one per network. With `exact+upto` that is
  three entries, the schema maximum; five slots sit at that maximum.
- A price of `0` is the *minimum* option, so a `0` slot with `exact+upto` is a free `exact` option
  alongside a priced `upto` option. No slot is `upto`-only at tier 0, which would be degenerate.
- **scheme set** — `exact` / `exact+upto` / `upto`. Per §4 this is a property of the payment
  options, not of the capability.
- **tags** — the orthogonal §0.2b flags: `sparse`, and the `adversarial_kind` when planted. A slot
  may carry both, and either may co-occur with `mcp`.

A dash in **method** marks an MCP slot: an MCP tool call is not a GET or a POST, so `input_method`
is `not_applicable` and `input_shape` is `tool_arguments` (see the conflict note in `axes.md`).

---

## Global ledger — how the 100 slots satisfy §4

Every figure below is computed from the slot tables in this file, not asserted. Re-derive them with
`python3 tools/check-families.py`, which parses the tables back out and re-runs every §3 and §4 gate
that is checkable from this file. **Run it after any edit here** — the numbers in this section are
only trustworthy because a script re-reads the tables that produced them.

| §4 target | required | planned | where |
|---|---|---|---|
| `http` | 85 | 85 | all families |
| `mcp` | 15 | 15 | one slot in each of families 1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13, 14, 16, 18, 20 |
| `exact` only | 70 | 70 | all families |
| `exact` + `upto` | 22 | 22 | all 20 families |
| `upto` only | 8 | 8 | families 1, 4, 6, 9, 11, 14, 17, 19 |
| adversarial | ~15 | 15 | families 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18, 20 |
| distinct `adversarial_kind` | >=6 | 9 | all nine kinds used |
| sparse | ~10 | 10 | families 1, 3, 5, 8, 9, 12, 14, 16, 17, 20 |

### Anti-correlation evidence (§4, mandatory)

The rule: `upto`, `mcp` and `network` must not correlate with family, price tier, method or each
other. Otherwise the retriever learns a spurious signal and the benchmark silently lies.

| dimension | spread |
|---|---|
| `upto`-bearing per family | all 20 families carry at least one; 10 carry two, 10 carry one |
| `upto`-bearing by price tier | 10 of the 10 tiers: 0 x3, 0.001 x2, 0.002 x1, 0.003 x5, 0.005 x4, 0.01 x3, 0.02 x3, 0.05 x2, 0.1 x5, 0.15 x2 |
| `upto`-bearing by resource type | http 25 / mcp 5 — 33% of MCP slots vs 30% overall |
| `upto`-bearing by input method | GET 16 / POST 9 / MCP 5 |
| MCP by family | one slot in each of 15 distinct families (§4 asks for >=8) |
| MCP by slot position | slot 1 x3, slot 2 x3, slot 3 x3, slot 4 x3, slot 5 x3 |
| MCP by price tier | 10 of the 10 tiers: 0 x2, 0.001 x2, 0.002 x2, 0.003 x2, 0.005 x1, 0.01 x1, 0.02 x1, 0.05 x1, 0.1 x1, 0.15 x2 |
| network overall | testnet-only 40 / pubnet-only 35 / both 25 (40/35/25) |
| MCP by network | testnet 6 / pubnet 5 / both 4 — matches the 40/35/25 baseline |
| `upto`-bearing by network | testnet 12 / pubnet 11 / both 7 |
| adversarial by network | testnet 6 / pubnet 5 / both 4 |
| sparse by network | testnet 4 / pubnet 4 / both 2 |
| network by family | every family carries both networks; the pattern is rotated per family so network never tracks slot position |
| adversarial by price tier | 9 of 10 tiers, at most 2 per tier — traps are not concentrated at any price point |
| sparse by price tier | 7 of 10 tiers, at most 2 per tier |
| adversarial by slot position | slot 1 x2, slot 2 x4, slot 3 x3, slot 4 x3, slot 5 x3 |

### Overlaps that prove §0.2b orthogonality

A single `source_class` enum could not express these; the orthogonal fields can.

| slot | overlapping tags |
|---|---|
| `res-0023` F5s3 `jurisdiction_rule_lookup` | `sparse`, `adversarial/scheme_mismatch_claim` |
| `res-0047` F10s2 `batch_embedding` | `mcp`, `adversarial/prompt_injection` |
| `res-0077` F16s2 `table_extraction` | `mcp`, `sparse` |

### Axis totals across the 100 slots

| axis | distribution |
|---|---|
| resource type | http 85 / mcp 15 |
| input method | GET 57 / POST 28 / not_applicable 15 |
| input shape | `query_params` 44 / `json_body` 28 / `path` 13 / `tool_arguments` 15 |
| output shape | `json` 31 / `list` 38 / `score` 11 / `text` 10 / `status` 10 |
| coverage | global 56 / regional 21 / multi-chain 15 / single-chain 8 |
| freshness | live 49 / hourly 16 / daily 26 / historical 9 |
| price tier | 0 10 / 0.001 10 / 0.002 10 / 0.003 10 / 0.005 10 / 0.01 10 / 0.02 10 / 0.05 10 / 0.1 10 / 0.15 10 |
| network | testnet 40 / pubnet 35 / both 25 |
| scheme set | `exact` 70 / `exact+upto` 22 / `upto` 8 |
| attestation | signed 22 / unsigned 78 |

Notes on the shapes above:

- **Input method** is ~2:1 GET:POST across the 85 HTTP slots (57/28), matching the 9,649/4,993
  split §3 cites. MCP slots are excluded from the ratio by construction.
- **Coverage** is skewed to `global` because only families 1-5, 13 and 14 have a meaningful
  chain-scope distinction. `single-chain` and `multi-chain` are concentrated there on purpose;
  forcing them onto Weather or Translation would be noise, not differentiation.
- **Price tiers** are assigned by the rotation `tier_index = (3*(family - 1) + 4*(slot - 1)) mod 10`.
  This gives five distinct tiers inside every family and exactly ten uses of each of the ten §3
  tiers across the 100, with no tier tied to a family or a slot position.
- **Attestation** is 22 signed: all five of family 13, where signing *is* the capability, plus one
  in each of 17 other families so `signed` is not a family proxy.
- **Network** follows a per-family pattern — `(testnet, testnet, pubnet, pubnet, both)` in fifteen
  families and `(testnet, testnet, pubnet, both, both)` in families 2, 6, 10, 14 and 18 — rotated
  by a per-family offset. Rotation cannot change the 40/35/25 totals, only which slot gets which
  network, and the offsets were chosen so that `mcp`, `upto`, `sparse` and adversarial each land
  on the 40/35/25 baseline instead of clustering on one network.

### Distributions this file does not fix

- The 400 distractors (§1, MVP scope cut from 900). Their only distribution constraint is ~99%
  `exact`-only, so the full 500-record corpus lands near an `upto` minority, and the
  `forbidden-capabilities.md` exclusion list.
- Query counts and classes (§6). Planned separately once slots are authored.
- Provider assignment across the 120 providers (§0.4), except that the `duplicate_provider` trap at
  F16 s3 must share a `provider_id` with an honest resource.

---

## F1 — On-chain state / block data

*Real-corpus evidence (§2): `on-chain(357)`, `chain(1133)`.*

**In scope.** Reading raw chain state and block/ledger structure: ledger entries, account state, block and ledger headers, transaction lookup by hash, contract event logs, historical state at a given ledger.

**Not in scope.** Valuation or pricing of the assets held (F2). AMM pool internals or routing (F3). Behavioural risk scores derived from chain data (F4). Pre-aggregated protocol metrics over chain data (F14) — F1 returns records, F14 returns computed aggregates.

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0001` | `ledger_entry_lookup` | http | GET | path | `json` | single-chain | live | 0 | pubnet | `exact` | unsigned | — |
| 2 | `res-0002` | `block_header_stream` | http | GET | query params | `list` | multi-chain | live | 0.005 | pubnet | `upto` | signed | `keyword_stuffing` |
| 3 | `res-0003` | `tx_receipt_lookup` | mcp | — | tool args | `json` | multi-chain | live | 0.1 | both | `exact+upto` | unsigned | — |
| 4 | `res-0004` | `contract_event_log` | http | GET | query params | `list` | single-chain | hourly | 0.002 | testnet | `exact` | unsigned | `sparse` |
| 5 | `res-0005` | `archive_state_at_ledger` | http | GET | query params | `json` | single-chain | historical | 0.02 | testnet | `exact` | unsigned | — |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `ledger_entry_lookup`** — input shape (path) + coverage (single-chain) vs the query-param, multi-chain siblings.
- **s2 `block_header_stream`** — output shape (list) + scheme set (upto-only) vs every sibling; carries the planted keyword_stuffing.
- **s3 `tx_receipt_lookup`** — resource type (MCP) + coverage vs s1, the other json/live slot.
- **s4 `contract_event_log`** — output shape (list) + freshness (hourly) vs s1, the other single-chain slot.
- **s5 `archive_state_at_ledger`** — freshness (historical) + input shape vs s1, the other single-chain json slot.

*MCP slot: s3. Its MCP-specific axes (tool tuple, schema shape, transport, tool count)
are assigned at authoring time and must differ from the other 14 MCP slots (§4). Only official
Bazaar transports (`streamable-http`, `sse`) are permitted.*

---

## F2 — Token & market prices

*Real-corpus evidence (§2): `market-data(299)`, `price(1837)`.*

**In scope.** Spot, reference and historical price of fungible tokens and pairs: last trade, OHLCV, batch quotes, time-weighted reference marks, daily close series.

**Not in scope.** Liquidity depth, pool composition or routing that produces the price (F3). Fiat FX and policy rates (F7). Listed-equity quotes (F8). The signing mechanics of a price feed belong to F13 — F2 slot 4 is signed but its capability is the mark, not the attestation.

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0006` | `spot_price_lookup` | http | GET | query params | `json` | global | live | 0.003 | testnet | `exact+upto` | unsigned | `false_free_claim` |
| 2 | `res-0007` | `ohlcv_candles` | http | GET | query params | `list` | global | hourly | 0.05 | pubnet | `exact` | unsigned | — |
| 3 | `res-0008` | `batch_price_quote` | http | POST | JSON body | `list` | global | live | 0.001 | both | `exact+upto` | unsigned | — |
| 4 | `res-0009` | `twap_reference_price` | http | GET | path | `score` | multi-chain | hourly | 0.01 | both | `exact` | signed | — |
| 5 | `res-0010` | `historical_price_series` | mcp | — | tool args | `list` | global | historical | 0.15 | testnet | `exact` | unsigned | — |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `spot_price_lookup`** — output shape (json) + freshness (live) vs s2; carries the planted false_free_claim.
- **s2 `ohlcv_candles`** — freshness (hourly) + output shape (list) vs s1.
- **s3 `batch_price_quote`** — input method (POST) + freshness vs s2, the other list slot.
- **s4 `twap_reference_price`** — output shape (score) + attestation (signed) vs every sibling.
- **s5 `historical_price_series`** — resource type (MCP) + freshness (historical) vs s2, the other candle-shaped slot.

*MCP slot: s5. Its MCP-specific axes (tool tuple, schema shape, transport, tool count)
are assigned at authoring time and must differ from the other 14 MCP slots (§4).*

---

## F3 — DeFi / DEX analytics

*Real-corpus evidence (§2): `defi(212)`, `glassnode(297)`.*

**In scope.** AMM and orderbook internals: pool reserves and composition, swap route quotes, TVL by protocol, LP yield history, orderbook depth.

**Not in scope.** A bare token price with no liquidity context (F2). Raw pool contract state read key-by-key (F1). Counterparty risk scoring of the addresses trading (F4).

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0011` | `pool_reserves_snapshot` | http | GET | query params | `json` | single-chain | live | 0.02 | testnet | `exact` | signed | — |
| 2 | `res-0012` | `swap_route_quote` | mcp | — | tool args | `json` | multi-chain | live | 0 | testnet | `exact` | unsigned | — |
| 3 | `res-0013` | `tvl_by_protocol` | http | GET | query params | `list` | multi-chain | daily | 0.005 | pubnet | `exact` | unsigned | — |
| 4 | `res-0014` | `lp_yield_history` | http | GET | query params | `list` | multi-chain | historical | 0.1 | pubnet | `exact+upto` | unsigned | `sparse` |
| 5 | `res-0015` | `orderbook_depth` | http | GET | path | `list` | single-chain | live | 0.002 | both | `exact` | unsigned | — |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `pool_reserves_snapshot`** — attestation (signed) + coverage (single-chain) vs s2, the other live json slot.
- **s2 `swap_route_quote`** — resource type (MCP) + coverage vs s1.
- **s3 `tvl_by_protocol`** — output shape (list) + freshness (daily) vs s1.
- **s4 `lp_yield_history`** — freshness (historical) + scheme set (exact+upto) vs s3; sparse metadata.
- **s5 `orderbook_depth`** — input shape (path) + coverage (single-chain) vs s3, the other GET list slot.

*MCP slot: s2. Its MCP-specific axes (tool tuple, schema shape, transport, tool count)
are assigned at authoring time and must differ from the other 14 MCP slots (§4).*

---

## F4 — Address & wallet risk scoring

*Real-corpus evidence (§2): `risk(1020)`, `score(815)`.*

**In scope.** Heuristic and behavioural risk or reputation signals about addresses, wallets and transactions: numeric risk scores, transaction screening, cluster attribution, exposure breakdown by counterparty type, bulk scoring.

**Not in scope.** Membership of a published sanctions or watch list — that is a deterministic list match (F5), not a heuristic score. Verifying a human's identity (F15). The raw transaction history the score is computed from (F1).

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0016` | `address_risk_score` | http | GET | path | `score` | multi-chain | live | 0.15 | pubnet | `exact+upto` | unsigned | `capability_spoof` |
| 2 | `res-0017` | `tx_risk_screen` | http | POST | JSON body | `score` | multi-chain | live | 0.003 | pubnet | `exact` | unsigned | — |
| 3 | `res-0018` | `cluster_attribution` | http | GET | query params | `json` | single-chain | daily | 0.05 | both | `exact` | signed | — |
| 4 | `res-0019` | `exposure_breakdown` | mcp | — | tool args | `json` | multi-chain | daily | 0.001 | testnet | `exact` | unsigned | — |
| 5 | `res-0020` | `bulk_address_scoring` | http | POST | JSON body | `list` | multi-chain | hourly | 0.01 | testnet | `upto` | unsigned | — |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `address_risk_score`** — input shape (path) + freshness (live) vs s3; carries the planted capability_spoof.
- **s2 `tx_risk_screen`** — input method (POST) + input shape (JSON body) vs s1, the other live score slot.
- **s3 `cluster_attribution`** — coverage (single-chain) + output shape (json) vs s1.
- **s4 `exposure_breakdown`** — resource type (MCP) + coverage vs s3, the other daily json slot.
- **s5 `bulk_address_scoring`** — output shape (list) + freshness (hourly) vs s2, the other POST slot.

*MCP slot: s4. Its MCP-specific axes (tool tuple, schema shape, transport, tool count)
are assigned at authoring time and must differ from the other 14 MCP slots (§4).*

---

## F5 — Compliance / sanctions screening

*Real-corpus evidence (§2): `compliance(281)`.*

**In scope.** Matching names, entities and addresses against published sanctions, watch and PEP lists, and looking up the jurisdiction rules that govern the match. Deterministic list membership and the case state of a screening decision.

**Not in scope.** Heuristic behavioural risk scores (F4). Identity document verification (F15). The text of the regulation behind a listing (F6). General adverse-media web search (F11).

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0021` | `sanctions_name_screen` | mcp | — | tool args | `score` | global | daily | 0.002 | testnet | `exact` | unsigned | — |
| 2 | `res-0022` | `address_watchlist_check` | http | GET | path | `status` | global | daily | 0.02 | testnet | `exact` | unsigned | — |
| 3 | `res-0023` | `jurisdiction_rule_lookup` | http | GET | query params | `json` | regional | daily | 0 | pubnet | `exact` | unsigned | `sparse`, `scheme_mismatch_claim` |
| 4 | `res-0024` | `pep_adverse_media_check` | http | POST | JSON body | `list` | global | hourly | 0.005 | pubnet | `exact+upto` | unsigned | — |
| 5 | `res-0025` | `screening_case_status` | http | GET | query params | `status` | global | live | 0.1 | both | `exact` | signed | — |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `sanctions_name_screen`** — resource type (MCP) + output shape (score) vs s2.
- **s2 `address_watchlist_check`** — input shape (path) + output shape (status) vs s3.
- **s3 `jurisdiction_rule_lookup`** — coverage (regional) + sparse metadata vs s2; also the planted scheme_mismatch_claim.
- **s4 `pep_adverse_media_check`** — input method (POST) + freshness (hourly) vs s1.
- **s5 `screening_case_status`** — freshness (live) + attestation (signed) vs s2, the other status slot.

*MCP slot: s1. Its MCP-specific axes (tool tuple, schema shape, transport, tool count)
are assigned at authoring time and must differ from the other 14 MCP slots (§4).*

---

## F6 — Regulatory documents

*Real-corpus evidence (§2): `federal-register(167)`, `regulations(166)`.*

**In scope.** Retrieval of primary regulatory and rulemaking source material: register search, docket timelines, comment-period notification, full regulation text, agency guidance diffs.

**Not in scope.** Deciding whether a party is sanctioned (F5). Ranked search over the open web (F11). Fetching and converting an arbitrary URL (F12). News coverage about a rule (F20).

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0026` | `federal_register_search` | http | GET | query params | `list` | regional | daily | 0.01 | testnet | `exact` | unsigned | — |
| 2 | `res-0027` | `rule_docket_timeline` | http | GET | path | `list` | regional | historical | 0.15 | pubnet | `exact` | unsigned | — |
| 3 | `res-0028` | `comment_period_alerts` | http | GET | query params | `list` | regional | hourly | 0.003 | both | `upto` | unsigned | — |
| 4 | `res-0029` | `regulation_text_fetch` | http | GET | path | `text` | regional | historical | 0.05 | both | `exact` | unsigned | `prompt_injection` |
| 5 | `res-0030` | `agency_guidance_diff` | http | POST | JSON body | `text` | regional | daily | 0.001 | testnet | `exact+upto` | unsigned | — |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `federal_register_search`** — input shape (query params) + freshness (daily) vs s2.
- **s2 `rule_docket_timeline`** — input shape (path) + freshness (historical) vs s1.
- **s3 `comment_period_alerts`** — freshness (hourly) + scheme set (upto-only) vs s1.
- **s4 `regulation_text_fetch`** — output shape (text) + price tier vs s2, the other historical slot; carries the planted prompt_injection.
- **s5 `agency_guidance_diff`** — input method (POST) + output shape (text) vs s2.

---

## F7 — Macro indicators

*Real-corpus evidence (§2): `macro(245)`.*

**In scope.** National and global economic time series and their release mechanics: indicator series, release calendars, fiat FX reference rates, yield curves, revision history.

**Not in scope.** Token prices (F2). Company-level fundamentals (F8). Journalistic commentary on a print (F20). Regulatory rule text (F6).

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0031` | `indicator_series_fetch` | http | GET | query params | `list` | global | daily | 0.1 | testnet | `exact` | unsigned | — |
| 2 | `res-0032` | `release_calendar` | http | GET | query params | `json` | global | hourly | 0.002 | testnet | `exact+upto` | unsigned | — |
| 3 | `res-0033` | `fx_reference_rate` | mcp | — | tool args | `score` | global | hourly | 0.02 | pubnet | `exact` | unsigned | — |
| 4 | `res-0034` | `yield_curve_snapshot` | http | GET | path | `json` | regional | daily | 0 | pubnet | `exact` | signed | — |
| 5 | `res-0035` | `indicator_revision_history` | http | GET | query params | `list` | global | historical | 0.005 | both | `exact` | unsigned | — |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `indicator_series_fetch`** — output shape (list) + price tier vs s2.
- **s2 `release_calendar`** — output shape (json) + freshness (hourly) vs s1.
- **s3 `fx_reference_rate`** — resource type (MCP) + output shape (score) vs s2.
- **s4 `yield_curve_snapshot`** — coverage (regional) + attestation (signed) vs s2.
- **s5 `indicator_revision_history`** — freshness (historical) + price tier vs s1.

*MCP slot: s3. Its MCP-specific axes (tool tuple, schema shape, transport, tool count)
are assigned at authoring time and must differ from the other 14 MCP slots (§4).*

---

## F8 — Equities & company data

*Real-corpus evidence (§2): `stocks(198)`.*

**In scope.** Listed-company reference and market data: quotes, company profiles, filing indexes, fundamentals, corporate actions.

**Not in scope.** Economy-wide aggregates (F7). Token prices (F2). Scraping a company's own website (F12). Business-registry identity checks for KYC (F15).

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0036` | `equity_quote` | http | GET | path | `json` | regional | live | 0.001 | pubnet | `exact` | signed | — |
| 2 | `res-0037` | `company_profile_lookup` | http | GET | query params | `json` | global | daily | 0.01 | pubnet | `exact` | unsigned | — |
| 3 | `res-0038` | `filing_index_search` | http | GET | query params | `list` | regional | historical | 0.15 | both | `exact` | unsigned | `sparse` |
| 4 | `res-0039` | `fundamentals_snapshot` | http | GET | query params | `json` | global | daily | 0.003 | testnet | `exact+upto` | unsigned | — |
| 5 | `res-0040` | `corporate_actions_feed` | http | POST | JSON body | `list` | regional | daily | 0.05 | testnet | `exact` | unsigned | `misleading_tags` |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `equity_quote`** — freshness (live) + attestation (signed) vs s2.
- **s2 `company_profile_lookup`** — coverage (global) + input shape vs s1.
- **s3 `filing_index_search`** — output shape (list) + sparse metadata vs s2.
- **s4 `fundamentals_snapshot`** — scheme set (exact+upto) + price tier vs s2.
- **s5 `corporate_actions_feed`** — coverage (regional) + planted misleading_tags vs s4.

---

## F9 — LLM inference

*Real-corpus evidence (§2): `llm(194)`, `inference(165)`.*

**In scope.** Token generation from a hosted language model: chat completion, constrained JSON output, long-document summarisation, tool-call planning, streamed completion.

**Not in scope.** Producing vectors rather than text (F10). Translation as a bounded task (F19). Reading text out of an image or PDF (F16). Retrieving documents to reason over (F11, F12).

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0041` | `chat_completion` | http | POST | JSON body | `text` | global | live | 0.005 | both | `upto` | unsigned | — |
| 2 | `res-0042` | `json_mode_extraction` | http | POST | JSON body | `json` | global | live | 0.1 | testnet | `exact` | unsigned | `ranking_instruction` |
| 3 | `res-0043` | `summarize_long_document` | http | POST | JSON body | `text` | global | live | 0.002 | testnet | `exact` | signed | — |
| 4 | `res-0044` | `function_call_planner` | http | GET | query params | `json` | global | live | 0.02 | pubnet | `exact` | unsigned | `sparse` |
| 5 | `res-0045` | `streaming_completion` | mcp | — | tool args | `text` | global | live | 0 | pubnet | `exact+upto` | unsigned | — |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `chat_completion`** — scheme set (upto-only) + price tier vs s3.
- **s2 `json_mode_extraction`** — output shape (json) + planted ranking_instruction vs s1.
- **s3 `summarize_long_document`** — attestation (signed) + price tier vs s1.
- **s4 `function_call_planner`** — input method (GET) + sparse metadata vs s2.
- **s5 `streaming_completion`** — resource type (MCP) + scheme set (exact+upto) vs s3.

*MCP slot: s5. Its MCP-specific axes (tool tuple, schema shape, transport, tool count)
are assigned at authoring time and must differ from the other 14 MCP slots (§4).*

---

## F10 — Embeddings & vector ops

*Real-corpus evidence (§2): `ai(496)`.*

**In scope.** Producing vectors and operating in vector space: single and batch text embedding, pairwise similarity, cross-encoder reranking, cluster assignment.

**Not in scope.** Generating prose (F9). Retrieving the documents to embed (F11, F12). Semantic search as an end-user product (F11) — F10 sells the primitive, not the index.

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0046` | `text_embedding` | http | POST | JSON body | `list` | global | live | 0.05 | testnet | `exact` | unsigned | — |
| 2 | `res-0047` | `batch_embedding` | mcp | — | tool args | `list` | global | live | 0.001 | testnet | `exact` | unsigned | `prompt_injection` |
| 3 | `res-0048` | `similarity_score` | http | POST | JSON body | `score` | global | live | 0.01 | pubnet | `exact+upto` | unsigned | — |
| 4 | `res-0049` | `cross_encoder_rerank` | http | POST | JSON body | `list` | global | live | 0.15 | both | `exact` | signed | — |
| 5 | `res-0050` | `cluster_assignment` | http | GET | query params | `json` | global | daily | 0.003 | both | `exact` | unsigned | — |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `text_embedding`** — price tier + scheme set vs s4.
- **s2 `batch_embedding`** — resource type (MCP) + planted prompt_injection vs s1.
- **s3 `similarity_score`** — output shape (score) + scheme set (exact+upto) vs s1.
- **s4 `cross_encoder_rerank`** — attestation (signed) + price tier vs s1.
- **s5 `cluster_assignment`** — input method (GET) + freshness (daily) vs s1.

*MCP slot: s2. Its MCP-specific axes (tool tuple, schema shape, transport, tool count)
are assigned at authoring time and must differ from the other 14 MCP slots (§4).*

---

## F11 — Web search

*Real-corpus evidence (§2): `search(1267)`.*

**In scope.** Querying an index of the public web and returning ranked results: general search, site-restricted search, image search, query autocomplete, related questions.

**Not in scope.** Fetching and parsing one known URL (F12). Searching a regulatory corpus (F6). News feeds ordered by publication time (F20). Vector similarity as a primitive (F10).

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0051` | `web_search_results` | http | GET | query params | `list` | global | live | 0 | both | `exact` | signed | — |
| 2 | `res-0052` | `site_restricted_search` | http | GET | query params | `list` | global | live | 0.005 | testnet | `exact+upto` | unsigned | — |
| 3 | `res-0053` | `image_search` | http | GET | query params | `list` | global | daily | 0.1 | testnet | `exact` | unsigned | — |
| 4 | `res-0054` | `query_autocomplete` | mcp | — | tool args | `list` | global | live | 0.002 | pubnet | `exact` | unsigned | — |
| 5 | `res-0055` | `related_questions` | http | GET | query params | `list` | regional | daily | 0.02 | pubnet | `upto` | unsigned | — |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `web_search_results`** — attestation (signed) + price tier vs s2.
- **s2 `site_restricted_search`** — scheme set (exact+upto) + price tier vs s1.
- **s3 `image_search`** — freshness (daily) + price tier vs s2.
- **s4 `query_autocomplete`** — resource type (MCP) + price tier vs s1.
- **s5 `related_questions`** — coverage (regional) + price tier vs s3.

*MCP slot: s4. Its MCP-specific axes (tool tuple, schema shape, transport, tool count)
are assigned at authoring time and must differ from the other 14 MCP slots (§4).*

---

## F12 — Web scraping / extraction

*Real-corpus evidence (§2): `web(619)`.*

**In scope.** Acting on a specific URL: converting a page to markdown, extracting declared fields, capturing a screenshot, crawling a sitemap, reporting headless render state.

**Not in scope.** Ranked discovery over an index (F11). OCR of an uploaded image or PDF (F16). LLM summarisation of the fetched page (F9). Time-ordered article feeds (F20).

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0056` | `page_to_markdown` | mcp | — | tool args | `text` | global | live | 0.003 | testnet | `exact` | unsigned | — |
| 2 | `res-0057` | `structured_field_extraction` | http | POST | JSON body | `json` | global | live | 0.05 | pubnet | `exact` | unsigned | `sparse` |
| 3 | `res-0058` | `screenshot_capture` | http | GET | query params | `status` | global | live | 0.001 | pubnet | `exact` | signed | — |
| 4 | `res-0059` | `sitemap_crawl` | http | POST | JSON body | `list` | global | daily | 0.01 | both | `exact` | unsigned | — |
| 5 | `res-0060` | `headless_render_status` | http | GET | path | `status` | global | live | 0.15 | testnet | `exact+upto` | unsigned | `unsupported_network_claim` |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `page_to_markdown`** — resource type (MCP) + output shape (text) vs s2.
- **s2 `structured_field_extraction`** — output shape (json) + sparse metadata vs s4.
- **s3 `screenshot_capture`** — input method (GET) + attestation (signed) vs s2.
- **s4 `sitemap_crawl`** — freshness (daily) + output shape (list) vs s2.
- **s5 `headless_render_status`** — input shape (path) + scheme set (exact+upto) vs s3; carries the planted unsupported_network_claim.

*MCP slot: s1. Its MCP-specific axes (tool tuple, schema shape, transport, tool count)
are assigned at authoring time and must differ from the other 14 MCP slots (§4).*

---

## F13 — Attested / signed feeds

*Real-corpus evidence (§2): `attested(188)`.*

**In scope.** Data delivered with a verifiable signature or attestation over the payload, plus the verification and history of those attestations: signed price marks, attested randomness, signature verification, bundle history, oracle report status.

**Not in scope.** The same data delivered unsigned (F1, F2, F7 — signing is the product here). Generic key management or wallet signing. Risk scoring of the signer (F4).

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0061` | `signed_price_attestation` | http | GET | path | `json` | multi-chain | live | 0.02 | testnet | `exact` | signed | — |
| 2 | `res-0062` | `attested_randomness` | http | GET | query params | `json` | single-chain | live | 0 | testnet | `exact+upto` | signed | — |
| 3 | `res-0063` | `signature_verification` | mcp | — | tool args | `status` | multi-chain | live | 0.005 | pubnet | `exact` | signed | — |
| 4 | `res-0064` | `attestation_bundle_history` | http | GET | query params | `list` | multi-chain | historical | 0.1 | pubnet | `exact+upto` | signed | — |
| 5 | `res-0065` | `oracle_report_status` | http | GET | query params | `status` | single-chain | hourly | 0.002 | both | `exact` | signed | `false_free_claim` |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `signed_price_attestation`** — input shape (path) + coverage (multi-chain) vs s2.
- **s2 `attested_randomness`** — coverage (single-chain) + scheme set (exact+upto) vs s1.
- **s3 `signature_verification`** — resource type (MCP) + output shape (status) vs s1.
- **s4 `attestation_bundle_history`** — freshness (historical) + output shape (list) vs s1.
- **s5 `oracle_report_status`** — freshness (hourly) + planted false_free_claim vs s3.

*MCP slot: s3. Its MCP-specific axes (tool tuple, schema shape, transport, tool count)
are assigned at authoring time and must differ from the other 14 MCP slots (§4).*

---

## F14 — Analytics & metrics

*Real-corpus evidence (§2): `analytics(483)`, `metrics(297)`.*

**In scope.** Computed aggregates over an underlying dataset: protocol usage metrics, cohort retention, funnel conversion, custom time-series aggregation, top-N leaderboards.

**Not in scope.** The underlying records themselves (F1). Price series (F2). Pool-level DeFi internals (F3). Anything the buyer would have to aggregate themselves — F14 sells the aggregate.

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0066` | `protocol_usage_metrics` | http | GET | query params | `json` | multi-chain | daily | 0.15 | testnet | `exact` | unsigned | — |
| 2 | `res-0067` | `cohort_retention_metrics` | http | POST | JSON body | `json` | global | daily | 0.003 | testnet | `upto` | signed | `sparse` |
| 3 | `res-0068` | `funnel_conversion_report` | http | GET | query params | `json` | global | daily | 0.05 | pubnet | `exact` | unsigned | — |
| 4 | `res-0069` | `custom_timeseries_aggregate` | http | POST | JSON body | `list` | global | hourly | 0.001 | both | `exact` | unsigned | `keyword_stuffing` |
| 5 | `res-0070` | `top_n_leaderboard` | mcp | — | tool args | `list` | multi-chain | daily | 0.01 | both | `exact+upto` | unsigned | — |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `protocol_usage_metrics`** — coverage (multi-chain) + price tier vs s3.
- **s2 `cohort_retention_metrics`** — input method (POST) + sparse metadata vs s3.
- **s3 `funnel_conversion_report`** — coverage (global) + price tier vs s1.
- **s4 `custom_timeseries_aggregate`** — output shape (list) + freshness (hourly) vs s2; carries the planted keyword_stuffing.
- **s5 `top_n_leaderboard`** — resource type (MCP) + coverage vs s4.

*MCP slot: s5. Its MCP-specific axes (tool tuple, schema shape, transport, tool count)
are assigned at authoring time and must differ from the other 14 MCP slots (§4).*

---

## F15 — Identity & KYC

*Real-corpus evidence (§2): thin — disclose as gap.*

**In scope.** Establishing that a person or business is who they claim to be: document verification, liveness capture, business-registry lookup, proof-of-address, verification case state.

**Not in scope.** List-based sanctions screening (F5). Blockchain address risk (F4). OCR offered as a generic document service with no identity decision (F16).

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0071` | `id_document_verify` | http | POST | JSON body | `status` | global | live | 0.002 | pubnet | `exact` | unsigned | — |
| 2 | `res-0072` | `liveness_selfie_check` | http | POST | JSON body | `score` | global | live | 0.02 | pubnet | `exact` | unsigned | — |
| 3 | `res-0073` | `business_registry_lookup` | http | GET | query params | `json` | regional | daily | 0 | both | `exact+upto` | unsigned | — |
| 4 | `res-0074` | `proof_of_address_check` | http | GET | path | `status` | regional | daily | 0.005 | testnet | `exact` | signed | — |
| 5 | `res-0075` | `verification_case_status` | http | GET | query params | `status` | global | live | 0.1 | testnet | `exact` | unsigned | — |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `id_document_verify`** — output shape (status) + price tier vs s2.
- **s2 `liveness_selfie_check`** — output shape (score) + price tier vs s1.
- **s3 `business_registry_lookup`** — input method (GET) + coverage (regional) vs s1.
- **s4 `proof_of_address_check`** — input shape (path) + attestation (signed) vs s5.
- **s5 `verification_case_status`** — coverage (global) + freshness (live) vs s4.

---

## F16 — Document parsing / OCR

*Real-corpus evidence (§2): thin — disclose as gap.*

**In scope.** Turning documents and images into text or structured fields: PDF text extraction, table extraction, invoice field parsing, handwriting OCR, page classification.

**Not in scope.** Fetching the document from the web (F12). Making an identity decision from it (F15). Summarising or reasoning over the extracted text (F9). Translating it (F19).

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0076` | `pdf_text_extract` | http | POST | JSON body | `text` | global | live | 0.01 | pubnet | `exact` | unsigned | — |
| 2 | `res-0077` | `table_extraction` | mcp | — | tool args | `list` | global | live | 0.15 | both | `exact` | unsigned | `sparse` |
| 3 | `res-0078` | `invoice_field_parse` | http | POST | JSON body | `json` | regional | live | 0.003 | testnet | `exact` | unsigned | `duplicate_provider` |
| 4 | `res-0079` | `handwriting_ocr` | http | POST | JSON body | `text` | global | live | 0.05 | testnet | `exact+upto` | unsigned | — |
| 5 | `res-0080` | `page_classification` | http | GET | query params | `score` | global | live | 0.001 | pubnet | `exact` | signed | — |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `pdf_text_extract`** — output shape (text) + coverage (global) vs s3.
- **s2 `table_extraction`** — resource type (MCP) + sparse metadata vs s1.
- **s3 `invoice_field_parse`** — output shape (json) + coverage (regional) vs s1; carries the planted duplicate_provider.
- **s4 `handwriting_ocr`** — scheme set (exact+upto) + price tier vs s1.
- **s5 `page_classification`** — input method (GET) + output shape (score) vs s1.

*MCP slot: s2. Its MCP-specific axes (tool tuple, schema shape, transport, tool count)
are assigned at authoring time and must differ from the other 14 MCP slots (§4).*

---

## F17 — Geocoding & mapping

*Real-corpus evidence (§2): thin — disclose as gap.*

**In scope.** Spatial lookups over places and coordinates: forward and reverse geocoding, route ETA, nearby place search, timezone for a point.

**Not in scope.** Conditions at a location (F18). Postal-address verification as a KYC control (F15). Regional news for a place (F20).

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0081` | `forward_geocode` | http | GET | query params | `json` | global | daily | 0.1 | testnet | `upto` | unsigned | — |
| 2 | `res-0082` | `reverse_geocode` | http | GET | query params | `json` | global | daily | 0.002 | testnet | `exact` | signed | `sparse` |
| 3 | `res-0083` | `route_eta` | http | POST | JSON body | `score` | regional | live | 0.02 | pubnet | `exact+upto` | unsigned | — |
| 4 | `res-0084` | `place_search_nearby` | http | GET | query params | `list` | regional | hourly | 0 | pubnet | `exact` | unsigned | `misleading_tags` |
| 5 | `res-0085` | `timezone_lookup` | http | GET | path | `json` | global | daily | 0.005 | both | `exact` | unsigned | — |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `forward_geocode`** — scheme set (upto-only) + price tier vs s2.
- **s2 `reverse_geocode`** — attestation (signed) + sparse metadata vs s1.
- **s3 `route_eta`** — input method (POST) + output shape (score) vs s1.
- **s4 `place_search_nearby`** — output shape (list) + planted misleading_tags vs s1.
- **s5 `timezone_lookup`** — input shape (path) + price tier vs s1.

---

## F18 — Weather

*Real-corpus evidence (§2): thin — disclose as gap.*

**In scope.** Atmospheric state and forecasts for a location: current conditions, hourly forecast, historical observations, severe-weather alerts, marine forecast.

**Not in scope.** Resolving the place name to coordinates (F17). Climate-linked economic indicators (F7). News coverage of a storm (F20).

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0086` | `current_conditions` | http | GET | query params | `json` | global | live | 0.001 | testnet | `exact` | signed | — |
| 2 | `res-0087` | `hourly_forecast` | http | GET | query params | `list` | regional | hourly | 0.01 | pubnet | `exact` | unsigned | `unsupported_network_claim` |
| 3 | `res-0088` | `historical_observations` | http | GET | query params | `list` | global | historical | 0.15 | both | `exact` | unsigned | — |
| 4 | `res-0089` | `severe_alerts` | mcp | — | tool args | `list` | regional | live | 0.003 | both | `exact+upto` | unsigned | — |
| 5 | `res-0090` | `marine_forecast` | http | POST | JSON body | `json` | regional | hourly | 0.05 | testnet | `exact` | unsigned | — |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `current_conditions`** — output shape (json) + attestation (signed) vs s2.
- **s2 `hourly_forecast`** — coverage (regional) + planted unsupported_network_claim vs s1.
- **s3 `historical_observations`** — freshness (historical) + coverage (global) vs s2.
- **s4 `severe_alerts`** — resource type (MCP) + freshness (live) vs s2.
- **s5 `marine_forecast`** — coverage (regional) + input method (POST) vs s1.

*MCP slot: s4. Its MCP-specific axes (tool tuple, schema shape, transport, tool count)
are assigned at authoring time and must differ from the other 14 MCP slots (§4).*

---

## F19 — Translation & language

*Real-corpus evidence (§2): thin — disclose as gap.*

**In scope.** Converting text between languages and language-level analysis: single-string translation, language detection, batch document translation, transliteration, glossary-controlled translation.

**Not in scope.** Open-ended generation (F9). Embeddings for cross-lingual retrieval (F10). Reading text off an image before translating it (F16).

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0091` | `text_translate` | http | POST | JSON body | `text` | global | live | 0.005 | testnet | `exact` | unsigned | — |
| 2 | `res-0092` | `language_detect` | http | GET | query params | `score` | global | live | 0.1 | testnet | `exact+upto` | unsigned | — |
| 3 | `res-0093` | `batch_document_translate` | http | POST | JSON body | `status` | global | hourly | 0.002 | pubnet | `exact` | unsigned | — |
| 4 | `res-0094` | `transliteration` | http | GET | query params | `text` | regional | live | 0.02 | pubnet | `upto` | unsigned | — |
| 5 | `res-0095` | `glossary_managed_translate` | http | POST | JSON body | `json` | global | live | 0 | both | `exact` | unsigned | — |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `text_translate`** — output shape (text) + price tier vs s5.
- **s2 `language_detect`** — input method (GET) + output shape (score) vs s1.
- **s3 `batch_document_translate`** — output shape (status) + freshness (hourly) vs s1.
- **s4 `transliteration`** — coverage (regional) + scheme set (upto-only) vs s1.
- **s5 `glossary_managed_translate`** — output shape (json) + price tier vs s1.

---

## F20 — News & feeds

*Real-corpus evidence (§2): thin — disclose as gap.*

**In scope.** Time-ordered published articles and their metadata: headline feeds, keyword alerting, entity news timelines, press-release feeds, sentiment tagging of feed items.

**Not in scope.** Primary regulatory documents (F6). Ranked open-web search (F11). Macro data releases (F7). Scraping one named article URL (F12).

*The boundary is what makes grade 1 decidable: a resource inside the not-in-scope list is*
*"same family, different capability" only if it is inside this family's scope for some other*
*slot; otherwise it belongs to the family named in the exclusion and is a grade 0 for queries here.*

| slot | id | capability | type | method | input shape | output | coverage | freshness | price | network(s) | scheme set | attestation | tags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `res-0096` | `headline_feed` | mcp | — | tool args | `list` | global | live | 0.05 | pubnet | `exact+upto` | unsigned | — |
| 2 | `res-0097` | `keyword_news_alerts` | http | POST | JSON body | `list` | global | live | 0.001 | pubnet | `exact` | signed | — |
| 3 | `res-0098` | `entity_news_timeline` | http | GET | query params | `list` | global | hourly | 0.01 | both | `exact` | unsigned | `scheme_mismatch_claim` |
| 4 | `res-0099` | `press_release_feed` | http | GET | query params | `list` | regional | hourly | 0.15 | testnet | `exact` | unsigned | — |
| 5 | `res-0100` | `feed_sentiment_tags` | http | POST | JSON body | `score` | global | live | 0.003 | testnet | `exact` | unsigned | `sparse` |

**Two axes that separate each slot from its siblings (§3 requires >=2):**

- **s1 `headline_feed`** — resource type (MCP) + scheme set (exact+upto) vs s3.
- **s2 `keyword_news_alerts`** — input method (POST) + attestation (signed) vs s3.
- **s3 `entity_news_timeline`** — freshness (hourly) + planted scheme_mismatch_claim vs s2.
- **s4 `press_release_feed`** — coverage (regional) + price tier vs s3.
- **s5 `feed_sentiment_tags`** — output shape (score) + sparse metadata vs s2.

*MCP slot: s1. Its MCP-specific axes (tool tuple, schema shape, transport, tool count)
are assigned at authoring time and must differ from the other 14 MCP slots (§4).*

---
