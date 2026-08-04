import { randomInt } from "node:crypto";
import express from "express";
import { createX402Seller, resolveSellerPublicUrl } from "@openx402/bazaar-sdk";
import { stellarAssets } from "@openx402/bazaar-sdk/stellar";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";

const PORT = Number(process.env.PORT ?? 4788);
const NETWORK = "stellar:testnet" as const;
const FACILITATOR_URL = process.env.FACILITATOR_URL
  ?? "https://facilitator-production-8430.up.railway.app";
const PAY_TO = process.env.SELLER_PAY_TO;

if (!PAY_TO) throw new Error("SELLER_PAY_TO is required");

const seller = createX402Seller({
  // SELLER_PUBLIC_URL (an https tunnel origin) or RAILWAY_PUBLIC_DOMAIN, if either is
  // set; otherwise falls back to the local loopback origin below, which lets this demo
  // run standalone but means the facilitator can't reach it to catalog the resource.
  publicUrl: resolveSellerPublicUrl({ localDevelopmentUrl: `http://127.0.0.1:${PORT}` }),
  network: NETWORK,
  payTo: PAY_TO,
  assets: {
    // Stellar testnet native XLM SAC. Charging it keeps this self-contained because
    // the existing test identities do not need a separate token faucet or trustline.
    XLM: stellarAssets.testnet.XLM,
  },
  defaults: {
    scheme: "exact",
    maxTimeoutSeconds: 60,
    feesSponsored: true,
  },
});

const play = seller.post("/play", {
  payment: { asset: "XLM", amount: "1000" },
  discovery: {
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

const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitator)
  .register(NETWORK, new ExactStellarScheme());

const app = express();
app.use(express.json({ limit: "16kb" }));
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use(paymentMiddleware(play.paymentConfig, resourceServer));

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

app.post(play.path, (req, res) => {
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
    localUrl: `http://127.0.0.1:${PORT}${play.path}`,
    publicUrl: play.resourceUrl,
    facilitator: FACILITATOR_URL,
    payTo: PAY_TO,
    asset: stellarAssets.testnet.XLM,
    amount: "1000",
  }, null, 2));
});
