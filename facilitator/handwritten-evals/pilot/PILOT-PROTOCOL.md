# Mandatory Step 1 pilot protocol

This package is preparation only. Dispatch every role in a fresh context. No author may read a
sibling staging directory, merged pilot artifacts, retrieval output, grades, or another prompt.
No agent may author and grade the same record/query. Grader candidate order is independently
randomized and hides resource ids, author identities, systems, ranks, and scores. The adjudicator
sees only disagreement candidates and independently regrades them without either prior grade. The forbidden
auditor sees one capability and all 15 blinded descriptions, never authorship.

Frozen scope: F1 On-chain state / block data; five labeled slots; ten independently authored HTTP
distractors; five capability queries (one per slot); one FC-02 no-result query; two graders; one
adjudicator; one full 15-record FC-02 exclusion audit.

Each agent must return its artifact plus actual run evidence: role, run id, exact model, prompt
hash, input/output tokens, wall-clock seconds, and API cost. Do not estimate or backfill values.
Rejected output is never silently rewritten: record the rejection and launch a fresh repair context.
Owner evidence records actual review time, corrections, rejection/regeneration counts, final
reviewed qrels, and explicit exclusion sign-off. Zero or absent timing/token evidence fails.

Execution order: resource, distractor, and query authors independently; deterministic prepare;
grader A and B independently; adjudicator on disagreements; forbidden auditor; owner review; gate.
Nothing in this package launches any of those contexts.
