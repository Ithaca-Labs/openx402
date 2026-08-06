# V2 freeze and holdout contract

`dataset-v2.json` and `release-queries-v2.json` do not exist until Step 6 succeeds. The freeze tool
refuses partial, invalid, unreviewed, or incorrectly distributed data and never overwrites an
existing freeze.

```sh
cd facilitator
npx tsx handwritten-evals/tools/freeze-manifest-v2.ts
```

The manifest hashes the catalog, sidecar, queries, schema, family/axis specifications, forbidden
capabilities, and build plan. `release-queries-v2.json` contains only the 50 release query IDs and
hashes of their schema-parsed records. It contains no qrels, grades, rationales, or answer key.

Release judgments remain sealed from normal development tuning. Any milestone/final release runner
must record a `started` event before reading release inputs, and exactly one terminal event after:

```sh
export STELLAR_BAZAAR_RELEASE_HOLDOUT=I_ACKNOWLEDGE_THIS_IS_A_RECORDED_HOLDOUT_RUN
npx tsx handwritten-evals/tools/release-run-ledger-v2.ts \
  --phase started --run-id release-2026-08-07-01 --purpose milestone \
  --actor OWNER --reason "Milestone evaluation" \
  --confirm-release-holdout RELEASE_HOLDOUT_ACCESS_RECORDED

# Run the isolated release evaluator here. Normal CI/development commands must never do this.

npx tsx handwritten-evals/tools/release-run-ledger-v2.ts \
  --phase completed --run-id release-2026-08-07-01 --purpose milestone \
  --actor OWNER --reason "Milestone evaluation completed" \
  --report reports/final-v2.json \
  --confirm-release-holdout RELEASE_HOLDOUT_ACCESS_RECORDED
```

Use `--phase failed --failure-reason "..."` instead of `completed` after a failed release attempt.
The JSONL ledger is append-only and hash-chained. The command has no update or delete operation,
validates the complete frozen dataset before every append, rejects reused run IDs and duplicate
terminal events, and serializes concurrent writers with an exclusive lock.
