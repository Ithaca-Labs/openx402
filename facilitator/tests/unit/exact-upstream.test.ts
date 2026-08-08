import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { ExactMechanism } from "../../src/stellar/exact.js";
import type { ExactProtocolVerifier } from "../../src/stellar/upstream-exact.js";
import type { NetworkRuntime, RequestEnvelope } from "../../src/types.js";

const ASSET = StrKey.encodeContract(Buffer.alloc(32, 7));
const SELLER = Keypair.random().publicKey();

function runtime(): NetworkRuntime {
  const sponsor = Keypair.random();
  const channel = Keypair.random();
  return {
    sponsor: { address: sponsor.publicKey(), secret: sponsor.secret() },
    simulationSource: { address: channel.publicKey(), secret: channel.secret() },
    unsafeInternalAddresses: new Set([sponsor.publicKey(), channel.publicKey()]),
    config: {
      id: "stellar:testnet",
      enabled: true,
      rpcUrl: "https://soroban-testnet.stellar.org",
      horizonUrl: "https://horizon-testnet.stellar.org",
      developmentAutoFund: false,
      channelAccountCount: 1,
      channelMinBalanceStroops: 1n,
      channelSecrets: [],
      allowedAssets: new Map([[ASSET, { symbol: "SIX", decimals: 6, maxPayment: 10_000_000n }]]),
      allowedSettlementHooks: new Set(),
      maxTimeoutSeconds: 300,
      exactFee: {
        maxResourceFeeStroops: 50_000n,
        maxInclusionFeeStroops: 200n,
        maxTotalFeeStroops: 50_200n,
      },
      uptoFee: {
        maxResourceFeeStroops: 150_000n,
        maxInclusionFeeStroops: 200n,
        maxTotalFeeStroops: 150_200n,
      },
    },
  };
}

function request(overrides: Partial<RequestEnvelope["paymentRequirements"]> = {}): RequestEnvelope {
  const requirements = {
    scheme: "exact",
    network: "stellar:testnet" as const,
    asset: ASSET,
    amount: "1234567",
    payTo: SELLER,
    maxTimeoutSeconds: 60,
    extra: { areFeesSponsored: true },
    ...overrides,
  };
  return {
    x402Version: 2,
    paymentRequirements: requirements,
    paymentPayload: {
      x402Version: 2,
      accepted: requirements,
      payload: { transaction: "deliberately-not-xdr" },
    },
  };
}

describe("ExactMechanism canonical verifier boundary", () => {
  it("makes a canonical @x402/stellar rejection final", async () => {
    const verify = vi.fn().mockResolvedValue({
      isValid: false,
      invalidReason: "invalid_exact_stellar_payload_wrong_amount",
    });
    const mechanism = new ExactMechanism({ verify } as ExactProtocolVerifier);

    const result = await mechanism.verify(request(), runtime());

    expect(verify).toHaveBeenCalledOnce();
    expect(result.response).toEqual({
      isValid: false,
      invalidReason: "invalid_exact_stellar_payload_wrong_amount",
    });
  });

  it("does not call upstream when operator allowlist validation fails", async () => {
    const verify = vi.fn();
    const mechanism = new ExactMechanism({ verify } as ExactProtocolVerifier);

    const result = await mechanism.verify(request({ asset: StrKey.encodeContract(Buffer.alloc(32, 8)) }), runtime());

    expect(verify).not.toHaveBeenCalled();
    expect(result.response.invalidReason).toBe("invalid_stellar_asset_not_allowed");
  });

  it("turns an upstream exception into a non-null wire rejection reason", async () => {
    const protocol: ExactProtocolVerifier = {
      verify: vi.fn().mockRejectedValue(new Error("RPC unavailable")),
    };

    const result = await new ExactMechanism(protocol).verify(request(), runtime());

    expect(result.response).toMatchObject({
      isValid: false,
      invalidReason: "unexpected_verify_error",
      invalidMessage: "RPC unavailable",
    });
  });

  it("continues past the known upstream unrelated-event over-rejection only into local hardening", async () => {
    const protocol: ExactProtocolVerifier = {
      verify: vi.fn().mockResolvedValue({
        isValid: false,
        invalidReason: "invalid_exact_stellar_payload_event_not_transfer",
      }),
    };

    const result = await new ExactMechanism(protocol).verify(request(), runtime());

    expect(result.response.invalidReason).toBe("invalid_stellar_payload_malformed");
  });

  it("normalizes a malformed upstream rejection so invalidReason is never null", async () => {
    const protocol: ExactProtocolVerifier = {
      verify: vi.fn().mockResolvedValue({ isValid: false }),
    };

    const result = await new ExactMechanism(protocol).verify(request(), runtime());

    expect(result.response.invalidReason).toBe("unexpected_verify_error");
  });
});
