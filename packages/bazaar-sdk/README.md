# @openx402/bazaar-sdk

Typed seller helpers that compile readable configuration into the official x402
**Bazaar** discovery metadata. You never hand-write Bazaar JSON or JSON Schema
for a normal HTTP endpoint.

The helpers delegate to `@x402/extensions/bazaar`'s `declareDiscoveryExtension`,
so the emitted `extensions.bazaar` object is built by upstream code. No
proprietary field is added and no new wire format is invented.

Apache-2.0. The whole dependency tree is `@x402/core` and `@x402/extensions`,
both Apache-2.0.

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
