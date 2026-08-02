import { randomInt } from "node:crypto";
import express from "express";
import { bazaar } from "@openx402/bazaar-sdk";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";

const PORT = Number(process.env.PORT ?? 4788);
const NETWORK = "stellar:testnet" as const;
const FACILITATOR_URL = process.env.FACILITATOR_URL
  ?? "https://facilitator-production-8430.up.railway.app";
const PUBLIC_URL = process.env.SELLER_PUBLIC_URL?.replace(/\/$/, "");
const PAY_TO = process.env.SELLER_PAY_TO;

// Stellar testnet native XLM SAC. Charging it keeps this self-contained because
// the existing test identities do not need a separate token faucet or trustline.
const XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const PRICE_ATOMIC = "1000";

if (!PUBLIC_URL || !PUBLIC_URL.startsWith("https://")) {
  throw new Error("SELLER_PUBLIC_URL must be the public HTTPS tunnel origin");
}
if (!PAY_TO) throw new Error("SELLER_PAY_TO is required");

const metadata = bazaar.http({
  description: "Plays one round of rock, paper, scissors against the server.",
  serviceName: "Rock Paper Scissors",
  tags: ["game", "rps", "random"],
  method: "POST",
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

const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitator)
  .register(NETWORK, new ExactStellarScheme());

const app = express();
app.use(express.json({ limit: "16kb" }));
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use(paymentMiddleware({
  "POST /play": {
    accepts: [{
      scheme: "exact",
      network: NETWORK,
      price: { asset: XLM_SAC, amount: PRICE_ATOMIC },
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
      extra: { areFeesSponsored: true },
    }],
    resource: `${PUBLIC_URL}/play`,
    description: metadata.resource.description,
    serviceName: metadata.resource.serviceName,
    tags: metadata.resource.tags,
    mimeType: "application/json",
    extensions: metadata.extensions,
  },
}, resourceServer));

const moves = ["rock", "paper", "scissors"] as const;
type Move = typeof moves[number];

function isMove(value: unknown): value is Move {
  return typeof value === "string" && moves.includes(value as Move);
}

function outcome(player: Move, server: Move): "win" | "lose" | "draw" {
  if (player === server) return "draw";
  if (
    (player === "rock" && server === "scissors")
    || (player === "paper" && server === "rock")
    || (player === "scissors" && server === "paper")
  ) return "win";
  return "lose";
}

app.post("/play", (req, res) => {
  if (!isMove(req.body?.move)) {
    res.status(400).json({ error: "move must be rock, paper, or scissors" });
    return;
  }
  const server = moves[randomInt(moves.length)]!;
  res.json({ player: req.body.move, server, result: outcome(req.body.move, server) });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({
    status: "listening",
    localUrl: `http://127.0.0.1:${PORT}/play`,
    publicUrl: `${PUBLIC_URL}/play`,
    facilitator: FACILITATOR_URL,
    payTo: PAY_TO,
    asset: XLM_SAC,
    amount: PRICE_ATOMIC,
  }, null, 2));
});
