# @openx402/bazaar-sdk

Typed seller helpers that compile readable configuration into the official x402
**Bazaar** discovery metadata. You never hand-write Bazaar JSON or JSON Schema
for a normal HTTP endpoint.

The helpers delegate to `@x402/extensions/bazaar`'s `declareDiscoveryExtension`,
so the emitted `extensions.bazaar` object is built by upstream code. No
proprietary field is added and no new wire format is invented.

Apache-2.0. The root package's whole dependency tree is `@x402/core` and
`@x402/extensions`, both Apache-2.0.

## Two layers

```
@openx402/bazaar-sdk
├── bazaar.http()             low-level metadata helper — one endpoint's discovery metadata
├── bazaar.mcp()               low-level metadata helper — one MCP tool's discovery metadata
├── createX402Seller()         server-level defaults (network, payTo, assets, timeouts, fee sponsorship)
│   └── seller.get/post/…()    a complete resource: metadata + payment config + framework wiring, one call
│   └── seller.tool()          a complete MCP tool: metadata + a resolved payment option, one call
├── resolveSellerPublicUrl()   explicit, testable seller-origin resolution (Railway-aware)
├── fromZod()                  @openx402/bazaar-sdk/zod — reuse an existing Zod schema, optional peer dep
└── stellarAssets              @openx402/bazaar-sdk/stellar — verified Stellar asset addresses, optional peer dep
```

`bazaar.http()`/`bazaar.mcp()` describe one payload shape. `createX402Seller()`
sits on top of them: it is the single place a route's method, path, payment
terms and discovery metadata are declared, and it compiles to the exact same
`declareDiscoveryExtension` output plus a canonical `@x402/core` `RouteConfig`
— nothing proprietary, nothing hand-assembled twice. Both layers stay fully
supported; reach for `bazaar.http()`/`bazaar.mcp()` directly only when you need
to build a `PaymentRequired` body by hand instead of going through
`paymentMiddleware`.

## Install

```sh
npm install @openx402/bazaar-sdk
```

## HTTP endpoints

```ts
import { bazaar } from "@openx402/bazaar-sdk";

const weather = bazaar.http({
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

Use the two halves directly in your 402 response:

```ts
res.status(402).json({
  x402Version: 2,
  error: "Payment required",
  resource: { url: "https://api.example.com/weather", ...weather.resource },
  accepts: [ /* your payment requirements */ ],
  extensions: { ...weather.extensions },
});
```

`weather.compile()` returns `{ resource, extensions }` as one canonical object
for snapshot tests and framework adapters.

### Supported HTTP inputs

| Field | Compiles to |
| --- | --- |
| `description`, `serviceName`, `tags`, `iconUrl`, `mimeType` | top-level `resource` fields |
| `method` | `info.input.method` |
| `query` | `info.input.queryParams` examples + `schema…input.properties.queryParams` |
| `path` | `info.input.pathParams` examples + `schema…input.properties.pathParams` |
| `body` (POST/PUT/PATCH) | `info.input.body` + `schema…input.properties.body`, with `bodyType` |
| `headers` | `info.input.headers` + `schema…input.properties.headers` |
| parameter `description`, `enum`, `format`, `items`, `default` | JSON Schema keywords on that property |
| parameter `required: true` | the schema's `required` array |
| parameter `example` | the declared example value for that parameter |
| `output.example` | `info.output.example` |
| `output.type` | `info.output.type` (defaults to `json`) |
| `output.schema` | `schema.properties.output.properties.example` |
| `output.description` | JSON Schema `description` on `schema.properties.output` |

## MCP tools

```ts
const analysis = bazaar.mcp({
  toolName: "financial_analysis",
  description: "Analyzes a public company using financial data.",
  transport: "streamable-http",
  inputSchema: {
    type: "object",
    properties: {
      ticker: { type: "string", description: "Stock ticker symbol, such as AAPL." },
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

The tool's existing `inputSchema` is reused **unchanged**. Parameter
descriptions stay in `inputSchema.properties.<name>.description`; this helper
does not maintain a second schema language.

The catalog identity of an MCP tool is the tuple (`resource.url`,
`info.input.toolName`), because MCP multiplexes many tools over one endpoint.
The tool `description` stays on the tool (`info.input.description`) and is not
copied onto the service `resource` block.

## Declaring a full resource with `createX402Seller`

Without this layer, a seller declares the same route in three places: once for
`bazaar.http()`, once for `paymentMiddleware`'s route config, and once for the
framework route (`app.post(...)`). Method and path get typed twice, metadata
gets copied field by field, and the resource URL gets assembled by hand. It's
easy for the handler, the payment requirements and the discovery declaration
to quietly drift apart.

`createX402Seller` fixes that by making the route the single source of truth.
Configure server-wide defaults once:

```ts
import { createX402Seller, resolveSellerPublicUrl } from "@openx402/bazaar-sdk";
import { stellarAssets } from "@openx402/bazaar-sdk/stellar";

const seller = createX402Seller({
  publicUrl: resolveSellerPublicUrl({ localDevelopmentUrl: "http://localhost:4788" }),
  network: "stellar:testnet",
  payTo: process.env.SELLER_PAY_TO,
  assets: {
    XLM: stellarAssets.testnet.XLM,
  },
  defaults: {
    scheme: "exact",
    maxTimeoutSeconds: 60,
    feesSponsored: true,
  },
});
```

Then declare one complete resource:

```ts
const weather = seller.get("/weather", {
  payment: {
    asset: "XLM",
    amount: "1000",
  },
  discovery: {
    name: "Weather API",
    description: "Returns current weather for a city.",
    tags: ["weather", "forecast"],
    query: {
      city: {
        type: "string",
        description: "City name, such as Mumbai or London.",
        required: true,
        example: "Mumbai",
      },
    },
    output: {
      description: "Current weather conditions.",
      example: { city: "Mumbai", temperature: 29, condition: "Sunny" },
    },
  },
});
```

Framework wiring needs no manual metadata spreading:

```ts
app.use(paymentMiddleware(weather.paymentConfig, resourceServer));
app.get(weather.path, weatherHandler);
```

`weather.paymentConfig` is `{ "GET /weather": RouteConfig }` — a *keyed*
`RoutesConfig`, not a bare `RouteConfig`. `paymentMiddleware` treats a bare
`RouteConfig` as a wildcard that matches every method and path, which would
silently payment-gate the whole app (including `/health`); the keyed form
protects exactly `GET /weather` no matter how `app.use` is called, and several
routes' configs can be merged with a plain object spread:
`paymentMiddleware({ ...weather.paymentConfig, ...play.paymentConfig }, resourceServer)`.

`createX402Seller` only compiles configuration. It never holds keys, signs
transactions, submits payments, or talks to a facilitator — construct your own
`x402ResourceServer` exactly as you would without this layer (see
`examples/rock-paper-scissors/index.ts`) and pass it to `paymentMiddleware`.

### What a route returns

| Field | Type | Description |
| --- | --- | --- |
| `method` | `HttpMethod` | The verb, from the `seller.get`/`.post`/… call that produced it. |
| `path` | `string` | The route path, as declared. |
| `routeKey` | `string` | `"METHOD /path"`, the exact `RoutesConfig` key. |
| `resourceUrl` | `string` | `publicUrl + path`. |
| `paymentConfig` | `{ [routeKey]: RouteConfig }` | Ready to spread into `paymentMiddleware`. |
| `resource` | `ServiceMetadataConfig` | Merges into the 402 `resource` object. |
| `extensions` | `{ bazaar: DiscoveryExtension }` | The compiled, official Bazaar extension. |
| `compile()` | `() => { resource, extensions }` | Canonical object for snapshot tests. |

### Defaults and overrides

`network`, `payTo`, `defaults.scheme`, `defaults.maxTimeoutSeconds` and
`defaults.feesSponsored` set server-wide values; every route may override any
of them under `payment`. `payment.asset` is always an alias into
`createX402Seller({ assets })` — raw asset addresses are never accepted at the
route level, so a typo'd or unregistered asset fails at startup instead of
producing a route that silently prices in the wrong token. `payment.amount` is
always an atomic-unit string (or `bigint`); floating-point amounts are never
accepted.

Startup-time rejections (`SellerConfigError`, with an `issues: string[]` like
`BazaarConfigError`) cover: an unknown asset alias, an empty/negative/decimal
amount, an invalid or traversal-unsafe path, a missing `payTo` or `network`
after merging defaults and overrides, an unrecognized scheme family, a
malformed `publicUrl`, and declaring the same `"METHOD /path"` (or the same
MCP tool at the same path) twice.

### `resolveSellerPublicUrl`

Resolves the seller's public origin, in order, and never touches a request's
`Host` header (client-controlled, never the canonical resource origin):

1. `SELLER_PUBLIC_URL` — explicit override, must be `https`.
2. `https://${RAILWAY_PUBLIC_DOMAIN}` — automatic on Railway; no seller
   variable needs to be set there at all.
3. `localDevelopmentUrl` — an explicit opt-in you pass in code, the only
   source allowed to resolve to a non-`https` origin.

```ts
resolveSellerPublicUrl({ localDevelopmentUrl: "http://localhost:4788" });
```

Trailing slashes are normalized away; a non-`http(s)` scheme or a malformed
origin throws `SellerConfigError` immediately rather than producing a
resource URL a facilitator would later reject.

## Reusing an existing Zod schema

`@openx402/bazaar-sdk/zod` is a separate entry point — installing
`@openx402/bazaar-sdk` alone never requires Zod, and the root import never
touches it.

```ts
import { z } from "zod/v4"; // or "zod" directly on Zod ^4.0.0
import { fromZod } from "@openx402/bazaar-sdk/zod";

const query = z.object({
  city: z.string().describe("City name, such as Mumbai or London."),
  units: z.enum(["celsius", "fahrenheit"]).describe("Temperature units.").optional(),
});

seller.get("/weather", {
  payment: { asset: "XLM", amount: "1000" },
  discovery: {
    description: "Returns current weather for a city.",
    query: fromZod(query, { example: { city: "Mumbai", units: "celsius" } }),
    output: { example: { city: "Mumbai", temperature: 29 } },
  },
});
```

`fromZod` requires **Zod 4**: it calls `toJSONSchema`, which does not exist on
Zod 3's classic API. If your project is on the Zod 3.25+ transitional release
(as this repo is), build the schema from the `zod/v4` subpath rather than the
package root; on Zod `^4.0.0` the package root already is the v4 API. It is
not possible to support Zod's pre-3.25 classic API robustly here, so this
adapter does not pretend to.

`fromZod` reuses `.describe()`, `z.enum()`, `.optional()`/required inference
and nested `z.object()`s exactly as Zod's own JSON Schema conversion produces
them — no second description language is maintained. When you pass `example`,
it is validated against the schema immediately (`schema.safeParse`), so a
stale example fails at startup rather than shipping a discovery entry an
agent can't actually call. The result is a `CompiledInputSchema` (`{ schema,
example }`) accepted anywhere `query`/`body` accepts a `ParameterMap`, in both
`bazaar.http()` and `seller.get`/`.post`/etc.

## Stellar asset registry

`@openx402/bazaar-sdk/stellar` is likewise a separate entry point — it is the
only place `@x402/stellar`/`@stellar/stellar-sdk` are touched.

```ts
import { stellarAssets } from "@openx402/bazaar-sdk/stellar";

stellarAssets.testnet.XLM; // native XLM SAC address on stellar:testnet
stellarAssets.testnet.USDC;
stellarAssets.pubnet.XLM;  // native XLM SAC address on stellar:pubnet
stellarAssets.pubnet.USDC;
```

The native XLM Stellar Asset Contract address is **not** a fixed constant —
it's derived from the network passphrase — so `stellarAssets` computes it with
`@stellar/stellar-sdk`'s own `Asset.native().contractId(passphrase)` rather
than hardcoding a value that would silently be wrong on a different network.
USDC addresses are read directly from `@x402/stellar`'s own exported
constants. There is no mainnet/pubnet inference and no way to reach an asset
address that isn't in this table: a seller who needs another asset passes its
address directly as an `assets` value in `createX402Seller`.

## Runtime validation

Both helpers throw `BazaarConfigError` with a list of issues when the
configuration would be dropped by a conforming facilitator — an over-long
`serviceName`, a `data:` `iconUrl`, duplicate or non-ASCII tags, a `body` on a
`GET`, an `example` outside its own `enum`, and so on. You find out at startup
instead of after your first paid request is silently soft-dropped.

## Compatibility guarantee

The test suite asserts `JSON.stringify(helperOutput) === JSON.stringify(
declareDiscoveryExtension(equivalentOfficialConfig))` for HTTP query, HTTP body,
path parameters and MCP, and validates every produced extension with the
official `validateDiscoveryExtension`.

Two fields are composed after the official builder returns, because the official
builder has no slot for them even though the official wire **types** and the
specification examples define them:

- `info.input.headers` plus its matching schema property;
- `info.output.type` when it is not `json`, and the JSON Schema `description`
  annotation on the `output` subschema.

Both are written in the exact official shape, and both `info` and `schema` are
updated together so the extension stays valid under the builder's
`additionalProperties: false`. When you declare neither, the output is
byte-identical to the official builder's.

`createX402Seller`'s route builder is a thin compiler on top of `bazaar.http`
and `bazaar.mcp`, not a reimplementation: `seller.get`/`.post`/etc. call
`bazaar.http` internally with the merged, resolved configuration, so a route
built through `createX402Seller` produces an `extensions.bazaar` byte-identical
to the equivalent manually assembled `bazaar.http(...)` call. The test suite
asserts this directly, alongside the resolved `RouteConfig.accepts` matching
the official `PaymentOption` shape from `@x402/core/server`.

## Development

The package is independently installable and testable from this directory:

```sh
npm ci --workspaces=false
npm test
npm run typecheck
npm run build
```

Inspect the public artifact before publishing:

```sh
npm pack --dry-run --workspaces=false
```

Publishing runs the test and typecheck gates, rebuilds `dist`, and uses the
public access configured in `package.json`:

```sh
npm publish --workspaces=false
```
