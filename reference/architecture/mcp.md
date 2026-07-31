# MCP Support

## Phase 1 protocol obligation

MCP cataloging and discovery are part of the facilitator, not deferred:

- accept and validate MCP Bazaar declarations;
- key entries by `(resource.url, extensions.bazaar.info.input.toolName)`;
- reuse the declared tool `inputSchema` and property descriptions;
- browse and rank MCP resources through the canonical Bazaar endpoints;
- understand the x402 MCP PaymentRequired and payment-response transport;
- include MCP resources in origin proof, liveness, evaluation, and analytics.

The required deployment is still one facilitator process and PostgreSQL.
Running a separate MCP server is optional Phase 2.

## Transport behavior

An x402-protected MCP tool returns PaymentRequired in both locations required by
the transport:

- the structured content object; and
- the JSON string in the first text content item.

The paying client retries the same `tools/call` with
`_meta["x402/payment"]`. A successful paid result includes
`_meta["x402/payment-response"]`. Implementations preserve the standard MCP and
x402 objects; they do not move payment fields into tool arguments or invent a
Stellar transport.

The cataloger parses both copies under size/depth bounds, requires semantic
equality, validates the standard x402 object, and compares the tool name to the
catalog key. A discrepancy is a protocol error and cannot activate a listing.

HTTP and streamable-HTTP origins share the same SSRF, redirect, DNS-rebinding,
timeout, and byte limits described in the Bazaar design. Catalog proof uses
`tools/list` plus an authorized official signed offer; it does not invoke the
tool and assume that a possibly broken payment guard prevented side effects.

## Discovery result

The canonical Bazaar resource remains unchanged. Trusted MCP wrappers may add a
sibling envelope:

```json
{
  "resource": { "...canonical Bazaar resource...": true },
  "provenance": {
    "metadataSource": "seller_declared",
    "originObservedAt": "2026-07-30T00:00:00Z",
    "lastSettledAt": null,
    "signedOfferVerified": false,
    "status": "active"
  },
  "warnings": ["seller_metadata_is_untrusted"]
}
```

This wrapper belongs to the optional discovery tool/API, not x402. Seller text
is returned as data with its schema and provenance. It is never concatenated
into the server's instructions or used to direct additional tool calls.

## Optional standalone MCP discovery server

Phase 2 packages the existing catalog/search client as a separately deployable
MCP server. It is stateless except for optional local signer configuration and
depends on a chosen facilitator's public APIs. It exposes a small versioned
surface:

| Tool | Purpose |
| --- | --- |
| `x402_search_resources` | Query canonical Bazaar search with standard filters and return provenance wrappers |
| `x402_get_resource` | Fetch one active version and payment options by stable resource ID |
| `x402_call_resource` | Perform the guarded discover/check/pay/retry loop for an active catalog entry |

`x402_search_resources` accepts query, canonical filters, limit, and cursor.
`x402_get_resource` accepts only a resource ID/version, avoiding arbitrary URL
fetch. `x402_call_resource` accepts resource ID/version, declared tool input,
network/asset choice, and a maximum atomic budget. The input schema uses strings
for atomic amounts and enumerated CAIP-2 networks.

Outputs are deterministic JSON objects with schema version, canonical resource
or result, settlement response, provenance, and stable error object. The server
does not summarize or rewrite tool output with an LLM. Large/binary upstream
outputs are rejected or returned through a bounded content reference according
to MCP capability negotiation.

Stable error codes are:

`INVALID_ARGUMENT`, `NO_RESULTS`, `RESOURCE_STALE`, `RESOURCE_CHANGED`,
`UNTRUSTED_REDIRECT`, `PAYMENT_REQUIRED`, `BUDGET_EXCEEDED`,
`PAYMENT_REJECTED`, `SETTLEMENT_UNKNOWN`, `UPSTREAM_TIMEOUT`, and
`UPSTREAM_PROTOCOL_ERROR`.

Human text may improve across releases; callers branch only on the code. An
unknown settlement returns `SETTLEMENT_UNKNOWN` with the known transaction hash
and polling reference, never a suggestion to pay again.

## Discover-pay-retry loop

1. Search and select an active resource version.
2. Make the tool call without payment.
3. Parse and validate both PaymentRequired copies.
4. Require URL, tool name, method/transport, network, asset, payTo, scheme,
   version, and schema to match the selected catalog version. A changed price or
   declaration returns `RESOURCE_CHANGED` for explicit re-selection.
5. Apply the agent's local maximum, token balance, expiry, and allowlisted-origin
   policy before signing.
6. Construct the canonical exact or `upto` Stellar transaction and auth tree.
7. Record-simulate, sign the auth entries, and retry the exact tool input with
   `_meta["x402/payment"]`.
8. For `upto`, let the resource server meter work and ask the facilitator to
   settle one actual amount under the signed maximum.
9. Validate `_meta["x402/payment-response"]`, network, payer, amount, transaction
   hash, and selected resource version before returning tool output.
10. Persist no secret or raw tool payload unless the self-host operator
    explicitly enables bounded audit logging.

The paid-call tool may contact only the already-active catalog URL and forbids
cross-origin redirects. It cannot be used as an arbitrary authenticated proxy.

## Budget composition

Three independent ceilings apply:

1. the agent runtime's per-call/session/day budget;
2. the x402 authorization's exact amount or `upto` maximum;
3. a C-account's on-chain context rule and spending policy.

The effective maximum is the minimum. For an OpenZeppelin smart account, the
delegated agent key is scoped to the canonical settlement contract/function,
permitted token/payTo/facilitator, deadline, and maximum. The policy accounts the
signed maximum, not the facilitator-selected actual. Threshold or weighted
rules can require multiple signers; an external verifier can support a passkey.
Removing the signer or rule revokes future authorizations without rotating the
owner account.

The facilitator still validates and enforcing-simulates the smart account.
Agent-side limits improve safety but never replace sponsor fee gates or payment
correctness checks.

## Examples and conformance

Phase 1 includes:

- an MCP seller using `bazaar.mcp` and its existing `inputSchema`;
- an unmodified canonical MCP x402 client performing PaymentRequired, payment
  metadata retry, and payment-response validation;
- exact and `upto` examples on both Stellar networks;
- tests for duplicate URL/different tool names, malformed dual copies, changed
  prices, stale resources, prompt-injection metadata, budget rejection, zero
  actual, lost settlement response, and no double payment.
