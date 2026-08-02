import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";

const NETWORK = "stellar:testnet" as const;
const SELLER_URL = process.env.SELLER_URL;
const BUYER_SECRET_KEY = process.env.BUYER_SECRET_KEY;

if (!SELLER_URL) throw new Error("SELLER_URL is required");
if (!BUYER_SECRET_KEY) throw new Error("BUYER_SECRET_KEY is required");

const signer = createEd25519Signer(BUYER_SECRET_KEY, NETWORK);
const paymentClient = new x402Client().register(NETWORK, new ExactStellarScheme(signer));
const httpClient = new x402HTTPClient(paymentClient);
const requestBody = JSON.stringify({ move: "rock" });

const unpaid = await fetch(SELLER_URL, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: requestBody,
});
if (unpaid.status !== 402) {
  throw new Error(`expected 402, received ${unpaid.status}: ${await unpaid.text()}`);
}

const required = httpClient.getPaymentRequiredResponse(
  name => unpaid.headers.get(name),
  await unpaid.json(),
);
const accepted = required.accepts[0];
if (!accepted) throw new Error("seller returned no payment option");

const payload = await httpClient.createPaymentPayload(required);
const paymentHeaders = httpClient.encodePaymentSignatureHeader(payload);
const paid = await fetch(SELLER_URL, {
  method: "POST",
  headers: { "content-type": "application/json", ...paymentHeaders },
  body: requestBody,
});
if (!paid.ok) throw new Error(`paid request failed ${paid.status}: ${await paid.text()}`);

const settlement = httpClient.getPaymentSettleResponse(name => paid.headers.get(name));
const result = await paid.json();

console.log(JSON.stringify({
  paymentRequired: {
    scheme: accepted.scheme,
    network: accepted.network,
    asset: accepted.asset,
    amount: accepted.amount,
    payTo: accepted.payTo,
    resource: required.resource,
    bazaar: required.extensions?.bazaar,
  },
  settlement,
  result,
}, null, 2));
