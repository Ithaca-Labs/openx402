import { randomBytes, randomInt } from "node:crypto";
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
if (wallets.length !== 17 || new Set(wallets.map(wallet => wallet.address)).size !== 17) {
  throw new Error("wallets.public.json must contain seventeen distinct wallets; run npm run wallets:setup");
}

const definitions = [
  ["/api/sunrise", "Solar Almanac", "1200", "Generates a compact daylight schedule with UTC sunrise, solar noon, and sunset."],
  ["/api/slug", "Slugsmith", "2700", "Creates clean URL-ready slugs from generated multiword phrases."],
  ["/api/lottery", "Lucky Draw", "4300", "Returns a sorted, duplicate-free set of lottery-style numbers."],
  ["/api/boolean", "Decision Bit", "900", "Produces a random yes-or-no decision with a confidence score."],
  ["/api/sequence", "Sequence Lab", "3100", "Builds bounded integer sequences for fixtures, games, and simulations."],
  ["/api/palette", "Palette Studio", "1800", "Creates a five-color hexadecimal palette for prototypes and data visuals."],
  ["/api/proverb", "Proverb Archive", "5200", "Returns a concise proverb together with its cultural source."],
  ["/api/nonce", "Nonce Vault", "2400", "Generates cryptographically secure nonces for disposable workflows."],
  ["/api/heartbeat", "Node Heartbeat", "3700", "Reports process health, uptime, and the current observation time."],
  ["/api/semver", "Version Compass", "1500", "Generates valid semantic versions for release and compatibility fixtures."],
  ["/api/noise", "Noise Source", "6600", "Returns cryptographically secure random bytes and their measured bit length."],
  ["/api/climate", "Climate Snapshot", "750", "Produces a compact synthetic weather reading with temperature and humidity."],
  ["/api/geopoint", "Geo Pin", "4600", "Generates a valid latitude and longitude pair for maps and test fixtures."],
  ["/api/feeling", "Mood Barometer", "2900", "Returns a mood label and intensity score for conversational prototypes."],
  ["/api/vocabulary", "Lexicon Pick", "6100", "Selects a distinctive word with a short plain-language definition."],
  ["/api/gradient", "Spectrum Blend", "3400", "Creates a CSS-ready two-color linear gradient with a randomized angle."],
  ["/api/countdown", "Countdown Relay", "4800", "Creates a bounded countdown with start and projected completion timestamps."],
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

const routes = definitions.map(([path, name, amount, description], index) =>
  seller.get(path, {
    payment: {
      asset: "USDC",
      amount,
      payTo: wallets[index]!.address,
    },
    discovery: {
      name,
      description,
      tags: ["demo", "x402", "stellar"],
      output: {
        description: `${name} response payload`,
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

const proverbs = [
  { text: "A smooth sea never made a skilled sailor.", source: "English proverb" },
  { text: "Little by little, a little becomes a lot.", source: "Tanzanian proverb" },
  { text: "The best time to plant a tree was years ago; the next best time is now.", source: "Modern proverb" },
] as const;

const lexicon = [
  { word: "sonder", definition: "the realization that every stranger has a life as vivid as your own" },
  { word: "petrichor", definition: "the earthy scent that follows rain on dry ground" },
  { word: "susurrus", definition: "a soft whispering or rustling sound" },
  { word: "apricity", definition: "the warmth of sunlight during winter" },
  { word: "liminal", definition: "occupying a threshold or transitional space" },
] as const;

const moods = ["serene", "curious", "buoyant", "focused", "reflective"] as const;
const slugWords = ["amber", "atlas", "bright", "harbor", "lunar", "meadow", "orbit", "quiet", "signal", "willow"] as const;

function isoAfter(seconds: number): string {
  return new Date(Date.now() + seconds * 1_000).toISOString();
}

const results: ReadonlyArray<() => unknown> = [
  () => {
    const sunriseHour = randomInt(5, 8);
    const sunsetHour = randomInt(17, 21);
    const date = new Date().toISOString().slice(0, 10);
    return { date, sunrise: `${date}T0${sunriseHour}:00:00Z`, solarNoon: `${date}T12:00:00Z`, sunset: `${date}T${sunsetHour}:00:00Z` };
  },
  () => Array.from({ length: 3 }, () => slugWords[randomInt(slugWords.length)]).join("-"),
  () => {
    const numbers = new Set<number>();
    while (numbers.size < 6) numbers.add(randomInt(1, 50));
    return { numbers: [...numbers].sort((a, b) => a - b) };
  },
  () => ({ decision: randomInt(2) === 1, confidence: randomInt(51, 100) }),
  () => Array.from({ length: randomInt(4, 9) }, () => randomInt(-100, 101)),
  () => Array.from({ length: 5 }, () => `#${randomBytes(3).toString("hex")}`),
  () => proverbs[randomInt(proverbs.length)]!,
  () => ({ nonce: randomBytes(24).toString("hex"), bytes: 24 }),
  () => ({ status: "healthy", uptimeSeconds: Math.floor(process.uptime()), observedAt: new Date().toISOString() }),
  () => `${randomInt(1, 10)}.${randomInt(10)}.${randomInt(100)}`,
  () => ({ hex: randomBytes(32).toString("hex"), bits: 256 }),
  () => ({ temperatureCelsius: Number((randomInt(-100, 401) / 10).toFixed(1)), humidityPercent: randomInt(20, 96) }),
  () => ({ latitude: randomInt(-9_000_000, 9_000_001) / 100_000, longitude: randomInt(-18_000_000, 18_000_001) / 100_000 }),
  () => ({ mood: moods[randomInt(moods.length)]!, intensity: randomInt(1, 101) }),
  () => lexicon[randomInt(lexicon.length)]!,
  () => `linear-gradient(${randomInt(360)}deg, #${randomBytes(3).toString("hex")}, #${randomBytes(3).toString("hex")})`,
  () => {
    const seconds = randomInt(30, 3601);
    return { seconds, startedAt: new Date().toISOString(), completesAt: isoAfter(seconds) };
  },
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
