# Execution prompt — Step 4: launch the 900-distractor authoring waves

Paste everything below this line as the task for the agent that will execute Step 4. This agent
needs Task/Agent-spawning tool access (it must launch isolated subagents itself) — it is not a
plain research/edit agent.

---

You are executing Step 4 of the Stellar Bazaar v2 search benchmark build, defined in
`/home/soumy/x402-stellar-DIY/facilitator/handwritten-evals/BUILD-PLAN.md`. The **preparation** for
this step is already done and has been independently verified: read
`handwritten-evals/staging/BRIEF-distractors.md`, `handwritten-evals/forbidden-capabilities.md`,
`handwritten-evals/distractor-config.ts`, and `handwritten-evals/staging/distractor-prompts/` before
doing anything else. Do not redesign or second-guess this package — your job is to run it, not
rewrite it.

## What already exists (verify, don't recreate)

- `handwritten-evals/staging/distractor-prompts/wave-01/agent-01.md` through
  `wave-09/agent-10.md` — 90 complete, self-contained agent prompts, one per shard. Each already
  specifies the exact 10 `resource_id`s, `provider_id`s, `run_id`, `shard_id`, and prompt hash for
  that shard. Read 2-3 of them if you want to confirm their shape before starting.
- `handwritten-evals/staging/distractor-prompts/manifest.jsonl` and `SHA256SUMS` — the frozen record
  of every prompt's hash. `tools/merge-distractors.ts` cross-checks authored output against this
  manifest, so do not edit any prompt file; if something in a prompt looks wrong, stop and report it
  rather than patching it yourself (a silent edit would invalidate the hash chain).
- `handwritten-evals/tools/merge-distractors.ts` — the validator. Run
  `npx tsx tools/merge-distractors.ts` from `facilitator/handwritten-evals/` right now, before
  launching anything, to confirm it still reports `0 records; nothing to merge` cleanly on the
  current repo state. If it doesn't, stop and report why before proceeding.

## What you must do

Launch all 90 shards as isolated subagents and let each write its own output, then merge.

1. **Work wave by wave, waves 1 through 9, in order.** Per BUILD-PLAN §1.1 step 5, each wave's ten
   contexts must be fresh and none may read another wave's output or reuse another wave's context —
   this is an evaluation-validity control (it is what stops a shared template forming across waves),
   not a performance suggestion. Do not start wave N+1 until every agent in wave N has finished and
   its context is gone.
2. **Within a wave, the 10 agents may run concurrently** — nothing stops them seeing each other's
   output because each is instructed not to read `staging/distractors/` at all before finishing.
3. For each of the 90 shards, launch one subagent whose entire task is: "read
   `handwritten-evals/staging/distractor-prompts/wave-NN/agent-NN.md` and follow it exactly." Do not
   paraphrase or summarize the prompt file into your own words when dispatching — hand the agent the
   file path and let it read the frozen instructions itself, so nothing is lost or altered in
   transcription.
4. Confirm after each wave that all 10 expected output directories exist under
   `handwritten-evals/staging/distractors/run-distractors-wNN-aXX/` with `wire.jsonl` and
   `sidecar.jsonl`, each 10 lines, before starting the next wave. If a shard is missing or malformed,
   re-run only that shard as a fresh isolated agent (same prompt file, same run_id/shard_id) rather
   than patching its output by hand.

## After all 9 waves complete

1. Run `npx tsc --noEmit -p tools/tsconfig.json` from `facilitator/handwritten-evals/` — must be
   clean.
2. Run `npx tsx tools/merge-distractors.ts` from `facilitator/handwritten-evals/`. This is the real
   gate: it validates every record against the actual v2 zod schema, cross-checks sidecar against
   wire, checks the frozen provider/run/shard assignment for every one of the 900 ids, checks the
   `exact`-only-except-nine-named-ids scheme rule, runs the deterministic forbidden-capability
   scanner against the **complete** 1,000-record corpus (100 labeled + 900 distractors), and — only
   if every check passes — merges the result into `catalog/catalog-v2.jsonl` and
   `catalog/sidecar-v2.jsonl`, replacing the 100-record files with the full 1,000-record corpus.
3. If it reports failures: for each failing `resource_id`, re-run **only that shard** as a fresh
   isolated agent using its original prompt file (never hand-patch generated JSON — that breaks the
   agent-authored provenance chain the whole benchmark depends on). Re-run `merge-distractors.ts`
   after each fix until it passes cleanly.
4. Confirm the final line reads `merged 900 distractors; catalog now has 1000 records`.
5. Run `python3 tools/check-families.py` and `npx tsx tools/check-schema.ts` once more as a final
   sanity sweep — neither should be affected by this step, but confirm nothing regressed.

## What NOT to do

- Do not author any distractor content yourself. Every one of the 900 records must come from one of
  the 90 isolated subagent runs, not from you directly — that's the entire point of the isolation
  protocol (BUILD-PLAN §1.1: "No agent may both author and grade the same query or resource," and
  more broadly the whole benchmark's credibility rests on no single context producing a large,
  possibly-templated share of the corpus).
- Do not edit `forbidden-capabilities.md`, `BRIEF-distractors.md`, `distractor-config.ts`, or any
  file under `staging/distractor-prompts/`. If you believe one of them is wrong, stop and report the
  specific problem instead of changing it — a mid-run change to the frozen task pack invalidates
  whatever shards already ran against the old version (BUILD-PLAN §0: "a mid-authoring schema change
  invalidates completed work" applies to the authoring brief the same way).
- Do not touch `catalog/catalog-v2.jsonl` or `catalog/sidecar-v2.jsonl` directly. Only
  `tools/merge-distractors.ts` writes those files, and only after every gate passes.
- Do not start Step 5 (queries) work. That is a separate handoff.

## When you're done, report

- confirmation that all 90 shards completed and passed validation, with any shards that needed a
  re-run and why
- the final `merge-distractors.ts` output in full (record counts, scheme distribution, forbidden-
  capability scan result, final merged count)
- whether `tools/check-schema.ts`, `python3 tools/check-families.py`, and
  `npx tsc --noEmit -p tools/tsconfig.json` all still pass after the merge
