import { McpToolError } from "../errors.js";
import type { BudgetStore, ReservationRecord } from "./budgetStore.js";

export interface EffectiveCapInput {
  perCallLimitAtomic: bigint;
  sessionOrDayRemainingAtomic: bigint;
  /** The x402 exact amount, or the upto maximum. */
  x402RequiredAtomic: bigint;
  /** The on-chain smart-account policy ceiling, if known ahead of simulation. */
  onChainPolicyCeilingAtomic?: bigint;
}

/**
 * The effective cap is the minimum of every independent ceiling: the
 * agent's per-call limit, its remaining session/day budget, the x402 exact
 * amount or upto maximum, and (if known) the on-chain smart-account policy.
 * These ceilings are independent -- this function never treats a lower
 * client-side limit as license to skip the facilitator's own enforcing
 * simulation or sponsor fee gate; it only ever tightens what this client is
 * willing to authorize.
 */
export function computeEffectiveCap(input: EffectiveCapInput): bigint {
  const terms = [
    input.perCallLimitAtomic,
    input.sessionOrDayRemainingAtomic,
    input.x402RequiredAtomic,
    ...(input.onChainPolicyCeilingAtomic !== undefined ? [input.onChainPolicyCeilingAtomic] : []),
  ];
  return terms.reduce((min, value) => (value < min ? value : min));
}

/**
 * The amount to actually reserve, given the effective cap and the scheme.
 * `exact` cannot be partially authorized: the reservation must equal the
 * exact required amount, so a lower effective cap means `BUDGET_EXCEEDED`,
 * not a smaller payment. `upto` may legitimately authorize less than the
 * seller's advertised maximum -- offering a tighter ceiling is always valid.
 */
export function amountToReserve(scheme: "exact" | "upto", cap: EffectiveCapInput): bigint {
  const effectiveCap = computeEffectiveCap(cap);
  if (scheme === "exact") {
    if (effectiveCap < cap.x402RequiredAtomic) {
      throw new McpToolError("BUDGET_EXCEEDED", "budget ceilings are below the required exact amount", {
        effectiveCap: effectiveCap.toString(), required: cap.x402RequiredAtomic.toString(),
      });
    }
    return cap.x402RequiredAtomic;
  }
  if (effectiveCap <= 0n) {
    throw new McpToolError("BUDGET_EXCEEDED", "budget ceilings leave no room for an upto payment", {
      effectiveCap: effectiveCap.toString(),
    });
  }
  return effectiveCap;
}

export interface ReserveForCallInput {
  paymentIdentifier: string;
  agentId: string;
  sessionId?: string;
  resourceRef: string;
  network: string;
  asset: string;
  scheme: "exact" | "upto";
  perCallMaxAtomic: bigint;
  sessionOrDayMaxAtomic: bigint;
  x402RequiredAtomic: bigint;
  onChainPolicyCeilingAtomic?: bigint;
}

/** Computes the reservation amount and reserves it, all strictly before any signing. */
export async function reserveForCall(store: BudgetStore, input: ReserveForCallInput): Promise<ReservationRecord> {
  const usedToday = await store.usedToday(input.agentId);
  const sessionOrDayRemaining = input.sessionOrDayMaxAtomic - usedToday;
  const amount = amountToReserve(input.scheme, {
    perCallLimitAtomic: input.perCallMaxAtomic,
    sessionOrDayRemainingAtomic: sessionOrDayRemaining > 0n ? sessionOrDayRemaining : 0n,
    x402RequiredAtomic: input.x402RequiredAtomic,
    ...(input.onChainPolicyCeilingAtomic !== undefined ? { onChainPolicyCeilingAtomic: input.onChainPolicyCeilingAtomic } : {}),
  });
  return store.reserve(
    {
      paymentIdentifier: input.paymentIdentifier,
      agentId: input.agentId,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      resourceRef: input.resourceRef,
      network: input.network,
      asset: input.asset,
      scheme: input.scheme,
      amount,
    },
    { perCallMaxAtomic: input.perCallMaxAtomic, sessionOrDayMaxAtomic: input.sessionOrDayMaxAtomic },
  );
}
