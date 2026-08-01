export type ReservationStatus = "reserved" | "settled" | "unknown" | "released" | "failed";

export interface ReserveInput {
  paymentIdentifier: string;
  agentId: string;
  sessionId?: string;
  resourceRef: string;
  network: string;
  asset: string;
  scheme: "exact" | "upto";
  /** The conservative maximum to reserve, in atomic units. */
  amount: bigint;
}

export interface BudgetLimits {
  perCallMaxAtomic: bigint;
  sessionOrDayMaxAtomic: bigint;
}

export interface ReservationRecord {
  paymentIdentifier: string;
  status: ReservationStatus;
  reservedAmount: bigint;
  settledAmount?: bigint;
  transactionHash?: string;
}

/**
 * All amounts are decimal-string atomic units parsed to `bigint`. Never
 * `Number` -- see `budgetPolicy.ts`. Every mutating method must be
 * idempotent on `paymentIdentifier`: replaying the same call (a duplicate
 * agent invocation, or a retried network request) returns the existing
 * record rather than reserving/spending twice.
 */
export interface BudgetStore {
  /**
   * Reserves the conservative maximum before any signing happens. Throws
   * `BUDGET_EXCEEDED` if the reservation would exceed the session/day
   * ceiling. Reusing an already-reserved `paymentIdentifier` returns the
   * existing reservation unchanged.
   */
  reserve(input: ReserveInput, limits: BudgetLimits): Promise<ReservationRecord>;

  /**
   * Reconciles a reservation to the actual settled amount after a confirmed
   * successful settlement (meaningful for `upto`, a no-op adjustment for
   * `exact`) and releases the unused portion back to the daily budget.
   */
  reconcile(paymentIdentifier: string, settledAmount: bigint, transactionHash: string): Promise<ReservationRecord>;

  /**
   * Marks a reservation `unknown` after an unresolved settlement response.
   * The full reservation stays held -- nothing is released -- until a
   * subsequent poll resolves it via `reconcile` or `release`.
   */
  markUnknown(paymentIdentifier: string, transactionHash?: string): Promise<ReservationRecord>;

  /** Releases a reservation after a conclusively failed, non-settled payment. */
  release(paymentIdentifier: string): Promise<ReservationRecord>;

  get(paymentIdentifier: string): Promise<ReservationRecord | undefined>;

  /** Atomic-unit spend already reserved or settled today for this agent. */
  usedToday(agentId: string): Promise<bigint>;
}
