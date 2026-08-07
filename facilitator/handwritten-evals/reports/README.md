# v2 report evidence contracts

`tools/release-gates-v2.ts` writes `release-gates-v2.json` and treats missing evidence as blocked.
It never promotes absence to success. Semantic/review reports are produced only after their build
steps run:

- `pilot-v2.json` — approved pilot, numeric `judged_at_10_threshold`, and measured
  `forbidden_audit_cost`.
- `distribution-audit-v2.json` — deterministic release-time distribution and anti-correlation
  audit, recomputed by the release gate from the current catalog and sidecars.
- `unpooled-audit-v2.json` — finalized owner-reviewed audit bound to the current pool and reviewed
  unpooled qrels, including the measured relevance rate and re-pool decision.
- `forbidden-capability-audit-v2.json` — owner-approved ten-capability audit and
  deterministic scan, both bound to the current corpus and frozen capability definitions.
- `agreement-v2.json` — safe aggregate stratified agreement, including relevant-family quadratic
  kappa and complete disagreement adjudication. Pair-level calibration stays outside the tree.
- `grading-process-audit-v2.json` — source-bound hashes of the exact blind grader/adjudicator packs
  and imports, with complete double grading and fresh-context identity checks.
- `owner-review-v2.json` — public hash/count-only summary proving exact split coverage and reporting
  correction/rejection rates without exposing query/resource ids or grades. The exhaustive owner
  decision report stays sealed outside the tree.
- `final-v2.json` — owner-approved metrics report bound to the current qrels and five system runs,
  with thresholds, gains, significance, BM25, owner rates, and all eight required limitations.

Each file has its own strict schema and current-input hash checks. Generic `status: "pass"` or
`status: "approved"` documents are rejected; evidence files never substitute for the preserved
isolated-run artifacts or exhaustive owner decisions they reference.
