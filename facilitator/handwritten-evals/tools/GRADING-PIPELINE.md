# Blind grading pipeline

`run-grading-pipeline.ts` implements BUILD-PLAN §§8–9 without generating semantic grades.
Every command takes a JSON config and creates outputs exclusively; an existing target aborts the
whole output bundle, so raw agent evidence is never overwritten.

## Phases

1. `prepare` validates the complete queries, catalog, sidecars, and pool, then emits two shuffled
   blind task packs plus a withheld mapping manifest. Grader packs contain opaque ids, query text,
   searchable listing fields, resource type, and MCP tool metadata only. They never contain source
   ids, provider/author provenance, family, system, rank, score, or another grade.
2. `adjudicate` validates two complete imports from distinct non-author runs and emits a fresh,
   disagreement-only pack. Prior grades and grader identities remain withheld.
3. `finalize` requires complete adjudication when disagreements exist and writes raw agent qrels,
   raw `AgentCalibrationSchema` rows, and the stratified agreement report. Keep these internal raw
   outputs append-only.
4. `owner-review` requires one owner decision for every query and raw qrel. It writes separate
   canonical `qrels/development-v2.jsonl` and `qrels/release-v2.jsonl`; only release qrels carry
   rationales. Rejected pairs and all pairs under rejected queries are excluded and listed in the
   report. Corrections, rejections, and their rates remain explicit.

Recommended final paths:

```text
qrels/raw-agent-v2.jsonl
qrels/development-v2.jsonl
qrels/release-v2.jsonl
reports/calibration-raw-v2.jsonl
reports/calibration-v2.jsonl
reports/agreement-v2.json
reports/owner-review-v2.json
```

Never expose `qrels/release-v2.jsonl` to normal development/CI tuning code. The release-run ledger
must record every authorized use.

## CLI

```sh
npx tsx tools/run-grading-pipeline.ts prepare prepare-config.json
npx tsx tools/run-grading-pipeline.ts adjudicate adjudicate-config.json
npx tsx tools/run-grading-pipeline.ts finalize finalize-config.json
npx tsx tools/run-grading-pipeline.ts owner-review owner-review-config.json
```

All source paths and output paths are explicit in each config. `prepare` and `adjudicate` also take
the assigned run/model/prompt-hash references and deterministic shuffle seed. `finalize` rechecks
the source hash and complete pool mapping before accepting imports. `owner-review` takes:

```json
{
  "generated_at": "2026-08-07T00:00:00.000Z",
  "inputs": {
    "queries": "queries/queries-v2.jsonl",
    "raw_qrels": "qrels/raw-agent-v2.jsonl",
    "raw_calibration": "reports/calibration-raw-v2.jsonl",
    "owner_decisions": "staging/owner-review/decisions.json"
  },
  "outputs": {
    "development_qrels": "qrels/development-v2.jsonl",
    "release_qrels": "qrels/release-v2.jsonl",
    "reviewed_calibration": "reports/calibration-v2.jsonl",
    "owner_review_report": "reports/owner-review-v2.json"
  }
}
```

`OwnerDecisionBundleSchema` defines the decision file. `approved` must preserve the agent grade;
`corrected` must change it and include notes; `rejected` has no final grade and requires notes.
