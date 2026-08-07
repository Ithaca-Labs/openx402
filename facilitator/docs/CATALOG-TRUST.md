# Catalog trust boundary

## What the catalog actually knows

A cataloged listing is **seller-declared metadata observed alongside a payment
this facilitator itself validated**. Every stored version carries
`provenance = 'seller_declared'` and that is the only provenance value the
schema permits.

The two claims are strictly separated:

| Claim | Backed by | Not backed by |
| --- | --- | --- |
| The payment terms (`network`, `scheme`, `asset`, `amount`, `payTo`, `maxTimeoutSeconds`, `extra`) | The signed authorization the facilitator verified and bound to those exact terms | — |
| The description, service name, tags, icon URL, input/output schemas and examples | Nothing. The paying client echoed them | Origin ownership, factual accuracy, or that the endpoint does what it says |

`catalog_resource_versions.verification` records this honestly:

- `payment_observed` — this facilitator verified (or settled) a real payment
  bound to the declared `payTo`, asset and network for this resource;
- `unverified` — a candidate recorded but not yet payment-confirmed (the
  `index_on: settled` waiting state).

Neither value means "the origin proved it owns this URL". No user-facing wording
may claim otherwise.

## The hostile input

`PaymentPayload.resource` and `PaymentPayload.extensions` are copied by the
client from the 402 response. A hostile client controls both completely, and can
send whatever it likes as long as it also makes a real payment. It can therefore
attempt to:

- catalog a competitor's URL under its own description;
- poison a listing with control characters, bidi overrides or prompt-injection
  prose aimed at agents that read the catalog;
- point `routeTemplate` at `/../admin` to catalog a payment under a different
  path;
- point `iconUrl` at `http://169.254.169.254/` to turn the facilitator into an
  SSRF proxy;
- send a multi-megabyte schema to exhaust storage;
- take over an existing listing by re-declaring it with its own `payTo`.

Every one of those is handled below, and none of them can change the payment
result.

## Defences

### Bounds, applied before anything else

`max_metadata_bytes`, `max_json_depth`, `max_schema_bytes`, `max_example_bytes`,
`max_description_length`, `max_tags`, `max_tag_length`, `max_icon_url_length`,
`max_service_name_length`, `max_route_template_length`. Over-large metadata is
rejected; an over-long description is truncated rather than discarded.

### Official validation

`validateDiscoveryExtensionSpec` then `validateDiscoveryExtension` (Ajv, JSON
Schema draft 2020-12) from `@x402/extensions/bazaar`. The upstream helpers are
used directly rather than reimplemented, so this facilitator cannot drift from
the specification's own vectors.

### URL handling

Parsed with the WHATWG parser. Query strings, fragments, default ports and
trailing slashes are dropped and the host is lowercased. Rejected: control
characters, credentials in the authority, any scheme other than `http`, `https`
and `mcp`, plain `http` public origins when `require_https_origins` is set, and
loopback/private/link-local origins unless `allow_local_origins` is explicitly
enabled (which startup forbids while pubnet is enabled).

### `routeTemplate`

Validated by the official `isValidRouteTemplate`, which **percent-decodes before
the `..` and `://` checks**, so `%2e%2e` and `%2E%2E` are caught. An invalid
template is soft-dropped and the concrete URL path is used instead — the payment
is unaffected and the listing still exists.

### `serviceName`, `tags`, `iconUrl`

Passed through the official `sanitizeResourceServiceMetadata`, which enforces
printable-ASCII limits, case-insensitive tag dedup, and the full `iconUrl` SSRF
rule set (no `data:`/`file:`/`javascript:`, no userinfo, no IP literals, no
decimal or hex IP encodings, no `localhost` aliases, IDN-normalized before the
checks). A field that fails is dropped; the surrounding metadata survives.

**Icons are never fetched.** `fetch_icons` is fixed `false`, so no request
processing path ever makes an outbound connection on behalf of a client-supplied
URL. Only the URL string is stored.

### Text for display and indexing

Descriptions, service names and tags are Unicode-normalized (NFC) with C0/C1
control characters, DEL and bidi marks/overrides/isolates removed, then bounded.
The **original** declaration is preserved verbatim in
`catalog_resource_versions.bazaar_extension`; the sanitized form is what
discovery returns and what the lexical index sees. Seller text is data: it is
never executed, never used to build an instruction, and no URL found inside
seller prose is ever fetched.

The lexical document is compiled by a deterministic, versioned formatter from
declared fields and normalized payment terms only. No generative model
participates in producing or rewriting any catalog text.

### Ownership

Each canonical resource records `owner_pay_to`, the `payTo` first observed for
it. A later observation with a different `payTo` **cannot** modify the active
listing: it is stored as a `quarantined` version with
`rejected_reason = 'payto_ownership_conflict'` and returns bazaar status
`rejected`. The incumbent listing and its accepts entries are untouched.

This is deliberately conservative. It means a seller who genuinely rotates their
`payTo` needs operator action, which is the right trade against silent listing
takeover.

### Duplicates, updates and price changes

Identity is:

- HTTP — normalized origin + validated `routeTemplate` (else the concrete path)
  + uppercase method;
- MCP — normalized `resource.url` + `input.toolName`, because MCP multiplexes
  many tools over one endpoint.

`declaration_hash` is a sha256 over the canonical **metadata** declaration.

| Observation | Result |
| --- | --- |
| Identical hash, same payTo | `last_seen` refreshes. No new version. |
| Changed metadata, same payTo | New append-only version; previous one becomes `superseded` and stays queryable for audit. `duplicate_changed: reject` refuses the change instead. |
| Changed price/timeout/extra, same metadata | The previous payment-option row is retired at this catalog version and a new row is appended. Historical settlements keep pointing at the terms actually paid, so a price change cannot rewrite past conversion data. |
| Different payTo | Quarantined as above. |
| Several networks/schemes for one resource | Several live payment-option rows, one resource, several `accepts` entries. |

### Liveness

Statuses are `active`, `stale`, `quarantined`, `disabled`, `tombstoned`.
A successful observation refreshes `last_seen`; a settlement also updates
`last_seen_paid`. After `stale_after_hours` without observation a resource is
demoted to `stale` and excluded from discovery by default; a fresh observation
restores it. A once-observed resource therefore cannot keep ranking as healthy
after it dies.

### Soft failure

Cataloging runs after the payment has already been decided, in a step that
catches everything. A rejection produces the official `EXTENSION-RESPONSES`
value with `bazaar.status = "rejected"` and a stable human-readable
`rejectedReason`, while the precise internal code is written to
`catalog_observations.internal_reason`. A valid payment never becomes a 5xx
because its metadata was bad.

## Cursor stability

`catalog_next_version()` increments a single row under a row lock held until
commit, so catalog version order equals commit order across every replica.
`catalog_watermark()` is therefore a true snapshot boundary: when a reader sees
watermark N, every version ≤ N is committed and no version ≤ N can appear later.

Discovery cursors are opaque `c1.<base64url payload>.<HMAC-SHA256>` tokens
carrying the pinned watermark, the next offset, a fingerprint of the filter set
and an expiry. A tampered signature, an expired cursor, or a cursor replayed
against different filters is rejected with 400. Each page filters
`created_version <= snapshot AND (retired_version IS NULL OR retired_version >
snapshot)` on resources, versions and payment options, so concurrent cataloging
cannot shift, duplicate or skip a row. Ordering is by resource id descending,
which is immutable and unique, so tie-breaking is deterministic.

### `partialResults` semantics

`partialResults` is `true` when the returned page is not the complete result of
the query — specifically when either:

1. more rows remain under the pinned snapshot (another page exists), or
2. rows that existed under the snapshot are no longer visible because their
   lifecycle state changed afterwards (quarantined, disabled, tombstoned, or
   demoted to `stale`).

It is `false` only when the requested page is the complete, unreduced result of
the query. Security quarantine always removes a result, even from a page a
cursor was already issued against.

## Non-standard surface, declared

Three things this facilitator exposes are **not** in the Bazaar specification and
must not be depended on by clients:

- the `asset` browse/search filter — `asset` is a structured column here, and
  the specification's filter list stops at `type`, `payTo`, `scheme`, `network`
  and `extensions`;
- the `maxPrice` browse/search filter — it is an atomic-unit integer and requires
  `asset`, so comparisons never mix currencies or decimal scales;
- `pagination.cursor` on the browse response, which mirrors the shape the
  specification already defines for search.

The two structured filters belong in an upstream discovery proposal. Requiring
an exact asset and using its atomic units gives `maxPrice` deterministic
minimum-option semantics when a listing has multiple `accepts` entries.

## What is not implemented

Active origin probing (`GET`/`HEAD` re-fetch of the declared 402, MCP
`tools/list`) and signed `offer-receipt` verification are **not** implemented
here. Consequently no listing is ever marked as origin-proved, and the schema
has no value that could claim it. The strongest signal this facilitator records
is `payment_observed`, which is exactly what it can prove.
