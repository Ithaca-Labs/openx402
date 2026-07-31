import { createHash } from "node:crypto";
import type { PaymentPayload } from "@x402/core/types";
import type { RequestEnvelope } from "./types.js";

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function paymentIdentifier(payload: PaymentPayload): string | undefined {
  const extension = payload.extensions?.["payment-identifier"];
  if (!extension || typeof extension !== "object" || Array.isArray(extension)) return undefined;
  const info = (extension as Record<string, unknown>).info;
  if (!info || typeof info !== "object" || Array.isArray(info)) return undefined;
  const id = (info as Record<string, unknown>).id;
  return typeof id === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(id) ? id : undefined;
}

export function paymentIdentifierError(payload: PaymentPayload): string | undefined {
  const extension = payload.extensions?.["payment-identifier"];
  if (extension === undefined) return undefined;
  if (!extension || typeof extension !== "object" || Array.isArray(extension)) {
    return "invalid_payment_identifier_extension";
  }
  const info = (extension as Record<string, unknown>).info;
  if (!info || typeof info !== "object" || Array.isArray(info)) {
    return "invalid_payment_identifier_extension";
  }
  const values = info as Record<string, unknown>;
  if (typeof values.required !== "boolean") return "invalid_payment_identifier_extension";
  if (values.id === undefined) return values.required ? "payment_identifier_required" : undefined;
  if (typeof values.id !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(values.id)) {
    return "invalid_payment_identifier";
  }
  return undefined;
}

export function idempotencyData(request: RequestEnvelope): { key: string; fingerprint: string } {
  const payload = request.paymentPayload;
  const transaction = typeof payload.payload.transaction === "string" ? payload.payload.transaction : "";
  const key = paymentIdentifier(payload) ?? `xdr_${sha256(transaction)}`;
  const fingerprint = sha256(stable({
    x402Version: payload.x402Version,
    resource: payload.resource ?? null,
    accepted: payload.accepted,
    transactionHash: sha256(transaction),
  }));
  return { key, fingerprint };
}

export function principalScope(network: string, sponsor: string, principal: string): string {
  return `${network}:${sponsor}:${sha256(principal)}`;
}

export function paymentScope(network: string, sponsor: string, payTo: string): string {
  return `${network}:${sponsor}:${payTo}`;
}

export function settlementIdForPaymentIdentifier(id: string): Buffer {
  return createHash("sha256")
    .update("x402:payment-identifier:v1\0", "utf8")
    .update(id, "utf8")
    .digest();
}
