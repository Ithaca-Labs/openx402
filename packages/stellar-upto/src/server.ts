import type {
  AssetAmount,
  MoneyParser,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
} from "@x402/core/types";
import { ExactStellarScheme as ExactStellarServerScheme } from "@x402/stellar/exact/server";

export interface UptoStellarServerOptions {
  /** Asset contract to decimal count, used by decimal settlement overrides. */
  assetDecimals?: Record<string, number>;
  defaultDecimals?: number;
}

/** Server-side requirements builder matching the canonical Stellar exact UX. */
export class UptoStellarScheme implements SchemeNetworkServer {
  readonly scheme = "upto";
  private readonly delegate = new ExactStellarServerScheme();

  constructor(private readonly options: UptoStellarServerOptions = {}) {}

  registerMoneyParser(parser: MoneyParser): UptoStellarScheme {
    this.delegate.registerMoneyParser(parser);
    return this;
  }

  parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    return this.delegate.parsePrice(price, network);
  }

  enhancePaymentRequirements(
    requirements: PaymentRequirements,
    supportedKind: {
      x402Version: number;
      scheme: string;
      network: Network;
      extra?: Record<string, unknown>;
    },
    extensionKeys: string[],
  ): Promise<PaymentRequirements> {
    return this.delegate.enhancePaymentRequirements(requirements, supportedKind, extensionKeys);
  }

  getAssetDecimals(asset: string, _network: Network): number {
    const decimals = this.options.assetDecimals?.[asset] ?? this.options.defaultDecimals ?? 7;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      throw new Error(`invalid decimal count for ${asset}`);
    }
    return decimals;
  }
}
