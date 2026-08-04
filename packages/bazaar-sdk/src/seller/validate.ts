import { isValidRouteTemplate } from "@x402/extensions/bazaar";

export class SellerConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`invalid x402 seller configuration:\n- ${issues.join("\n- ")}`);
    this.name = "SellerConfigError";
  }
}

/**
 * Top-level x402 scheme families. Kept as an allowlist rather than an open string so a
 * typo in `payment.scheme` fails at startup instead of silently producing a route no
 * facilitator scheme server will ever match.
 */
const SCHEME_FAMILIES = new Set(["exact", "upto", "auth-capture", "batch-settlement"]);
const AMOUNT_PATTERN = /^[0-9]+$/;
const NETWORK_PATTERN = /^[a-z0-9-]+:[A-Za-z0-9_-]+$/;

export function validatePath(path: string, issues: string[]): void {
  if (typeof path !== "string" || path.length === 0 || !path.startsWith("/")) {
    issues.push(`path must be a string starting with "/", got ${JSON.stringify(path)}`);
    return;
  }
  if (!isValidRouteTemplate(path)) {
    issues.push(`path is not a valid route template: ${path}`);
  }
}

export function validateAmount(amount: string | bigint, issues: string[], label = "payment.amount"): void {
  const text = typeof amount === "bigint" ? amount.toString() : amount;
  if (typeof text !== "string" || text.trim().length === 0) {
    issues.push(`${label} must not be empty`);
    return;
  }
  if (!AMOUNT_PATTERN.test(text)) {
    issues.push(`${label} must be a non-negative atomic-unit integer string, got ${JSON.stringify(text)}`);
  }
}

export function resolveAsset(
  alias: string,
  assets: Record<string, string> | undefined,
  issues: string[],
): string | undefined {
  if (typeof alias !== "string" || alias.length === 0) {
    issues.push("payment.asset is required");
    return undefined;
  }
  const resolved = assets?.[alias];
  if (resolved === undefined) {
    issues.push(
      `payment.asset ${JSON.stringify(alias)} is not declared in createX402Seller({ assets }); `
      + "known asset aliases must be listed there, raw asset addresses are not accepted",
    );
    return undefined;
  }
  return resolved;
}

export function validateScheme(scheme: string, issues: string[]): void {
  if (!SCHEME_FAMILIES.has(scheme)) {
    issues.push(`payment.scheme ${JSON.stringify(scheme)} is not a recognized x402 scheme family (${[...SCHEME_FAMILIES].join(", ")})`);
  }
}

export function validateNetwork(network: string | undefined, issues: string[], label = "network"): void {
  if (network === undefined || network.trim().length === 0) {
    issues.push(`${label} is required: set createX402Seller({ network }) or payment.network`);
    return;
  }
  if (!NETWORK_PATTERN.test(network)) {
    issues.push(`${label} must be a CAIP-2 identifier like "stellar:testnet", got ${JSON.stringify(network)}`);
  }
}

export function validatePayTo(payTo: string | undefined, issues: string[]): void {
  if (payTo === undefined || payTo.trim().length === 0) {
    issues.push("payTo is required: set createX402Seller({ payTo }) or payment.payTo");
  }
}

/**
 * Validates and normalizes `createX402Seller({ publicUrl })`. Unlike
 * `resolveSellerPublicUrl`, this does not require `https`: by the time a seller has an
 * origin string in hand (local tunnel, `resolveSellerPublicUrl()`, or otherwise) it has
 * already made that call, and re-enforcing it here would make local development
 * impossible to configure through `createX402Seller` directly.
 */
export function validatePublicUrl(url: string, issues: string[]): string | undefined {
  if (typeof url !== "string" || url.trim().length === 0) {
    issues.push("publicUrl must not be empty");
    return undefined;
  }
  const trimmed = url.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    issues.push(`publicUrl must be an absolute http(s) URL, got ${JSON.stringify(url)}`);
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    issues.push(`publicUrl must use http or https, got ${JSON.stringify(parsed.protocol)}`);
    return undefined;
  }
  if (parsed.username !== "" || parsed.password !== "") {
    issues.push("publicUrl must not contain credentials");
    return undefined;
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    issues.push(`publicUrl must be an origin with no path, got ${JSON.stringify(url)}`);
    return undefined;
  }
  return `${parsed.protocol}//${parsed.host}`;
}
