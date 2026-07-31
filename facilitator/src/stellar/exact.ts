import { Operation, scValToNative } from "@stellar/stellar-sdk";
import type { Mechanism, NetworkRuntime, ParsedPayment, PreparedSettlement, RequestEnvelope, VerificationResult, ChannelSigner } from "../types.js";
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
  sameTransfers,
  simulate,
  tokenTransfers,
  transactionOperation,
  validateAuthExpiration,
  validateEnvelope,
  validateFee,
} from "./common.js";

export class ExactMechanism implements Mechanism {
  async verify(request: RequestEnvelope, runtime: NetworkRuntime): Promise<VerificationResult> {
    const structural = validateEnvelope(request, runtime, "exact", "verify");
    if (structural) return { response: structural };
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
    const recordingTx = await buildSourceTransaction(
      server,
      runtime.simulationSource.address,
      operationWithAuth(operation, []),
      passphrase,
      request.paymentRequirements.maxTimeoutSeconds,
    );
    const recording = await simulate(server, recordingTx, "record");
    if (isVerifyResponse(recording)) return { response: { ...recording, payer: from } };
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
    const transfers = tokenTransfers(enforcing.events, invocation.contract);
    if (!sameTransfers(transfers, [{ from, to, amount }])) return {
      response: invalid("invalid_exact_stellar_unexpected_balance_changes", from, transferSummary(transfers)),
    };
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
    const transfers = tokenTransfers(enforcing.events, invocation.contract);
    if (!sameTransfers(transfers, [{
      from: verified.parsed.payer,
      to: request.paymentRequirements.payTo,
      amount: verified.parsed.actual,
    }])) return invalid("invalid_exact_stellar_unexpected_balance_changes", verified.parsed.payer, transferSummary(transfers));
    const finalized = finalizeSponsoredTransaction({ sourceTransaction, enforcing, channel, sponsor: runtime.sponsor, passphrase });
    return preparedFrom(verified.parsed, channel, finalized, enforcing);
  }
}

function argsXdr(args: readonly { toXDR(): Buffer }[]): string {
  return Buffer.concat(args.map(arg => arg.toXDR())).toString("base64");
}

function transferSummary(transfers: Array<{ from: string; to: string; amount: bigint }>): string {
  return JSON.stringify(transfers, (_key, value) => typeof value === "bigint" ? value.toString() : value);
}

function operationInvocationFromAuth(entry: NonNullable<Operation.InvokeHostFunction["auth"]>[number]):
  { contract: string; functionName: string; argsXdr: string } | undefined {
  const parsed = authInvocation(entry.rootInvocation());
  return parsed ? { contract: parsed.contract, functionName: parsed.functionName, argsXdr: argsXdr(parsed.args) } : undefined;
}
