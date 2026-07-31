# Facilitator integration evidence

Facilitator code is deliberately excluded from this contract/spec review
repository. The implementation snapshot reviewed during extraction contains:

- Payment Identifier parsing and validation;
- a normalized fingerprint using the signed `upto` maximum rather than the
  settlement-time actual;
- deterministic XDR fallback keys when the extension is absent;
- PostgreSQL conflict detection for changed fingerprints or actual amounts;
- HTTP 409 for conflicting identifier reuse;
- atomic persistence of envelope XDR, transaction hash, sponsor budget and
  unresolved channel lease before submission;
- known-hash polling after an RPC timeout; and
- channel quarantine until a transaction becomes definitively successful or
  failed.

Recorded tests:

| Test file | Covered behavior |
| --- | --- |
| `tests/unit/idempotency.test.ts` | Stable `upto` fingerprint, changed signed terms, XDR fallback, required/malformed identifiers |
| `tests/integration/state.test.ts` | Conflicts, atomic prepared/hash storage, unknown state, channel fencing, global budgets |

The implementation also completed real facilitator-backed testnet `upto`
settlements:

- partial: `638384dfc73e28c8736a7699b04caa7920b3ea247f269a82eec1f9832f4c504f`
- zero: `cc9c93d527e125674e5db01d23d38db56aa2cf736012a1bfbcb9597525ade0cb`

These demonstrate integration with the deployed contract but are not yet an
official upstream Stellar `upto` client/E2E result because that client does not
exist in the canonical SDK.
