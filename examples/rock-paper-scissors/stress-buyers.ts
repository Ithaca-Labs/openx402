import { execFileSync } from "node:child_process";
import { chmod, access, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const FRIENDBOT_URL = "https://friendbot.stellar.org";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const EXTRA_BUYERS = 55;
const PRIVATE_FILE = fileURLToPath(new URL("./stress-buyers.private.json", import.meta.url));
const server = new Horizon.Server(HORIZON_URL);
const usdc = new Asset("USDC", USDC_ISSUER);
type Wallet = { id: number; address: string; secret: string };

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function exists(path: string): Promise<boolean> {
  try { await access(path, fsConstants.F_OK); return true; } catch { return false; }
}

async function loadOrCreate(): Promise<Wallet[]> {
  let wallets: Wallet[] = [];
  if (await exists(PRIVATE_FILE)) wallets = JSON.parse(await readFile(PRIVATE_FILE, "utf8")) as Wallet[];
  if (wallets.length > EXTRA_BUYERS) throw new Error(`expected at most ${EXTRA_BUYERS} extra buyers`);
  while (wallets.length < EXTRA_BUYERS) {
    const keypair = Keypair.random();
    wallets.push({ id: 18 + wallets.length, address: keypair.publicKey(), secret: keypair.secret() });
  }
  for (const [index, wallet] of wallets.entries()) {
    const keypair = Keypair.fromSecret(wallet.secret);
    if (wallet.id !== 18 + index || keypair.publicKey() !== wallet.address) throw new Error(`invalid extra buyer ${wallet.id}`);
  }
  await writeFile(PRIVATE_FILE, `${JSON.stringify(wallets, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(PRIVATE_FILE, 0o600);
  return wallets;
}

async function ensureFunded(wallet: Wallet): Promise<void> {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try { await server.loadAccount(wallet.address); return; } catch (error) {
      const status = typeof error === "object" && error !== null && "response" in error
        ? (error.response as { status?: unknown }).status : undefined;
      if (status !== 404) throw error;
      const response = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(wallet.address)}`);
      if (response.ok) return;
      if (attempt === 6) throw new Error(`Friendbot failed for buyer ${wallet.id}: ${await response.text()}`);
      await wait(attempt * 2_000);
    }
  }
}

function balance(account: Awaited<ReturnType<typeof server.loadAccount>>): string | undefined {
  return account.balances.find(item =>
    (item as { asset_code?: string }).asset_code === "USDC" &&
    (item as { asset_issuer?: string }).asset_issuer === USDC_ISSUER)?.balance;
}

async function ensureTrustline(wallet: Wallet): Promise<void> {
  const account = await server.loadAccount(wallet.address);
  if (balance(account) !== undefined) return;
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: usdc }))
    .setTimeout(180)
    .build();
  tx.sign(Keypair.fromSecret(wallet.secret));
  await server.submitTransaction(tx);
}

async function distribute(wallets: Wallet[]): Promise<string | undefined> {
  const identity = process.env.USDC_FUNDER_IDENTITY;
  if (!identity) throw new Error("USDC_FUNDER_IDENTITY is required; use the disposable testnet treasury identity");
  const funderAddress = execFileSync("stellar", ["keys", "public-key", identity], { encoding: "utf8" }).trim();
  const funder = await server.loadAccount(funderAddress);
  const recipients: Wallet[] = [];
  for (const wallet of wallets) {
    const account = await server.loadAccount(wallet.address);
    if (Number(balance(account) ?? "0") < 0.01) recipients.push(wallet);
  }
  if (recipients.length === 0) return undefined;
  const available = Number(balance(funder) ?? "0");
  if (available < recipients.length) throw new Error(`treasury needs ${recipients.length} USDC; has ${available}`);
  const tx = recipients.reduce(
    (builder, wallet) => builder.addOperation(Operation.payment({ destination: wallet.address, asset: usdc, amount: "1" })),
    new TransactionBuilder(funder, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET }),
  ).setTimeout(180).build();
  const signedXdr = execFileSync(
    "stellar", ["tx", "sign", "--sign-with-key", identity, "--network", "testnet", tx.toXDR()], { encoding: "utf8" },
  ).trim();
  const signed = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
  return (await server.submitTransaction(signed)).hash;
}

const wallets = await loadOrCreate();
for (const wallet of wallets) {
  await ensureFunded(wallet);
  await ensureTrustline(wallet);
}
const fundingTransaction = await distribute(wallets);
const output = [];
for (const wallet of wallets) {
  const account = await server.loadAccount(wallet.address);
  output.push({ id: wallet.id, address: wallet.address, usdc: balance(account) ?? "0.0000000" });
}
if (output.some(wallet => Number(wallet.usdc) <= 0)) throw new Error("extra buyer funding did not produce positive USDC balances");
console.log(JSON.stringify({ network: "stellar:testnet", asset: "USDC", fundingTransaction, buyers: output }, null, 2));
