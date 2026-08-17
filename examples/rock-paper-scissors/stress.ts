import { randomInt } from "node:crypto";
import { appendFile, chmod, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createEd25519Signer, USDC_TESTNET_ADDRESS } from "@x402/stellar";
import { ShortAuthExactStellarScheme } from "./short-auth-exact.js";

const NETWORK = "stellar:testnet" as const;
const FACILITATOR_URL = "https://facilitator.stellarx402.xyz";
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const RUN_ID = "hosted-usdc-543-v1";
const RUN_STARTED_AT = "2026-08-17T18:27:19Z";
const SELLER_ORIGIN = process.env.SELLER_ORIGIN?.replace(/\/$/, "");
const INTER_REQUEST_DELAY_MS = Number(process.env.INTER_REQUEST_DELAY_MS ?? 6_000);
const SELLER_WALLETS_FILE = fileURLToPath(new URL("./wallets.private.json", import.meta.url));
const EXTRA_BUYERS_FILE = fileURLToPath(new URL("./stress-buyers.private.json", import.meta.url));
const PROOF_FILE = fileURLToPath(new URL("./stress-purchases.public.ndjson", import.meta.url));
const BUYER_PLAN_FILE = fileURLToPath(new URL("./stress-buyers.public.json", import.meta.url));
const INFLIGHT_FILE = fileURLToPath(new URL("./.stress-inflight.private.json", import.meta.url));
const INFLIGHT_TEMP_FILE = `${INFLIGHT_FILE}.tmp`;

if (!SELLER_ORIGIN) throw new Error("SELLER_ORIGIN is required");
if (!Number.isInteger(INTER_REQUEST_DELAY_MS) || INTER_REQUEST_DELAY_MS < 0 || INTER_REQUEST_DELAY_MS > 60_000) {
  throw new Error("INTER_REQUEST_DELAY_MS must be an integer from 0 through 60000");
}

const paths = [
  "sunrise", "slug", "lottery", "boolean", "sequence",
  "palette", "proverb", "nonce", "heartbeat", "semver",
  "noise", "climate", "geopoint", "feeling", "vocabulary",
  "gradient", "countdown",
] as const;
type Path = typeof paths[number];
const AMOUNTS: Record<Path, string> = {
  sunrise: "1200",
  slug: "2700",
  lottery: "4300",
  boolean: "900",
  sequence: "3100",
  palette: "1800",
  proverb: "5200",
  nonce: "2400",
  heartbeat: "3700",
  semver: "1500",
  noise: "6600",
  climate: "750",
  geopoint: "4600",
  feeling: "2900",
  vocabulary: "6100",
  gradient: "3400",
  countdown: "4800",
};
const TARGETS: Record<Path, number> = {
  sunrise: 28,
  slug: 31,
  lottery: 35,
  boolean: 27,
  sequence: 33,
  palette: 39,
  proverb: 24,
  nonce: 36,
  heartbeat: 30,
  semver: 22,
  noise: 41,
  climate: 26,
  geopoint: 34,
  feeling: 29,
  vocabulary: 37,
  gradient: 32,
  countdown: 39,
};
const TOTAL_TRANSACTIONS = Object.values(TARGETS).reduce((sum, target) => sum + target, 0);
if (TOTAL_TRANSACTIONS !== 543 || new Set(Object.values(TARGETS)).size < 4 ||
    Object.values(TARGETS).some(target => target < 3)) {
  throw new Error("transaction targets must be varied positive counts totaling 543");
}
type PrivateWallet = { id: number; address: string; secret: string };
type Proof = {
  runId: typeof RUN_ID;
  path: Path;
  buyer: string;
  payTo: string;
  amount: string;
  asset: typeof USDC_TESTNET_ADDRESS;
  transaction: string;
  ledger: number;
  createdAt: string;
  successful: true;
  source: "analytics" | "stress";
};
type Inflight = {
  runId: typeof RUN_ID;
  createdAt?: string;
  path: Path;
  buyer: string;
  payTo: string;
  url: string;
  headers: Record<string, string>;
};
type BuyerPlan = Record<Path, { target: number; buyers: string[] }>;
type BuyerPlanFile = { runId: typeof RUN_ID; services: BuyerPlan };
let previousRunPath: Path | undefined;

const sellerWallets = JSON.parse(await readFile(SELLER_WALLETS_FILE, "utf8")) as PrivateWallet[];
if (sellerWallets.length !== paths.length) throw new Error("wallets.private.json must contain seventeen seller wallets");
let extraBuyers: PrivateWallet[];
try {
  extraBuyers = JSON.parse(await readFile(EXTRA_BUYERS_FILE, "utf8")) as PrivateWallet[];
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error("run npm run stress-buyers:setup first to create four extra buyer wallets");
  }
  throw error;
}
if (extraBuyers.length !== 4 || new Set(extraBuyers.map(wallet => wallet.address)).size !== 4) {
  throw new Error("stress-buyers.private.json must contain four extra buyers");
}
const allBuyerWallets = [...sellerWallets, ...extraBuyers];
const ACTIVE_BUYER_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 18, 19, 20, 21]);
const buyerWallets = allBuyerWallets.filter(wallet => ACTIVE_BUYER_IDS.has(wallet.id));
if (buyerWallets.length !== 15 || new Set(buyerWallets.map(wallet => wallet.address)).size !== 15) {
  throw new Error("stress run requires fifteen distinct buyer wallets");
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function json(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 500) }; }
}

async function fetchTimed(url: string, init?: RequestInit, timeoutMs = 30_000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

async function horizon(transaction: string): Promise<{ ledger: number; createdAt: string; successful: true } | undefined> {
  const response = await fetchTimed(`${HORIZON_URL}/transactions/${encodeURIComponent(transaction)}`);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Horizon lookup failed: HTTP ${response.status}`);
  const body = await response.json() as { hash?: string; ledger?: number; created_at?: string; successful?: boolean };
  if (body.hash !== transaction || body.successful !== true || !Number.isInteger(body.ledger) || !body.created_at) {
    throw new Error(`Horizon did not confirm ${transaction}`);
  }
  return { ledger: body.ledger!, createdAt: body.created_at, successful: true };
}

async function confirm(transaction: string): Promise<{ ledger: number; createdAt: string; successful: true }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const confirmed = await horizon(transaction);
      if (confirmed) return confirmed;
    } catch (error) {
      lastError = error;
    }
    await wait(Math.min(2_000 * (attempt + 1), 10_000));
  }
  throw new Error(`transaction ${transaction} was not confirmed by Horizon`, { cause: lastError });
}

async function readProofs(): Promise<Proof[]> {
  try {
    const text = await readFile(PROOF_FILE, "utf8");
    const records = text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as Proof);
    const firstCurrent = records.findIndex(proof => proof.runId === RUN_ID);
    const previous = firstCurrent > 0 ? records[firstCurrent - 1] : firstCurrent === -1 ? records.at(-1) : undefined;
    previousRunPath = paths.find(path => path === previous?.path);
    return records.filter(proof => proof.runId === RUN_ID);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function appendProof(proof: Proof): Promise<void> {
  await appendFile(PROOF_FILE, `${JSON.stringify(proof)}\n`, { encoding: "utf8", mode: 0o644 });
}

async function saveInflight(value: Inflight): Promise<void> {
  await writeFile(INFLIGHT_TEMP_FILE, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(INFLIGHT_TEMP_FILE, 0o600);
  await rename(INFLIGHT_TEMP_FILE, INFLIGHT_FILE);
}

async function readInflight(): Promise<Inflight | undefined> {
  try {
    return JSON.parse(await readFile(INFLIGHT_FILE, "utf8")) as Inflight;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function clearInflight(): Promise<void> {
  await unlink(INFLIGHT_FILE).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
}

function pathFromUrl(value: string): Path | undefined {
  const prefix = `${SELLER_ORIGIN}/api/`;
  if (!value.startsWith(prefix)) return undefined;
  const candidate = value.slice(prefix.length);
  return paths.find(path => path === candidate);
}

async function importAnalytics(proofs: Proof[]): Promise<Proof[]> {
  const known = new Set(proofs.map(proof => proof.transaction));
  const imported: Proof[] = [];
  const response = await fetchTimed(`${FACILITATOR_URL}/analytics/v1/transactions?limit=200&offset=0`);
  if (!response.ok) throw new Error(`analytics lookup failed: HTTP ${response.status}`);
  const body = await response.json() as { items?: Array<Record<string, unknown>> };
  for (const event of body.items ?? []) {
    if (event.status !== "success" || typeof event.resource_url !== "string" || typeof event.transaction_hash !== "string") continue;
    if (typeof event.occurred_at !== "string" || Date.parse(event.occurred_at) < Date.parse(RUN_STARTED_AT)) continue;
    const path = pathFromUrl(event.resource_url);
    if (!path || known.has(event.transaction_hash)) continue;
    const endpointIndex = paths.indexOf(path);
    const owner = sellerWallets[endpointIndex]!;
    const buyer = buyerWallets.find(wallet => wallet.address === event.payer);
    if (!buyer || buyer.address === owner.address) continue;
    if (event.payer !== buyer.address || event.pay_to !== owner.address ||
        event.max_amount !== AMOUNTS[path] || event.asset !== USDC_TESTNET_ADDRESS) continue;
    const chain = await confirm(event.transaction_hash);
    const proof: Proof = {
      runId: RUN_ID, path, buyer: buyer.address, payTo: owner.address,
      amount: AMOUNTS[path], asset: USDC_TESTNET_ADDRESS, transaction: event.transaction_hash,
      ...chain, source: "analytics",
    };
    await appendProof(proof);
    proofs.push(proof);
    imported.push(proof);
    known.add(proof.transaction);
  }
  return imported;
}

function validateProofs(proofs: Proof[]): Map<Path, number> {
  const hashes = new Set<string>();
  const counts = new Map(paths.map(path => [path, 0]));
  for (const proof of proofs) {
    if (proof.runId !== RUN_ID || !paths.includes(proof.path) || proof.successful !== true) throw new Error("invalid proof record");
    if (hashes.has(proof.transaction)) throw new Error(`duplicate proof hash ${proof.transaction}`);
    hashes.add(proof.transaction);
    counts.set(proof.path, (counts.get(proof.path) ?? 0) + 1);
  }
  return counts;
}

function buyerCounts(proofs: Proof[], path: Path): Map<string, number> {
  const counts = new Map<string, number>();
  for (const proof of proofs) {
    if (proof.path === path) counts.set(proof.buyer, (counts.get(proof.buyer) ?? 0) + 1);
  }
  return counts;
}

function hasCurrentPriceProof(proofs: Proof[], path: Path): boolean {
  return [...proofs].reverse().find(proof => proof.path === path)?.amount === AMOUNTS[path];
}

function shuffled<T>(values: T[]): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = randomInt(index + 1);
    [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
  }
  return copy;
}

async function loadBuyerPlan(proofs: Proof[]): Promise<BuyerPlan> {
  const createEntry = (path: Path): BuyerPlan[Path] => {
    const owner = sellerWallets[paths.indexOf(path)]!;
    const existing = [...buyerCounts(proofs, path).keys()];
    if (existing.length > 9) throw new Error(`${path} already has more than nine buyers`);
    const target = randomInt(Math.max(3, existing.length), Math.min(9, TARGETS[path]) + 1);
    const candidates = shuffled(buyerWallets
      .map(wallet => wallet.address)
      .filter(address => address !== owner.address && !existing.includes(address)));
    return { target, buyers: [...existing, ...candidates.slice(0, target - existing.length)] };
  };

  let document: BuyerPlanFile | undefined;
  try {
    document = JSON.parse(await readFile(BUYER_PLAN_FILE, "utf8")) as BuyerPlanFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  if (document?.runId === RUN_ID) {
    const plan = document.services;
    let changed = false;
    for (const path of paths) {
      if (!plan[path]) {
        plan[path] = createEntry(path);
        changed = true;
      }
      const entry = plan[path];
      const owner = sellerWallets[paths.indexOf(path)]!;
      if (!entry || entry.target < 3 || entry.target > Math.min(9, TARGETS[path]) || entry.buyers.length !== entry.target ||
          new Set(entry.buyers).size !== entry.target || entry.buyers.includes(owner.address) ||
          entry.buyers.some(address => !buyerWallets.some(wallet => wallet.address === address))) {
        throw new Error(`invalid buyer plan for ${path}`);
      }
    }
    if (changed) {
      await writeFile(BUYER_PLAN_FILE, `${JSON.stringify({ runId: RUN_ID, services: plan }, null, 2)}\n`, "utf8");
    }
    return plan;
  }

  const plan = {} as BuyerPlan;
  for (const path of paths) {
    plan[path] = createEntry(path);
  }
  await writeFile(BUYER_PLAN_FILE, `${JSON.stringify({ runId: RUN_ID, services: plan }, null, 2)}\n`, "utf8");
  return plan;
}

function canFinishWithoutAdjacentRepeat(remaining: Map<Path, number>, previous: Path): boolean {
  const total = [...remaining.values()].reduce((sum, count) => sum + count, 0);
  return paths.every(path => {
    const count = remaining.get(path) ?? 0;
    const other = total - count;
    return count <= other + (path === previous ? 0 : 1);
  });
}

function chooseNextPath(counts: Map<Path, number>, previous?: Path): Path {
  const candidates = paths.filter(path => path !== previous && (counts.get(path) ?? 0) < TARGETS[path]);
  const valid = candidates.filter(candidate => {
    const remaining = new Map(paths.map(path => [path, TARGETS[path] - (counts.get(path) ?? 0)]));
    remaining.set(candidate, (remaining.get(candidate) ?? 0) - 1);
    return canFinishWithoutAdjacentRepeat(remaining, candidate);
  });
  if (valid.length === 0) throw new Error("no non-adjacent stress schedule remains");
  return valid[randomInt(valid.length)]!;
}

function settlement(httpClient: x402HTTPClient, response: Response, body: unknown): Record<string, unknown> {
  if (response.headers.has("payment-response") || response.headers.has("x-payment-response")) {
    return httpClient.getPaymentSettleResponse(name => response.headers.get(name)) as unknown as Record<string, unknown>;
  }
  return typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
}

async function pay(inflight: Inflight, httpClient: x402HTTPClient): Promise<{ transaction: string }> {
  for (let attempt = 1; attempt <= 12; attempt++) {
    let response: Response;
    try {
      response = await fetchTimed(inflight.url, { headers: inflight.headers }, 75_000);
    } catch (error) {
      const recovered = await recoverSettled(inflight);
      if (recovered) return { transaction: recovered };
      console.warn(JSON.stringify({ path: inflight.path, attempt, retrying: "transport", error: String(error) }));
      await wait(Math.min(attempt * 3_000, 15_000));
      continue;
    }
    const body = await json(response);
    const result = settlement(httpClient, response, body);
    if (response.ok && result.success === true && typeof result.transaction === "string") {
      return { transaction: result.transaction };
    }
    const recovered = await recoverSettled(inflight);
    if (recovered) return { transaction: recovered };
    const reason = typeof result.errorReason === "string" ? result.errorReason : `http_${response.status}`;
    if (reason.endsWith("status_unknown") && typeof result.transaction === "string") {
      const chain = await horizon(result.transaction);
      if (chain) return { transaction: result.transaction };
    }
    if (/(submission_failed|transaction_failed|expired_unconfirmed|auth_expired|signature_expired)/.test(reason)) {
      throw new Error(`fresh_payload_required:${reason}`);
    }
    console.warn(JSON.stringify({ path: inflight.path, attempt, retrying: reason }));
    await wait(Math.min(attempt * 3_000, 15_000));
  }
  throw new Error("fresh_payload_required:retry_exhausted");
}

async function recoverSettled(inflight: Inflight): Promise<string | undefined> {
  if (!inflight.createdAt) return undefined;
  try {
    const response = await fetchTimed(`${FACILITATOR_URL}/analytics/v1/transactions?limit=200&offset=0`);
    if (!response.ok) return undefined;
    const body = await response.json() as { items?: Array<Record<string, unknown>> };
    const started = Date.parse(inflight.createdAt) - 5_000;
    const event = (body.items ?? []).find(item =>
      item.status === "success" && item.resource_url === inflight.url && item.payer === inflight.buyer &&
      typeof item.occurred_at === "string" && Date.parse(item.occurred_at) >= started &&
      typeof item.transaction_hash === "string");
    if (!event || typeof event.transaction_hash !== "string") return undefined;
    return await horizon(event.transaction_hash) ? event.transaction_hash : undefined;
  } catch {
    return undefined;
  }
}

async function createInflightAttempt(path: Path, buyerAddress: string): Promise<{ inflight: Inflight; httpClient: x402HTTPClient }> {
  const endpointIndex = paths.indexOf(path);
  const owner = sellerWallets[endpointIndex]!;
  const buyer = buyerWallets.find(wallet => wallet.address === buyerAddress);
  if (!buyer || buyer.address === owner.address) throw new Error(`${path}: invalid planned buyer`);
  const signer = createEd25519Signer(buyer.secret, NETWORK);
  const paymentClient = new x402Client().register(NETWORK, new ShortAuthExactStellarScheme(signer));
  const httpClient = new x402HTTPClient(paymentClient);
  const url = `${SELLER_ORIGIN}/api/${path}`;
  const { response: unpaid, body: unpaidBody } = await paymentRequired(url, path);
  const required = httpClient.getPaymentRequiredResponse(name => unpaid.headers.get(name), unpaidBody);
  const accepted = required.accepts[0];
  if (!accepted || accepted.network !== NETWORK || accepted.asset !== USDC_TESTNET_ADDRESS ||
      accepted.amount !== AMOUNTS[path] || accepted.payTo !== owner.address) {
    throw new Error(`${path}: invalid payment requirements`);
  }
  const payload = await httpClient.createPaymentPayload(required);
  const headers = Object.fromEntries(Object.entries(httpClient.encodePaymentSignatureHeader(payload)));
  const inflight: Inflight = {
    runId: RUN_ID, createdAt: new Date().toISOString(), path,
    buyer: buyer.address, payTo: owner.address, url, headers,
  };
  await saveInflight(inflight);
  return { inflight, httpClient };
}

async function createInflight(path: Path, buyerAddress: string): Promise<{ inflight: Inflight; httpClient: x402HTTPClient }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      return await createInflightAttempt(path, buyerAddress);
    } catch (error) {
      lastError = error;
      console.warn(JSON.stringify({ path, attempt, retrying: "payment_payload", error: String(error) }));
      await wait(Math.min(attempt * 2_000, 10_000));
    }
  }
  throw new Error(`${path}: could not create payment payload`, { cause: lastError });
}

async function clientForInflight(inflight: Inflight): Promise<x402HTTPClient> {
  const buyer = buyerWallets.find(wallet => wallet.address === inflight.buyer);
  if (!buyer) throw new Error("in-flight buyer is unknown");
  const signer = createEd25519Signer(buyer.secret, NETWORK);
  return new x402HTTPClient(new x402Client().register(NETWORK, new ShortAuthExactStellarScheme(signer)));
}

async function paymentRequired(url: string, path: Path): Promise<{ response: Response; body: unknown }> {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const response = await fetchTimed(url);
      const body = await json(response);
      if (response.status === 402) return { response, body };
      console.warn(JSON.stringify({ path, attempt, retrying: `unpaid_http_${response.status}` }));
    } catch (error) {
      console.warn(JSON.stringify({ path, attempt, retrying: "unpaid_transport", error: String(error) }));
    }
    await wait(Math.min(attempt * 2_000, 10_000));
  }
  throw new Error(`${path}: could not obtain payment requirements`);
}

const proofs = await readProofs();
const imported = await importAnalytics(proofs);
let counts = validateProofs(proofs);
const plan = await loadBuyerPlan(proofs);
const plannedBuyers = new Set(paths.flatMap(path => plan[path].buyers));
if (plannedBuyers.size !== buyerWallets.length) {
  throw new Error(`buyer plan covers ${plannedBuyers.size} wallets; expected all ${buyerWallets.length}`);
}
console.log(JSON.stringify({
  status: "starting",
  total: proofs.length,
  counts: Object.fromEntries(counts),
  transactionTargets: TARGETS,
  buyerTargets: Object.fromEntries(paths.map(path => [path, plan[path].target])),
}));

let pending = await readInflight();
if (pending && pending.runId !== RUN_ID) throw new Error("in-flight state belongs to another run");
if (pending && imported.some(proof => proof.path === pending!.path && proof.buyer === pending!.buyer)) {
  console.log(JSON.stringify({
    status: "recovered",
    path: pending.path,
    transactions: imported.filter(proof => proof.path === pending!.path && proof.buyer === pending!.buyer)
      .map(proof => proof.transaction),
  }));
  await clearInflight();
  pending = undefined;
}

while (proofs.length < TOTAL_TRANSACTIONS) {
  const path = pending?.path ?? chooseNextPath(counts, proofs.at(-1)?.path ?? previousRunPath);
  let httpClient: x402HTTPClient;
  if (pending) {
    httpClient = await clientForInflight(pending);
  } else {
    const usage = buyerCounts(proofs, path);
    const buyer = [...plan[path].buyers].sort((left, right) =>
      (usage.get(left) ?? 0) - (usage.get(right) ?? 0))[0]!;
    ({ inflight: pending, httpClient } = await createInflight(path, buyer));
  }
  try {
    const paid = await pay(pending, httpClient);
    const chain = await confirm(paid.transaction);
    if (proofs.some(proof => proof.transaction === paid.transaction)) {
      await clearInflight();
      pending = undefined;
      counts = validateProofs(proofs);
      console.log(JSON.stringify({ status: "recovered", total: proofs.length, path, transaction: paid.transaction }));
      continue;
    }
    const proof: Proof = {
      runId: RUN_ID, path, buyer: pending.buyer, payTo: pending.payTo,
      amount: AMOUNTS[path], asset: USDC_TESTNET_ADDRESS, transaction: paid.transaction,
      ...chain, source: "stress",
    };
    await appendProof(proof);
    proofs.push(proof);
    await clearInflight();
    pending = undefined;
    counts.set(path, (counts.get(path) ?? 0) + 1);
    console.log(JSON.stringify({
      status: "success", total: proofs.length, path, count: counts.get(path),
      buyers: buyerCounts(proofs, path).size, buyerTarget: plan[path].target,
      transaction: proof.transaction,
    }));
    await wait(INTER_REQUEST_DELAY_MS);
  } catch (error) {
    if (!String(error).includes("fresh_payload_required:")) throw error;
    console.warn(JSON.stringify({ path, refreshing: String(error) }));
    await clearInflight();
    pending = undefined;
    await wait(INTER_REQUEST_DELAY_MS);
  }
}

counts = validateProofs(proofs);
if (proofs.length !== 543 || paths.some(path => (counts.get(path) ?? 0) !== TARGETS[path]) ||
    paths.some(path => buyerCounts(proofs, path).size !== plan[path].target || !hasCurrentPriceProof(proofs, path))) {
  throw new Error("stress run did not reach its transaction and buyer targets");
}
if (proofs.some((proof, index) => index > 0 && proof.path === proofs[index - 1]!.path)) {
  throw new Error("stress run contains adjacent payments to the same endpoint");
}
if (previousRunPath && proofs[0]?.path === previousRunPath) {
  throw new Error("stress run repeats the previous run's final endpoint");
}
console.log(JSON.stringify({
  status: "complete",
  total: proofs.length,
  counts: Object.fromEntries(counts),
  buyers: Object.fromEntries(paths.map(path => [path, buyerCounts(proofs, path).size])),
}));
