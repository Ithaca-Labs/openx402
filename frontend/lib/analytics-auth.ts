import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

export const ANALYTICS_ACCESS_COOKIE = "openx402-analytics-access";
export const ALLOWED_ANALYTICS_EMAIL = "labsithaca@gmail.com";

const ACCESS_DURATION_SECONDS = 60 * 60 * 12;

function accessSecret(): string | undefined {
  if (process.env.ANALYTICS_ACCESS_SECRET) return process.env.ANALYTICS_ACCESS_SECRET;
  return process.env.NODE_ENV === "production" ? undefined : "openx402-analytics-development-only";
}

function signature(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function matches(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createAnalyticsAccessToken(now = Date.now()): string | undefined {
  const secret = accessSecret();
  if (!secret) return undefined;

  const expiresAt = Math.floor(now / 1000) + ACCESS_DURATION_SECONDS;
  const payload = `${ALLOWED_ANALYTICS_EMAIL}.${expiresAt}`;
  return `${expiresAt}.${signature(payload, secret)}`;
}

export async function hasAnalyticsAccess(now = Date.now()): Promise<boolean> {
  const secret = accessSecret();
  const token = (await cookies()).get(ANALYTICS_ACCESS_COOKIE)?.value;
  if (!secret || !token) return false;

  const [expiresAt, tokenSignature, ...rest] = token.split(".");
  const expiresAtNumber = Number(expiresAt);
  if (rest.length || !Number.isSafeInteger(expiresAtNumber) || expiresAtNumber <= Math.floor(now / 1000) || !tokenSignature) {
    return false;
  }

  return matches(tokenSignature, signature(`${ALLOWED_ANALYTICS_EMAIL}.${expiresAtNumber}`, secret));
}

export const analyticsAccessCookieOptions = {
  httpOnly: true,
  maxAge: ACCESS_DURATION_SECONDS,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};
