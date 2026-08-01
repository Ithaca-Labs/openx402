import type { PaymentRequirements } from "@x402/core/types";

/** CAIP-2 networks this package understands. Nothing else is wired to a signer. */
export type StellarNetwork = "stellar:testnet" | "stellar:pubnet";

export type ResourceType = "http" | "mcp";

/**
 * Decoded identity of a cataloged resource: exactly the tuple the facilitator
 * keys its catalog on (`bazaar.md`, `facilitator/src/bazaar/extract.ts`).
 * MCP entries require `toolName`; two tools on the same URL decode to two
 * distinct identities.
 */
export interface ResourceIdentity {
  type: ResourceType;
  url: string;
  toolName?: string;
}

/**
 * The exact, unmodified Bazaar `DiscoveryResource` shape as returned by
 * `/discovery/resources`, `/discovery/search` and `/discovery/resource`.
 * This package never adds fields to this object — provenance/status/warnings
 * live only in `ResourceWrapper` below.
 */
export interface CanonicalResource {
  resource: string;
  type: ResourceType;
  x402Version: number;
  accepts: PaymentRequirements[];
  lastUpdated: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
  extensions?: Record<string, unknown>;
}

export type ResourceStatus = "active" | "stale" | "unknown";

/**
 * The MCP-server-only trust wrapper. Never merged into `CanonicalResource`;
 * always returned alongside it as a sibling field.
 */
export interface ResourceWrapper {
  ref: string;
  versionHash: string;
  provenance: "seller_declared";
  status: ResourceStatus;
  warnings: string[];
}

export interface WrappedResource {
  resource: CanonicalResource;
  wrapper: ResourceWrapper;
}

export type SettlementStatus = "settled" | "unknown" | "failed";

/** Structured receipt returned by `x402_call_resource` alongside tool output. */
export interface PaymentReceipt {
  paymentIdentifier: string;
  ref: string;
  versionHash: string;
  network: StellarNetwork;
  scheme: "exact" | "upto";
  asset: string;
  payTo: string;
  authorizedAmount: string;
  settledAmount?: string;
  transaction?: string;
  status: SettlementStatus;
  pollingHint?: string;
}
