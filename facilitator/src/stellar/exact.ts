import { Operation, scValToNative } from "@stellar/stellar-sdk";
import type { Mechanism, NetworkRuntime, PreparedSettlement, RequestEnvelope, VerificationResult, ChannelSigner } from "../types.js";
import {
  addressOfAuth,
  authInvocation,
  buildSourceTransaction,
  finalizeSponsoredTransaction,
  invalid,
  isSignedEnough,
  isVerifyResponse,
  networkPassphrase,
  operationInvocation,
  operationWithAuth,
  parseClientTransaction,
  parseInteger,
  preparedFrom,
  rpcServer,
  simulate,
  transactionOperation,
  validateAuthExpiration,
  validateEnvelope,
  validateExactTransferEvents,
  validateFee,
} from "./common.js";
import { X402StellarExactVerifier, type ExactProtocolVerifier } from "./upstream-exact.js";

// @x402/stellar 2.20.0 over-rejects unrelated contract events before it
// reaches auth validation. These two cases may continue only into the complete
// local hardening path, which performs signed-auth and exact-transfer checks.
const UPSTREAM_EVENT_COMPATIBILITY_REASONS = new Set([
  "invalid_exact_stellar_payload_event_not_transfer",
  "invalid_exact_stellar_payload_event_wrong_asset",
]);

export class ExactMechanism implements Mechanism {
  constructor(private readonly protocol: ExactProtocolVerifier = new X402StellarExactVerifier()) {}

  async verify(request: RequestEnvelope, runtime: NetworkRuntime): Promise<VerificationResult> {
    const structural = validateEnvelope(request, runtime, "exact", "verify");
    if (structural) return { response: structural };
    let upstream;
    try {
      upstream = await this.protocol.verify(request, runtime);
    } catch (error) {
      return {
        response: invalid(
          "unexpected_verify_error",
          undefined,
          error instanceof Error ? error.message : String(error),
        ),
      };
    }
    if (!upstream.isValid && !UPSTREAM_EVENT_COMPATIBILITY_REASONS.has(upstream.invalidReason ?? "")) {
      return {
        response: upstream.invalidReason
          ? upstream
          : invalid("unexpected_verify_error", upstream.payer, upstream.invalidMessage),
      };
    }
    const passphrase = networkPassphrase(runtime.config.id);
    const transaction = parseClientTransaction(request.paymentPayload, passphrase);
    if (isVerifyResponse(transaction)) return { response: transaction };
    const operation = transactionOperation(transaction, runtime.unsafeInternalAddresses);
    if (isVerifyResponse(operation)) return { response: operation };
    const invocation = operationInvocation(operation);
    if (!invocation || invocation.contract !== request.paymentRequirements.asset || invocation.functionName !== "transfer" || invocation.args.length !== 3) {
      return { response: invalid("invalid_exact_stellar_payload_wrong_invocation") };
    }
    const from = String(scValToNative(invocation.args[0]!));
    const to = String(scValToNative(invocation.args[1]!));
    const amount = BigInt(scValToNative(invocation.args[2]!) as bigint);
    if (upstream.isValid && upstream.payer !== from) {
      return { response: invalid("invalid_exact_stellar_upstream_payer_mismatch", from) };
    }
    if (runtime.unsafeInternalAddresses.has(from)) return { response: invalid("invalid_exact_stellar_facilitator_is_payer", from) };
    if (to !== request.paymentRequirements.payTo) return { response: invalid("invalid_exact_stellar_wrong_recipient", from) };
    const required = parseInteger(request.paymentRequirements.amount);
    if (required === undefined || amount !== required) return { response: invalid("invalid_exact_stellar_wrong_amount", from) };
    if (!operation.auth || operation.auth.length !== 1) return { response: invalid("invalid_exact_stellar_wrong_auth_count", from) };
    const auth = operation.auth[0]!;
    if (addressOfAuth(auth) !== from || !isSignedEnough(auth)) return { response: invalid("invalid_exact_stellar_missing_payer_signature", from) };
    if (auth.rootInvocation().subInvocations().length !== 0) return { response: invalid("invalid_exact_stellar_has_subinvocations", from) };
    const authRoot = operationInvocationFromAuth(auth);
    if (!authRoot || authRoot.contract !== invocation.contract || authRoot.functionName !== "transfer" || authRoot.argsXdr !== argsXdr(invocation.args)) {
      return { response: invalid("invalid_exact_stellar_auth_tree_mismatch", from) };
    }
    const server = rpcServer(runtime);
    const expiration = await validateAuthExpiration(auth, server, request.paymentRequirements.maxTimeoutSeconds);
    if (expiration) return { response: { ...expiration, payer: from } };
    // The canonical verifier above supplies the record-mode simulation. This
    // enforcing pass is the operator hardening gate for custom __check_auth
    // accounts and token-side behavior.
    const enforcingTx = await buildSourceTransaction(
      server,
      runtime.simulationSource.address,
      Operation.invokeHostFunction(operation),
      passphrase,
      request.paymentRequirements.maxTimeoutSeconds,
    );
    const enforcing = await simulate(server, enforcingTx, "enforce");
    if (isVerifyResponse(enforcing)) return { response: { ...enforcing, payer: from } };
    const feeError = validateFee(enforcing, runtime.config.exactFee, from);
    if (feeError) return { response: feeError };
    const transferError = validateExactTransferEvents(enforcing.events, { asset: invocation.contract, from, to, amount });
    if (transferError) return { response: { ...transferError, payer: from } };
    return {
      response: { isValid: true, payer: from },
      parsed: { scheme: "exact", network: runtime.config.id, payer: from, maximum: amount, actual: amount },
    };
  }

  async prepareSettlement(
    request: RequestEnvelope,
    runtime: NetworkRuntime,
    channel: ChannelSigner,
  ): Promise<PreparedSettlement | ReturnType<typeof invalid>> {
    const verified = await this.verify(request, runtime);
    if (!verified.response.isValid || !verified.parsed) return verified.response;
    const passphrase = networkPassphrase(runtime.config.id);
    const transaction = parseClientTransaction(request.paymentPayload, passphrase);
    if (isVerifyResponse(transaction)) return transaction;
    const operation = transactionOperation(transaction, runtime.unsafeInternalAddresses);
    if (isVerifyResponse(operation)) return operation;
    const server = rpcServer(runtime);
    const recordingTx = await buildSourceTransaction(
      server, channel.address, operationWithAuth(operation, []), passphrase, request.paymentRequirements.maxTimeoutSeconds,
    );
    const recording = await simulate(server, recordingTx, "record");
    if (isVerifyResponse(recording)) return { ...recording, payer: verified.parsed.payer };
    const sourceTransaction = await buildSourceTransaction(
      server, channel.address, Operation.invokeHostFunction(operation), passphrase, request.paymentRequirements.maxTimeoutSeconds,
    );
    const enforcing = await simulate(server, sourceTransaction, "enforce");
    if (isVerifyResponse(enforcing)) return { ...enforcing, payer: verified.parsed.payer };
    const feeError = validateFee(enforcing, runtime.config.exactFee, verified.parsed.payer);
    if (feeError) return feeError;
    const invocation = operationInvocation(operation)!;
    const transferError = validateExactTransferEvents(enforcing.events, {
      asset: invocation.contract,
      from: verified.parsed.payer,
      to: request.paymentRequirements.payTo,
      amount: verified.parsed.actual,
    });
    if (transferError) return { ...transferError, payer: verified.parsed.payer };
    const finalized = finalizeSponsoredTransaction({ sourceTransaction, enforcing, channel, sponsor: runtime.sponsor, passphrase });
    return preparedFrom(verified.parsed, channel, finalized, enforcing);
  }
}

function argsXdr(args: readonly { toXDR(): Buffer }[]): string {
  return Buffer.concat(args.map(arg => arg.toXDR())).toString("base64");
}

function operationInvocationFromAuth(entry: NonNullable<Operation.InvokeHostFunction["auth"]>[number]):
  { contract: string; functionName: string; argsXdr: string } | undefined {
  const parsed = authInvocation(entry.rootInvocation());
  return parsed ? { contract: parsed.contract, functionName: parsed.functionName, argsXdr: argsXdr(parsed.args) } : undefined;
}
