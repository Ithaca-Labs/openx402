import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { AppConfig, FeeProfile, NetworkConfig, StellarNetwork } from "./types.js";

const feeSchema = z.object({
  max_resource_fee_stroops: z.union([z.string(), z.number().int().positive()]),
  max_inclusion_fee_stroops: z.union([z.string(), z.number().int().positive()]),
  max_total_fee_stroops: z.union([z.string(), z.number().int().positive()]),
});

const networkSchema = z.object({
  enabled: z.boolean().default(false),
  rpc_url: z.string().url(),
  horizon_url: z.string().url(),
  friendbot_url: z.string().url().optional(),
  development_auto_fund: z.boolean().default(false),
  channel_account_count: z.number().int().min(1).max(100).default(10),
  channel_min_balance_stroops: z.union([z.string(), z.number().int().positive()]).default("50000000"),
  sponsor_secret_env: z.string().optional(),
  channel_secrets_env: z.string().optional(),
  upto_contract: z.string().regex(/^C[A-Z2-7]{55}$/).optional(),
  upto_contract_env: z.string().optional(),
  fee_ceilings_calibrated: z.boolean().default(false),
  allowed_settlement_hooks: z.array(z.string().regex(/^C[A-Z2-7]{55}$/)).default([]),
  max_timeout_seconds: z.number().int().positive().max(2_000_000).default(300),
  assets: z.array(z.object({
    contract: z.string().regex(/^C[A-Z2-7]{55}$/),
    symbol: z.string().min(1),
    decimals: z.number().int().min(0).max(18),
    max_payment: z.union([z.string(), z.number().int().positive()]),
  })).min(1),
  fees: z.object({ exact: feeSchema, upto: feeSchema }),
});

const rawSchema = z.object({
  server: z.object({ port: z.number().int().min(1).max(65535).default(4022) }).default({}),
  database_url_env: z.string().default("DATABASE_URL"),
  api_keys_env: z.string().default("FACILITATOR_API_KEYS"),
  key_encryption_key_env: z.string().default("FACILITATOR_KEY_ENCRYPTION_KEY"),
  limits: z.object({
    max_request_bytes: z.number().int().positive().default(262_144),
    max_concurrent_simulations: z.number().int().positive().default(20),
    max_simulations_per_key_per_minute: z.number().int().positive().default(30),
    max_sponsored_stroops_per_key_per_day: z.union([z.string(), z.number().int().positive()]).default("5000000"),
    max_global_sponsored_stroops_per_day: z.union([z.string(), z.number().int().positive()]).default("200000000"),
    max_pending_settlements: z.number().int().positive().default(1000),
    channel_lease_ms: z.number().int().positive().default(30_000),
    settle_poll_ms: z.number().int().positive().default(1_000),
    settle_timeout_ms: z.number().int().positive().default(30_000),
  }).default({}),
  networks: z.object({
    "stellar:testnet": networkSchema,
    "stellar:pubnet": networkSchema,
  }),
});

function fee(value: z.infer<typeof feeSchema>): FeeProfile {
  const result = {
    maxResourceFeeStroops: BigInt(value.max_resource_fee_stroops),
    maxInclusionFeeStroops: BigInt(value.max_inclusion_fee_stroops),
    maxTotalFeeStroops: BigInt(value.max_total_fee_stroops),
  };
  if (result.maxTotalFeeStroops < result.maxResourceFeeStroops + result.maxInclusionFeeStroops) {
    throw new Error("max_total_fee_stroops must cover resource plus inclusion ceilings");
  }
  return result;
}

function encryptionKey(envName: string): Buffer {
  const configured = process.env[envName];
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`${envName} is required in production`);
    }
    return createHash("sha256").update("x402-testnet-development-key-only").digest();
  }
  const decoded = Buffer.from(configured, "base64");
  if (decoded.length !== 32) throw new Error(`${envName} must be a base64-encoded 32-byte key`);
  return decoded;
}

function mapNetwork(id: StellarNetwork, value: z.infer<typeof networkSchema>): NetworkConfig {
  if (id === "stellar:pubnet" && value.development_auto_fund) {
    throw new Error("development_auto_fund is forbidden on stellar:pubnet");
  }
  const sponsorSecret = value.sponsor_secret_env ? process.env[value.sponsor_secret_env] : undefined;
  const channelSecrets = value.channel_secrets_env
    ? (process.env[value.channel_secrets_env] ?? "").split(",").map(v => v.trim()).filter(Boolean)
    : [];
  const uptoContract = value.upto_contract
    ?? (value.upto_contract_env ? process.env[value.upto_contract_env] : undefined);
  if (uptoContract && !/^C[A-Z2-7]{55}$/.test(uptoContract)) {
    throw new Error(`${id} upto contract must be a valid Stellar contract address`);
  }
  if (value.enabled && !value.fee_ceilings_calibrated) {
    throw new Error(`${id} fee ceilings must be calibrated from measured p99 settlement costs before enabling`);
  }
  if (id === "stellar:pubnet" && value.enabled && !uptoContract) {
    throw new Error("stellar:pubnet requires an audited upto settlement contract before enabling both schemes");
  }
  return {
    id,
    enabled: value.enabled,
    rpcUrl: value.rpc_url,
    horizonUrl: value.horizon_url,
    ...(value.friendbot_url ? { friendbotUrl: value.friendbot_url } : {}),
    developmentAutoFund: value.development_auto_fund,
    channelAccountCount: value.channel_account_count,
    channelMinBalanceStroops: BigInt(value.channel_min_balance_stroops),
    ...(sponsorSecret ? { sponsorSecret } : {}),
    channelSecrets,
    ...(uptoContract ? { uptoContract } : {}),
    allowedAssets: new Map(value.assets.map(asset => [asset.contract, {
      symbol: asset.symbol,
      decimals: asset.decimals,
      maxPayment: BigInt(asset.max_payment),
    }])),
    allowedSettlementHooks: new Set(value.allowed_settlement_hooks),
    maxTimeoutSeconds: value.max_timeout_seconds,
    exactFee: fee(value.fees.exact),
    uptoFee: fee(value.fees.upto),
  };
}

export function loadConfig(path = process.env.FACILITATOR_CONFIG ?? "config/self-hosted.yaml"): AppConfig {
  const raw = rawSchema.parse(YAML.parse(readFileSync(resolve(path), "utf8")));
  const databaseUrl = process.env[raw.database_url_env];
  if (!databaseUrl) throw new Error(`${raw.database_url_env} is required`);
  const apiKeys = (process.env[raw.api_keys_env] ?? "").split(",").map(v => v.trim()).filter(Boolean);
  const networks = new Map<StellarNetwork, NetworkConfig>([
    ["stellar:testnet", mapNetwork("stellar:testnet", raw.networks["stellar:testnet"])],
    ["stellar:pubnet", mapNetwork("stellar:pubnet", raw.networks["stellar:pubnet"])],
  ]);
  if (![...networks.values()].some(network => network.enabled)) throw new Error("at least one network must be enabled");
  if (networks.get("stellar:pubnet")?.enabled && apiKeys.length === 0) {
    throw new Error("pubnet requires at least one facilitator API key");
  }
  return {
    port: process.env.PORT ? z.coerce.number().int().min(1).max(65535).parse(process.env.PORT) : raw.server.port,
    databaseUrl,
    apiKeys,
    keyEncryptionKey: encryptionKey(raw.key_encryption_key_env),
    instanceId: process.env.FACILITATOR_INSTANCE_ID ?? `${hostname()}-${process.pid}-${randomBytes(4).toString("hex")}`,
    networks,
    limits: {
      maxRequestBytes: raw.limits.max_request_bytes,
      maxConcurrentSimulations: raw.limits.max_concurrent_simulations,
      maxSimulationsPerKeyPerMinute: raw.limits.max_simulations_per_key_per_minute,
      maxSponsoredStroopsPerKeyPerDay: BigInt(raw.limits.max_sponsored_stroops_per_key_per_day),
      maxGlobalSponsoredStroopsPerDay: BigInt(raw.limits.max_global_sponsored_stroops_per_day),
      maxPendingSettlements: raw.limits.max_pending_settlements,
      channelLeaseMs: raw.limits.channel_lease_ms,
      settlePollMs: raw.limits.settle_poll_ms,
      settleTimeoutMs: raw.limits.settle_timeout_ms,
    },
  };
}
