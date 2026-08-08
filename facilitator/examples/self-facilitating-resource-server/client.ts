import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";

const secret = process.env.STELLAR_SECRET_KEY;
if (!secret) throw new Error("STELLAR_SECRET_KEY is required");
const network = "stellar:testnet";
const paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{
    network,
    client: new ExactStellarScheme(createEd25519Signer(secret, network)),
  }],
});

const response = await paidFetch(process.env.RESOURCE_URL ?? "http://127.0.0.1:4021/weather");
if (!response.ok) throw new Error(`paid request failed: HTTP ${response.status} ${await response.text()}`);
console.log(JSON.stringify(await response.json()));
