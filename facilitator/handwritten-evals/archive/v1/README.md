# v1 benchmark archive

Archived under BUILD-PLAN §0.6. These files are preserved as evidence of the superseded v1
evaluation attempt; they are not active v2 inputs.

v1 produced roughly 30,000 category-shaped judgments while conflating unjudged pairs with grade 0.
Its calibration process never produced a defensible inter-annotator kappa, and the position checks
did not repair the underlying labeling design. v2 replaces that process with pooled incomplete
judgments, explicit unjudged state, isolated agent grading, adjudication, and owner review.

## Preserved files

- `qrels/qrels-v1.jsonl` — generated v1 qrels.
- `manifests/openrouter-qrels-v1.jsonl` — OpenRouter generation provenance.
- `reports/calibration-v1.json` — incomplete calibration output.
- `reports/position-consistency-v1.json` and `position-consistency-rejudge-v1.json` — position-order
  checks.
- `src/cli/judge-release-qrels.ts` — retired v1 OpenRouter judging CLI, preserved as source evidence
  and intentionally removed from active package scripts.

`prompts/judge-v1.0.0.txt` was named by the plan but was not present in the repository at archive
time, so no prompt file could be moved. The generated manifest remains the available prompt/run
provenance record.

The format fixture remains active at `facilitator/tests/fixtures/search/golden-v1.json`, exactly as
required by §0.6.
