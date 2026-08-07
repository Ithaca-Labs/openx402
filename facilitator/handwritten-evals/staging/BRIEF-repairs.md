# Fresh repair protocol

Authority: `BUILD-PLAN.md` §1.1 step 8. A repair is independent re-authoring, never an edit.

Each generated repair prompt is self-contained and exposes only:

- the artifact kind and ID;
- the frozen structural slot constraints;
- owner-confirmed rejection reasons and owner direction;
- a fresh run ID, shard ID, prompt hash, and output directory.

The repair agent must not read the rejected artifact, merged catalog, sibling staging directories,
critic imports, retrieval output, qrels, or prior agent context. It authors exactly one replacement
from scratch under the current schema and relevant shared authoring/boundary briefs, records actual
generation provenance, and leaves review status pending.

A replacement is never accepted by virtue of being repaired. Re-merge it, generate fresh critic
packs from the changed source hash, run all six fresh critic contexts, and obtain owner acceptance.
Discard the repair context after its one output.
