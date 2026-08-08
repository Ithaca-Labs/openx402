import { Keypair } from "@stellar/stellar-sdk";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { describe, expect, it, vi } from "vitest";
import { EmbeddedStellarFacilitator } from "../../src/embedded.js";
import type { FacilitatorRuntime } from "../../src/factory.js";
import { BusyError, ConflictError } from "../../src/orchestrator.js";

const requirements: PaymentRequirements = {
  scheme: "exact",
  network: "stellar:testnet",
  asset: Keypair.random().publicKey(),
  amount: "1",
  payTo: Keypair.random().publicKey(),
  maxTimeoutSeconds: 60,
  extra: { areFeesSponsored: true },
};

const payload: PaymentPayload = {
  x402Version: 2,
  resource: { url: "https://seller.example/paid" },
  accepted: requirements,
  payload: { transaction: "AAAA" },
};

function embedded(core: Record<string, unknown>) {
  const close = vi.fn(async () => undefined);
  const client = new EmbeddedStellarFacilitator(
    { core, close } as unknown as FacilitatorRuntime,
    "test:principal",
    0,
  );
  return { client, close };
}

describe("EmbeddedStellarFacilitator", () => {
  it("implements the canonical local FacilitatorClient methods", async () => {
    const verify = vi.fn(async () => ({
      response: { isValid: true, payer: "GTEST" },
      extensionResponses: { bazaar: { status: "success" } },
    }));
    const settle = vi.fn(async () => ({
      response: { success: true, payer: "GTEST", transaction: "abc", network: "stellar:testnet" },
    }));
    const supported = vi.fn(() => ({ kinds: [], extensions: [], signers: {} }));
    const { client, close } = embedded({ verify, settle, supported, recoverUnresolved: vi.fn() });

    await expect(client.verify(payload, requirements)).resolves.toMatchObject({
      isValid: true,
      extensions: { bazaar: { status: "success" } },
    });
    await expect(client.settle(payload, requirements)).resolves.toMatchObject({
      success: true,
      transaction: "abc",
    });
    await expect(client.getSupported()).resolves.toEqual({ kinds: [], extensions: [], signers: {} });
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ x402Version: 2 }), "test:principal");

    await client.close();
    await client.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("returns non-null protocol reasons for conflicts, overload, and internal errors", async () => {
    const conflict = embedded({
      verify: vi.fn(async () => { throw new ConflictError(); }),
      settle: vi.fn(async () => { throw new ConflictError(); }),
    }).client;
    await expect(conflict.verify(payload, requirements)).resolves.toMatchObject({
      isValid: false,
      invalidReason: "payment_identifier_conflict",
    });
    await expect(conflict.settle(payload, requirements)).resolves.toMatchObject({
      success: false,
      errorReason: "payment_identifier_conflict",
    });

    const busy = embedded({ settle: vi.fn(async () => { throw new BusyError(); }) }).client;
    await expect(busy.settle(payload, requirements)).resolves.toMatchObject({
      success: false,
      errorReason: "settle_stellar_temporarily_unavailable",
    });

    const broken = embedded({ verify: vi.fn(async () => { throw new Error("secret"); }) }).client;
    await expect(broken.verify(payload, requirements)).resolves.toMatchObject({
      isValid: false,
      invalidReason: "internal_error",
    });
  });
});
