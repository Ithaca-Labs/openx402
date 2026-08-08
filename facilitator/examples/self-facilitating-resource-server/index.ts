import express from "express";
import { createEmbeddedFacilitator } from "@openx402/stellar-facilitator";
import { paymentMiddleware, setSettlementOverrides, x402ResourceServer } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { UptoStellarServerScheme } from "@openx402/stellar-upto";

const network = "stellar:testnet";
const payTo = process.env.SELLER_PAY_TO;
const asset = process.env.STELLAR_ASSET;
if (!payTo || !asset) throw new Error("SELLER_PAY_TO and STELLAR_ASSET are required");

const facilitator = await createEmbeddedFacilitator();
const resourceServer = new x402ResourceServer(facilitator)
  .register(network, new ExactStellarScheme())
  .register(network, new UptoStellarServerScheme());

const app = express();
app.use(paymentMiddleware({
  "GET /weather": {
    accepts: [{
      scheme: "exact",
      price: { asset, amount: "1000" },
      network,
      payTo,
      maxTimeoutSeconds: 60,
    }],
    description: "Returns current weather for a city.",
    mimeType: "application/json",
  },
  "GET /metered": {
    accepts: [{
      scheme: "upto",
      price: { asset, amount: "10000" },
      network,
      payTo,
      maxTimeoutSeconds: 60,
    }],
    description: "Returns a metered response and settles the measured amount.",
    mimeType: "application/json",
  },
}, resourceServer));

app.get("/weather", (_req, res) => res.json({ city: "Mumbai", temperature: 29 }));
app.get("/metered", (_req, res) => {
  setSettlementOverrides(res, { amount: "3000" });
  res.json({ unitsUsed: 3000 });
});

const server = app.listen(Number(process.env.PORT ?? 4021));
async function shutdown(): Promise<void> {
  server.close();
  await facilitator.close();
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
