import { FeeBumpTransaction, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import type { SettleResponse, VerifyResponse } from "@x402/core/types";
import type { AppConfig, Mechanism, RequestEnvelope, SettlementOutcome, StellarNetwork } from "./types.js";
import type { RuntimeRegistry } from "./runtime.js";
import { StateStore, type SettlementRecord } from "./db/state.js";
import type { AnalyticsStore } from "./db/analytics.js";
import { toWireResponse, type Cataloger } from "./bazaar/cataloger.js";
import { idempotencyData, paymentIdentifierError, paymentScope, principalScope } from "./idempotency.js";
import { ExactMechanism } from "./stellar/exact.js";
import { UptoMechanism } from "./stellar/upto.js";
import { isVerifyResponse, networkPassphrase, parseInteger, rpcServer } from "./stellar/common.js";
import { Semaphore } from "./semaphore.js";

export class ConflictError extends Error {}
export class BusyError extends Error {}

/** Payment result plus any extension responses to encode in EXTENSION-RESPONSES. */
export interface VerifyOutcome {
  response: VerifyResponse;
  extensionResponses?: Record<string, unknown>;
}

export interface SettleOutcome {
  response: SettlementOutcome;
  extensionResponses?: Record<string, unknown>;
}

function failed(request: RequestEnvelope, reason: string, payer?: string, transaction = ""): SettleResponse {
  return {
    success: false,
    transaction,
    network: request.paymentRequirements.network,
    errorReason: reason,
    ...(payer ? { payer } : {}),
  };
}

export function persistedTransactionMaximumTime(envelopeXdr: string, network: StellarNetwork): bigint | undefined {
  try {
    const parsed = TransactionBuilder.fromXDR(envelopeXdr, networkPassphrase(network));
    const transaction = parsed instanceof FeeBumpTransaction ? parsed.innerTransaction : parsed;
    const maximumTime = transaction.timeBounds?.maxTime;
    return maximumTime && maximumTime !== "0" ? BigInt(maximumTime) : undefined;
  } catch {
    return undefined;
  }
}

export class FacilitatorCore {
  private readonly mechanisms = new Map<string, Mechanism>([
    ["exact", new ExactMechanism()],
    ["upto", new UptoMechanism()],
  ]);
  private readonly simulations: Semaphore;

  constructor(
    private readonly config: AppConfig,
    private readonly registry: RuntimeRegistry,
    private readonly state: StateStore,
    private readonly cataloger?: Cataloger,
    private readonly analytics?: AnalyticsStore,
  ) {
    this.simulations = new Semaphore(config.limits.maxConcurrentSimulations);
  }

  supported(): {
    kinds: Array<{ x402Version: number; scheme: string; network: StellarNetwork; extra: { areFeesSponsored: true } }>;
    extensions: string[];
    signers: Record<string, string[]>;
  } {
    const kinds: Array<{ x402Version: number; scheme: string; network: StellarNetwork; extra: { areFeesSponsored: true } }> = [];
    const signers = new Set<string>();
    for (const [network, runtime] of this.registry.networks) {
      kinds.push({ x402Version: 2, scheme: "exact", network, extra: { areFeesSponsored: true } });
      if (runtime.config.uptoContract) kinds.push({ x402Version: 2, scheme: "upto", network, extra: { areFeesSponsored: true } });
      signers.add(runtime.sponsor.address);
    }
    const extensions = ["payment-identifier"];
    if (this.config.catalog.autoCatalog) extensions.push("bazaar");
    return { kinds, extensions, signers: { "stellar:*": [...signers] } };
  }

  /**
   * Verifies a payment and then, as a separate soft-failing step, catalogs the
   * observation. Cataloging never changes `response`.
   */
  async verify(request: RequestEnvelope, principal: string): Promise<VerifyOutcome> {
    const response = await this.runVerify(request, principal);
    const extensionResponses = await this.catalog(request, "verified", {
      succeeded: response.isValid === true,
      ...(response.payer ? { payer: response.payer } : {}),
    });
    return { response, ...(extensionResponses ? { extensionResponses } : {}) };
  }

  /**
   * Settles a payment and then, as a separate soft-failing step, catalogs the
   * observation and records the analytics fact.
   */
  async settle(request: RequestEnvelope, principal: string): Promise<SettleOutcome> {
    const response = await this.runSettle(request, principal);
    const succeeded = "success" in response && response.success === true;
    const payer = "payer" in response && typeof response.payer === "string" ? response.payer : undefined;
    const extensionResponses = await this.catalog(request, "settled", {
      succeeded,
      ...(payer ? { payer } : {}),
      response: response as SettleResponse,
    });
    return { response, ...(extensionResponses ? { extensionResponses } : {}) };
  }

  private async runVerify(request: RequestEnvelope, principal: string): Promise<VerifyResponse> {
    const identifierError = paymentIdentifierError(request.paymentPayload);
    if (identifierError) return { isValid: false, invalidReason: identifierError };
    const context = this.context(request);
    const budgetScope = principalScope(context.network, context.runtime.sponsor.address, principal);
    if (!await this.state.consumeSimulations(budgetScope, 2, this.config.limits.maxSimulationsPerKeyPerMinute)) {
      return { isValid: false, invalidReason: "invalid_stellar_simulation_rate_exceeded" };
    }
    const { key, fingerprint } = idempotencyData(request);
    const idScope = paymentScope(context.network, context.runtime.sponsor.address, request.paymentPayload.accepted.payTo);
    const idempotency = await this.state.registerIdempotency(idScope, key, fingerprint, context.scheme, context.network);
    if (idempotency.conflict) throw new ConflictError("payment identifier conflict");
    return this.simulations.run(async () => (await context.mechanism.verify(request, context.runtime)).response);
  }

  private async runSettle(request: RequestEnvelope, principal: string): Promise<SettlementOutcome> {
    const identifierError = paymentIdentifierError(request.paymentPayload);
    if (identifierError) return failed(request, identifierError);
    const context = this.context(request);
    if (await this.state.unresolvedCount() >= this.config.limits.maxPendingSettlements) {
      throw new BusyError("maximum pending settlements reached");
    }
    const actual = parseInteger(request.paymentRequirements.amount);
    if (actual === undefined) return failed(request, "invalid_stellar_settlement_amount");
    const budgetScope = principalScope(context.network, context.runtime.sponsor.address, principal);
    const simulationCost = context.scheme === "exact" ? 4 : 2;
    if (!await this.state.consumeSimulations(
      budgetScope, simulationCost, this.config.limits.maxSimulationsPerKeyPerMinute,
    )) {
      return failed(request, "settle_stellar_simulation_rate_exceeded");
    }
    const { key, fingerprint } = idempotencyData(request);
    const claim = await this.state.claimSettlement({
      scope: paymentScope(context.network, context.runtime.sponsor.address, request.paymentPayload.accepted.payTo),
      key,
      fingerprint,
      scheme: context.scheme,
      network: context.network,
      actual,
      workerId: this.config.instanceId,
      leaseMs: this.config.limits.channelLeaseMs,
    });
    if (claim.kind === "conflict") throw new ConflictError(claim.message);
    if (claim.kind === "cached") return claim.record.response!;
    if (claim.kind === "wait") {
      const cached = await this.waitForOwner(claim.record.id, 5_000);
      if (cached?.response) return cached.response;
      throw new BusyError("identical settlement is already in progress");
    }
    if (claim.kind === "resume") return this.pollKnown(request, claim.record);

    const knownChannels = [...(this.registry.channels.get(context.network)?.keys() ?? [])];
    const lease = await this.state.leaseChannel(
      context.network,
      this.config.instanceId,
      this.config.limits.channelLeaseMs,
      knownChannels,
    );
    if (!lease) throw new BusyError("no channel account is currently available");
    const channel = this.registry.channels.get(context.network)?.get(lease.address);
    if (!channel) {
      await this.state.releaseChannel(lease);
      return failed(request, "settle_stellar_channel_key_unavailable");
    }
    let prepared;
    try {
      prepared = await this.simulations.run(() => context.mechanism.prepareSettlement(request, context.runtime, channel));
    } catch (error) {
      await this.state.releaseChannel(lease);
      const outcome = failed(request, "unexpected_settle_error");
      await this.state.complete(claim.record.id, outcome, "failed");
      return outcome;
    }
    if (isVerifyResponse(prepared)) {
      await this.state.releaseChannel(lease);
      const outcome = failed(request, prepared.invalidReason ?? "verification_failed", prepared.payer);
      await this.state.complete(claim.record.id, outcome, "failed");
      return outcome;
    }
    const stored = await this.state.storePreparedAndReserve({
      recordId: claim.record.id,
      lease,
      prepared,
      scope: budgetScope,
      perScopeDailyLimit: this.config.limits.maxSponsoredStroopsPerKeyPerDay,
      globalDailyLimit: this.config.limits.maxGlobalSponsoredStroopsPerDay,
    });
    if (stored !== "stored") {
      await this.state.releaseChannel(lease);
      const reason = stored === "budget_exceeded" ? "settle_stellar_sponsor_budget_exceeded" : "settle_stellar_channel_fence_lost";
      const outcome = failed(request, reason, prepared.payer);
      await this.state.complete(claim.record.id, outcome, "failed");
      return outcome;
    }
    const persisted = await this.state.getRecord(claim.record.id);
    if (!persisted) throw new Error("prepared settlement disappeared");
    return this.submitPersisted(request, persisted);
  }

  async recoverUnresolved(): Promise<void> {
    for (const record of await this.state.listUnresolved()) {
      if (!record.transactionHash || !this.registry.networks.has(record.network)) continue;
      await this.pollRecordWithoutRequest(record).catch(() => undefined);
    }
  }

  /**
   * Cataloging and analytics side channel.
   *
   * Runs only after the payment itself has been decided, catches everything,
   * and returns the official extension responses. A catalog failure produces a
   * `rejected` bazaar status, never an internal server error.
   */
  private async catalog(
    request: RequestEnvelope,
    stage: "verified" | "settled",
    outcome: { succeeded: boolean; payer?: string; response?: SettleResponse },
  ): Promise<Record<string, unknown> | undefined> {
    try {
      const network = request.paymentRequirements.network as StellarNetwork;
      const runtime = this.registry.networks.get(network);
      let settlementRecordId: number | undefined;
      let feeStroops: string | undefined;
      if (stage === "settled" && runtime) {
        const { key } = idempotencyData(request);
        const record = await this.state.findRecord(
          paymentScope(network, runtime.sponsor.address, request.paymentPayload.accepted.payTo),
          key,
        ).catch(() => undefined);
        settlementRecordId = record?.id;
        feeStroops = record?.estimatedFeeStroops?.toString();
      }

      let bazaar;
      if (outcome.succeeded && this.cataloger) {
        bazaar = await this.cataloger.observe(request, {
          stage,
          ...(outcome.payer ? { payer: outcome.payer } : {}),
          ...(settlementRecordId !== undefined ? { settlementRecordId } : {}),
        });
      }

      if (this.analytics && runtime && (stage === "settled" || outcome.succeeded)) {
        const asset = runtime.config.allowedAssets.get(request.paymentRequirements.asset);
        const response = outcome.response;
        const status = stage === "verified"
          ? "valid" as const
          : outcome.succeeded ? "success" as const
            : response?.errorReason === "settle_stellar_transaction_status_unknown"
              ? "unknown" as const : "failed" as const;
        await this.analytics.record({
          ...(settlementRecordId !== undefined ? { settlementRecordId } : {}),
          stage,
          status,
          network,
          scheme: request.paymentRequirements.scheme,
          asset: request.paymentRequirements.asset,
          ...(asset ? { assetSymbol: asset.symbol, assetDecimals: asset.decimals } : {}),
          ...(outcome.payer ? { payer: outcome.payer } : {}),
          payTo: request.paymentRequirements.payTo,
          maxAmount: String(request.paymentRequirements.amount),
          ...(outcome.succeeded ? { amount: String(response?.amount ?? request.paymentRequirements.amount) } : {}),
          ...(feeStroops ? { feeStroops } : {}),
          ...(response?.transaction ? { transactionHash: response.transaction } : {}),
          facilitatorId: runtime.sponsor.address,
          ...(bazaar?.resourceId ? { resourceId: bazaar.resourceId } : {}),
          ...(bazaar?.versionId ? { resourceVersionId: bazaar.versionId } : {}),
          ...(bazaar?.paymentOptionId ? { paymentOptionId: bazaar.paymentOptionId } : {}),
          ...(request.paymentPayload.resource?.url ? { resourceUrl: request.paymentPayload.resource.url } : {}),
          ...(response?.errorReason ? { errorReason: response.errorReason } : {}),
        });
      }
      return bazaar ? { bazaar: toWireResponse(bazaar) } : undefined;
    } catch {
      // Cataloging and analytics are strictly best-effort.
      return undefined;
    }
  }

  private context(request: RequestEnvelope) {
    const network = request.paymentRequirements.network as StellarNetwork;
    const runtime = this.registry.networks.get(network);
    if (!runtime) throw new Error("unsupported_network");
    const scheme = request.paymentRequirements.scheme as "exact" | "upto";
    const mechanism = this.mechanisms.get(scheme);
    if (!mechanism || (scheme === "upto" && !runtime.config.uptoContract)) throw new Error("unsupported_scheme");
    return { network, runtime, scheme, mechanism };
  }

  private async submitPersisted(request: RequestEnvelope, record: SettlementRecord): Promise<SettlementOutcome> {
    const runtime = this.registry.networks.get(request.paymentRequirements.network as StellarNetwork)!;
    const server = rpcServer(runtime);
    const transaction = TransactionBuilder.fromXDR(record.envelopeXdr!, networkPassphrase(runtime.config.id));
    try {
      let sent = await server.sendTransaction(transaction);
      if (sent.status === "TRY_AGAIN_LATER") {
        await new Promise(resolve => setTimeout(resolve, 1_000));
        sent = await server.sendTransaction(transaction);
      }
      if (sent.status === "ERROR") {
        const outcome = failed(request, "settle_stellar_transaction_submission_failed", record.payer, record.transactionHash);
        await this.state.complete(record.id, outcome, "failed");
        return outcome;
      }
      await this.state.markPending(record.id);
    } catch {
      await this.state.markUnknown(record.id, "rpc response lost after submission attempt");
    }
    return this.pollKnown(request, record);
  }

  private async pollKnown(request: RequestEnvelope, record: SettlementRecord): Promise<SettlementOutcome> {
    const network = request.paymentRequirements.network as StellarNetwork;
    const runtime = this.registry.networks.get(network)!;
    const result = await this.poll(record.transactionHash!, runtime);
    if (result === "SUCCESS") {
      const outcome: SettleResponse = {
        success: true,
        transaction: record.transactionHash!,
        network,
        ...(record.payer ? { payer: record.payer } : {}),
        ...(request.paymentRequirements.scheme === "upto" ? { amount: request.paymentRequirements.amount } : {}),
      };
      await this.state.complete(record.id, outcome, "success");
      return outcome;
    }
    if (result === "FAILED") {
      const outcome = failed(request, "settle_stellar_transaction_failed", record.payer, record.transactionHash);
      await this.state.complete(record.id, outcome, "failed");
      return outcome;
    }
    await this.state.markUnknown(record.id, "transaction was not resolved before polling deadline");
    return failed(request, "settle_stellar_transaction_status_unknown", record.payer, record.transactionHash);
  }

  private async poll(hash: string, runtime: RuntimeRegistry["networks"] extends Map<unknown, infer T> ? T : never): Promise<"SUCCESS" | "FAILED" | "UNKNOWN"> {
    const server = rpcServer(runtime);
    const deadline = Date.now() + this.config.limits.settleTimeoutMs;
    while (Date.now() < deadline) {
      try {
        const result = await server.getTransaction(hash);
        if (result.status === "SUCCESS" || result.status === "FAILED") return result.status;
      } catch {
        // A known hash remains the recovery anchor across transient RPC failures.
      }
      await new Promise(resolve => setTimeout(resolve, this.config.limits.settlePollMs));
    }
    return "UNKNOWN";
  }

  private async waitForOwner(id: number, timeoutMs: number): Promise<SettlementRecord | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const record = await this.state.getRecord(id);
      if (record?.response || record?.transactionHash) return record;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return undefined;
  }

  private async pollRecordWithoutRequest(record: SettlementRecord): Promise<void> {
    const runtime = this.registry.networks.get(record.network)!;
    let result: "SUCCESS" | "FAILED" | "UNKNOWN" | "NOT_FOUND" =
      await this.poll(record.transactionHash!, runtime);
    if (result === "UNKNOWN") {
      result = await this.horizonStatus(record.transactionHash!, runtime);
      if (result === "UNKNOWN") return;
      if (result === "NOT_FOUND") {
        if (!await this.persistedTransactionExpired(record, runtime)) return;
        const payer = record.payer ? { payer: record.payer } : {};
        await this.state.complete(record.id, {
          success: false,
          transaction: record.transactionHash!,
          network: record.network,
          ...payer,
          errorReason: "settle_stellar_transaction_expired_unconfirmed",
        }, "failed");
        return;
      }
    }
    const payer = record.payer ? { payer: record.payer } : {};
    const outcome: SettleResponse = result === "SUCCESS"
      ? {
          success: true,
          transaction: record.transactionHash!,
          network: record.network,
          ...payer,
          ...(record.scheme === "upto" && record.actualAmount !== undefined
            ? { amount: record.actualAmount.toString() }
            : {}),
        }
      : {
          success: false,
          transaction: record.transactionHash!,
          network: record.network,
          ...payer,
          errorReason: "settle_stellar_transaction_failed",
        };
    await this.state.complete(record.id, outcome, result === "SUCCESS" ? "success" : "failed");
  }

  private async horizonStatus(
    hash: string,
    runtime: RuntimeRegistry["networks"] extends Map<unknown, infer T> ? T : never,
  ): Promise<"SUCCESS" | "FAILED" | "NOT_FOUND" | "UNKNOWN"> {
    try {
      const endpoint = new URL(`/transactions/${encodeURIComponent(hash)}`, runtime.config.horizonUrl);
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) });
      if (response.status === 404) return "NOT_FOUND";
      if (!response.ok) return "UNKNOWN";
      const body = await response.json() as { successful?: boolean };
      if (body.successful === true) return "SUCCESS";
      if (body.successful === false) return "FAILED";
    } catch {
      // Horizon is corroboration only; an unavailable archive must not release a channel.
    }
    return "UNKNOWN";
  }

  private async persistedTransactionExpired(
    record: SettlementRecord,
    runtime: RuntimeRegistry["networks"] extends Map<unknown, infer T> ? T : never,
  ): Promise<boolean> {
    if (!record.envelopeXdr) return false;
    const maximumTime = persistedTransactionMaximumTime(record.envelopeXdr, runtime.config.id);
    if (maximumTime === undefined) return false;
    try {
      const latest = await rpcServer(runtime).getLatestLedger();
      return BigInt(latest.closeTime) > maximumTime;
    } catch {
      // Malformed state or an unavailable RPC is never sufficient to release a channel.
      return false;
    }
  }
}
