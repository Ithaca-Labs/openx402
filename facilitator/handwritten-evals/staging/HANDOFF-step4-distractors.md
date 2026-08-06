# Handoff prompt — Step 4: prepare the ~900-distractor authoring wave

Paste everything below this line as the task for the agent that will prepare Step 4.

---

You are preparing (not yet executing) Step 4 of the Stellar Bazaar v2 search benchmark build,
defined in `/home/soumy/x402-stellar-DIY/facilitator/handwritten-evals/BUILD-PLAN.md`. Your job is
to **read the actual current state of the repo** — don't rely on any summary you're given — and
produce a complete, ready-to-launch authoring package for ~900 distractor resources. Do not launch
any distractor-authoring subagents yourself; stop once the package below exists and is internally
consistent. Someone else will review the package and dispatch the actual authoring waves.

## Read these first, in full

1. `handwritten-evals/BUILD-PLAN.md` — particularly §0.2b (orthogonal sidecar fields), §1 and §1.1
   (scope, the isolated-agent protocol, "produce distractors in nine waves... a context is discarded
   after its wave so it cannot build a reusable template"), §4 (`upto` distribution: keep the 900
   distractors ~99% `exact`-only so the full 1,000-record corpus lands near 3% `upto`), §5 (wire
   generation constraints), §6 "No-result queries — capability exclusion is mandatory" (the
   `forbidden-capabilities.md` requirement), §9 step 4, §11 release gates.
2. `handwritten-evals/schema/schema-v2.ts` — the actual current schema (do not assume anything about
   it; it has recently changed to an agent-provenance model: `authorship: "agent"`, a `generation`
   block with `provider/model/prompt_hash/run_id/shard_id/generated_at`, `review_status`,
   `derived_from.kind: "agent_generated"`). Confirm exactly what `SidecarRecordSchema` requires for a
   record where `is_distractor: true` (in particular: `family`/`family_slot` must be `null`, `axes`
   must be omitted, `adversarial_kind` must be `null` — the schema's own `superRefine` enforces all
   of this, so read it rather than trust this description).
3. `handwritten-evals/spec/families.md` — the 20 capability families and their "in scope" / "not in
   scope" boundaries. A distractor must satisfy **no** family's in-scope capability description —
   that's what makes it a distractor rather than an unlabeled-but-relevant resource.
4. `handwritten-evals/catalog/catalog-v2.jsonl` and `catalog/sidecar-v2.jsonl` — the 100 labeled
   resources already authored and merged (`res-0001`–`res-0100`, `provider-001`–`provider-100`,
   except `res-0078` which deliberately shares `provider-008` as a planted `duplicate_provider`
   trap). Distractors continue the id space from `res-0101` to `res-1000` and may use
   `provider-001`–`provider-120` (120 providers total budgeted across the whole 1,000-record corpus).
5. `handwritten-evals/staging/BRIEF-resources.md` — the shared protocol that was handed to the 10
   labeled-resource authoring agents. Reuse its wire-shape, `.example`-hostname, stroop-math, and
   provenance-block conventions where they still apply; the distractor sidecar is simpler (no
   `axes`, no `mcp` object, no `adversarial_kind`, `family`/`family_slot` always `null`).
6. `handwritten-evals/tools/merge-resources.ts` — the validator/merge script used for the 100 labeled
   resources. You will write a sibling script for distractors; read this one first so the new script
   follows the same pattern (real zod schema validation, not ad hoc checks).

## What "distractor" means here — do not get this wrong

Per BUILD-PLAN §1: **distractors are unjudged, not irrelevant.** A distractor is corpus padding that
makes retrieval hard by diluting the pool (at 1,000 records a top-20 result is 2% of the corpus,
vs 20% at 100). It is NOT required to be obviously wrong — a distractor can be a perfectly
plausible, well-written listing for some real-world need. What makes it a distractor is simply that
it sits outside the 20 defined capability families' in-scope boundaries, so no labeled query is
designed to target it. Some distractors may coincidentally be topically close to a family (that's
useful — it's what makes retrieval hard); they must never actually satisfy a family's in-scope
capability wording precisely enough that a grader would call it relevant to a real query.

Per §1 and §1.1: distractors must be **independently authored, never templated.** "An agent must not
generate variants by changing names, locations, prices, or adjectives in a shared template" — v1's
`CDP-shaped weather 001` … `030` are the canonical failure this is guarding against. Each of the 900
distractors must read like an independently designed listing, not a mail-merge.

## Part A — forbidden-capabilities.md (do this before designing the wave briefs)

BUILD-PLAN §6 requires that for every `no_result` query, the capability it claims is absent from the
whole 1,000-record corpus must be (1) forbidden in the distractor authoring brief, (2) deterministically
scanned for, and (3) independently agent-audited — and that this must happen *before* distractors are
authored, since distractors come before queries in the build order (§9 steps 4 and 5).

This means you must pre-select the ~10 no-result capabilities now, before any query has been
written, as a deliberate methodological decision — not defer it. Do this by finding capabilities
that are:
- clearly and unambiguously excluded from all 20 families' in-scope descriptions in `families.md`
  (a good source: capabilities explicitly named in one family's "not in scope" list that also don't
  appear in *any* family's in-scope list — i.e., a real gap, not just "F1 doesn't do this, but F4
  does"), and
- plausible enough that a buyer might actually search for them (so the eventual no-result query
  reads as a genuine miss, not a strawman).

Write `handwritten-evals/forbidden-capabilities.md` listing exactly these ~10 capabilities, each with
a one-sentence definition precise enough that both a human distractor-author and a deterministic
keyword/tag/schema scanner can check for it. Cross-reference which family boundaries motivate each
exclusion. This file becomes an input every distractor-authoring wave brief must carry.

## Part B — the distractor authoring package

Produce, as concrete files under `handwritten-evals/staging/`:

1. `BRIEF-distractors.md` — the shared protocol every distractor-authoring agent will read, parallel
   in spirit to `BRIEF-resources.md` but for distractors specifically. It must cover:
   - the wire record shape (identical structure to labeled resources — `.example` hostname, stroop
     math, `payTo`, `accepts` — reuse the exact conventions from `BRIEF-resources.md`)
   - the distractor sidecar shape: `is_distractor: true`, `family: null`, `family_slot: null`, no
     `axes` key, no `mcp` key, `adversarial_kind: null` always, plus the full `generation` /
     `derived_from` / `review_status` / `reviewed_at` / `owner_note` provenance block exactly as the
     current schema requires it (read the schema, don't guess)
   - resource_type split for distractors: state your recommendation (the real 14,669-listing sample
     is 100% `http` — §3 — so `http`-only distractors is the defensible default) and say explicitly
     that you chose it, rather than leaving it implicit
   - the ~99% `exact`-only scheme requirement (§4): at most ~9 of every 900 distractors may carry an
     `upto` option, spread arbitrarily, never patterned
   - the full text of `forbidden-capabilities.md` from Part A, with an explicit instruction that no
     distractor may provide, hint at, or be plausibly mistaken for providing any listed capability
   - the anti-templating rule, stated as a hard constraint with the v1 failure as the cited reason
   - the "no CDP prose or schemas copied" licensing rule (§5)
   - a provider_id policy (decide and state a concrete rule — e.g. round-robin over
     `provider-001..120`, or some other explicit scheme — so waves don't need to coordinate live)

2. A generator (script or a clearly written manual enumeration — your choice) that produces the
   **90 concrete, self-contained agent prompts** needed to run all 9 waves × 10 agents, each prompt
   assigning a specific `resource_id` range (10 consecutive ids per agent, e.g. wave 1 agent 1 gets
   `res-0101`–`res-0110`), a `run_id`/`shard_id`, and reminding the agent to read `BRIEF-distractors.md`
   and `forbidden-capabilities.md`. Follow the concrete, fully-spelled-out style already used for the
   10 labeled-resource prompts (no placeholders like "<pick a plausible capability>" left for the
   authoring agent to under-specify) — but distractor topics are intentionally NOT prescribed
   per-slot the way labeled resources were (there's no slot table for distractors); instead give each
   agent clear creative latitude within the "plausible, satisfies no family's in-scope capability
   and no forbidden capability" constraint, plus a instruction to pick a genuinely different topic
   area per resource within their own shard of 10 (no two of their own 10 should be near-duplicates
   of each other either).
   - Critical ordering point from §1.1 step 5: waves must be **sequential in the sense that each
     wave's 10 contexts are fresh and discarded afterward** — but you are only producing the prompts
     now, not running them, so just make sure your prompts don't accidentally instruct one wave to
     read another wave's output (isolation applies within and across waves, same as the labeled
     resources).

3. `tools/merge-distractors.ts` — a validator/merge script modeled on the existing
   `tools/merge-resources.ts`, adapted for distractors: real schema validation via
   `SidecarRecordSchema`/`CatalogRecordSchema`, resource_id/provider_id sanity, the ~99% exact-only
   check, resource_type distribution reporting, and — this is the §6-mandated one — a **deterministic
   forbidden-capability scanner** that greps/matches every one of the 900 distractor records (tags,
   description, serviceName, mimeType) against keyword/tag signatures for each capability in
   `forbidden-capabilities.md` and fails the build on any hit. Don't hand-wave this scanner; §6 is
   explicit that it must exist and must fail the build on a match, and that a script (not an agent)
   is the correct tool for it, since it's syntax matching, not meaning.

## What NOT to do

- Do not invent or launch the 90 authoring subagents. Stop after the package above is written and
  internally consistent (i.e., you've dry-run the prompt-generation logic and spot-checked a couple
  of the 90 generated prompts for concrete, non-placeholder content).
- Do not touch `catalog/catalog-v2.jsonl`, `catalog/sidecar-v2.jsonl`, or anything in
  `staging/resources/` (the already-completed labeled-resource work) except to read them for
  provider_id/resource_id bookkeeping.
- Do not author any query content — `queries/` and no-result query wording are Step 5, out of scope
  here. Part A only needs the *capabilities* that will be forbidden, not the queries that will later
  assert their absence.

## When you're done, report

- the path to `forbidden-capabilities.md` and the ~10 capabilities you chose, with one sentence each
  on why they're a genuine, defensible gap across all 20 families
- the path to `BRIEF-distractors.md`
- how the 90 concrete agent prompts are stored/generated, with 2-3 example prompts shown in full so
  the quality can be spot-checked before anyone spends the API budget running all 90
- the path to `tools/merge-distractors.ts` and confirmation it runs (even against zero distractors,
  it should execute without crashing and report "0 records" cleanly)
