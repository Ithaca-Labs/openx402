import type { SchemeNetworkClient } from "@x402/core/types";
import { ExactStellarScheme, type ClientStellarSigner } from "@x402/stellar";
import { McpToolError } from "../errors.js";

export type SupportedScheme = "exact" | "upto";

/**
 * No reusable Stellar "upto" client exists upstream (checked against
 * `@x402/stellar`, the upstream x402 monorepo in full, and the local
 * `x402-stellar-upto` project, which only ships a private, unpublished test
 * harness -- not a client library). Selecting `upto` fails closed rather than
 * silently downgrading to `exact` or hand-rolling a signer.
 */
export class UptoUnavailableError extends McpToolError {
  constructor() {
    super(
      "PAYMENT_REJECTED",
      "the upto scheme has no reusable Stellar client upstream yet; this deployment supports exact only",
      { scheme: "upto", blocked: true },
    );
  }
}

/**
 * Mirrors `SchemeNetworkClient` so a future upstream Stellar upto client can
 * be registered here without any caller changing shape.
 */
export interface UptoSchemeClient extends SchemeNetworkClient {
  readonly scheme: "upto";
}

export type SchemeRegistry = Map<SupportedScheme, SchemeNetworkClient>;

/** Builds the scheme registry for one signer. `exact` is always populated; `upto` is deliberately absent. */
export function buildSchemeRegistry(signer: ClientStellarSigner): SchemeRegistry {
  const registry: SchemeRegistry = new Map();
  registry.set("exact", new ExactStellarScheme(signer));
  return registry;
}

export function resolveScheme(registry: SchemeRegistry, scheme: SupportedScheme): SchemeNetworkClient {
  const client = registry.get(scheme);
  if (!client) {
    if (scheme === "upto") throw new UptoUnavailableError();
    throw new McpToolError("PAYMENT_REJECTED", `no client registered for scheme "${scheme}"`, { scheme });
  }
  return client;
}
