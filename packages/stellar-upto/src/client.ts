import { contract, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { FacilitatorClient } from "@x402/core/server";
import type {
  PaymentPayloadContext,
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/core/types";
import {
  generatePaymentId,
  isPaymentIdentifierExtension,
  isValidPaymentId,
} from "@x402/extensions/payment-identifier";
import {
  getEstimatedLedgerCloseTimeSeconds,
  getNetworkPassphrase,
  getRpcClient,
  getRpcUrl,
  handleSimulationResult,
  isStellarNetwork,
  type ClientStellarSigner,
  type RpcConfig,
  validateStellarAssetAddress,
  validateStellarDestinationAddress,
} from "@x402/stellar";
import {
  I128_MAX,
  PAYMENT_IDENTIFIER_DOMAIN,
  STELLAR_PUBNET,
  STELLAR_TESTNET,
  TESTNET_UPTO_SETTLEMENT_CONTRACT,
  type StellarNetwork,
} from "./constants.js";

type AddressResolver = string | ((network: StellarNetwork) => Promise<string> | string);

export interface UptoStellarSchemeOptions {
  rpcConfig?: RpcConfig;
  /** Pubnet intentionally has no default until its deployment is audited. */
  settlementContracts?: Partial<Record<StellarNetwork, string>>;
  /** Out-of-band SDK configuration; this is never added to x402 extra. */
  facilitatorAddress?: AddressResolver;
  /** Convenience source for resolving and validating the facilitator signer. */
  facilitatorClient?: FacilitatorClient;
  /** Optional versioned hook chosen and signed by the payer. */
  settlementHook?: string;
  /** Testable override; production defaults to the measured network estimate. */
  estimatedLedgerSeconds?: (network: StellarNetwork) => Promise<number>;
}

interface IdentifierResult {
  settlementId: Uint8Array;
  extensions?: Record<string, unknown>;
}

function canonicalPositiveI128(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error("amount must be a canonical positive integer string");
  const parsed = BigInt(value);
  if (parsed > I128_MAX) throw new Error("amount exceeds Stellar i128 maximum");
  return parsed;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function settlementIdForPaymentIdentifier(id: string): Promise<Uint8Array> {
  if (!isValidPaymentId(id)) throw new Error("invalid payment-identifier id");
  return sha256(PAYMENT_IDENTIFIER_DOMAIN + id);
}

async function identifierFromContext(context?: PaymentPayloadContext): Promise<IdentifierResult> {
  const declared = context?.extensions?.["payment-identifier"];
  if (declared === undefined) {
    const settlementId = new Uint8Array(32);
    crypto.getRandomValues(settlementId);
    return { settlementId };
  }
  if (!isPaymentIdentifierExtension(declared)) {
    throw new Error("server declared a malformed payment-identifier extension");
  }
  const id = declared.info.id ?? generatePaymentId();
  if (!isValidPaymentId(id)) throw new Error("server supplied an invalid payment-identifier id");
  const enriched = { ...declared, info: { ...declared.info, id } };
  return {
    settlementId: await settlementIdForPaymentIdentifier(id),
    extensions: { "payment-identifier": enriched },
  };
}

function asNetwork(network: PaymentRequirements["network"]): StellarNetwork {
  if (!isStellarNetwork(network) || (network !== STELLAR_TESTNET && network !== STELLAR_PUBNET)) {
    throw new Error(`unsupported Stellar network: ${network}`);
  }
  return network;
}

function validateAddress(value: string, label: string, contractOnly = false): void {
  const valid = contractOnly ? validateStellarAssetAddress(value) : validateStellarDestinationAddress(value);
  if (!valid) throw new Error(`invalid ${label}: ${value}`);
}

/**
 * Reusable canonical SchemeNetworkClient for Stellar upto.
 *
 * The returned payload remains exactly `{ transaction }`. Contract and
 * facilitator addresses are SDK configuration because the v2 wire format has
 * no fields for them.
 */
export class UptoStellarScheme implements SchemeNetworkClient {
  readonly scheme = "upto";
  private readonly contracts: Partial<Record<StellarNetwork, string>>;
  private readonly facilitatorCache = new Map<StellarNetwork, string>();

  constructor(
    private readonly signer: ClientStellarSigner,
    private readonly options: UptoStellarSchemeOptions = {},
  ) {
    this.contracts = {
      [STELLAR_TESTNET]: TESTNET_UPTO_SETTLEMENT_CONTRACT,
      ...options.settlementContracts,
    };
  }

  async createPaymentPayload(
    x402Version: number,
    requirements: PaymentRequirements,
    context?: PaymentPayloadContext,
  ): Promise<PaymentPayloadResult> {
    if (x402Version !== 2) throw new Error("Stellar upto requires x402 version 2");
    if (requirements.scheme !== this.scheme) throw new Error(`unsupported scheme: ${requirements.scheme}`);
    const network = asNetwork(requirements.network);
    const maximum = canonicalPositiveI128(requirements.amount);
    if (!Number.isInteger(requirements.maxTimeoutSeconds) || requirements.maxTimeoutSeconds <= 0) {
      throw new Error("maxTimeoutSeconds must be a positive integer");
    }
    if (requirements.extra.areFeesSponsored !== true) {
      throw new Error("Stellar upto requires areFeesSponsored to be true");
    }
    validateAddress(this.signer.address, "payer");
    validateAddress(requirements.payTo, "recipient");
    validateAddress(requirements.asset, "asset", true);

    const settlementContract = this.contracts[network];
    if (!settlementContract) {
      throw new Error(`${network} upto settlement contract is not configured`);
    }
    validateAddress(settlementContract, "settlement contract", true);
    const facilitator = await this.resolveFacilitator(network);
    validateAddress(facilitator, "facilitator");
    if (facilitator === this.signer.address) throw new Error("facilitator must not be the payer");

    const settlementHook = this.options.settlementHook;
    if (settlementHook) {
      validateAddress(settlementHook, "settlement hook", true);
      if (settlementHook === settlementContract || settlementHook === requirements.asset) {
        throw new Error("settlement hook must not equal the settlement or token contract");
      }
    }

    const rpcServer = getRpcClient(network, this.options.rpcConfig);
    const latest = await rpcServer.getLatestLedger();
    const seconds = await (this.options.estimatedLedgerSeconds?.(network)
      ?? getEstimatedLedgerCloseTimeSeconds(network));
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("invalid estimated ledger close time");
    const validAfter = latest.sequence;
    const deadline = validAfter + Math.ceil(requirements.maxTimeoutSeconds / seconds);
    const identifier = await identifierFromContext(context);

    const tx = await contract.AssembledTransaction.build({
      contractId: settlementContract,
      method: "settle",
      args: [
        nativeToScVal(this.signer.address, { type: "address" }),
        nativeToScVal(requirements.payTo, { type: "address" }),
        nativeToScVal(requirements.asset, { type: "address" }),
        nativeToScVal(maximum, { type: "i128" }),
        nativeToScVal(validAfter, { type: "u32" }),
        nativeToScVal(deadline, { type: "u32" }),
        nativeToScVal(facilitator, { type: "address" }),
        nativeToScVal(identifier.settlementId, { type: "bytes" }),
        settlementHook ? nativeToScVal(settlementHook, { type: "address" }) : xdr.ScVal.scvVoid(),
        nativeToScVal(maximum, { type: "i128" }),
      ],
      networkPassphrase: getNetworkPassphrase(network),
      rpcUrl: getRpcUrl(network, this.options.rpcConfig),
      parseResultXdr: result => result,
    });
    handleSimulationResult(tx.simulation);

    const expected = new Set([this.signer.address, facilitator]);
    const before = tx.needsNonInvokerSigningBy();
    if (before.length !== expected.size || before.some(address => !expected.has(address))) {
      throw new Error(`expected payer and facilitator auth entries, got [${before.join(", ")}]`);
    }
    await tx.signAuthEntries({
      address: this.signer.address,
      signAuthEntry: this.signer.signAuthEntry,
      expiration: deadline,
    });
    const after = tx.needsNonInvokerSigningBy();
    if (after.length !== 1 || after[0] !== facilitator) {
      throw new Error(`expected only facilitator signature to remain, got [${after.join(", ")}]`);
    }
    if (!tx.built) throw new Error("Stellar SDK did not assemble the upto transaction");

    return {
      x402Version,
      payload: { transaction: tx.built.toXDR() },
      ...(identifier.extensions ? { extensions: identifier.extensions } : {}),
    };
  }

  private async resolveFacilitator(network: StellarNetwork): Promise<string> {
    const cached = this.facilitatorCache.get(network);
    if (cached) return cached;
    let address: string | undefined;
    if (typeof this.options.facilitatorAddress === "string") {
      address = this.options.facilitatorAddress;
    } else if (this.options.facilitatorAddress) {
      address = await this.options.facilitatorAddress(network);
    } else if (this.options.facilitatorClient) {
      const supported = await this.options.facilitatorClient.getSupported();
      const kind = supported.kinds.find(candidate =>
        candidate.x402Version === 2 && candidate.scheme === "upto" && candidate.network === network,
      );
      if (!kind) throw new Error(`facilitator does not advertise upto on ${network}`);
      if (kind.extra?.areFeesSponsored !== true) {
        throw new Error(`facilitator does not sponsor upto fees on ${network}`);
      }
      address = supported.signers["stellar:*"]?.[0] ?? supported.signers[network]?.[0];
    }
    if (!address) throw new Error(`facilitator address is not configured for ${network}`);
    this.facilitatorCache.set(network, address);
    return address;
  }
}
