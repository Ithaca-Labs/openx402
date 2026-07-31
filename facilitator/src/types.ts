import type { PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "@x402/core/types";

export type StellarNetwork = "stellar:testnet" | "stellar:pubnet";
export type Scheme = "exact" | "upto";

export interface RequestEnvelope {
  x402Version: number;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

export interface FeeProfile {
  maxResourceFeeStroops: bigint;
  maxInclusionFeeStroops: bigint;
  maxTotalFeeStroops: bigint;
}

export interface NetworkConfig {
  id: StellarNetwork;
  enabled: boolean;
  rpcUrl: string;
  horizonUrl: string;
  friendbotUrl?: string;
  developmentAutoFund: boolean;
  channelAccountCount: number;
  channelMinBalanceStroops: bigint;
  sponsorSecret?: string;
  channelSecrets: string[];
  uptoContract?: string;
  allowedAssets: Map<string, { symbol: string; decimals: number; maxPayment: bigint }>;
  allowedSettlementHooks: Set<string>;
  maxTimeoutSeconds: number;
  exactFee: FeeProfile;
  uptoFee: FeeProfile;
}

/** Bazaar cataloging policy. None of it can change payment semantics. */
export interface CatalogConfig {
  autoCatalog: boolean;
  indexOn: "verified" | "settled";
  requireValidSchema: boolean;
  duplicateChanged: "version_and_verify" | "reject";
  staleAfterHours: number;
  maxMetadataBytes: number;
  maxDescriptionLength: number;
  maxSchemaBytes: number;
  maxExampleBytes: number;
  maxJsonDepth: number;
  maxTags: number;
  maxTagLength: number;
  maxIconUrlLength: number;
  maxServiceNameLength: number;
  maxRouteTemplateLength: number;
  fetchIcons: false;
  requireHttpsOrigins: boolean;
  allowLocalOrigins: boolean;
  inactiveVersionRetentionDays: number;
  observationRetentionDays: number;
}

export interface DiscoveryConfig {
  enabled: boolean;
  defaultPageSize: number;
  maxPageSize: number;
  cursorTtlMinutes: number;
  includeStale: boolean;
  includeUnverified: boolean;
  cursorHmacKey: Buffer;
}

export interface AnalyticsConfig {
  enabled: boolean;
  maxPageSize: number;
  defaultPageSize: number;
  redactAddresses: boolean;
}

export interface AppConfig {
  port: number;
  databaseUrl: string;
  apiKeys: string[];
  keyEncryptionKey: Buffer;
  instanceId: string;
  networks: Map<StellarNetwork, NetworkConfig>;
  catalog: CatalogConfig;
  discovery: DiscoveryConfig;
  analytics: AnalyticsConfig;
  limits: {
    maxRequestBytes: number;
    maxConcurrentSimulations: number;
    maxSimulationsPerKeyPerMinute: number;
    maxSponsoredStroopsPerKeyPerDay: bigint;
    maxGlobalSponsoredStroopsPerDay: bigint;
    maxPendingSettlements: number;
    channelLeaseMs: number;
    settlePollMs: number;
    settleTimeoutMs: number;
  };
}

export interface ParsedPayment {
  scheme: Scheme;
  network: StellarNetwork;
  payer: string;
  maximum: bigint;
  actual: bigint;
}

export interface VerificationResult {
  response: VerifyResponse;
  parsed?: ParsedPayment;
}

export interface PreparedSettlement extends ParsedPayment {
  channelAddress: string;
  envelopeXdr: string;
  transactionHash: string;
  estimatedResourceFee: bigint;
  estimatedInclusionFee: bigint;
  estimatedTotalFee: bigint;
}

export interface Mechanism {
  verify(request: RequestEnvelope, network: NetworkRuntime): Promise<VerificationResult>;
  prepareSettlement(
    request: RequestEnvelope,
    network: NetworkRuntime,
    channel: ChannelSigner,
  ): Promise<PreparedSettlement | VerifyResponse>;
}

export interface ChannelSigner {
  address: string;
  secret: string;
}

export interface NetworkRuntime {
  config: NetworkConfig;
  sponsor: ChannelSigner;
  simulationSource: ChannelSigner;
  unsafeInternalAddresses: ReadonlySet<string>;
}

export interface HttpConflict {
  kind: "conflict";
  message: string;
}

export type SettlementOutcome = SettleResponse | HttpConflict;
