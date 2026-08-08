export const STELLAR_TESTNET = "stellar:testnet" as const;
export const STELLAR_PUBNET = "stellar:pubnet" as const;
export type StellarNetwork = typeof STELLAR_TESTNET | typeof STELLAR_PUBNET;

/** Immutable contract measured by the repository testnet evidence. */
export const TESTNET_UPTO_SETTLEMENT_CONTRACT =
  "CDEI3W6ZFW6BFSU37VL265OSOGKSM3BR3TZVUR5NZ4UER6FOMVJUKOOT";

export const I128_MAX = (1n << 127n) - 1n;
export const PAYMENT_IDENTIFIER_DOMAIN = "x402:payment-identifier:v1\0";
