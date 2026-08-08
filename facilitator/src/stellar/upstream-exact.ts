import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/facilitator";
import type { VerifyResponse } from "@x402/core/types";
import type { NetworkRuntime, RequestEnvelope } from "../types.js";

/** Protocol-level exact verification supplied by the canonical Stellar package. */
export interface ExactProtocolVerifier {
  verify(request: RequestEnvelope, runtime: NetworkRuntime): Promise<VerifyResponse>;
}

/**
 * Binds the canonical verifier to this operator's RPC and signing identities.
 * Transaction preparation stays local because it must be fenced and persisted
 * before submission; protocol interpretation does not.
 */
export class X402StellarExactVerifier implements ExactProtocolVerifier {
  private readonly schemes = new WeakMap<NetworkRuntime, ExactStellarScheme>();

  async verify(request: RequestEnvelope, runtime: NetworkRuntime): Promise<VerifyResponse> {
    return this.scheme(runtime).verify(request.paymentPayload, request.paymentRequirements);
  }

  private scheme(runtime: NetworkRuntime): ExactStellarScheme {
    const existing = this.schemes.get(runtime);
    if (existing) return existing;

    const channel = createEd25519Signer(runtime.simulationSource.secret, runtime.config.id);
    const sponsor = createEd25519Signer(runtime.sponsor.secret, runtime.config.id);
    const configuredCeiling = runtime.config.exactFee.maxTotalFeeStroops;
    const upstreamCeiling = configuredCeiling > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(configuredCeiling);
    const scheme = new ExactStellarScheme([channel], {
      rpcConfig: { url: runtime.config.rpcUrl },
      areFeesSponsored: true,
      maxTransactionFeeStroops: upstreamCeiling,
      feeBumpSigner: sponsor,
    });
    this.schemes.set(runtime, scheme);
    return scheme;
  }
}
