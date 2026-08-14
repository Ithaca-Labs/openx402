import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
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
const PRIVATE_FILE = fileURLToPath(new URL("./wallets.private.json", import.meta.url));
const PUBLIC_FILE = fileURLToPath(new URL("./wallets.public.json", import.meta.url));
const WALLET_COUNT = 17;
const server = new Horizon.Server(HORIZON_URL);
const usdc = new Asset("USDC", USDC_ISSUER);

type PrivateWallet = { id: number; address: string; secret: string };

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function validateWallets(wallets: PrivateWallet[]): void {
  if (wallets.length !== WALLET_COUNT) throw new Error(`wallet file must contain exactly ${WALLET_COUNT} wallets`);
  if (new Set(wallets.map(wallet => wallet.address)).size !== WALLET_COUNT) {
    throw new Error("wallet addresses must be distinct");
  }
  for (const [index, wallet] of wallets.entries()) {
    const keypair = Keypair.fromSecret(wallet.secret);
    if (wallet.id !== index + 1 || keypair.publicKey() !== wallet.address) {
      throw new Error(`wallet ${index + 1} is invalid`);
    }
  }
}

async function loadOrCreateWallets(): Promise<PrivateWallet[]> {
  let wallets: PrivateWallet[];
  if (await exists(PRIVATE_FILE)) {
    wallets = JSON.parse(await readFile(PRIVATE_FILE, "utf8")) as PrivateWallet[];
    if (wallets.length > WALLET_COUNT) throw new Error(`wallet file contains more than ${WALLET_COUNT} wallets`);
    while (wallets.length < WALLET_COUNT) {
      const keypair = Keypair.random();
      wallets.push({ id: wallets.length + 1, address: keypair.publicKey(), secret: keypair.secret() });
    }
    await writeFile(PRIVATE_FILE, `${JSON.stringify(wallets, null, 2)}\n`, { mode: 0o600 });
  } else {
    wallets = Array.from({ length: WALLET_COUNT }, (_, index) => {
      const keypair = Keypair.random();
      return { id: index + 1, address: keypair.publicKey(), secret: keypair.secret() };
    });
    await writeFile(PRIVATE_FILE, `${JSON.stringify(wallets, null, 2)}\n`, { mode: 0o600 });
  }
  validateWallets(wallets);
  await writeFile(
    PUBLIC_FILE,
    `${JSON.stringify(wallets.map(({ id, address }) => ({ id, address })), null, 2)}\n`,
  );
  return wallets;
}

async function ensureFunded(wallet: PrivateWallet): Promise<void> {
  try {
    await server.loadAccount(wallet.address);
    return;
  } catch (error) {
    const status = typeof error === "object" && error !== null && "response" in error
      ? (error.response as { status?: unknown }).status
      : undefined;
    if (status !== 404) throw error;
  }

  const response = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(wallet.address)}`);
  if (!response.ok) throw new Error(`Friendbot failed for wallet ${wallet.id}: ${await response.text()}`);
}

function findUsdcBalance(account: Awaited<ReturnType<typeof server.loadAccount>>) {
  return account.balances.find(balance =>
    (balance.asset_type === "credit_alphanum4" || balance.asset_type === "credit_alphanum12")
    && balance.asset_code === "USDC"
    && balance.asset_issuer === USDC_ISSUER
  );
}

async function ensureTrustline(wallet: PrivateWallet): Promise<string | undefined> {
  const account = await server.loadAccount(wallet.address);
  if (findUsdcBalance(account)) return undefined;

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset: usdc }))
    .setTimeout(180)
    .build();
  transaction.sign(Keypair.fromSecret(wallet.secret));
  return (await server.submitTransaction(transaction)).hash;
}

async function distributeUsdc(wallets: PrivateWallet[]): Promise<string | undefined> {
  const funderSecret = process.env.USDC_FUNDER_SECRET;
  const funderIdentity = process.env.USDC_FUNDER_IDENTITY;
  if (!funderSecret && !funderIdentity) return undefined;
  if (funderSecret && funderIdentity) {
    throw new Error("set only one of USDC_FUNDER_SECRET or USDC_FUNDER_IDENTITY");
  }

  const funder = funderSecret ? Keypair.fromSecret(funderSecret) : undefined;
  const funderAddress = funder?.publicKey() ?? execFileSync(
    "stellar",
    ["keys", "public-key", funderIdentity!],
    { encoding: "utf8" },
  ).trim();
  const account = await server.loadAccount(funderAddress);
  const recipients = [];
  for (const wallet of wallets) {
    const walletAccount = await server.loadAccount(wallet.address);
    if (Number(findUsdcBalance(walletAccount)?.balance ?? "0") < 0.01) recipients.push(wallet);
  }
  if (recipients.length === 0) return undefined;

  const available = Number(findUsdcBalance(account)?.balance ?? "0");
  if (available < recipients.length) {
    throw new Error(`USDC funder needs at least ${recipients.length} USDC; available ${available}`);
  }

  const transaction = recipients.reduce(
    (builder, wallet) => builder.addOperation(Operation.payment({
      destination: wallet.address,
      asset: usdc,
      amount: "1",
    })),
    new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET }),
  ).setTimeout(180).build();
  if (funder) {
    transaction.sign(funder);
    return (await server.submitTransaction(transaction)).hash;
  }

  const signedXdr = execFileSync(
    "stellar",
    [
      "tx", "sign",
      "--sign-with-key", funderIdentity!,
      "--network", "testnet",
      transaction.toXDR(),
    ],
    { encoding: "utf8" },
  ).trim();
  const signedTransaction = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
  return (await server.submitTransaction(signedTransaction)).hash;
}

const wallets = await loadOrCreateWallets();
const setup = [];
for (const wallet of wallets) {
  await ensureFunded(wallet);
  const trustlineTransaction = await ensureTrustline(wallet);
  const account = await server.loadAccount(wallet.address);
  setup.push({
    id: wallet.id,
    address: wallet.address,
    funded: true,
    trustline: true,
    trustlineTransaction,
    usdcBalance: findUsdcBalance(account)?.balance ?? "0.0000000",
  });
}

const fundingTransaction = await distributeUsdc(wallets);
if (fundingTransaction) {
  for (const wallet of setup) {
    const account = await server.loadAccount(wallet.address);
    wallet.usdcBalance = findUsdcBalance(account)?.balance ?? "0.0000000";
  }
}

console.log(JSON.stringify({
  network: "stellar:testnet",
  usdc: { code: "USDC", issuer: USDC_ISSUER },
  fundingTransaction,
  wallets: setup,
}, null, 2));
