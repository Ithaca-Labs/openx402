import { McpToolError } from "../errors.js";
import type { BudgetLimits, BudgetStore, ReservationRecord, ReserveInput } from "./budgetStore.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * In-process budget store for local stdio sessions. Restart weakness: all
 * reservations and daily usage live only in this process's memory, so a
 * crash or restart mid-invocation forgets any `reserved`/`unknown`
 * reservation and resets the daily counter to zero. This is acceptable for
 * a single local agent session where the operator is present and the
 * blast radius is one signer's own funds, but it must never be the default
 * for a shared or remote deployment -- `config.ts` only selects this store
 * for the stdio transport.
 */
export class MemoryBudgetStore implements BudgetStore {
  private readonly reservations = new Map<string, ReservationRecord>();
  private readonly dailyUsage = new Map<string, bigint>();
  private readonly dailyKeyOf = new Map<string, string>();

  async reserve(input: ReserveInput, limits: BudgetLimits): Promise<ReservationRecord> {
    const existing = this.reservations.get(input.paymentIdentifier);
    if (existing) return existing;

    if (input.amount > limits.perCallMaxAtomic) {
      throw new McpToolError("BUDGET_EXCEEDED", "amount exceeds the per-call limit", {
        amount: input.amount.toString(), perCallMaxAtomic: limits.perCallMaxAtomic.toString(),
      });
    }
    const key = `${input.agentId}|${today()}`;
    const used = this.dailyUsage.get(key) ?? 0n;
    if (used + input.amount > limits.sessionOrDayMaxAtomic) {
      throw new McpToolError("BUDGET_EXCEEDED", "amount would exceed the session/day budget", {
        used: used.toString(), amount: input.amount.toString(), sessionOrDayMaxAtomic: limits.sessionOrDayMaxAtomic.toString(),
      });
    }
    this.dailyUsage.set(key, used + input.amount);
    this.dailyKeyOf.set(input.paymentIdentifier, key);
    const record: ReservationRecord = {
      paymentIdentifier: input.paymentIdentifier,
      status: "reserved",
      reservedAmount: input.amount,
    };
    this.reservations.set(input.paymentIdentifier, record);
    return record;
  }

  async reconcile(paymentIdentifier: string, settledAmount: bigint, transactionHash: string): Promise<ReservationRecord> {
    const record = this.require(paymentIdentifier);
    if (record.status === "settled") return record;
    const unused = record.reservedAmount - settledAmount;
    if (unused > 0n) this.releaseFromDaily(record, unused);
    const updated: ReservationRecord = { ...record, status: "settled", settledAmount, transactionHash };
    this.reservations.set(paymentIdentifier, updated);
    return updated;
  }

  async markUnknown(paymentIdentifier: string, transactionHash?: string): Promise<ReservationRecord> {
    const record = this.require(paymentIdentifier);
    const updated: ReservationRecord = { ...record, status: "unknown", ...(transactionHash ? { transactionHash } : {}) };
    this.reservations.set(paymentIdentifier, updated);
    return updated;
  }

  async release(paymentIdentifier: string): Promise<ReservationRecord> {
    const record = this.require(paymentIdentifier);
    if (record.status === "released") return record;
    this.releaseFromDaily(record, record.reservedAmount);
    const updated: ReservationRecord = { ...record, status: "released" };
    this.reservations.set(paymentIdentifier, updated);
    return updated;
  }

  async get(paymentIdentifier: string): Promise<ReservationRecord | undefined> {
    return this.reservations.get(paymentIdentifier);
  }

  async usedToday(agentId: string): Promise<bigint> {
    return this.dailyUsage.get(`${agentId}|${today()}`) ?? 0n;
  }

  private require(paymentIdentifier: string): ReservationRecord {
    const record = this.reservations.get(paymentIdentifier);
    if (!record) throw new McpToolError("INVALID_ARGUMENT", `no reservation for payment identifier ${paymentIdentifier}`);
    return record;
  }

  private releaseFromDaily(record: ReservationRecord, amount: bigint): void {
    // Reservations are not keyed by agent, so recover the agent's daily key
    // via the reservation's own identifier prefix stashed at reserve time.
    const key = this.dailyKeyOf.get(record.paymentIdentifier);
    if (!key) return;
    const used = this.dailyUsage.get(key) ?? 0n;
    this.dailyUsage.set(key, used - amount > 0n ? used - amount : 0n);
  }
}
