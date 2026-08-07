# Critic, owner, and repair workflow

`run-critic-workflow.ts` prepares evidence for BUILD-PLAN §1.1 steps 7–8. It writes task packs and
prompts but never launches an agent. All output writes are exclusive: an existing artifact causes
the command to fail instead of overwriting review history.

Run two review scopes:

- `corpus` immediately after the 1,000 resources are merged; it contains 1,000 artifacts.
- `full` after the 100 queries exist; it contains 1,100 owner-review artifacts. Roles that cannot
  assess queries receive only the resources, but the owner still decides every source artifact.

## 1. Prepare six task packs

Create a JSON config with this exact shape. List critics in the role order recorded by
`CRITIC_ROLES`: schema fidelity, clone detection, family-boundary leakage, prompt injection,
forbidden/no-result contradictions, and Stellar payment correctness.

```json
{
  "scope": "corpus",
  "review_run_id": "review-corpus-v2-001",
  "created_at": "2026-08-07T00:00:00.000Z",
  "seed": "record-a-secret-seed-at-least-16-characters",
  "inputs": {
    "catalog": "handwritten-evals/catalog/catalog-v2.jsonl",
    "sidecars": "handwritten-evals/catalog/sidecar-v2.jsonl",
    "queries": null,
    "families": "handwritten-evals/spec/families.md",
    "forbidden_capabilities": "handwritten-evals/forbidden-capabilities.md"
  },
  "critics": [
    {"provider":"anthropic","model":"claude-sonnet-4-YYYYMMDD","run_id":"critic-schema-001","shard_id":"critic-schema-corpus-001","temperature":0},
    {"provider":"anthropic","model":"claude-sonnet-4-YYYYMMDD","run_id":"critic-clones-001","shard_id":"critic-clones-corpus-001","temperature":0},
    {"provider":"anthropic","model":"claude-sonnet-4-YYYYMMDD","run_id":"critic-boundaries-001","shard_id":"critic-boundaries-corpus-001","temperature":0},
    {"provider":"anthropic","model":"claude-sonnet-4-YYYYMMDD","run_id":"critic-injection-001","shard_id":"critic-injection-corpus-001","temperature":0},
    {"provider":"anthropic","model":"claude-sonnet-4-YYYYMMDD","run_id":"critic-forbidden-001","shard_id":"critic-forbidden-corpus-001","temperature":0},
    {"provider":"anthropic","model":"claude-sonnet-4-YYYYMMDD","run_id":"critic-stellar-001","shard_id":"critic-stellar-corpus-001","temperature":0}
  ],
  "output_directory": "handwritten-evals/staging/critic-corpus-v2-001"
}
```

Replace `YYYYMMDD` with the exact deployed model revision and set actual timestamps/run IDs before
preparation. Then run from `facilitator/`:

```sh
npx tsx handwritten-evals/tools/run-critic-workflow.ts prepare /absolute/path/prepare.json
```

The output contains six `packs/*.json`, six `prompts/*.md`, and a withheld manifest. Dispatch each
pack/prompt pair to one fresh context. Never give the withheld manifest to a critic.

## 2. Consolidate strict critic imports

Create a config naming the withheld manifest and all six returned JSON imports:

```json
{
  "inputs": {
    "withheld_manifest": "handwritten-evals/staging/critic-corpus-v2-001/withheld-manifest.json",
    "critic_imports": [
      "imports/schema_fidelity.json",
      "imports/clone_detection.json",
      "imports/family_boundary_leakage.json",
      "imports/prompt_injection.json",
      "imports/forbidden_no_result_contradictions.json",
      "imports/stellar_payment_correctness.json"
    ]
  },
  "output_owner_pack": "handwritten-evals/staging/critic-corpus-v2-001/owner-review-pack.json"
}
```

```sh
npx tsx handwritten-evals/tools/run-critic-workflow.ts consolidate /absolute/path/consolidate.json
```

The command fails on missing/duplicate assessments, unknown finding codes, duplicate finding IDs,
or provenance that differs from the frozen assignment.

## 3. Owner decision and repair preparation

The owner reviews every artifact and finding in the generated pack and writes one document accepted
by `CriticOwnerDecisionBundleSchema`. Finalize with:

```json
{
  "generated_at": "2026-08-07T00:00:00.000Z",
  "repair_round": 1,
  "inputs": {
    "withheld_manifest": "handwritten-evals/staging/critic-corpus-v2-001/withheld-manifest.json",
    "critic_imports": [
      "imports/schema_fidelity.json",
      "imports/clone_detection.json",
      "imports/family_boundary_leakage.json",
      "imports/prompt_injection.json",
      "imports/forbidden_no_result_contradictions.json",
      "imports/stellar_payment_correctness.json"
    ],
    "owner_decisions": "handwritten-evals/staging/critic-corpus-v2-001/owner-decisions.json"
  },
  "outputs": {
    "owner_acceptance_report": "handwritten-evals/reports/critic-owner-corpus-v2.json",
    "repair_directory": "handwritten-evals/staging/critic-corpus-v2-001/repairs-round-01"
  }
}
```

```sh
npx tsx handwritten-evals/tools/run-critic-workflow.ts finalize /absolute/path/finalize.json
```

Confirmed findings cannot be approved. Repair prompts contain no rejected source text. After any
repair, rebuild and rerun the workflow with fresh critic contexts because the source hash changes.
For the later `full` scope, provide `queries/queries-v2.jsonl` and write the final acceptance report
to `reports/critic-owner-full-v2.json`. Both current, zero-repair reports are release-gate inputs.
