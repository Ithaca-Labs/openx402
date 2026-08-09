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
3. `finalize` requires the exact preserved grader/adjudicator packs as inputs, verifies them against
   the withheld mappings and current source snapshot, and requires complete adjudication when
   disagreements exist. It writes raw agent qrels, raw `AgentCalibrationSchema` rows, the
   stratified agreement report, and `grading-process-audit-v2.json`. Keep these internal raw outputs
   append-only.
4. `owner-review` requires one owner decision for every query and raw qrel. Pair-level inputs, owner
   decisions, release qrels, reviewed calibration, and the full owner report must use absolute paths
   outside the benchmark tree. It writes development qrels plus a public hash/count-only owner
   summary inside the tree; only sealed release qrels carry release rationales. Rejected pairs and
   all pairs under rejected queries are excluded and listed in the sealed full report.

Recommended final paths:

```text
/sealed/stellar-bazaar-v2/raw-agent-v2.jsonl
qrels/development-v2.jsonl
/sealed/stellar-bazaar-v2/release-qrels.jsonl
/sealed/stellar-bazaar-v2/calibration-raw-v2.jsonl
/sealed/stellar-bazaar-v2/calibration-v2.jsonl
/sealed/stellar-bazaar-v2/owner-decisions-v2.json
/sealed/stellar-bazaar-v2/owner-review-full-v2.json
reports/agreement-v2.json
reports/grading-process-audit-v2.json
reports/owner-review-v2.json
```

Never place pair-level release evidence below `handwritten-evals/` or expose it to normal
development/CI tuning code. `reports/owner-review-v2.json` contains only aggregate counts and hashes,
never query/resource ids or grades. An authorized milestone/final runner sets
`STELLAR_BAZAAR_RELEASE_QRELS_PATH` after recording its `started` ledger event; only then does the
report generator resolve the sealed qrels. The final report, public owner summary, aggregate
agreement/process reports, and append-only ledger are shareable.

## CLI

```sh
npx tsx tools/cli/run-grading-pipeline.ts prepare prepare-config.json
npx tsx tools/cli/run-grading-pipeline.ts adjudicate adjudicate-config.json
npx tsx tools/cli/run-grading-pipeline.ts finalize finalize-config.json
npx tsx tools/cli/run-grading-pipeline.ts owner-review owner-review-config.json
```

All source paths and output paths are explicit in each config. `prepare` and `adjudicate` also take
the assigned run/model/prompt-hash references and deterministic shuffle seed. `finalize` rechecks
the source hash, exact blind-pack contents, complete pool mapping, and fresh-context run identities
before accepting imports. Its config names `grader_a_pack`, `grader_b_pack`, and nullable
`adjudication_pack` inputs plus a `process_audit` output; its raw `qrels` and `calibration` outputs
must be absolute sealed paths outside the tree. `owner-review` takes:

```json
{
  "generated_at": "2026-08-07T00:00:00.000Z",
  "inputs": {
    "queries": "queries/queries-v2.jsonl",
    "raw_qrels": "/sealed/stellar-bazaar-v2/raw-agent-v2.jsonl",
    "raw_calibration": "/sealed/stellar-bazaar-v2/calibration-raw-v2.jsonl",
    "owner_decisions": "/sealed/stellar-bazaar-v2/owner-decisions-v2.json"
  },
  "outputs": {
    "development_qrels": "qrels/development-v2.jsonl",
    "release_qrels": "/sealed/stellar-bazaar-v2/release-qrels.jsonl",
    "reviewed_calibration": "/sealed/stellar-bazaar-v2/calibration-v2.jsonl",
    "owner_review_report": "/sealed/stellar-bazaar-v2/owner-review-full-v2.json",
    "owner_review_public_summary": "reports/owner-review-v2.json"
  }
}
```

`OwnerDecisionBundleSchema` defines the decision file. `approved` must preserve the agent grade;
`corrected` must change it and include notes; `rejected` has no final grade and requires notes.
