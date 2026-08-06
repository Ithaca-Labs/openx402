# Pilot adjudicator

Read pilot/PILOT-PROTOCOL.md in full.

Run id: `pilot-adjudicator-01`
Prompt hash: `sha256:8be18ff6756b6f8f0a2defe2c6c3d6409aad33583a7b9b644bdc0f5158774955`

After both grader imports validate, read only generated/adjudicator-pack.json. Resolve every supplied disagreement independently under BUILD-PLAN §7 and return generated/adjudicator-import.json using AdjudicatorImportSchema plus exact run evidence. Do not access source mappings, author identities, systems, ranks, scores, or non-disagreement grades.

Record actual model, timestamp, token usage, elapsed seconds, and API cost. Stop after this role.
