import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createEd25519Signer, USDC_TESTNET_ADDRESS } from "@x402/stellar";
import { ShortAuthExactStellarScheme } from "./short-auth-exact.js";

const NETWORK = "stellar:testnet" as const;
const SELLER_ORIGIN = process.env.SELLER_ORIGIN;
const START_INDEX = Number(process.env.START_INDEX ?? 0);
const INTER_REQUEST_DELAY_MS = Number(process.env.INTER_REQUEST_DELAY_MS ?? 6_000);
const WALLETS_FILE = fileURLToPath(new URL("./wallets.private.json", import.meta.url));

if (!SELLER_ORIGIN) throw new Error("SELLER_ORIGIN is required");
if (!Number.isInteger(START_INDEX) || START_INDEX < 0 || START_INDEX >= 10) {
  throw new Error("START_INDEX must be an integer from 0 through 9");
}
if (!Number.isInteger(INTER_REQUEST_DELAY_MS) || INTER_REQUEST_DELAY_MS < 0 || INTER_REQUEST_DELAY_MS > 60_000) {
  throw new Error("INTER_REQUEST_DELAY_MS must be an integer from 0 through 60000");
}

type PrivateWallet = { id: number; address: string; secret: string };

const paths = [
  "time", "uuid", "dice", "coin", "number",
  "color", "quote", "token", "status", "version",
] as const;
const amounts = ["1200", "2700", "4300", "900", "3100", "1800", "5200", "2400", "3700", "1500"] as const;

const wallets = JSON.parse(await readFile(WALLETS_FILE, "utf8")) as PrivateWallet[];
if (wallets.length !== paths.length) throw new Error("wallets.private.json must contain ten wallets");

const purchases = [];

function settlementRetryMode(value: unknown): "same-payload" | "fresh-payload" | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const failure = value as { success?: unknown; errorReason?: unknown };
  if (failure.success !== false || typeof failure.errorReason !== "string") return undefined;
  if (/(status_unknown|temporarily_unavailable|unexpected_settle_error)$/.test(failure.errorReason)) return "same-payload";
  if (/(submission_failed|transaction_failed|expired_unconfirmed|auth_expired|signature_expired)$/.test(failure.errorReason)) {
    return "fresh-payload";
  }
  return undefined;
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

for (let endpointIndex = START_INDEX; endpointIndex < paths.length; endpointIndex++) {
  const owner = wallets[endpointIndex]!;
  const buyer = wallets[(endpointIndex + paths.length - 1) % paths.length]!;
  if (buyer.address === owner.address) throw new Error(`wallet ${buyer.id} cannot pay itself`);

  const signer = createEd25519Signer(buyer.secret, NETWORK);
  const paymentClient = new x402Client()
    .register(NETWORK, new ShortAuthExactStellarScheme(signer));
  const httpClient = new x402HTTPClient(paymentClient);
  const path = paths[endpointIndex]!;
  const url = `${SELLER_ORIGIN.replace(/\/$/, "")}/api/${path}`;

  const unpaid = await fetch(url);
  if (unpaid.status !== 402) {
    throw new Error(`${path}: expected 402, received ${unpaid.status}: ${await unpaid.text()}`);
  }

  const required = httpClient.getPaymentRequiredResponse(
    name => unpaid.headers.get(name),
    await unpaid.json(),
  );
  const accepted = required.accepts[0];
  if (!accepted) throw new Error(`${path}: seller returned no payment option`);
  if (accepted.network !== NETWORK) throw new Error(`${path}: unexpected network ${accepted.network}`);
  if (accepted.asset !== USDC_TESTNET_ADDRESS) throw new Error(`${path}: unexpected asset ${accepted.asset}`);
  if (accepted.amount !== amounts[endpointIndex]) throw new Error(`${path}: unexpected amount ${accepted.amount}`);
  if (accepted.payTo !== owner.address) throw new Error(`${path}: unexpected payTo ${accepted.payTo}`);

  let paid: Response | undefined;
  let body: unknown;
  payloadAttempts: for (let payloadAttempt = 1; payloadAttempt <= 3; payloadAttempt++) {
    const payload = await httpClient.createPaymentPayload(required);
    const paymentHeaders = httpClient.encodePaymentSignatureHeader(payload);

    for (let settleAttempt = 1; settleAttempt <= 3; settleAttempt++) {
      const response = await fetch(url, { headers: paymentHeaders });
      paid = response;
      body = await response.json();
      if (response.ok) break payloadAttempts;

      let failure: unknown = body;
      if (response.headers.has("payment-response") || response.headers.has("x-payment-response")) {
        failure = httpClient.getPaymentSettleResponse(name => response.headers.get(name));
      } else if (response.headers.has("payment-required")) {
        failure = httpClient.getPaymentRequiredResponse(name => response.headers.get(name), body);
      }

      const retryMode = settlementRetryMode(failure);
      const reason = typeof failure === "object" && failure !== null && "errorReason" in failure
        ? String(failure.errorReason)
        : "unknown";
      if (retryMode === "same-payload" && settleAttempt < 3) {
        console.warn(JSON.stringify({ path, payloadAttempt, settleAttempt, retrying: reason }));
        await wait(6_000);
        continue;
      }
      if (retryMode && payloadAttempt < 3) {
        console.warn(JSON.stringify({ path, payloadAttempt, refreshing: reason }));
        await wait(6_000);
        continue payloadAttempts;
      }
      throw new Error(`${path}: paid request failed ${response.status}: ${JSON.stringify(failure)}`);
    }
  }
  if (!paid?.ok) throw new Error(`${path}: payment retry loop exited without success`);

  const settlement = httpClient.getPaymentSettleResponse(name => paid.headers.get(name));
  if (!settlement.success || !/^[0-9a-f]{64}$/i.test(settlement.transaction)) {
    throw new Error(`${path}: invalid settlement ${JSON.stringify(settlement)}`);
  }

  const purchase = {
    path,
    status: paid.status,
    buyer: buyer.address,
    payTo: owner.address,
    transaction: settlement.transaction,
    result: body,
  };
  purchases.push(purchase);
  console.log(JSON.stringify(purchase));
  if (endpointIndex < paths.length - 1 && INTER_REQUEST_DELAY_MS > 0) {
    await wait(INTER_REQUEST_DELAY_MS);
  }
}

const expectedPurchases = paths.length - START_INDEX;
if (new Set(purchases.map(purchase => purchase.transaction)).size !== expectedPurchases) {
  throw new Error(`expected ${expectedPurchases} unique settlement transaction hashes`);
}

console.log(JSON.stringify({ status: "complete", purchases: purchases.length }));
