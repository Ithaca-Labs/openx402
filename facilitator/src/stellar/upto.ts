import {
  Address,
  Contract,
  Operation,
  inspectAuthEntry,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import type { VerifyResponse } from "@x402/core/types";
import type {
  ChannelSigner,
  Mechanism,
  NetworkRuntime,
  ParsedPayment,
  PreparedSettlement,
  RequestEnvelope,
  VerificationResult,
} from "../types.js";
import { paymentIdentifier, settlementIdForPaymentIdentifier } from "../idempotency.js";
import {
  addressOfAuth,
  authInvocation,
  buildSourceTransaction,
  cloneAuth,
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
  signFacilitatorAuth,
  simulate,
  tokenTransfers,
  transactionOperation,
  validateAuthExpiration,
  validateEnvelope,
  validateFee,
} from "./common.js";

interface UptoTerms {
  contract: string;
  payer: string;
  payTo: string;
  token: string;
  maximum: bigint;
  validAfter: number;
  deadline: number;
  facilitator: string;
  settlementId: Uint8Array;
  settlementHook?: string;
  actual: bigint;
}

export class UptoMechanism implements Mechanism {
  async verify(request: RequestEnvelope, runtime: NetworkRuntime): Promise<VerificationResult> {
    const checked = await this.validateAndSimulate(request, runtime, "verify");
    if (isVerifyResponse(checked)) return { response: checked };
    return {
      response: { isValid: true, payer: checked.terms.payer },
      parsed: parsedPayment(runtime, checked.terms),
    };
  }

  async prepareSettlement(
    request: RequestEnvelope,
    runtime: NetworkRuntime,
    channel: ChannelSigner,
  ): Promise<PreparedSettlement | VerifyResponse> {
    const structural = validateEnvelope(request, runtime, "upto", "settle");
    if (structural) return structural;
    const actual = parseInteger(request.paymentRequirements.amount);
    if (actual === undefined) return invalid("invalid_upto_stellar_actual_malformed");
    const passphrase = networkPassphrase(runtime.config.id);
    const clientTransaction = parseClientTransaction(request.paymentPayload, passphrase);
    if (isVerifyResponse(clientTransaction)) return clientTransaction;
    const clientOperation = transactionOperation(clientTransaction, runtime.unsafeInternalAddresses);
    if (isVerifyResponse(clientOperation)) return clientOperation;
    const terms = parseTerms(clientOperation);
    if (isVerifyResponse(terms)) return terms;
    const termsError = validateTerms(terms, request, runtime, "settle", actual);
    if (termsError) return termsError;
    const payerEntry = findPayerEntry(clientOperation, terms.payer);
    if (isVerifyResponse(payerEntry)) return payerEntry;
    const payerTreeError = validatePayerTree(payerEntry, terms, runtime.config.uptoContract!);
    if (payerTreeError) return payerTreeError;
    const server = rpcServer(runtime);
    const expirationError = await validateUptoExpiration(payerEntry, terms, server, request.paymentRequirements.maxTimeoutSeconds);
    if (expirationError) return expirationError;

    const settlementOperation = buildSettlementOperation({ ...terms, actual }, runtime.config.uptoContract!, []);
    const recordingTx = await buildSourceTransaction(
      server, channel.address, settlementOperation, passphrase, request.paymentRequirements.maxTimeoutSeconds,
    );
    const recording = await simulate(server, recordingTx, "record");
    if (isVerifyResponse(recording)) return { ...recording, payer: terms.payer };
    const recordedAuth = recording.result?.auth ?? [];
    const recordedPayer = recordedAuth.find(entry => addressOfAuth(entry) === terms.payer);
    const recordedFacilitator = recordedAuth.find(entry => addressOfAuth(entry) === runtime.sponsor.address);
    if (!recordedPayer || !recordedFacilitator || recordedAuth.length !== 2) {
      return invalid("invalid_upto_stellar_recorded_auth_tree", terms.payer);
    }
    if (recordedPayer.rootInvocation().toXDR().toString("base64") !== payerEntry.rootInvocation().toXDR().toString("base64")) {
      return invalid("invalid_upto_stellar_payer_auth_tree_mismatch", terms.payer);
    }
    const facilitatorEntry = await signFacilitatorAuth(
      recordedFacilitator, runtime.sponsor, terms.deadline, passphrase,
    );
    const signedOperation = buildSettlementOperation(
      { ...terms, actual }, runtime.config.uptoContract!, [cloneAuth(payerEntry), facilitatorEntry],
    );
    const enforcingTx = await buildSourceTransaction(
      server, channel.address, signedOperation, passphrase, request.paymentRequirements.maxTimeoutSeconds,
    );
    const enforcing = await simulate(server, enforcingTx, "enforce");
    if (isVerifyResponse(enforcing)) return { ...enforcing, payer: terms.payer };
    const feeError = validateFee(enforcing, runtime.config.uptoFee, terms.payer);
    if (feeError) return feeError;
    const transferError = validateUptoTransfers(enforcing.events, { ...terms, actual }, runtime.config.uptoContract!);
    if (transferError) return transferError;
    const finalized = finalizeSponsoredTransaction({
      sourceTransaction: enforcingTx,
      enforcing,
      channel,
      sponsor: runtime.sponsor,
      passphrase,
    });
    return preparedFrom(parsedPayment(runtime, { ...terms, actual }), channel, finalized, enforcing);
  }

  private async validateAndSimulate(
    request: RequestEnvelope,
    runtime: NetworkRuntime,
    phase: "verify",
  ): Promise<{ terms: UptoTerms } | VerifyResponse> {
    const structural = validateEnvelope(request, runtime, "upto", phase);
    if (structural) return structural;
    if (!runtime.config.uptoContract) return invalid("unsupported_upto_stellar_contract_not_configured");
    const passphrase = networkPassphrase(runtime.config.id);
    const clientTransaction = parseClientTransaction(request.paymentPayload, passphrase);
    if (isVerifyResponse(clientTransaction)) return clientTransaction;
    const clientOperation = transactionOperation(clientTransaction, runtime.unsafeInternalAddresses);
    if (isVerifyResponse(clientOperation)) return clientOperation;
    const terms = parseTerms(clientOperation);
    if (isVerifyResponse(terms)) return terms;
    const termsError = validateTerms(terms, request, runtime, phase, terms.maximum);
    if (termsError) return termsError;
    const payerEntry = findPayerEntry(clientOperation, terms.payer);
    if (isVerifyResponse(payerEntry)) return payerEntry;
    const payerTreeError = validatePayerTree(payerEntry, terms, runtime.config.uptoContract);
    if (payerTreeError) return payerTreeError;
    const facilitatorEntry = clientOperation.auth?.find(entry => addressOfAuth(entry) === runtime.sponsor.address);
    if (!facilitatorEntry || clientOperation.auth?.length !== 2) {
      return invalid("invalid_upto_stellar_wrong_auth_count", terms.payer);
    }
    const facilitatorRoot = authInvocation(facilitatorEntry.rootInvocation());
    if (!facilitatorRoot || facilitatorRoot.contract !== runtime.config.uptoContract ||
      facilitatorRoot.functionName !== "settle" || facilitatorRoot.args.length !== 10 ||
      argsXdr(facilitatorRoot.args) !== argsXdr(operationInvocation(clientOperation)!.args)) {
      return invalid("invalid_upto_stellar_facilitator_auth_tree_mismatch", terms.payer);
    }
    const server = rpcServer(runtime);
    const expirationError = await validateUptoExpiration(payerEntry, terms, server, request.paymentRequirements.maxTimeoutSeconds);
    if (expirationError) return expirationError;
    const recordingTx = await buildSourceTransaction(
      server, runtime.simulationSource.address, operationWithAuth(clientOperation, []), passphrase, request.paymentRequirements.maxTimeoutSeconds,
    );
    const recording = await simulate(server, recordingTx, "record");
    if (isVerifyResponse(recording)) return { ...recording, payer: terms.payer };
    const signedFacilitator = await signFacilitatorAuth(
      facilitatorEntry, runtime.sponsor, terms.deadline, passphrase,
    );
    const signedOperation = operationWithAuth(clientOperation, [cloneAuth(payerEntry), signedFacilitator]);
    const enforcingTx = await buildSourceTransaction(
      server, runtime.simulationSource.address, signedOperation, passphrase, request.paymentRequirements.maxTimeoutSeconds,
    );
    const enforcing = await simulate(server, enforcingTx, "enforce");
    if (isVerifyResponse(enforcing)) return { ...enforcing, payer: terms.payer };
    const feeError = validateFee(enforcing, runtime.config.uptoFee, terms.payer);
    if (feeError) return feeError;
    const transferError = validateUptoTransfers(enforcing.events, terms, runtime.config.uptoContract);
    if (transferError) return transferError;
    return { terms };
  }
}

function parseTerms(operation: Operation.InvokeHostFunction): UptoTerms | VerifyResponse {
  const invocation = operationInvocation(operation);
  if (!invocation || invocation.functionName !== "settle" || invocation.args.length !== 10) {
    return invalid("invalid_upto_stellar_wrong_invocation");
  }
  try {
    const rawId = scValToNative(invocation.args[7]!);
    const settlementId = rawId instanceof Uint8Array ? rawId : new Uint8Array(rawId as Buffer);
    if (settlementId.length !== 32) return invalid("invalid_upto_stellar_settlement_id");
    const hook = scValToNative(invocation.args[8]!);
    return {
      contract: invocation.contract,
      payer: String(scValToNative(invocation.args[0]!)),
      payTo: String(scValToNative(invocation.args[1]!)),
      token: String(scValToNative(invocation.args[2]!)),
      maximum: BigInt(scValToNative(invocation.args[3]!) as bigint),
      validAfter: Number(scValToNative(invocation.args[4]!)),
      deadline: Number(scValToNative(invocation.args[5]!)),
      facilitator: String(scValToNative(invocation.args[6]!)),
      settlementId,
      ...(typeof hook === "string" ? { settlementHook: hook } : {}),
      actual: BigInt(scValToNative(invocation.args[9]!) as bigint),
    };
  } catch {
    return invalid("invalid_upto_stellar_malformed_arguments");
  }
}

function validateTerms(
  terms: UptoTerms,
  request: RequestEnvelope,
  runtime: NetworkRuntime,
  phase: "verify" | "settle",
  actual: bigint,
): VerifyResponse | undefined {
  if (terms.contract !== runtime.config.uptoContract) return invalid("invalid_upto_stellar_wrong_contract", terms.payer);
  const maximum = parseInteger(request.paymentPayload.accepted.amount);
  if (maximum === undefined || terms.maximum !== maximum) return invalid("invalid_upto_stellar_wrong_maximum", terms.payer);
  if (terms.maximum <= 0 || actual < 0 || actual > terms.maximum) return invalid("invalid_upto_stellar_actual_out_of_range", terms.payer);
  if (phase === "verify" && terms.actual !== terms.maximum) return invalid("invalid_upto_stellar_verify_actual_not_maximum", terms.payer);
  if (terms.payTo !== request.paymentRequirements.payTo) return invalid("invalid_upto_stellar_wrong_recipient", terms.payer);
  if (terms.token !== request.paymentRequirements.asset) return invalid("invalid_upto_stellar_wrong_asset", terms.payer);
  if (terms.facilitator !== runtime.sponsor.address) return invalid("invalid_upto_stellar_wrong_facilitator", terms.payer);
  if (runtime.unsafeInternalAddresses.has(terms.payer)) return invalid("invalid_upto_stellar_facilitator_is_payer", terms.payer);
  if (terms.validAfter > terms.deadline) return invalid("invalid_upto_stellar_invalid_ledger_window", terms.payer);
  if (terms.settlementHook && !runtime.config.allowedSettlementHooks.has(terms.settlementHook)) {
    return invalid("invalid_upto_stellar_settlement_hook_not_allowed", terms.payer);
  }
  if (terms.settlementHook === runtime.config.uptoContract || terms.settlementHook === terms.token) {
    return invalid("invalid_upto_stellar_forbidden_settlement_hook", terms.payer);
  }
  const identifier = paymentIdentifier(request.paymentPayload);
  if (identifier) {
    const expected = settlementIdForPaymentIdentifier(identifier);
    if (!Buffer.from(terms.settlementId).equals(expected)) {
      return invalid("invalid_upto_stellar_settlement_id_mismatch", terms.payer);
    }
  }
  return undefined;
}

function findPayerEntry(operation: Operation.InvokeHostFunction, payer: string): xdr.SorobanAuthorizationEntry | VerifyResponse {
  const entry = operation.auth?.find(candidate => addressOfAuth(candidate) === payer);
  if (!entry || !isSignedEnough(entry)) return invalid("invalid_upto_stellar_missing_payer_signature", payer);
  return entry;
}

function validatePayerTree(
  entry: xdr.SorobanAuthorizationEntry,
  terms: UptoTerms,
  settlementContract: string,
): VerifyResponse | undefined {
  const root = authInvocation(entry.rootInvocation());
  if (!root || root.contract !== settlementContract || root.functionName !== "settle" || root.args.length !== 8) {
    return invalid("invalid_upto_stellar_payer_auth_root", terms.payer);
  }
  const expectedRoot = [
    nativeToScVal(terms.payTo, { type: "address" }),
    nativeToScVal(terms.token, { type: "address" }),
    nativeToScVal(terms.maximum, { type: "i128" }),
    nativeToScVal(terms.validAfter, { type: "u32" }),
    nativeToScVal(terms.deadline, { type: "u32" }),
    nativeToScVal(terms.facilitator, { type: "address" }),
    nativeToScVal(terms.settlementId, { type: "bytes" }),
    terms.settlementHook ? nativeToScVal(terms.settlementHook, { type: "address" }) : xdr.ScVal.scvVoid(),
  ];
  if (argsXdr(root.args) !== argsXdr(expectedRoot)) return invalid("invalid_upto_stellar_payer_bound_fields", terms.payer);
  const children = entry.rootInvocation().subInvocations();
  if (children.length !== 1) return invalid("invalid_upto_stellar_wrong_subinvocation_count", terms.payer);
  const approve = authInvocation(children[0]!);
  if (!approve || approve.contract !== terms.token || approve.functionName !== "approve" || approve.args.length !== 4) {
    return invalid("invalid_upto_stellar_wrong_approval_invocation", terms.payer);
  }
  const expectedApprove = [
    nativeToScVal(terms.payer, { type: "address" }),
    nativeToScVal(settlementContract, { type: "address" }),
    nativeToScVal(terms.maximum, { type: "i128" }),
    nativeToScVal(terms.deadline, { type: "u32" }),
  ];
  if (argsXdr(approve.args) !== argsXdr(expectedApprove) || children[0]!.subInvocations().length !== 0) {
    return invalid("invalid_upto_stellar_approval_mismatch", terms.payer);
  }
  return undefined;
}

async function validateUptoExpiration(
  entry: xdr.SorobanAuthorizationEntry,
  terms: UptoTerms,
  server: ReturnType<typeof rpcServer>,
  maxTimeoutSeconds: number,
): Promise<VerifyResponse | undefined> {
  const generic = await validateAuthExpiration(entry, server, maxTimeoutSeconds);
  if (generic) return { ...generic, payer: terms.payer };
  const expiration = inspectAuthEntry(entry).signatureExpirationLedger;
  if (expiration === null || expiration > terms.deadline) return invalid("invalid_upto_stellar_expiration_after_deadline", terms.payer);
  const latest = await server.getLatestLedger();
  const maximumDeadline = latest.sequence + Math.ceil(maxTimeoutSeconds / 5) + 2;
  if (terms.deadline > maximumDeadline) return invalid("invalid_upto_stellar_deadline_too_far", terms.payer);
  return undefined;
}

function buildSettlementOperation(
  terms: UptoTerms,
  settlementContract: string,
  auth: xdr.SorobanAuthorizationEntry[],
): ReturnType<typeof Operation.invokeHostFunction> {
  const raw = new Contract(settlementContract).call(
    "settle",
    nativeToScVal(terms.payer, { type: "address" }),
    nativeToScVal(terms.payTo, { type: "address" }),
    nativeToScVal(terms.token, { type: "address" }),
    nativeToScVal(terms.maximum, { type: "i128" }),
    nativeToScVal(terms.validAfter, { type: "u32" }),
    nativeToScVal(terms.deadline, { type: "u32" }),
    nativeToScVal(terms.facilitator, { type: "address" }),
    nativeToScVal(terms.settlementId, { type: "bytes" }),
    terms.settlementHook ? nativeToScVal(terms.settlementHook, { type: "address" }) : xdr.ScVal.scvVoid(),
    nativeToScVal(terms.actual, { type: "i128" }),
  );
  if (auth.length === 0) return raw;
  return Operation.invokeHostFunction({ func: raw.body().invokeHostFunctionOp().hostFunction(), auth });
}

function validateUptoTransfers(events: xdr.DiagnosticEvent[], terms: UptoTerms, contract: string): VerifyResponse | undefined {
  const expected = [{ from: terms.payer, to: contract, amount: terms.maximum }];
  if (terms.actual > 0) expected.push({ from: contract, to: terms.payTo, amount: terms.actual });
  const refund = terms.maximum - terms.actual;
  if (refund > 0) expected.push({ from: contract, to: terms.payer, amount: refund });
  if (!sameTransfers(tokenTransfers(events, terms.token), expected)) {
    return invalid("invalid_upto_stellar_unexpected_balance_changes", terms.payer);
  }
  return undefined;
}

function parsedPayment(runtime: NetworkRuntime, terms: UptoTerms): ParsedPayment {
  return {
    scheme: "upto",
    network: runtime.config.id,
    payer: terms.payer,
    maximum: terms.maximum,
    actual: terms.actual,
  };
}

function argsXdr(args: readonly xdr.ScVal[]): string {
  return Buffer.concat(args.map(arg => arg.toXDR())).toString("base64");
}
