import type { PaymentRequirements } from "@x402/core/types";
import {
  getNetworkPassphrase,
  getRpcClient,
  getRpcUrl,
  handleSimulationResult,
  isStellarNetwork,
  validateStellarAssetAddress,
  validateStellarDestinationAddress,
  type Ed25519Signer,
} from "@x402/stellar";
import { contract, nativeToScVal } from "@stellar/stellar-sdk";

/**
 * Hosted-facilitator compatibility scheme.
 *
 * @x402/stellar normally makes auth expiry fill maxTimeoutSeconds. The hosted
 * facilitator can trail the public RPC by enough ledgers to reject that as too
 * far in the future. Twenty ledgers remain valid through slow simulation and
 * settlement while staying below the default 50-ledger auth window.
 */
export class ShortAuthExactStellarScheme {
  readonly scheme = "exact";

  constructor(private readonly signer: Ed25519Signer) {}

  async createPaymentPayload(x402Version: number, requirements: PaymentRequirements) {
    const { scheme, network, payTo, asset, amount, extra } = requirements;
    if (scheme !== this.scheme) throw new Error(`unsupported scheme ${scheme}`);
    if (!isStellarNetwork(network)) throw new Error(`unsupported network ${network}`);
    if (!validateStellarDestinationAddress(payTo)) throw new Error(`invalid payTo ${payTo}`);
    if (!validateStellarAssetAddress(asset)) throw new Error(`invalid asset ${asset}`);
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) throw new Error(`invalid amount ${amount}`);
    if (extra?.areFeesSponsored !== true) throw new Error("fee sponsorship is required");

    const networkPassphrase = getNetworkPassphrase(network);
    const rpcUrl = getRpcUrl(network);
    const rpcServer = getRpcClient(network);
    const currentLedger = (await rpcServer.getLatestLedger()).sequence;
    const expirationLedger = currentLedger + 20;
    const source = this.signer.address;
    const transaction = await contract.AssembledTransaction.build({
      contractId: asset,
      method: "transfer",
      args: [
        nativeToScVal(source, { type: "address" }),
        nativeToScVal(payTo, { type: "address" }),
        nativeToScVal(amount, { type: "i128" }),
      ],
      networkPassphrase,
      rpcUrl,
      parseResultXdr: result => result,
    });
    handleSimulationResult(transaction.simulation);

    const missingBeforeSigning = transaction.needsNonInvokerSigningBy();
    if (missingBeforeSigning.length !== 1 || missingBeforeSigning[0] !== source) {
      throw new Error(`unexpected signer set ${missingBeforeSigning.join(",")}`);
    }

    await transaction.signAuthEntries({
      address: source,
      signAuthEntry: this.signer.signAuthEntry,
      expiration: expirationLedger,
    });
    await transaction.simulate();
    handleSimulationResult(transaction.simulation);
    if (transaction.needsNonInvokerSigningBy().length > 0) {
      throw new Error("payment authorization is not fully signed");
    }
    if (!transaction.built) throw new Error("payment transaction was not built");

    return {
      x402Version,
      payload: { transaction: transaction.built.toXDR() },
    };
  }
}
