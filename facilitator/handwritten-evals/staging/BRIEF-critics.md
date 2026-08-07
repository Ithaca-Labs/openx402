# Independent critic protocol

Authority: `BUILD-PLAN.md` §1.1 steps 7–8 and §11. Critics inspect; they never author or repair.

## Isolation

Each of the six roles runs in a fresh context with one generated opaque pack and its matching
prompt. A critic must not read the source catalog, sidecars, author provenance, sibling critic
output, qrels, retrieval runs, ranks, or scores. Its context is discarded after it writes one
import. A critic run ID must be unique and must not equal any artifact-author run ID.

The six mandatory roles are:

1. `schema_fidelity`: semantic consistency across wire, sidecar, and query structure.
2. `clone_detection`: exact/near clones, mail-merge variants, and reusable templates.
3. `family_boundary_leakage`: all frozen family boundaries, including distractor leakage.
4. `prompt_injection`: ranking, grader, retriever, and buyer-directed manipulation.
5. `forbidden_no_result_contradictions`: forbidden capabilities and no-result consistency.
6. `stellar_payment_correctness`: Stellar assets/networks, stroops, payTo, schemes, and snapshots.

## Required output

Return one JSON document accepted by `CriticImportSchema` in `tools/critic-workflow.ts`. It must
contain exactly one assessment for every opaque `artifact_id` in the pack. Do not omit clean
artifacts. A passing assessment has no findings; a flagged assessment has at least one finding.
Only use the finding codes permitted for the assigned role. Every finding needs a unique stable
`finding_id`, severity, concise summary, concrete evidence, rationale, and recommendation.

Copy the assigned `pack_id`, provider, exact model revision, prompt hash, run ID, shard ID,
temperature, and actual completion timestamp. Do not guess or normalize provenance.

## Handoff

The CLI validates exact coverage and provenance before resolving opaque IDs for the owner. Critics
do not see owner decisions and cannot mark an artifact accepted. Any confirmed defect becomes a
new isolated repair task; the critic never rewrites its subject.
