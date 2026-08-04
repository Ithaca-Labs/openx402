import { SellerConfigError } from "./validate.js";

export interface ResolveSellerPublicUrlOptions {
  /** Defaults to `process.env`. Override for testing. */
  env?: Record<string, string | undefined>;
  /**
   * Explicit local-development origin, e.g. `"http://localhost:4788"`. Only ever used
   * when neither `SELLER_PUBLIC_URL` nor `RAILWAY_PUBLIC_DOMAIN` is set, and is the only
   * source allowed to resolve to a non-`https` origin.
   */
  localDevelopmentUrl?: string;
}

function normalizeOrigin(raw: string, label: string, issues: string[]): string | undefined {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) {
    issues.push(`${label} must not be blank`);
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    issues.push(`${label} must be an absolute http(s) URL, got ${JSON.stringify(raw)}`);
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    issues.push(`${label} must use http or https, got ${JSON.stringify(url.protocol)}`);
    return undefined;
  }
  if (url.username !== "" || url.password !== "") {
    issues.push(`${label} must not contain credentials`);
    return undefined;
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    issues.push(`${label} must be an origin with no path, got ${JSON.stringify(raw)}`);
    return undefined;
  }
  return `${url.protocol}//${url.host}`;
}

/**
 * Resolves the seller's public origin, in order:
 *
 * 1. `SELLER_PUBLIC_URL` — explicit override, must be `https`.
 * 2. `https://${RAILWAY_PUBLIC_DOMAIN}` — automatic on Railway, no seller variable needed.
 * 3. `localDevelopmentUrl` — explicit opt-in, the only source allowed to be `http`.
 *
 * Never reads a request's `Host` header: that is client-controlled and cannot be the
 * canonical resource origin cataloged by a facilitator.
 */
export function resolveSellerPublicUrl(options: ResolveSellerPublicUrlOptions = {}): string {
  const env = options.env ?? process.env;
  const issues: string[] = [];

  const explicit = env.SELLER_PUBLIC_URL;
  if (explicit !== undefined && explicit.trim().length > 0) {
    const normalized = normalizeOrigin(explicit, "SELLER_PUBLIC_URL", issues);
    if (issues.length > 0) throw new SellerConfigError(issues);
    if (normalized!.startsWith("http://")) {
      throw new SellerConfigError([
        `SELLER_PUBLIC_URL must be https in production, got ${JSON.stringify(normalized)}; `
        + "pass localDevelopmentUrl for local development instead",
      ]);
    }
    return normalized!;
  }

  const railwayDomain = env.RAILWAY_PUBLIC_DOMAIN;
  if (railwayDomain !== undefined && railwayDomain.trim().length > 0) {
    const normalized = normalizeOrigin(`https://${railwayDomain.trim()}`, "RAILWAY_PUBLIC_DOMAIN", issues);
    if (issues.length > 0) throw new SellerConfigError(issues);
    return normalized!;
  }

  if (options.localDevelopmentUrl !== undefined) {
    const normalized = normalizeOrigin(options.localDevelopmentUrl, "localDevelopmentUrl", issues);
    if (issues.length > 0) throw new SellerConfigError(issues);
    return normalized!;
  }

  throw new SellerConfigError([
    "no seller public URL configured: set SELLER_PUBLIC_URL, deploy on Railway "
    + "(RAILWAY_PUBLIC_DOMAIN is set automatically), or pass localDevelopmentUrl explicitly",
  ]);
}
