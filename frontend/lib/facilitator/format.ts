import type { PaymentOption } from "./contracts";

export const TESTNET_XLM = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
export const TESTNET_USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const PUBNET_USDC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

const STELLAR_EXPLORER = "https://stellar.expert/explorer";
const KNOWN_ASSETS: Record<string, { symbol: string; decimals: number }> = {
  [TESTNET_XLM]: { symbol: "XLM", decimals: 7 },
  [TESTNET_USDC]: { symbol: "USDC", decimals: 7 },
  [PUBNET_USDC]: { symbol: "USDC", decimals: 7 },
};

export function compactDecimalString(value: string | undefined): string {
  if (value === undefined || !/^\d+$/.test(value)) return "Unavailable";
  try {
    return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(BigInt(value));
  } catch {
    return "Unavailable";
  }
}

export function decimalAmount(amount: string, decimals: number): string | undefined {
  if (!/^\d+$/.test(amount) || !Number.isInteger(decimals) || decimals < 0 || decimals > 30) return undefined;
  if (decimals === 0) return amount;
  const padded = amount.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function shortIdentifier(value: string): string {
  return value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-6)}` : value || "Unavailable";
}

export function formatAtomicAmount(amount: string | undefined, asset: string | undefined, symbol?: string, decimals?: number): string {
  if (amount === undefined || !/^\d+$/.test(amount)) return "Unavailable";
  const known = asset ? KNOWN_ASSETS[asset] : undefined;
  const resolvedDecimals = decimals ?? known?.decimals;
  const resolvedSymbol = symbol || known?.symbol;
  if (resolvedDecimals !== undefined && resolvedSymbol) {
    const formatted = decimalAmount(amount, resolvedDecimals);
    return formatted === undefined ? "Unavailable" : `${formatted} ${resolvedSymbol}`;
  }
  return `${amount} atomic units${asset ? ` · ${shortIdentifier(asset)}` : ""}`;
}

export function chartAtomicAmount(amount: string | undefined, asset: string | undefined, decimals?: number): number | undefined {
  if (amount === undefined || !/^\d+$/.test(amount)) return undefined;
  const known = asset ? KNOWN_ASSETS[asset] : undefined;
  const resolvedDecimals = decimals ?? known?.decimals;
  if (resolvedDecimals === undefined) return chartNumber(amount);
  const decimal = decimalAmount(amount, resolvedDecimals);
  if (decimal === undefined) return undefined;
  const parsed = Number(decimal);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

export function formatPaymentOption(option: PaymentOption): string {
  const amount = formatAtomicAmount(option.amount, option.asset);
  const network = humanNetwork(option.network);
  return `${amount} · ${option.scheme} · ${network}`;
}

export function humanNetwork(network: string | undefined): string {
  if (!network) return "Network unavailable";
  return network.startsWith("stellar:")
    ? `Stellar ${network.slice("stellar:".length)}`
    : network;
}

export function relativeTime(value: string | undefined, now = Date.now()): string {
  if (!value) return "Last updated unavailable";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Last updated unavailable";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function chartNumber(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = BigInt(value);
  return parsed > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(parsed);
}

export function safeResourceHref(resource: string, type: "http" | "mcp"): string | undefined {
  if (type === "mcp") return undefined;
  try {
    const url = new URL(resource);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (url.username || url.password || !url.hostname) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function resourceLabel(resource: string, type: "http" | "mcp"): string {
  if (type === "mcp") return resource;
  try {
    return new URL(resource).hostname;
  } catch {
    return resource || "Resource unavailable";
  }
}

export function transactionExplorerUrl(network: string | undefined, hash: string | undefined): string | undefined {
  if (!hash) return undefined;
  if (network === "stellar:testnet") return `${STELLAR_EXPLORER}/testnet/tx/${hash}`;
  if (network === "stellar:pubnet") return `${STELLAR_EXPLORER}/public/tx/${hash}`;
  return undefined;
}
