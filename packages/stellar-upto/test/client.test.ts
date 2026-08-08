import { createHash } from "node:crypto";
import { contract, Keypair, scValToNative } from "@stellar/stellar-sdk";
import { x402Client } from "@x402/core/client";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentRequired } from "@x402/core/types";
import { declarePaymentIdentifierExtension } from "@x402/extensions/payment-identifier";
import type { ClientStellarSigner } from "@x402/stellar";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  settlementIdForPaymentIdentifier,
  UptoStellarScheme,
} from "../src/client.js";
import { PAYMENT_IDENTIFIER_DOMAIN, TESTNET_UPTO_SETTLEMENT_CONTRACT } from "../src/constants.js";

vi.mock("@x402/stellar", async importOriginal => {
  const actual = await importOriginal<typeof import("@x402/stellar")>();
  return {
    ...actual,
    getRpcClient: () => ({ getLatestLedger: async () => ({ sequence: 1_000 }) }),
    getEstimatedLedgerCloseTimeSeconds: async () => 5,
  };
});

afterEach(() => vi.restoreAllMocks());

describe("UptoStellarScheme", () => {
  it("derives the normative settlement ID domain hash", async () => {
    const id = "pay_identifier_123456789";
    const expected = createHash("sha256").update(PAYMENT_IDENTIFIER_DOMAIN + id).digest("hex");
    expect(Buffer.from(await settlementIdForPaymentIdentifier(id)).toString("hex")).toBe(expected);
  });

  it("runs through an unmodified canonical x402Client and leaves only facilitator auth unsigned", async () => {
    const payer = Keypair.random().publicKey();
    const recipient = Keypair.random().publicKey();
    const facilitatorAddress = Keypair.random().publicKey();
    const asset = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    const paymentId = "pay_canonical_upto_123456";
    let missing = [payer, facilitatorAddress];
    let buildOptions: { args: unknown[] } | undefined;
    let signedExpiration: number | undefined;
    vi.spyOn(contract.AssembledTransaction, "build").mockImplementation(async options => {
      buildOptions = options as unknown as { args: unknown[] };
      return {
        simulation: { transactionData: "AAAA" },
        needsNonInvokerSigningBy: () => missing,
        signAuthEntries: async ({ address, expiration }: { address: string; expiration: number }) => {
          expect(address).toBe(payer);
          signedExpiration = expiration;
          missing = [facilitatorAddress];
        },
        built: { toXDR: () => "AAAA_CANONICAL_UPTO" },
      } as never;
    });

    const facilitatorClient: FacilitatorClient = {
      verify: vi.fn(),
      settle: vi.fn(),
      getSupported: async () => ({
        kinds: [{
          x402Version: 2,
          scheme: "upto",
          network: "stellar:testnet",
          extra: { areFeesSponsored: true },
        }],
        extensions: ["payment-identifier"],
        signers: { "stellar:*": [facilitatorAddress] },
      }),
    };
    const signer = {
      address: payer,
      signAuthEntry: vi.fn(),
    } as unknown as ClientStellarSigner;
    const scheme = new UptoStellarScheme(signer, { facilitatorClient });
    const canonical = new x402Client().register("stellar:testnet", scheme);
    const declared = declarePaymentIdentifierExtension();
    declared.info.id = paymentId;
    const paymentRequired: PaymentRequired = {
      x402Version: 2,
      resource: { url: "https://seller.example/metered" },
      accepts: [{
        scheme: "upto",
        network: "stellar:testnet",
        asset,
        amount: "10000",
        payTo: recipient,
        maxTimeoutSeconds: 60,
        extra: { areFeesSponsored: true },
      }],
      extensions: { "payment-identifier": declared },
    };

    const result = await canonical.createPaymentPayload(paymentRequired);
    expect(result).toMatchObject({
      x402Version: 2,
      payload: { transaction: "AAAA_CANONICAL_UPTO" },
      accepted: { scheme: "upto", amount: "10000" },
      extensions: { "payment-identifier": { info: { id: paymentId } } },
    });
    expect(buildOptions).toBeDefined();
    const args = buildOptions!.args.map(value => scValToNative(value as never));
    expect(args.slice(0, 7).map(String)).toEqual([
      payer,
      recipient,
      asset,
      "10000",
      "1000",
      "1012",
      facilitatorAddress,
    ]);
    expect(Buffer.from(args[7] as Uint8Array).toString("hex")).toBe(
      createHash("sha256").update(PAYMENT_IDENTIFIER_DOMAIN + paymentId).digest("hex"),
    );
    expect(args[8]).toBeNull();
    expect(String(args[9])).toBe("10000");
    expect(signedExpiration).toBe(1_012);
    expect((buildOptions as unknown as { contractId: string }).contractId)
      .toBe(TESTNET_UPTO_SETTLEMENT_CONTRACT);
  });

  it("fails closed for pubnet without an audited configured contract", async () => {
    const scheme = new UptoStellarScheme({
      address: Keypair.random().publicKey(),
      signAuthEntry: vi.fn(),
    } as unknown as ClientStellarSigner, { facilitatorAddress: Keypair.random().publicKey() });
    await expect(scheme.createPaymentPayload(2, {
      scheme: "upto",
      network: "stellar:pubnet",
      asset: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
      amount: "1",
      payTo: Keypair.random().publicKey(),
      maxTimeoutSeconds: 60,
      extra: { areFeesSponsored: true },
    })).rejects.toThrow("pubnet upto settlement contract is not configured");
  });
});
