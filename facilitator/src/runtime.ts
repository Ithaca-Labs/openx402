import { Keypair, rpc } from "@stellar/stellar-sdk";
import type { Pool } from "pg";
import type { AppConfig, ChannelSigner, NetworkRuntime, StellarNetwork } from "./types.js";
import { KeyStore, type StoredKey } from "./db/keystore.js";
import { StateStore } from "./db/state.js";
import { rpcServer } from "./stellar/common.js";

export interface RuntimeRegistry {
  networks: Map<StellarNetwork, NetworkRuntime>;
  channels: Map<StellarNetwork, Map<string, ChannelSigner>>;
}

async function fundFriendbot(url: string, address: string): Promise<void> {
  const endpoint = new URL(url);
  endpoint.searchParams.set("addr", address);
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok && response.status !== 400) {
    throw new Error(`Friendbot funding failed for ${address}: HTTP ${response.status}`);
  }
}

function fromSecret(secret: string): ChannelSigner {
  const keypair = Keypair.fromSecret(secret);
  return { address: keypair.publicKey(), secret };
}

function decimalToStroops(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(value);
  if (!match) throw new Error(`invalid native balance returned by Horizon: ${value}`);
  return BigInt(match[1]!) * 10_000_000n + BigInt((match[2] ?? "").padEnd(7, "0"));
}

async function nativeBalance(horizonUrl: string, address: string): Promise<bigint> {
  const endpoint = new URL(`/accounts/${encodeURIComponent(address)}`, horizonUrl);
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Horizon account lookup failed for ${address}: HTTP ${response.status}`);
  const body = await response.json() as { balances?: Array<{ asset_type?: string; balance?: string }> };
  const native = body.balances?.find(balance => balance.asset_type === "native")?.balance;
  if (!native) throw new Error(`Horizon returned no native balance for ${address}`);
  return decimalToStroops(native);
}

async function assertMinimumBalance(horizonUrl: string, signer: ChannelSigner, minimum: bigint): Promise<void> {
  const balance = await nativeBalance(horizonUrl, signer.address);
  if (balance < minimum) {
    throw new Error(`${signer.address} has ${balance} stroops, below required minimum ${minimum}`);
  }
}

async function importConfiguredKeys(store: KeyStore, network: StellarNetwork, config: AppConfig["networks"] extends Map<unknown, infer T> ? T : never): Promise<void> {
  const existing = await store.list(network);
  const existingSponsors = existing.filter(key => key.role === "sponsor");
  if (config.sponsorSecret) {
    const signer = fromSecret(config.sponsorSecret);
    if (existingSponsors.length === 0) await store.put(network, "sponsor", signer.address, signer.secret);
    else if (!existingSponsors.some(key => key.address === signer.address)) {
      throw new Error(`${network} configured sponsor differs from encrypted active sponsor; rotate it explicitly`);
    }
  }
  const known = new Set(existing.map(key => key.address));
  for (const secret of config.channelSecrets) {
    const signer = fromSecret(secret);
    if (!known.has(signer.address)) await store.put(network, "channel", signer.address, signer.secret);
  }
}

async function ensureDevelopmentKeys(store: KeyStore, network: StellarNetwork, count: number): Promise<StoredKey[]> {
  let keys = await store.list(network);
  if (!keys.some(key => key.role === "sponsor")) {
    const generated = Keypair.random();
    await store.put(network, "sponsor", generated.publicKey(), generated.secret());
  }
  let channels = keys.filter(key => key.role === "channel");
  while (channels.length < count) {
    const generated = Keypair.random();
    await store.put(network, "channel", generated.publicKey(), generated.secret());
    channels.push({ network, role: "channel", address: generated.publicKey(), secret: generated.secret() });
  }
  keys = await store.list(network);
  return keys;
}

export async function initializeRuntimes(config: AppConfig, pool: Pool, state: StateStore): Promise<RuntimeRegistry> {
  const keyStore = new KeyStore(pool, config.keyEncryptionKey);
  const networks = new Map<StellarNetwork, NetworkRuntime>();
  const channelsByNetwork = new Map<StellarNetwork, Map<string, ChannelSigner>>();

  for (const [network, networkConfig] of config.networks) {
    if (!networkConfig.enabled) continue;
    await importConfiguredKeys(keyStore, network, networkConfig);
    let keys = await keyStore.list(network);
    if (networkConfig.developmentAutoFund) {
      keys = await ensureDevelopmentKeys(keyStore, network, networkConfig.channelAccountCount);
    }
    const sponsors = keys.filter(key => key.role === "sponsor");
    const channelKeys = keys.filter(key => key.role === "channel");
    if (sponsors.length !== 1) throw new Error(`${network} requires exactly one active sponsor key`);
    if (channelKeys.length === 0) throw new Error(`${network} requires at least one channel account`);
    if (network === "stellar:pubnet" && channelKeys.length < networkConfig.channelAccountCount) {
      throw new Error(`stellar:pubnet requires ${networkConfig.channelAccountCount} pre-funded channel keys`);
    }
    if (networkConfig.developmentAutoFund) {
      const friendbotUrl = networkConfig.friendbotUrl;
      if (!friendbotUrl) throw new Error(`${network} development auto-fund requires friendbot_url`);
      const probe = new rpc.Server(networkConfig.rpcUrl, { allowHttp: true });
      await Promise.all(keys.map(async key => {
        try {
          await probe.getAccount(key.address);
        } catch {
          await fundFriendbot(friendbotUrl, key.address);
        }
      }));
    }
    const sponsor = fromSecret(sponsors[0]!.secret);
    const channels = new Map(channelKeys.map(key => {
      const signer = fromSecret(key.secret);
      return [signer.address, signer];
    }));
    await state.syncChannels(network, [...channels.keys()]);
    const runtime: NetworkRuntime = {
      config: networkConfig,
      sponsor,
      simulationSource: channels.values().next().value!,
      unsafeInternalAddresses: new Set([sponsor.address, ...channels.keys()]),
    };
    const server = rpcServer(runtime);
    await server.getAccount(sponsor.address);
    await Promise.all([...channels.keys()].map(address => server.getAccount(address)));
    await Promise.all([
      assertMinimumBalance(networkConfig.horizonUrl, sponsor, networkConfig.channelMinBalanceStroops),
      ...[...channels.values()].map(channel =>
        assertMinimumBalance(networkConfig.horizonUrl, channel, networkConfig.channelMinBalanceStroops)),
    ]);
    networks.set(network, runtime);
    channelsByNetwork.set(network, channels);
  }
  return { networks, channels: channelsByNetwork };
}
