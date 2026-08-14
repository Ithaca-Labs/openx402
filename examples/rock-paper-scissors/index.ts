import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { createX402Seller, resolveSellerPublicUrl } from "@openx402/bazaar-sdk";
import { stellarAssets } from "@openx402/bazaar-sdk/stellar";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";

const PORT = Number(process.env.PORT ?? 4788);
const NETWORK = "stellar:testnet" as const;
const FACILITATOR_URL = process.env.FACILITATOR_URL
  ?? "https://facilitator.stellarx402.xyz";
const WALLETS_FILE = fileURLToPath(new URL("./wallets.public.json", import.meta.url));

type PublicWallet = { id: number; address: string };

const wallets = JSON.parse(readFileSync(WALLETS_FILE, "utf8")) as PublicWallet[];
if (wallets.length !== 15 || new Set(wallets.map(wallet => wallet.address)).size !== 15) {
  throw new Error("wallets.public.json must contain fifteen distinct wallets; run npm run wallets:setup");
}

const definitions = [
  ["/api/time", "Meridian Clock", "1200"],
  ["/api/uuid", "Nova Identifier", "2700"],
  ["/api/dice", "Chance Engine", "4300"],
  ["/api/coin", "Binary Toss", "900"],
  ["/api/number", "Integer Bloom", "3100"],
  ["/api/color", "Chroma Sample", "1800"],
  ["/api/quote", "Axiom Fragment", "5200"],
  ["/api/token", "Cipher Seed", "2400"],
  ["/api/status", "Service Heartbeat", "3700"],
  ["/api/version", "Build Signature", "1500"],
  ["/api/entropy", "Noise Reservoir", "6600"],
  ["/api/temperature", "Climate Pulse", "750"],
  ["/api/coordinate", "Atlas Point", "4600"],
  ["/api/mood", "Sentiment Echo", "2900"],
  ["/api/word", "Lexicon Drift", "6100"],
] as const;

const seller = createX402Seller({
  publicUrl: resolveSellerPublicUrl({ localDevelopmentUrl: `http://127.0.0.1:${PORT}` }),
  network: NETWORK,
  assets: { USDC: stellarAssets.testnet.USDC },
  defaults: {
    scheme: "exact",
    // The client currently measures six-second ledgers while the hosted
    // facilitator validates against five-second ledgers. Its testnet maximum
    // provides enough tolerance for that estimate and RPC-head skew.
    maxTimeoutSeconds: 300,
    feesSponsored: true,
  },
});

const routes = definitions.map(([path, name, amount], index) =>
  seller.get(path, {
    payment: {
      asset: "USDC",
      amount,
      payTo: wallets[index]!.address,
    },
    discovery: {
      name,
      description: `${name} test API`,
      tags: ["demo", "x402", "stellar"],
      output: {
        description: `${name} JSON result`,
        example: { result: "example" },
      },
    },
  })
);

const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitator)
  .register(NETWORK, new ExactStellarScheme());

const app = express();
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use(paymentMiddleware(
  Object.assign({}, ...routes.map(route => route.paymentConfig)),
  resourceServer,
));

const quotes = [
  "Simplicity is the soul of efficiency.",
  "Make it work, make it right, make it fast.",
  "Programs must be written for people to read.",
] as const;

const results: ReadonlyArray<() => unknown> = [
  () => new Date().toISOString(),
  () => randomUUID(),
  () => randomInt(1, 7),
  () => randomInt(2) === 0 ? "heads" : "tails",
  () => randomInt(1_000_000),
  () => `#${randomBytes(3).toString("hex")}`,
  () => quotes[randomInt(quotes.length)]!,
  () => randomBytes(16).toString("hex"),
  () => ({ status: "ok", uptimeSeconds: Math.floor(process.uptime()) }),
  () => "0.1.0",
  () => randomBytes(24).toString("hex"),
  () => Number((randomInt(-200, 451) / 10).toFixed(1)),
  () => ({ latitude: randomInt(-9000, 9001) / 100, longitude: randomInt(-18000, 18001) / 100 }),
  () => ["calm", "curious", "focused", "bright", "restless"][randomInt(5)]!,
  () => ["ember", "harbor", "lattice", "orbit", "willow"][randomInt(5)]!,
];

routes.forEach((route, index) => {
  app.get(route.path, (_req, res) => res.json({ result: results[index]!() }));
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({
    status: "listening",
    localOrigin: `http://127.0.0.1:${PORT}`,
    publicOrigin: seller.config.publicUrl,
    facilitator: FACILITATOR_URL,
    network: NETWORK,
    asset: stellarAssets.testnet.USDC,
    resources: routes.map((route, index) => ({
      path: route.path,
      amount: definitions[index]![2],
      payTo: wallets[index]!.address,
    })),
  }, null, 2));
});
