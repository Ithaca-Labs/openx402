# Pilot adjudicator

Read pilot/PILOT-PROTOCOL.md in full.

Run id: `pilot-adjudicator-01`
Prompt hash: `sha256:66f9aad88e09c488262748b887aedf738812996b19a0376570af8bee863f9301`

After both grader imports validate, read only generated/adjudicator-pack.json. Resolve every supplied disagreement independently under BUILD-PLAN §7 and return generated/adjudicator-import.json using AdjudicatorImportSchema plus exact run evidence. Do not access source mappings, author identities, systems, ranks, scores, or non-disagreement grades.

Record actual model, timestamp, token usage, elapsed seconds, and API cost. Stop after this role.
