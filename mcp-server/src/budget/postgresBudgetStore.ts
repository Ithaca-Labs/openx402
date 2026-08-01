import type { Pool, PoolClient } from "pg";
import { McpToolError } from "../errors.js";
import type { BudgetLimits, BudgetStore, ReservationRecord, ReservationStatus, ReserveInput } from "./budgetStore.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function toRecord(row: Record<string, unknown>): ReservationRecord {
  return {
    paymentIdentifier: String(row.payment_identifier),
    status: row.status as ReservationStatus,
    reservedAmount: BigInt(String(row.reserved_amount)),
    ...(row.settled_amount !== null && row.settled_amount !== undefined ? { settledAmount: BigInt(String(row.settled_amount)) } : {}),
    ...(row.transaction_hash ? { transactionHash: String(row.transaction_hash) } : {}),
  };
}

/**
 * PostgreSQL-backed budget store against the same instance the facilitator
 * uses (a separate `DATABASE_URL`-configured pool -- this package never
 * imports or shares the facilitator's own `pg.Pool`). Every mutation runs
 * inside one transaction with `SELECT ... FOR UPDATE` row locks on both the
 * reservation row and the daily usage row, so two replicas racing on the
 * same agent's budget serialize correctly instead of double-spending.
 */
export class PostgresBudgetStore implements BudgetStore {
  constructor(private readonly pool: Pool) {}

  async reserve(input: ReserveInput, limits: BudgetLimits): Promise<ReservationRecord> {
    if (input.amount > limits.perCallMaxAtomic) {
      throw new McpToolError("BUDGET_EXCEEDED", "amount exceeds the per-call limit", {
        amount: input.amount.toString(), perCallMaxAtomic: limits.perCallMaxAtomic.toString(),
      });
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // `SELECT ... FOR UPDATE` cannot lock a row that doesn't exist yet, so
      // two replicas racing on the same brand-new payment_identifier would
      // otherwise both pass the existence check and collide on the unique
      // constraint. An advisory lock keyed on the identifier serializes them
      // even before any row exists; 1402 is a namespace distinct from the
      // migration lock (402, 2).
      await client.query("SELECT pg_advisory_xact_lock(1402, hashtext($1))", [input.paymentIdentifier]);
      const existing = await client.query(
        "SELECT * FROM mcp_budget_reservations WHERE payment_identifier = $1 FOR UPDATE",
        [input.paymentIdentifier],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return toRecord(existing.rows[0]);
      }

      const day = today();
      await client.query(
        "INSERT INTO mcp_budget_usage(agent_id, usage_day) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [input.agentId, day],
      );
      const usage = await client.query<{ spent_amount: string; reserved_amount: string }>(
        "SELECT spent_amount, reserved_amount FROM mcp_budget_usage WHERE agent_id = $1 AND usage_day = $2 FOR UPDATE",
        [input.agentId, day],
      );
      const usageRow = usage.rows[0]!;
      const committed = BigInt(usageRow.spent_amount) + BigInt(usageRow.reserved_amount);
      if (committed + input.amount > limits.sessionOrDayMaxAtomic) {
        await client.query("ROLLBACK");
        throw new McpToolError("BUDGET_EXCEEDED", "amount would exceed the session/day budget", {
          committed: committed.toString(), amount: input.amount.toString(), sessionOrDayMaxAtomic: limits.sessionOrDayMaxAtomic.toString(),
        });
      }

      await client.query(
        "UPDATE mcp_budget_usage SET reserved_amount = reserved_amount + $3 WHERE agent_id = $1 AND usage_day = $2",
        [input.agentId, day, input.amount.toString()],
      );
      const inserted = await client.query(
        `INSERT INTO mcp_budget_reservations(
           payment_identifier, agent_id, session_id, usage_day, resource_ref, network, asset, scheme, reserved_amount, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'reserved') RETURNING *`,
        [
          input.paymentIdentifier, input.agentId, input.sessionId ?? null, day, input.resourceRef,
          input.network, input.asset, input.scheme, input.amount.toString(),
        ],
      );
      await client.query("COMMIT");
      return toRecord(inserted.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async reconcile(paymentIdentifier: string, settledAmount: bigint, transactionHash: string): Promise<ReservationRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = await this.lockReservation(client, paymentIdentifier);
      if (row.status === "settled") {
        await client.query("COMMIT");
        return toRecord(row);
      }
      const reserved = BigInt(String(row.reserved_amount));
      // The entire original reservation leaves "reserved": the settled
      // portion moves to "spent", the unused portion (reserved - settled)
      // simply frees up -- it is never counted in either column again.
      await client.query(
        "UPDATE mcp_budget_usage SET reserved_amount = reserved_amount - $3, spent_amount = spent_amount + $4 WHERE agent_id = $1 AND usage_day = $2",
        [row.agent_id, row.usage_day, reserved.toString(), settledAmount.toString()],
      );
      const updated = await client.query(
        "UPDATE mcp_budget_reservations SET status = 'settled', settled_amount = $2, transaction_hash = $3, updated_at = now() WHERE payment_identifier = $1 RETURNING *",
        [paymentIdentifier, settledAmount.toString(), transactionHash],
      );
      await client.query("COMMIT");
      return toRecord(updated.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async markUnknown(paymentIdentifier: string, transactionHash?: string): Promise<ReservationRecord> {
    const result = await this.pool.query(
      "UPDATE mcp_budget_reservations SET status = 'unknown', transaction_hash = COALESCE($2, transaction_hash), updated_at = now() WHERE payment_identifier = $1 RETURNING *",
      [paymentIdentifier, transactionHash ?? null],
    );
    if (!result.rows[0]) throw new McpToolError("INVALID_ARGUMENT", `no reservation for payment identifier ${paymentIdentifier}`);
    return toRecord(result.rows[0]);
  }

  async release(paymentIdentifier: string): Promise<ReservationRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = await this.lockReservation(client, paymentIdentifier);
      if (row.status === "released") {
        await client.query("COMMIT");
        return toRecord(row);
      }
      await client.query(
        "UPDATE mcp_budget_usage SET reserved_amount = reserved_amount - $3 WHERE agent_id = $1 AND usage_day = $2",
        [row.agent_id, row.usage_day, String(row.reserved_amount)],
      );
      const updated = await client.query(
        "UPDATE mcp_budget_reservations SET status = 'released', updated_at = now() WHERE payment_identifier = $1 RETURNING *",
        [paymentIdentifier],
      );
      await client.query("COMMIT");
      return toRecord(updated.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async get(paymentIdentifier: string): Promise<ReservationRecord | undefined> {
    const result = await this.pool.query(
      "SELECT * FROM mcp_budget_reservations WHERE payment_identifier = $1",
      [paymentIdentifier],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async usedToday(agentId: string): Promise<bigint> {
    const result = await this.pool.query<{ spent_amount: string; reserved_amount: string }>(
      "SELECT spent_amount, reserved_amount FROM mcp_budget_usage WHERE agent_id = $1 AND usage_day = $2",
      [agentId, today()],
    );
    const row = result.rows[0];
    if (!row) return 0n;
    return BigInt(row.spent_amount) + BigInt(row.reserved_amount);
  }

  private async lockReservation(client: PoolClient, paymentIdentifier: string): Promise<Record<string, unknown>> {
    const result = await client.query(
      "SELECT * FROM mcp_budget_reservations WHERE payment_identifier = $1 FOR UPDATE",
      [paymentIdentifier],
    );
    const row = result.rows[0];
    if (!row) throw new McpToolError("INVALID_ARGUMENT", `no reservation for payment identifier ${paymentIdentifier}`);
    return row;
  }
}
