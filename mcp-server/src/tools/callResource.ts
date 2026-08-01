import { x402Client } from "@x402/core/client";
import { attachPaymentToMeta, extractPaymentResponseFromMeta } from "@x402/mcp";
import type { PaymentRequired, SettleResponse } from "@x402/core/types";
import type { AppConfig } from "../config.js";
import type { BudgetStore } from "../budget/budgetStore.js";
import { reserveForCall } from "../budget/budgetPolicy.js";
import { buildSchemeRegistry, resolveScheme, UptoUnavailableError } from "../payment/schemeRegistry.js";
import type { SignerProvider } from "../payment/signerProvider.js";
import { computePaymentIdentifier, newInvocationNonce, type SingleRetryGuard } from "../payment/paymentIdentifier.js";
import { FacilitatorClient } from "../facilitatorClient.js";
import { decodeResourceRef, computeVersionHash } from "../resourceRef.js";
import { guardAgainstCatalog } from "../catalogGuard.js";
import { validatePaymentRequiredDualCopy } from "../transport.js";
import { connectMcpClient, resolveConnectableEndpoint, type McpTransportKind, type McpConnectionConfig } from "../network/mcpConnection.js";
import { McpToolError } from "../errors.js";
import type { PaymentReceipt, StellarNetwork } from "../types.js";

export interface CallResourceInput {
  ref: string;
  expectedVersionHash?: string;
  toolArguments: Record<string, unknown>;
  network: StellarNetwork;
  scheme: "exact" | "upto";
  asset: string;
  maxAtomicAmount: string;
  agentId: string;
  sessionId?: string;
}

export interface CallResourceDeps {
  facilitatorClient: FacilitatorClient;
  budgetStore: BudgetStore;
  signerProvider?: SignerProvider;
  config: AppConfig;
  retryGuard: SingleRetryGuard;
  mcpConnectionConfig: McpConnectionConfig;
}

export interface CallResourceOutput {
  content: unknown;
  receipt: PaymentReceipt;
}

function bazaarTransport(extensions: Record<string, unknown> | undefined): McpTransportKind {
  const bazaar = extensions?.bazaar as Record<string, unknown> | undefined;
  const info = bazaar?.info as Record<string, unknown> | undefined;
  const input = info?.input as Record<string, unknown> | undefined;
  return input?.transport === "sse" ? "sse" : "streamable-http";
}

/**
 * The guarded discover-pay-retry orchestrator behind `x402_call_resource`.
 * Implements the 11-step state machine from `reference/architecture/mcp.md`:
 * resolve -> connect -> call unpaid -> validate dual-copy -> guard against
 * catalog -> reserve budget -> mint one Payment Identifier -> sign and retry
 * -> validate settlement -> return output + receipt. There is only one
 * automatic paid retry, and no fresh authorization is ever constructed after
 * an ambiguous response.
 */
export async function callResource(deps: CallResourceDeps, input: CallResourceInput): Promise<CallResourceOutput> {
  const identity = decodeResourceRef(input.ref);
  if (identity.type !== "mcp" || !identity.toolName) {
    throw new McpToolError("INVALID_ARGUMENT", "x402_call_resource only calls MCP tool resources");
  }

  // Step 1: resolve the ref against the active catalog version.
  const catalogResource = await deps.facilitatorClient.getResource(identity);
  if (!catalogResource) {
    throw new McpToolError("NO_RESULTS", "no active catalog entry for this resource reference");
  }
  const versionHash = computeVersionHash(catalogResource);
  if (input.expectedVersionHash && input.expectedVersionHash !== versionHash) {
    throw new McpToolError("RESOURCE_STALE", "the catalog version has changed since this reference was obtained", {
      expectedVersionHash: input.expectedVersionHash, actualVersionHash: versionHash,
    });
  }

  // pubnet fail-closed gate: signer, authenticated access and a durable
  // budget store are all required before a pubnet payment is even attempted.
  if (input.network === "stellar:pubnet") {
    if (!deps.config.networks.pubnet) {
      throw new McpToolError("PAYMENT_REJECTED", "stellar:pubnet is not enabled on this server");
    }
    if (deps.config.transport !== "stdio" && deps.config.httpApiKeys.length === 0) {
      throw new McpToolError("PAYMENT_REJECTED", "pubnet paid calls require authenticated access");
    }
    if (deps.config.budget.store === "memory" && deps.config.transport !== "stdio") {
      throw new McpToolError("PAYMENT_REJECTED", "pubnet paid calls require a durable budget store");
    }
  }
  if (!deps.signerProvider) {
    throw new McpToolError("PAYMENT_REJECTED", "no signer is configured; paid calls are disabled");
  }

  // Step 2: connect only to this version's cataloged, already-active endpoint.
  const endpoint = resolveConnectableEndpoint(catalogResource.resource, deps.mcpConnectionConfig);
  const transportKind = bazaarTransport(catalogResource.extensions);
  const bound = await connectMcpClient(endpoint, transportKind, deps.mcpConnectionConfig);

  let paymentIdentifier: string | undefined;
  try {
    // Step 3: call the declared tool without payment, exact supplied arguments.
    const unpaidRaw = await bound.client.callTool({ name: identity.toolName, arguments: input.toolArguments });

    // Step 4: parse and validate both PaymentRequired copies.
    const liveChallenge: PaymentRequired = validatePaymentRequiredDualCopy(unpaidRaw as never);

    // Steps 5-6: the live challenge must match the selected catalog version.
    guardAgainstCatalog({
      liveChallenge, catalogResource, identity,
      selection: { network: input.network, scheme: input.scheme, asset: input.asset },
    });

    const accepted = liveChallenge.accepts.find(
      option => option.network === input.network && option.scheme === input.scheme && option.asset === input.asset,
    );
    if (!accepted) {
      throw new McpToolError("INVALID_ARGUMENT", "selected network/scheme/asset is not offered by this resource");
    }

    // Step 7: apply the local budget before constructing or signing authorization.
    const requiredAtomic = BigInt(accepted.amount);
    const suppliedMax = BigInt(input.maxAtomicAmount);
    const perCallLimit = suppliedMax < deps.config.budget.defaultPerCallMaxAtomic
      ? suppliedMax : deps.config.budget.defaultPerCallMaxAtomic;

    // Step 8: one official Payment Identifier for this logical invocation.
    const nonce = newInvocationNonce();
    paymentIdentifier = computePaymentIdentifier({
      ref: input.ref, versionHash, network: input.network, scheme: input.scheme,
      asset: input.asset, maxAtomicAmount: input.maxAtomicAmount, nonce,
    });
    if (!deps.retryGuard.claim(paymentIdentifier)) {
      throw new McpToolError("INVALID_ARGUMENT", "duplicate payment identifier generated within this process");
    }

    await reserveForCall(deps.budgetStore, {
      paymentIdentifier, agentId: input.agentId, resourceRef: input.ref,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      network: input.network, asset: input.asset, scheme: input.scheme,
      perCallMaxAtomic: perCallLimit, sessionOrDayMaxAtomic: deps.config.budget.defaultSessionOrDayMaxAtomic,
      x402RequiredAtomic: requiredAtomic,
    });

    // Step 9: construct the canonical payload and retry with the same arguments.
    const signer = await deps.signerProvider.getSigner(input.network);
    let paymentPayload;
    try {
      const registry = buildSchemeRegistry(signer);
      const schemeClient = resolveScheme(registry, input.scheme);
      const paymentClient = new x402Client().register(input.network, schemeClient);
      // Scope accepts to exactly the option the caller selected, so the
      // library's own selection policy can never silently pick a different one.
      paymentPayload = await paymentClient.createPaymentPayload({ ...liveChallenge, accepts: [accepted] });
    } catch (error) {
      await deps.budgetStore.release(paymentIdentifier);
      if (error instanceof UptoUnavailableError) throw error;
      throw new McpToolError("PAYMENT_REJECTED", `failed to construct or sign the payment: ${(error as Error).message}`, { paymentIdentifier });
    }

    const paidParams = attachPaymentToMeta({ name: identity.toolName, arguments: input.toolArguments }, paymentPayload);
    let paidRaw: unknown;
    try {
      paidRaw = await bound.client.callTool(paidParams as never);
    } catch (error) {
      // The request itself failed (network/timeout) after a payload was
      // already signed. Nothing here confirms the seller ever saw it, so
      // this is ambiguous, not a confirmed failure -- keep the reservation.
      await deps.budgetStore.markUnknown(paymentIdentifier);
      throw new McpToolError("SETTLEMENT_UNKNOWN", `no confirmed response after the paid retry: ${(error as Error).message}`, {
        paymentIdentifier, pollingHint: "poll facilitator settlement status for this payment identifier",
      });
    }

    // Step 10: validate payment-response success, network, payer, amount, transaction.
    const settleResponse = extractPaymentResponseFromMeta(paidRaw as never) as SettleResponse | null;
    if (!settleResponse) {
      const stillChallenged = looksLikePaymentRequiredResult(paidRaw);
      if (stillChallenged) {
        await deps.budgetStore.release(paymentIdentifier);
        throw new McpToolError("PAYMENT_REJECTED", "the paid retry was rejected: seller returned another PaymentRequired", { paymentIdentifier });
      }
      await deps.budgetStore.markUnknown(paymentIdentifier);
      throw new McpToolError("SETTLEMENT_UNKNOWN", "no payment-response metadata was returned after the paid retry", { paymentIdentifier });
    }
    if (!settleResponse.success) {
      await deps.budgetStore.release(paymentIdentifier);
      throw new McpToolError("PAYMENT_REJECTED", settleResponse.errorReason ?? "settlement reported failure", { paymentIdentifier });
    }
    if (settleResponse.network !== input.network || (settleResponse.payer && settleResponse.payer !== signer.address)) {
      await deps.budgetStore.markUnknown(paymentIdentifier, settleResponse.transaction);
      throw new McpToolError("SETTLEMENT_UNKNOWN", "payment-response network/payer did not match the authorized payment", {
        paymentIdentifier, pollingHint: "poll facilitator settlement status for this payment identifier",
      });
    }

    const settledAmount = BigInt(settleResponse.amount ?? accepted.amount);
    await deps.budgetStore.reconcile(paymentIdentifier, settledAmount, settleResponse.transaction);

    // Step 11: return upstream tool output unchanged, with a structured receipt.
    const result = paidRaw as { content: unknown };
    return {
      content: result.content,
      receipt: {
        paymentIdentifier, ref: input.ref, versionHash, network: input.network, scheme: input.scheme,
        asset: input.asset, payTo: accepted.payTo, authorizedAmount: requiredAtomic.toString(),
        settledAmount: settledAmount.toString(), transaction: settleResponse.transaction, status: "settled",
      },
    };
  } finally {
    await bound.close();
  }
}

function looksLikePaymentRequiredResult(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { isError?: boolean; structuredContent?: unknown };
  return record.isError === true && typeof record.structuredContent === "object";
}
