# Bazaar and Catalog

## External endpoints

The facilitator implements the canonical v2 Bazaar surfaces:

- `GET /discovery/resources` for browse/filter/pagination;
- `GET /discovery/search` for query, filter, ranked cursor pagination;
- `EXTENSION-RESPONSES` on facilitator responses for cataloging outcome.

Browse accepts only the specification filters: `type`, `payTo`, `scheme`,
`network`, `extensions`, `limit`, and `offset`. Search accepts the specification
query, filters, limit, and cursor. The response shapes remain the official
`items` browse shape and `resources` search shape, including `x402Version`,
pagination, and `partialResults`. Operator-only status and provenance fields are
not inserted into a Bazaar resource.

Price is deliberately not added as a private filter. A TSC proposal will define
asset-aware minimum/maximum price semantics, decimal units, multiple accepts
entries, and backwards-compatible discovery behavior. Natural-language search
may rank the phrase "cheap" using the seller-declared structured payment
options, but clients cannot depend on a non-standard `maxPrice` field.

## Automatic cataloging

Every valid `/verify` or `/settle` PaymentPayload is an observation, not proof
that all echoed metadata is true. Cataloging is a separate soft-failure path:

1. Extract only the official resource and Bazaar extension fields.
2. Enforce request byte, JSON depth, array, string, schema, URL, and enum bounds.
3. Apply the official Bazaar validation and soft-drop rules.
4. Normalize a stable resource key and hash the canonical declaration.
5. Upsert a candidate/version in PostgreSQL and record the observation source.
6. Obtain a side-effect-safe origin proof and compare its declaration/payment
   terms to the candidate.
7. Activate the version and enqueue indexing only when schema validation and
   configured proof policy pass.

With `index_on: verified`, a successful x402 payment verification plus origin
proof is sufficient. With `index_on: settled`, activation waits for a confirmed
settlement as an additional liveness signal. Payment validity never depends on
catalog success.

The facilitator attempts the origin probe within the verification response
budget. A completed proof yields Bazaar extension status `success`; a durable
candidate awaiting a probe yields `processing`; a terminal schema or proof
failure yields `rejected` with a stable `rejectedReason`. A later verification
can report the now-terminal outcome. The encoded `EXTENSION-RESPONSES` value is
the official base64 JSON shape, not a custom response body.

## Validation and trust boundary

The echoed resource block is controlled by the paying client. Before any URL or
path use:

- parse with a standards-compliant URL parser and require `https` in production;
- normalize host casing, IDNA, default ports, method, and path;
- percent-decode path segments before checking traversal and separators;
- reject encoded or decoded `..`, credentials, fragments, NUL/control
  characters, backslashes, ambiguous encodings, and `://` inside a route
  template;
- require `routeTemplate` to begin with `/` and match the official placeholder
  grammar; invalid templates are soft-dropped in favor of the concrete resource
  URL;
- re-resolve DNS at connection time, deny loopback, link-local, private,
  multicast, and cloud-metadata ranges, cap response bytes and time, and do not
  follow a redirect to a different origin;
- allow local origins only in the explicit E2E/development profile.

`iconUrl` receives the same SSRF treatment and is never required for indexing.
The service stores the URL by default rather than fetching it. If icon caching
is enabled, MIME type, dimensions, bytes, redirect count, and decompression
ratio are bounded.

For HTTP GET/HEAD, proof requests the declared URL without payment, expects the
current x402 PaymentRequired response, and compares normalized URL/template,
method, accepts, payTo, price, and Bazaar declaration. The cataloger never sends
an example body to POST/PUT/PATCH/DELETE: a misconfigured payment layer could
execute it. Those methods require an official signed offer whose signer is
authorized for the resource origin or payTo before default-public activation.

For MCP, a safe `tools/list` observation proves that the origin exposes the tool
and input schema but not its payment terms. Default-public activation therefore
also requires an authorized official signed offer. A `tools/call` is not used as
a catalog probe because a broken payment guard could execute the tool. Signed
offers are portable protocol artifacts, not a hosted identity dependency; the
seller helper can generate their official JWS form and operators can verify
payTo signatures or `did:web` authorization.

Without this proof, the declaration remains a candidate or an explicitly
unverified operator view. This trades some automatic coverage for protection
against forged listings and accidental side effects. It is preferable to
silently teaching agents to pay a client-invented payTo.

This proves "observed at origin", not legal ownership or factual accuracy.
User-facing wording must preserve that distinction.

## Identity, duplicates, and updates

Stable keys are:

- HTTP: normalized resource origin, normalized route template or concrete path,
  and uppercase method;
- MCP: exact normalized `resource.url` and `extensions.bazaar.info.input.toolName`.

An identical canonical hash refreshes `last_seen` without creating a version. A
changed description, schema, payment option, method, or price creates an
append-only candidate version. The old active version remains searchable until
the replacement passes proof. A payTo or origin change is always quarantined
for new proof. Activation is a transactional compare-and-swap; simultaneous
observations converge on one active version and retain an audit trail.

Canonical query examples and output examples are versioned with the seller
declaration. Search impressions and settlements refer to the exact resource
version, so a changed price cannot rewrite historical conversion data.

## Seller helper

Sellers never construct Bazaar JSON or JSON Schema by hand. The SDK exposes
typed builders:

```ts
const weatherMetadata = bazaar.http({
  description: "Returns the current weather for a city.",
  serviceName: "Weather API",
  tags: ["weather", "forecast"],
  iconUrl: "https://api.example.com/icon.png",
  method: "GET",
  query: {
    city: {
      type: "string",
      description: "The city to look up, such as Mumbai or London.",
      required: true,
      example: "Mumbai",
    },
    units: {
      type: "string",
      description: "Temperature units.",
      enum: ["celsius", "fahrenheit"],
      required: false,
      example: "celsius",
    },
  },
  output: {
    type: "json",
    description: "Current conditions and a short forecast.",
    example: { city: "Mumbai", temperature: 29, condition: "Sunny" },
  },
});
```

The builder compiles deterministically to the existing official fields:
`resource.description`, `serviceName`, `tags`, `iconUrl`,
`extensions.bazaar.info`, `extensions.bazaar.schema`, parameter descriptions
and examples, and output schema/example. It emits no proprietary field. A
`compile()` method returns the canonical object for snapshots, while framework
adapters pass that same object to x402 middleware.

For MCP:

```ts
const analysisMetadata = bazaar.mcp({
  toolName: "financial_analysis",
  description: "Analyzes a public company using financial data.",
  transport: "streamable-http",
  inputSchema: {
    type: "object",
    properties: {
      ticker: {
        type: "string",
        description: "Stock ticker symbol, such as AAPL.",
      },
      analysis_type: {
        type: "string",
        enum: ["quick", "deep"],
        description: "How detailed the analysis should be.",
      },
    },
    required: ["ticker"],
  },
  example: { ticker: "AAPL", analysis_type: "deep" },
  output: { type: "json", example: { summary: "Strong fundamentals", score: 8.5 } },
});
```

The tool's existing `inputSchema` is reused unchanged. Parameter descriptions
remain in `inputSchema.properties.<name>.description`; the helper does not
maintain a second schema language. Compile-time types and runtime validation use
the same canonical schema fixtures as the cataloger and E2E suite.

For mutating HTTP methods and MCP, the helper also offers a dedicated
`did:web`/JWS signing adapter that emits the existing `offer-receipt` extension.
The key is a service signing key, not the payment recipient key, and its public
key is hosted by the seller. This is optional for payment conformance but
required by the default public-catalog proof policy for methods that cannot be
safely probed. The adapter generates the official artifact; it does not add a
new Bazaar field.

## Catalog lifecycle and liveness

Resource states are `candidate`, `active`, `stale`, `quarantined`, and
`tombstoned`.

- successful verified/settled observations refresh `last_seen`;
- a confirmed payment is the strongest liveness observation and updates
  `last_seen_paid`;
- bounded scheduled probes refresh origin health without paying;
- after `stale_after_hours`, a resource is demoted and excluded by default;
- repeated proof mismatch quarantines it immediately;
- retention eventually tombstones old inactive versions while preserving the
  minimal settlement audit reference;
- search rank includes bounded recency/health features, never an unbounded
  pay-to-win volume boost.

Nothing in the protocol explicitly deletes a listing, so liveness policy is
required to prevent agents from selecting abandoned endpoints. Operators may
choose the stale interval and whether stale entries appear, but cannot mark an
unproved candidate as verified.

## Agent-facing metadata security

Description, tags, schemas, examples, service names, and outputs are
seller-authored untrusted text:

- store the original declaration and a separately sanitized display/index form;
- strip control and bidi override characters, normalize Unicode, bound every
  field, and escape it at render time;
- never execute examples, fetch URLs found in prose, or place seller text in a
  system/developer instruction;
- present schema and provenance structurally, with the label
  `seller_declared`;
- keep ranking text deterministic and derived only from declared fields;
- expose origin-observed time, settlement-observed time, active version, and
  signed-offer status through trusted dashboard/MCP wrapper fields;
- require agent SDKs to treat the seller content as data and enforce local URL,
  payment, output-size, and budget policies independently.

The canonical Bazaar response cannot carry new provenance fields. Provenance is
therefore available from the separate resource-detail analytics endpoint and
the optional MCP discovery wrapper, while the original resource object is
returned byte-for-byte compatibly.

## Dashboard-equivalent read API

Phase 1 exposes read-only `/analytics/v1` endpoints; the UI is Phase 2. The
surface covers the x402scan reference data:

| View | Data |
| --- | --- |
| Overview | transaction count, amount/volume, unique buyers, sellers, facilitators, latest activity, and time buckets |
| Transactions | payer, payTo/server, amount, asset, scheme, network, facilitator/channel, hash, status, fee, resource, timestamp |
| Buyers | list and detail, count, volume, unique sellers, latest activity, networks, facilitators, top sellers, time series |
| Sellers | list and detail, count, volume, unique buyers, latest activity, networks, facilitators, resources, time series |
| Facilitators | list/detail, addresses, networks, buyers, sellers, volume, counts, fee spend, latency, status/error rate, method counts |
| Networks | count, volume, buyers, sellers, facilitators, assets, latest activity, time series |
| Resources/origins | catalog entry/version, accepts/prices, schemas, tags, origin, proof/liveness, invocations, conversions, uptime, status classes, p50/p90/p99 latency |

The concrete read routes are:

- `/overview` and `/overview/timeseries`;
- `/transactions` and `/transactions/:hash`;
- `/buyers`, `/buyers/:address`, `/buyers/:address/transactions`, and
  `/buyers/:address/sellers`;
- `/sellers`, `/sellers/:address`, `/sellers/:address/transactions`, and
  `/sellers/:address/resources`;
- `/facilitators`, `/facilitators/:id`,
  `/facilitators/:id/transactions`, and `/facilitators/:id/observability`;
- `/networks` and `/networks/:network`;
- `/origins`, `/origins/:id`, `/origins/:id/resources`;
- `/resources`, `/resources/:id`, `/resources/:id/invocations`, and
  `/resources/:id/observability`.

Time windows cover current day, 1, 7, 14, and 30 days plus all time. Resource
observability covers total calls, uptime, 2xx/3xx/4xx/5xx counts, and
p50/p90/p99 latency at 1h, 6h, 24h, 3d, 7d, 15d, 30d, and all time. Resource
detail includes type, method/tool, description, MIME type, x402 version, tags,
declared input/output examples and schemas, every accepts option (scheme,
network, atomic price, asset, payTo, timeout, extra), active version, origin,
proof, and liveness.

Unlike the reference implementation, the default does not retain arbitrary live
request/response bodies, authorization headers, or query secrets. It exposes
seller-declared examples and bounded status/content-type invocation metadata.
This preserves the useful dashboard surface without making high-volume
micropayments a sensitive payload warehouse.

All aggregates come from this facilitator's confirmed and failed settlement
records and its catalog observations. They are not falsely presented as a
network-wide chain index. A network-wide scanner would be a separate optional
indexing product and is not required by the one-service deployment.

Addresses, transaction hashes, and amounts are retained because they are needed
for audit and explorer equivalence. API responses obey configured redaction and
retention policy without changing immutable on-chain facts.
