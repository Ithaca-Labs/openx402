import {
  Address,
  BASE_FEE,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  authorizeEntry,
  inspectAuthEntry,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import type { Api } from "@stellar/stellar-sdk/rpc";
import type { PaymentPayload, PaymentRequirements, VerifyResponse } from "@x402/core/types";
import type {
  ChannelSigner,
  FeeProfile,
  NetworkRuntime,
  ParsedPayment,
  PreparedSettlement,
  RequestEnvelope,
  Scheme,
  StellarNetwork,
} from "../types.js";

export const I128_MAX = (1n << 127n) - 1n;
export const I128_MIN = -(1n << 127n);
const LEDGER_CLOSE_SECONDS = 5;
const EXPIRATION_TOLERANCE_LEDGERS = 2;
type ParsedOperation = Transaction["operations"][number];
type BuiltOperation = ReturnType<typeof Operation.invokeHostFunction>;

export function networkPassphrase(network: StellarNetwork): string {
  return network === "stellar:pubnet" ? Networks.PUBLIC : Networks.TESTNET;
}

export function rpcServer(runtime: NetworkRuntime): rpc.Server {
  return new rpc.Server(runtime.config.rpcUrl, { allowHttp: runtime.config.id === "stellar:testnet" });
}

export function invalid(reason: string, payer?: string, message?: string): VerifyResponse {
  return {
    isValid: false,
    invalidReason: reason,
    ...(payer ? { payer } : {}),
    ...(message ? { invalidMessage: message } : {}),
  };
}

export function parseInteger(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(value)) return undefined;
  try {
    const parsed = BigInt(value);
    return parsed >= I128_MIN && parsed <= I128_MAX ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function validateEnvelope(
  request: RequestEnvelope,
  runtime: NetworkRuntime,
  scheme: Scheme,
  phase: "verify" | "settle",
): VerifyResponse | undefined {
  const { paymentPayload: payload, paymentRequirements: requirements } = request;
  if (request.x402Version !== 2 || payload.x402Version !== 2) return invalid("invalid_x402_version");
  if (payload.accepted.scheme !== scheme || requirements.scheme !== scheme) return invalid("unsupported_scheme");
  if (payload.accepted.network !== runtime.config.id || requirements.network !== runtime.config.id) return invalid("network_mismatch");
  if (payload.accepted.asset !== requirements.asset || payload.accepted.payTo !== requirements.payTo) return invalid("requirements_mismatch");
  if (payload.accepted.maxTimeoutSeconds !== requirements.maxTimeoutSeconds) return invalid("requirements_mismatch");
  if (scheme === "exact" || phase === "verify") {
    if (payload.accepted.amount !== requirements.amount) return invalid("requirements_mismatch");
  }
  if (requirements.maxTimeoutSeconds <= 0 || requirements.maxTimeoutSeconds > runtime.config.maxTimeoutSeconds) {
    return invalid("invalid_stellar_timeout_exceeds_maximum");
  }
  const asset = runtime.config.allowedAssets.get(requirements.asset);
  if (!asset) return invalid("invalid_stellar_asset_not_allowed");
  const advertisedMaximum = parseInteger(payload.accepted.amount);
  if (advertisedMaximum === undefined || advertisedMaximum <= 0 || advertisedMaximum > asset.maxPayment) {
    return invalid("invalid_stellar_amount_exceeds_maximum");
  }
  if (payload.accepted.extra?.areFeesSponsored !== true || requirements.extra?.areFeesSponsored !== true) {
    return invalid("invalid_stellar_fee_sponsorship_required");
  }
  return undefined;
}

export function parseClientTransaction(payload: PaymentPayload, passphrase: string): Transaction | VerifyResponse {
  if (!payload.payload || typeof payload.payload.transaction !== "string") {
    return invalid("invalid_stellar_payload_malformed");
  }
  try {
    const parsed = TransactionBuilder.fromXDR(payload.payload.transaction, passphrase);
    if (parsed instanceof FeeBumpTransaction) return invalid("invalid_stellar_payload_fee_bump_not_allowed");
    return parsed;
  } catch {
    return invalid("invalid_stellar_payload_malformed");
  }
}

export interface ContractInvocation {
  contract: string;
  functionName: string;
  args: xdr.ScVal[];
}

export function operationInvocation(operation: ParsedOperation): ContractInvocation | undefined {
  if (operation.type !== "invokeHostFunction") return undefined;
  const func = (operation as Operation.InvokeHostFunction).func;
  if (func.switch().name !== "hostFunctionTypeInvokeContract") return undefined;
  const call = func.invokeContract();
  return {
    contract: Address.fromScAddress(call.contractAddress()).toString(),
    functionName: call.functionName().toString(),
    args: call.args(),
  };
}

export function authInvocation(invocation: xdr.SorobanAuthorizedInvocation): ContractInvocation | undefined {
  const fn = invocation.function();
  if (fn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn") return undefined;
  const call = fn.contractFn();
  return {
    contract: Address.fromScAddress(call.contractAddress()).toString(),
    functionName: call.functionName().toString(),
    args: call.args(),
  };
}

export function addressOfAuth(entry: xdr.SorobanAuthorizationEntry): string | undefined {
  return inspectAuthEntry(entry).address ?? undefined;
}

export function isSignedEnough(entry: xdr.SorobanAuthorizationEntry): boolean {
  const info = inspectAuthEntry(entry);
  if (info.credentialType === "addressWithDelegates") {
    return info.signers.slice(1).some(signer => signer.signed) || info.signers[0]?.signed === true;
  }
  return info.signed;
}

export async function validateAuthExpiration(
  entry: xdr.SorobanAuthorizationEntry,
  server: rpc.Server,
  maxTimeoutSeconds: number,
): Promise<VerifyResponse | undefined> {
  const info = inspectAuthEntry(entry);
  if (!info.address || info.signatureExpirationLedger === null) return invalid("invalid_stellar_auth_credential_type");
  const latest = await server.getLatestLedger();
  if (info.signatureExpirationLedger <= latest.sequence) return invalid("invalid_stellar_auth_expired", info.address);
  const maximum = latest.sequence + Math.ceil(maxTimeoutSeconds / LEDGER_CLOSE_SECONDS);
  if (info.signatureExpirationLedger > maximum + EXPIRATION_TOLERANCE_LEDGERS) {
    return invalid("invalid_stellar_auth_expiration_too_far", info.address);
  }
  return undefined;
}

export function cloneAuth(entry: xdr.SorobanAuthorizationEntry): xdr.SorobanAuthorizationEntry {
  return xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
}

export async function signFacilitatorAuth(
  entry: xdr.SorobanAuthorizationEntry,
  signer: ChannelSigner,
  expirationLedger: number,
  passphrase: string,
): Promise<xdr.SorobanAuthorizationEntry> {
  return authorizeEntry(cloneAuth(entry), Keypair.fromSecret(signer.secret), expirationLedger, passphrase);
}

export async function simulate(
  server: rpc.Server,
  transaction: Transaction,
  mode: "record" | "enforce",
): Promise<Api.SimulateTransactionSuccessResponse | VerifyResponse> {
  try {
    const response = await server.simulateTransaction(transaction, undefined, mode);
    if (!rpc.Api.isSimulationSuccess(response) || rpc.Api.isSimulationRestore(response)) {
      return invalid(
        mode === "record" ? "invalid_stellar_record_simulation_failed" : "invalid_stellar_enforcing_simulation_failed",
        undefined,
        "error" in response && typeof response.error === "string" ? response.error.split("\n")[0] : undefined,
      );
    }
    return response;
  } catch (error) {
    return invalid(
      mode === "record" ? "invalid_stellar_record_simulation_failed" : "invalid_stellar_enforcing_simulation_failed",
      undefined,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function isVerifyResponse(value: unknown): value is VerifyResponse {
  return typeof value === "object" && value !== null && typeof (value as { isValid?: unknown }).isValid === "boolean";
}

export function validateFee(simulation: Api.SimulateTransactionSuccessResponse, profile: FeeProfile, payer?: string): VerifyResponse | undefined {
  const resource = BigInt(simulation.minResourceFee);
  const inclusion = BigInt(BASE_FEE) * 2n;
  const total = resource + inclusion;
  if (resource > profile.maxResourceFeeStroops) {
    return invalid("invalid_stellar_resource_fee_exceeds_maximum", payer, `${resource} > ${profile.maxResourceFeeStroops}`);
  }
  if (inclusion > profile.maxInclusionFeeStroops) {
    return invalid("invalid_stellar_inclusion_fee_exceeds_maximum", payer);
  }
  if (total > profile.maxTotalFeeStroops) {
    return invalid("invalid_stellar_total_fee_exceeds_maximum", payer, `${total} > ${profile.maxTotalFeeStroops}`);
  }
  return undefined;
}

export interface TransferEvent {
  from: string;
  to: string;
  amount: bigint;
}

export function tokenTransfers(events: xdr.DiagnosticEvent[], asset: string): TransferEvent[] {
  const transfers: TransferEvent[] = [];
  for (const diagnostic of events) {
    try {
      const event = diagnostic.event();
      const id = event.contractId();
      if (!id) continue;
      const contract = Address.fromScAddress(xdr.ScAddress.scAddressTypeContract(id)).toString();
      if (contract !== asset) continue;
      const body = event.body().v0();
      const topics = body.topics();
      if (topics.length < 3 || topics[0]?.switch().name !== "scvSymbol" || topics[0].sym().toString() !== "transfer") continue;
      transfers.push({
        from: String(scValToNative(topics[1]!)),
        to: String(scValToNative(topics[2]!)),
        amount: BigInt(scValToNative(body.data()) as bigint),
      });
    } catch {
      continue;
    }
  }
  return transfers;
}

export function sameTransfers(actual: TransferEvent[], expected: TransferEvent[]): boolean {
  return actual.length === expected.length && actual.every((event, index) => {
    const want = expected[index];
    return want !== undefined && event.from === want.from && event.to === want.to && event.amount === want.amount;
  });
}

export async function buildSourceTransaction(
  server: rpc.Server,
  channelAddress: string,
  operation: BuiltOperation,
  passphrase: string,
  timeoutSeconds: number,
): Promise<Transaction> {
  const source = await server.getAccount(channelAddress);
  return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(operation)
    .setTimeout(timeoutSeconds)
    .build();
}

export function operationWithAuth(operation: Operation.InvokeHostFunction, auth: xdr.SorobanAuthorizationEntry[]): BuiltOperation {
  return Operation.invokeHostFunction({ func: operation.func, auth });
}

export function finalizeSponsoredTransaction(args: {
  sourceTransaction: Transaction;
  enforcing: Api.SimulateTransactionSuccessResponse;
  channel: ChannelSigner;
  sponsor: ChannelSigner;
  passphrase: string;
}): { transaction: FeeBumpTransaction; xdr: string; hash: string } {
  const assembled = rpc.assembleTransaction(args.sourceTransaction, args.enforcing).build();
  assembled.sign(Keypair.fromSecret(args.channel.secret));
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    args.sponsor.address,
    BASE_FEE,
    assembled,
    args.passphrase,
  );
  feeBump.sign(Keypair.fromSecret(args.sponsor.secret));
  return { transaction: feeBump, xdr: feeBump.toXDR(), hash: feeBump.hash().toString("hex") };
}

export function preparedFrom(
  parsed: ParsedPayment,
  channel: ChannelSigner,
  envelope: { xdr: string; hash: string },
  simulation: Api.SimulateTransactionSuccessResponse,
): PreparedSettlement {
  const resource = BigInt(simulation.minResourceFee);
  const inclusion = BigInt(BASE_FEE) * 2n;
  return {
    ...parsed,
    channelAddress: channel.address,
    envelopeXdr: envelope.xdr,
    transactionHash: envelope.hash,
    estimatedResourceFee: resource,
    estimatedInclusionFee: inclusion,
    estimatedTotalFee: resource + inclusion,
  };
}

export function transactionOperation(transaction: Transaction, internalAddresses: ReadonlySet<string>): Operation.InvokeHostFunction | VerifyResponse {
  if (transaction.operations.length !== 1) return invalid("invalid_stellar_payload_wrong_operation_count");
  const operation = transaction.operations[0];
  if (!operation || operation.type !== "invokeHostFunction") return invalid("invalid_stellar_payload_wrong_operation");
  if (operation.source || internalAddresses.has(transaction.source)) {
    return invalid("invalid_stellar_payload_unsafe_source");
  }
  return operation as Operation.InvokeHostFunction;
}
