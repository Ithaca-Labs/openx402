/**
 * Optional Stellar asset registry, imported from `@openx402/bazaar-sdk/stellar`.
 *
 * The root `@openx402/bazaar-sdk` entry point never imports this file, so installing
 * `@openx402/bazaar-sdk` alone works without `@x402/stellar` or `@stellar/stellar-sdk`
 * present.
 *
 * The native XLM Stellar Asset Contract ID is **network-dependent** — it is derived
 * from the network passphrase, not a fixed constant — so it is computed here with the
 * official `@stellar/stellar-sdk` and `@x402/stellar`'s network passphrase table
 * rather than hardcoded. USDC addresses are read directly from `@x402/stellar`'s own
 * exported constants, the same values the Stellar exact-scheme client and facilitator
 * packages use.
 */
import { Asset } from "@stellar/stellar-sdk";
import {
  getNetworkPassphrase,
  STELLAR_PUBNET_CAIP2,
  STELLAR_TESTNET_CAIP2,
  USDC_PUBNET_ADDRESS,
  USDC_TESTNET_ADDRESS,
} from "@x402/stellar";

function nativeAssetContractId(network: typeof STELLAR_TESTNET_CAIP2 | typeof STELLAR_PUBNET_CAIP2): string {
  return Asset.native().contractId(getNetworkPassphrase(network));
}

/**
 * Named, verifiable Stellar asset addresses for use as `createX402Seller({ assets })`
 * values, e.g. `assets: { XLM: stellarAssets.testnet.XLM }`. There is no `mainnet`
 * inference helper beyond `pubnet`: sellers must pick the network explicitly, and no
 * asset outside this table is invented on their behalf.
 */
export const stellarAssets = {
  testnet: {
    XLM: nativeAssetContractId(STELLAR_TESTNET_CAIP2),
    USDC: USDC_TESTNET_ADDRESS,
  },
  pubnet: {
    XLM: nativeAssetContractId(STELLAR_PUBNET_CAIP2),
    USDC: USDC_PUBNET_ADDRESS,
  },
} as const;
