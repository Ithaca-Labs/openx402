# Seller API: before and after `createX402Seller`



## Previous pattern: declare the route in three places

```ts
import { bazaar } from "@openx402/bazaar-sdk";

// ISSUE A — hand-rolled public-URL logic: trailing slash stripped manually,
// https enforced manually, RAILWAY_PUBLIC_DOMAIN never considered at all.
const PUBLIC_URL = process.env.SELLER_PUBLIC_URL?.replace(/\/$/, "");
const PAY_TO = process.env.SELLER_PAY_TO;

// ISSUE B — raw, opaque asset contract ID. Nothing here checks that this is
// actually the right address for `NETWORK`; a copy-paste from the wrong
// network's docs would silently compile and silently misprice the route.
const XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const PRICE_ATOMIC = "1000";

if (!PUBLIC_URL || !PUBLIC_URL.startsWith("https://")) {
  // ISSUE A (cont.) — this throws at import time. A local run with no tunnel
  // configured can't start the server at all, instead of degrading gracefully.
  throw new Error("SELLER_PUBLIC_URL must be the public HTTPS tunnel origin");
}
if (!PAY_TO) throw new Error("SELLER_PAY_TO is required");

// 1. Discovery metadata — ISSUE C (1 of 3): method declared here...
const metadata = bazaar.http({
  description: "Plays one round of rock, paper, scissors against the server.",
  serviceName: "Rock Paper Scissors",
  tags: ["game", "rps", "random"],
  method: "POST", // <- method, 1st time
  body: {
    move: {
      type: "string",
      description: "Player move: rock, paper, or scissors.",
      enum: ["rock", "paper", "scissors"],
      required: true,
      example: "rock",
    },
  },
  output: {
    type: "json",
    description: "The player move, server move, and round result.",
    example: { player: "rock", server: "scissors", result: "win" },
  },
});

// 2. Payment route config
app.use(paymentMiddleware({
  // ISSUE C (2 of 3) — method + path retyped as a string key. Nothing checks
  // this agrees with `method: "POST"` above or the `app.post` call below.
  "POST /play": {
    accepts: [{
      // ISSUE D — payment defaults (scheme, timeout, fee sponsorship) are
      // hardcoded per route. A seller with 10 routes retypes these 10 times;
      // changing fee-sponsorship policy means editing every route by hand.
      scheme: "exact",
      network: NETWORK,
      price: { asset: XLM_SAC, amount: PRICE_ATOMIC },
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
      extra: { areFeesSponsored: true },
    }],
    // ISSUE A (cont.) — path retyped a 3rd/4th time via string concatenation.
    resource: `${PUBLIC_URL}/play`,
    // ISSUE E — metadata copied by hand off the object built in step 1.
    // If `description` changes above and this copy is forgotten, the 402
    // response and the Bazaar catalog entry silently disagree with no error.
    description: metadata.resource.description,
    serviceName: metadata.resource.serviceName,
    tags: metadata.resource.tags,
    mimeType: "application/json",
    extensions: metadata.extensions,
  },
}, resourceServer));

// 3. Framework route — ISSUE C (3 of 3): method + path retyped a third time.
// Typo "/pIay" here vs. "POST /play" above → payment enforced on a route that
// doesn't exist, and the real handler serves for free with no error anywhere.
app.post("/play", (req, res) => { /* handler */ });
```


## New pattern: declare the route once

```ts
import { createX402Seller, resolveSellerPublicUrl } from "@openx402/bazaar-sdk";
import { stellarAssets } from "@openx402/bazaar-sdk/stellar";

const seller = createX402Seller({
  // resolves ISSUE A — precedence + https + trailing-slash handling lives in
  // one tested function; degrades to localDevelopmentUrl instead of throwing.
  publicUrl: resolveSellerPublicUrl({ localDevelopmentUrl: `http://127.0.0.1:${PORT}` }),
  network: NETWORK,
  payTo: PAY_TO,
  assets: {
    // resolves ISSUE B — the address is computed from the network passphrase
    // via @stellar/stellar-sdk, not hand-copied; "XLM" is what routes refer to.
    XLM: stellarAssets.testnet.XLM,
  },
  defaults: {
    // resolves ISSUE D — set once, inherited by every route below.
    scheme: "exact",
    maxTimeoutSeconds: 60,
    feesSponsored: true,
  },
});

// resolves ISSUE C — method ("post") and path ("/play") appear exactly once,
// right here. play.routeKey/play.path below are *derived*, never retyped.
const play = seller.post("/play", {
  payment: { asset: "XLM", amount: "1000" }, // <- alias from `assets` above, not a raw address
  discovery: {
    // resolves ISSUE E — this is the only place description/tags/etc. are
    // written; it flows into both the 402 response and the Bazaar catalog.
    name: "Rock Paper Scissors",
    description: "Plays one round of rock, paper, scissors against the server.",
    tags: ["game", "rps", "random"],
    body: {
      move: {
        type: "string",
        description: "Player move: rock, paper, or scissors.",
        enum: ["rock", "paper", "scissors"],
        required: true,
        example: "rock",
      },
    },
    output: {
      description: "The player move, server move, and round result.",
      example: { player: "rock", server: "scissors", result: "win" },
    },
  },
});

app.use(paymentMiddleware(play.paymentConfig, resourceServer)); // <- path derived, ISSUE C stays resolved
app.post(play.path, (req, res) => { /* handler */ });            // <- path derived, ISSUE C stays resolved
```

Method and path are typed once, at `seller.post("/play", ...)`. Everything
downstream — `play.paymentConfig`'s route key, `play.path` for the framework
route, `play.resourceUrl`, and `extensions.bazaar` — is derived from that one
call, not retyped.



## Compatibility

Both patterns are fully supported side by side. `createX402Seller` is not a
replacement for `bazaar.http`/`bazaar.mcp` — it's built on top of them and
delegates to them internally, so existing code using the low-level helpers
needs no migration, and either pattern can be used per-route in the same
codebase.
