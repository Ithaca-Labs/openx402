import { createHash, randomBytes } from "node:crypto";
import { canonicalJson } from "../resourceRef.js";

export interface PaymentIdentifierInput {
  ref: string;
  versionHash: string;
  network: string;
  scheme: string;
  asset: string;
  maxAtomicAmount: string;
  nonce: string;
}

/**
 * One official Payment Identifier per logical invocation: a deterministic
 * hash of the resource reference, its version hash, the chosen payment
 * terms and a per-invocation nonce. Recomputing it from the same inputs
 * always yields the same id, which is what lets a network-level retry reuse
 * it instead of minting a fresh authorization.
 */
export function computePaymentIdentifier(input: PaymentIdentifierInput): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

export function newInvocationNonce(): string {
  return randomBytes(16).toString("hex");
}

/**
 * In-process guard against issuing a second automatic paid retry for the
 * same logical invocation. Scoped to this process only -- cross-replica
 * idempotency for the same Payment Identifier is enforced durably by
 * `PostgresBudgetStore`'s reservation row, which this guard complements
 * rather than replaces.
 */
export class SingleRetryGuard {
  private readonly claimed = new Set<string>();

  /** Returns true the first time this id is claimed, false on every call after. */
  claim(paymentIdentifier: string): boolean {
    if (this.claimed.has(paymentIdentifier)) return false;
    this.claimed.add(paymentIdentifier);
    return true;
  }

  release(paymentIdentifier: string): void {
    this.claimed.delete(paymentIdentifier);
  }
}
