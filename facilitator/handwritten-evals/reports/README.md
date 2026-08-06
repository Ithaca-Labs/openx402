# v2 report evidence contracts

`tools/release-gates-v2.ts` writes `release-gates-v2.json` and treats missing evidence as blocked.
It never promotes absence to success. Semantic/review reports are produced only after their build
steps run:

- `pilot-v2.json` — approved pilot, numeric `judged_at_10_threshold`, and measured
  `forbidden_audit_cost`.
- `distribution-audit-v2.json` — approved release-time anti-correlation audit.
- `unpooled-audit-v2.json` — approved audit with numeric `audited_relevance_rate`.
- `forbidden-capability-audit-v2.json` — owner-approved ten-capability audit and
  `deterministic_scan_passed: true`.
- `calibration-records-v2.jsonl` / `calibration-v2.json` — schema-valid rows and approved report
  with `relevant_family_weighted_kappa`.
- `isolation-audit-v2.json` and `grading-blindness-v2.json` — approved process audits.
- `final-v2.json` — metrics, thresholds, `ndcg_gains`, significance, BM25, owner rates, and
  limitations.

An approval field is `status: "approved"`, `status: "pass"`, or `owner_review: "approved"`.
These files are evidence imports, not substitutes for the actual isolated runs and owner review.
