import { Asset, Networks } from "@stellar/stellar-sdk";
import { USDC_PUBNET_ADDRESS, USDC_TESTNET_ADDRESS } from "@x402/stellar";
import { describe, expect, it } from "vitest";
import { stellarAssets } from "../src/stellar.js";

const CONTRACT_ID_PATTERN = /^C[A-Z0-9]{55}$/;

describe("stellarAssets", () => {
  it("computes the testnet native XLM SAC address from the official SDK, not a hardcoded guess", () => {
    expect(stellarAssets.testnet.XLM).toBe(Asset.native().contractId(Networks.TESTNET));
    expect(stellarAssets.testnet.XLM).toMatch(CONTRACT_ID_PATTERN);
  });

  it("computes the pubnet native XLM SAC address from the official SDK", () => {
    expect(stellarAssets.pubnet.XLM).toBe(Asset.native().contractId(Networks.PUBLIC));
    expect(stellarAssets.pubnet.XLM).toMatch(CONTRACT_ID_PATTERN);
  });

  it("computes different XLM contract IDs per network, since the SAC id is network-dependent", () => {
    expect(stellarAssets.testnet.XLM).not.toBe(stellarAssets.pubnet.XLM);
  });

  it("reuses @x402/stellar's own USDC addresses rather than a second copy", () => {
    expect(stellarAssets.testnet.USDC).toBe(USDC_TESTNET_ADDRESS);
    expect(stellarAssets.pubnet.USDC).toBe(USDC_PUBNET_ADDRESS);
  });
});
