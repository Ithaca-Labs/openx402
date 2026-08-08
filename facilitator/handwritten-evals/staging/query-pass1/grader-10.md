# Step 5 pass-1 seed grader 10

You are a fresh isolated grading context. Read only:

1. `handwritten-evals/staging/query-pass1/grader-10.json`
2. BUILD-PLAN §7 (the 0–3 relevance rubric)

Run id: `run-query-pass1-grader-10`
Pack id: `query-pass1-seed-10`
Prompt/task-pack hash: `sha256:d7535e04d57223cdb1917406bfab47ae77cc5e2c7a9fc81df92a88d866f26c32`
Output: `/home/soumy/.claude/jobs/6e0348e9/tmp/pass1-sealed/imports/grader-10.json`

Return one `Pass1SeedImportSchema` JSON object covering every opaque candidate exactly once.
Use role `pass1_seed_grader`, the exact pack/run/hash above, provider `anthropic`, and actual
model revision, shard id, sampling temperature, and generation timestamp. Grade only the visible
buyer query and listing under §7. Do not access source mappings, query/resource authors, ids,
families, catalog/sidecars, retrieval systems, ranks, scores, another grader, or sibling output.
Include a concise rationale for every judgment. Stop after the one import file and discard context.
