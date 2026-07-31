import { TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import type { SettleResponse, VerifyResponse } from "@x402/core/types";
import type { AppConfig, Mechanism, RequestEnvelope, SettlementOutcome, StellarNetwork } from "./types.js";
import type { RuntimeRegistry } from "./runtime.js";
import { StateStore, type SettlementRecord } from "./db/state.js";
import { idempotencyData, paymentIdentifierError, paymentScope, principalScope } from "./idempotency.js";
import { ExactMechanism } from "./stellar/exact.js";
import { UptoMechanism } from "./stellar/upto.js";
import { isVerifyResponse, networkPassphrase, parseInteger, rpcServer } from "./stellar/common.js";
import { Semaphore } from "./semaphore.js";

export class ConflictError extends Error {}
export class BusyError extends Error {}

function failed(request: RequestEnvelope, reason: string, payer?: string, transaction = ""): SettleResponse {
  return {
    success: false,
    transaction,
    network: request.paymentRequirements.network,
    errorReason: reason,
    ...(payer ? { payer } : {}),
  };
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
  ) {
    this.simulations = new Semaphore(config.limits.maxConcurrentSimulations);
  }

  supported(): {
    kinds: Array<{ x402Version: number; scheme: string; network: string; extra: { areFeesSponsored: true } }>;
    extensions: string[];
    signers: Record<string, string[]>;
  } {
    const kinds: Array<{ x402Version: number; scheme: string; network: string; extra: { areFeesSponsored: true } }> = [];
    const signers = new Set<string>();
    for (const [network, runtime] of this.registry.networks) {
      kinds.push({ x402Version: 2, scheme: "exact", network, extra: { areFeesSponsored: true } });
      if (runtime.config.uptoContract) kinds.push({ x402Version: 2, scheme: "upto", network, extra: { areFeesSponsored: true } });
      signers.add(runtime.sponsor.address);
    }
    return { kinds, extensions: ["payment-identifier"], signers: { "stellar:*": [...signers] } };
  }

  async verify(request: RequestEnvelope, principal: string): Promise<VerifyResponse> {
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

  async settle(request: RequestEnvelope, principal: string): Promise<SettlementOutcome> {
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
    const result = await this.poll(record.transactionHash!, runtime);
    if (result === "UNKNOWN") return;
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
}
