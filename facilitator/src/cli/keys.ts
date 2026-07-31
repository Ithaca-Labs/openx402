import { Keypair } from "@stellar/stellar-sdk";
import pg from "pg";
import { loadConfig } from "../config.js";
import { migrate } from "../db/migrate.js";
import { KeyStore } from "../db/keystore.js";
import type { StellarNetwork } from "../types.js";

const [command, rawNetwork, address] = process.argv.slice(2);
if (rawNetwork !== "stellar:testnet" && rawNetwork !== "stellar:pubnet") {
  throw new Error("network must be stellar:testnet or stellar:pubnet");
}
const network: StellarNetwork = rawNetwork;
const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl });
await migrate(pool);
const keys = new KeyStore(pool, config.keyEncryptionKey);

try {
  if (command === "rotate-sponsor" || command === "add-channel") {
    const secret = process.env.STELLAR_SECRET;
    if (!secret) throw new Error("STELLAR_SECRET is required");
    const keypair = Keypair.fromSecret(secret);
    if (address && address !== keypair.publicKey()) throw new Error("address does not match STELLAR_SECRET");
    if (command === "rotate-sponsor") await keys.rotateSponsor(network, keypair.publicKey(), secret);
    else await keys.put(network, "channel", keypair.publicKey(), secret);
    process.stdout.write(`${command} completed for ${keypair.publicKey()}\n`);
  } else if (command === "disable-channel") {
    if (!address) throw new Error("disable-channel requires an address");
    await keys.disableChannel(network, address);
    process.stdout.write(`disabled channel ${address}\n`);
  } else {
    throw new Error("usage: keys <rotate-sponsor|add-channel|disable-channel> <network> [address]");
  }
} finally {
  await pool.end();
}
