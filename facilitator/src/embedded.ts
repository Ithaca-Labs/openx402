import type { FacilitatorClient } from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import type { Pool } from "pg";
import { loadConfig } from "./config.js";
import {
  createFacilitatorRuntime,
  type CreateFacilitatorRuntimeOptions,
  type FacilitatorRuntime,
} from "./factory.js";
import { BusyError, ConflictError } from "./orchestrator.js";
import type { AppConfig, RequestEnvelope } from "./types.js";

export interface EmbeddedFacilitatorOptions {
  /** Fully mapped config. Takes precedence over configPath. */
  config?: AppConfig;
  /** YAML config path accepted by the standalone service. */
  configPath?: string;
  /** Reuse an application Pool. The caller remains responsible for closing it. */
  pool?: Pool;
  /** Defaults to true. Disable only when migrations are managed externally. */
  runMigrations?: boolean;
  migrationsDirectory?: string;
  /** Budget/rate-limit identity for calls made by this resource server process. */
  principal?: string;
  /** How often unresolved submitted transactions are polled. Set 0 to disable. */
  recoveryIntervalMs?: number;
}

function request(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): RequestEnvelope {
  return { x402Version: paymentPayload.x402Version, paymentPayload, paymentRequirements };
}

function withExtensions<T extends VerifyResponse | SettleResponse>(
  response: T,
  extensions?: Record<string, unknown>,
): T {
  return extensions
    ? { ...response, extensions: { ...response.extensions, ...extensions } }
    : response;
}

/** A local FacilitatorClient accepted directly by x402ResourceServer. */
export class EmbeddedStellarFacilitator implements FacilitatorClient {
  private readonly principal: string;
  private readonly recovery?: NodeJS.Timeout;
  private closed = false;

  constructor(
    private readonly runtime: FacilitatorRuntime,
    principal = "embedded:resource-server",
    recoveryIntervalMs = 15_000,
  ) {
    this.principal = principal;
    if (recoveryIntervalMs > 0) {
      this.recovery = setInterval(
        () => void this.runtime.core.recoverUnresolved().catch(() => undefined),
        recoveryIntervalMs,
      );
      this.recovery.unref();
    }
  }

  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    try {
      const outcome = await this.runtime.core.verify(
        request(paymentPayload, paymentRequirements),
        this.principal,
      );
      return withExtensions(outcome.response, outcome.extensionResponses);
    } catch (error) {
      if (error instanceof ConflictError) {
        return { isValid: false, invalidReason: "payment_identifier_conflict" };
      }
      return { isValid: false, invalidReason: "internal_error" };
    }
  }

  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const failed = (errorReason: string): SettleResponse => ({
      success: false,
      transaction: "",
      network: paymentRequirements.network,
      errorReason,
    });
    try {
      const outcome = await this.runtime.core.settle(
        request(paymentPayload, paymentRequirements),
        this.principal,
      );
      return withExtensions(outcome.response as SettleResponse, outcome.extensionResponses);
    } catch (error) {
      if (error instanceof ConflictError) return failed("payment_identifier_conflict");
      if (error instanceof BusyError) return failed("settle_stellar_temporarily_unavailable");
      return failed("unexpected_settle_error");
    }
  }

  async getSupported(): Promise<SupportedResponse> {
    return this.runtime.core.supported();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.recovery) clearInterval(this.recovery);
    await this.runtime.close();
  }
}

export async function createEmbeddedFacilitator(
  options: EmbeddedFacilitatorOptions = {},
): Promise<EmbeddedStellarFacilitator> {
  const config = options.config ?? loadConfig(options.configPath);
  const runtimeOptions: CreateFacilitatorRuntimeOptions = { config };
  if (options.pool) runtimeOptions.pool = options.pool;
  if (options.runMigrations !== undefined) runtimeOptions.runMigrations = options.runMigrations;
  if (options.migrationsDirectory) runtimeOptions.migrationsDirectory = options.migrationsDirectory;
  const runtime = await createFacilitatorRuntime(runtimeOptions);
  return new EmbeddedStellarFacilitator(
    runtime,
    options.principal,
    options.recoveryIntervalMs,
  );
}

export type { AppConfig, FacilitatorRuntime };
