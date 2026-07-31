import { execFileSync } from "node:child_process";
import {
  Address,
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  authorizeEntry,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { HTTPFacilitatorClient } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { bazaar } from "@openx402/bazaar-sdk";
import { settlementIdForPaymentIdentifier } from "../../src/idempotency.js";

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://127.0.0.1:4022";
const RPC_URL = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const TOKEN = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const CONTRACT = "CDEI3W6ZFW6BFSU37VL265OSOGKSM3BR3TZVUR5NZ4UER6FOMVJUKOOT";
const server = new rpc.Server(RPC_URL);
const client = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

function identity(name: string): Keypair {
  return Keypair.fromSecret(execFileSync("stellar", ["keys", "show", name], { encoding: "utf8" }).trim());
}

function extension(prefix: string) {
  return {
    "payment-identifier": {
      info: { required: false, id: `${prefix}_${Date.now()}_${crypto.randomUUID().replaceAll("-", "")}` },
    },
  };
}

function extensionWithId(prefix: string) {
  const id = `${prefix}_${Date.now()}_${crypto.randomUUID().replaceAll("-", "")}`;
  return { id, extensions: { "payment-identifier": { info: { required: false, id } } } };
}

async function exact(payer: Keypair, payTo: string): Promise<string> {
  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: "stellar:testnet",
    asset: TOKEN,
    amount: "1000",
    payTo,
    maxTimeoutSeconds: 60,
    extra: { areFeesSponsored: true },
  };
  const mechanism = new ExactStellarScheme(createEd25519Signer(payer.secret()));
  const created = await mechanism.createPaymentPayload(2, requirements);
  const payload: PaymentPayload = { ...created, accepted: requirements, extensions: extension("pay_exact") };
  const verified = await client.verify(payload, requirements);
  if (!verified.isValid) throw new Error(`exact verify failed: ${verified.invalidReason} ${verified.invalidMessage ?? ""}`);
  const settled = await client.settle(payload, requirements);
  if (!settled.success || !/^[0-9a-f]{64}$/.test(settled.transaction)) throw new Error(`exact settle failed: ${settled.errorReason}`);
  const retry = await client.settle(payload, requirements);
  if (retry.transaction !== settled.transaction) throw new Error("exact idempotent retry returned a different transaction");
  return settled.transaction;
}

/**
 * A real testnet exact payment carrying seller Bazaar metadata, checked through
 * the official EXTENSION-RESPONSES header and the public discovery endpoint.
 */
async function catalogedExact(payer: Keypair, payTo: string): Promise<{
  transaction: string; resource: string; verifyStatus: string; settleStatus: string;
}> {
  const resource = `https://live.example.com/weather-${Date.now()}`;
  const metadata = bazaar.http({
    description: "Returns the current weather for a city.",
    serviceName: "Live Weather API",
    tags: ["weather", "live"],
    method: "GET",
    query: { city: { type: "string", description: "City to look up.", required: true, example: "Mumbai" } },
    output: { type: "json", example: { city: "Mumbai", temperature: 29 } },
  });
  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: "stellar:testnet",
    asset: TOKEN,
    amount: "1000",
    payTo,
    maxTimeoutSeconds: 60,
    extra: { areFeesSponsored: true },
  };
  const mechanism = new ExactStellarScheme(createEd25519Signer(payer.secret()));
  const created = await mechanism.createPaymentPayload(2, requirements);
  const payload = {
    ...created,
    accepted: requirements,
    resource: { url: resource, ...metadata.resource },
    extensions: { ...extension("pay_catalog"), ...metadata.extensions },
  };

  const call = async (route: "verify" | "settle") => {
    const response = await fetch(`${FACILITATOR_URL}/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements }),
    });
    const header = response.headers.get("extension-responses");
    if (!header) throw new Error(`${route} did not return EXTENSION-RESPONSES`);
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      bazaar?: { status?: string; rejectedReason?: string };
    };
    if (decoded.bazaar?.status !== "success") {
      throw new Error(`${route} cataloging status ${decoded.bazaar?.status}: ${decoded.bazaar?.rejectedReason}`);
    }
    return { body: await response.json() as Record<string, unknown>, status: decoded.bazaar.status };
  };

  const verified = await call("verify");
  if (verified.body.isValid !== true) throw new Error(`cataloged verify failed: ${JSON.stringify(verified.body)}`);
  const settled = await call("settle");
  if (settled.body.success !== true) throw new Error(`cataloged settle failed: ${JSON.stringify(settled.body)}`);

  const listed = await fetch(`${FACILITATOR_URL}/discovery/resources?limit=50&type=http`);
  const catalog = await listed.json() as { items: Array<{ resource: string; accepts: Array<{ payTo: string }> }> };
  const entry = catalog.items.find(item => item.resource === resource);
  if (!entry) throw new Error(`${resource} was not cataloged`);
  if (entry.accepts[0]?.payTo !== payTo) throw new Error("cataloged accepts entry does not match the paid terms");

  const searched = await fetch(`${FACILITATOR_URL}/discovery/search?query=weather&limit=50`);
  const results = await searched.json() as { resources: Array<{ resource: string }> };
  if (!results.resources.some(item => item.resource === resource)) {
    throw new Error(`${resource} was not lexically searchable`);
  }

  return {
    transaction: String(settled.body.transaction),
    resource,
    verifyStatus: verified.status,
    settleStatus: settled.status,
  };
}

function authAddress(entry: xdr.SorobanAuthorizationEntry): string | undefined {
  const credentials = entry.credentials();
  if (credentials.switch().name !== "sorobanCredentialsAddress") return undefined;
  return Address.fromScAddress(credentials.address().address()).toString();
}

function settlementOperation(args: {
  payer: string; payTo: string; facilitator: string; maximum: bigint;
  validAfter: number; deadline: number; settlementId: Uint8Array; actual: bigint;
  auth?: xdr.SorobanAuthorizationEntry[];
}) {
  const raw = new Contract(CONTRACT).call(
    "settle",
    nativeToScVal(args.payer, { type: "address" }),
    nativeToScVal(args.payTo, { type: "address" }),
    nativeToScVal(TOKEN, { type: "address" }),
    nativeToScVal(args.maximum, { type: "i128" }),
    nativeToScVal(args.validAfter, { type: "u32" }),
    nativeToScVal(args.deadline, { type: "u32" }),
    nativeToScVal(args.facilitator, { type: "address" }),
    nativeToScVal(args.settlementId, { type: "bytes" }),
    xdr.ScVal.scvVoid(),
    nativeToScVal(args.actual, { type: "i128" }),
  );
  return args.auth
    ? Operation.invokeHostFunction({ func: raw.body().invokeHostFunctionOp().hostFunction(), auth: args.auth })
    : raw;
}

async function uptoPayload(
  payer: Keypair,
  source: Keypair,
  payTo: string,
  facilitator: string,
  maximum: bigint,
): Promise<{ payload: PaymentPayload; maximumRequirements: PaymentRequirements }> {
  const latest = await server.getLatestLedger();
  const validAfter = latest.sequence;
  const deadline = latest.sequence + 10;
  const identified = extensionWithId("pay_upto");
  const settlementId = settlementIdForPaymentIdentifier(identified.id);
  const account = await server.getAccount(source.publicKey());
  const unsigned = new TransactionBuilder(account, { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(settlementOperation({
      payer: payer.publicKey(), payTo, facilitator, maximum, validAfter, deadline, settlementId, actual: maximum,
    }))
    .setTimeout(60)
    .build();
  const recording = await server.simulateTransaction(unsigned, undefined, "record");
  if (!rpc.Api.isSimulationSuccess(recording) || !recording.result?.auth) throw new Error("upto recording simulation failed");
  const auth: xdr.SorobanAuthorizationEntry[] = [];
  for (const entry of recording.result.auth) {
    const address = authAddress(entry);
    if (address === payer.publicKey()) auth.push(await authorizeEntry(entry, payer, deadline, Networks.TESTNET));
    else if (address === facilitator) auth.push(entry);
    else throw new Error(`unexpected upto signer ${address}`);
  }
  if (auth.length !== 2) throw new Error("upto recording returned the wrong auth count");
  const signed = new TransactionBuilder(account, { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(settlementOperation({
      payer: payer.publicKey(), payTo, facilitator, maximum, validAfter, deadline, settlementId, actual: maximum, auth,
    }))
    .setTimeout(60)
    .build();
  const maximumRequirements: PaymentRequirements = {
    scheme: "upto",
    network: "stellar:testnet",
    asset: TOKEN,
    amount: maximum.toString(),
    payTo,
    maxTimeoutSeconds: 60,
    extra: { areFeesSponsored: true },
  };
  return {
    maximumRequirements,
    payload: {
      x402Version: 2,
      accepted: maximumRequirements,
      payload: { transaction: signed.toXDR() },
      extensions: identified.extensions,
    },
  };
}

async function upto(
  payer: Keypair,
  source: Keypair,
  payTo: string,
  facilitator: string,
  actual: bigint,
): Promise<string> {
  const { payload, maximumRequirements } = await uptoPayload(payer, source, payTo, facilitator, 10_000n);
  const verified = await client.verify(payload, maximumRequirements);
  if (!verified.isValid) throw new Error(`upto verify failed: ${verified.invalidReason} ${verified.invalidMessage ?? ""}`);
  const settleRequirements = { ...maximumRequirements, amount: actual.toString() };
  const settled = await client.settle(payload, settleRequirements);
  if (!settled.success || settled.amount !== actual.toString()) throw new Error(`upto settle failed: ${settled.errorReason}`);
  return settled.transaction;
}

const payer = identity(process.env.PAYER_IDENTITY ?? "upto-payer");
const payee = identity(process.env.PAYEE_IDENTITY ?? "upto-payee");
const source = identity(process.env.SOURCE_IDENTITY ?? "upto-ch");
const supported = await client.getSupported();
const facilitator = supported.signers["stellar:*"]?.[0];
if (!facilitator) throw new Error("supported response did not advertise a Stellar signer");
if (!supported.kinds.some(kind => kind.scheme === "exact" && kind.network === "stellar:testnet")) throw new Error("exact missing from supported");
if (!supported.kinds.some(kind => kind.scheme === "upto" && kind.network === "stellar:testnet")) throw new Error("upto missing from supported");
if (!supported.kinds.every(kind => kind.extra?.areFeesSponsored === true)) throw new Error("fee sponsorship missing from supported");

const exactHash = await exact(payer, payee.publicKey());
const cataloged = await catalogedExact(payer, payee.publicKey());
const uptoPartialHash = await upto(payer, source, payee.publicKey(), facilitator, 3_000n);
const uptoZeroHash = await upto(payer, source, payee.publicKey(), facilitator, 0n);

console.log(JSON.stringify({ exactHash, uptoPartialHash, uptoZeroHash, cataloged }, null, 2));
