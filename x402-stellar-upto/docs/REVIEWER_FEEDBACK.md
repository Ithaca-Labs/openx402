# Reviewer feedback record

## OpenZeppelin smart-account integration

Date recorded: 2026-07-31

Reviewer context: Boyan, OpenZeppelin Stellar contracts lead. The feedback was
provided after the reference implementation measured that the OZ account sees
two authorization contexts: the settlement root and nested SEP-41 approval.

### Context rules

Feedback: use two rules and pass both identifiers in the authorization payload:

```text
context_rule_ids = [settlement_rule, token_rule]
```

Resolution: implemented. Both rules use the agent signer and reconciling policy.
The token rule permits only the approval correlated with the settlement rule's
pending reservation. Standalone or altered approvals fail.

Evidence: P1, P5, P6, L9, and L10 in
[the evidence matrix](../evidence/CLAIMS.md).

### Recording simulation

Feedback: recording mode does not invoke `__check_auth`, so policy `enforce()`
does not execute.

Resolution: implemented. The hook returns without mutation when no reservation
exists during record simulation. In enforcing simulation and execution, rule 0
creates the reservation before rule 1 and the hook validate it. Missing,
duplicate, altered, or unauthorized notices still fail.

Evidence: P1-P3, P6, L9, and L10.

### Status

Both questions are closed. They are no longer listed as open design questions.
The optional reference policy ships as review evidence but remains outside the
settlement critical path and canonical-client acceptance criteria.
