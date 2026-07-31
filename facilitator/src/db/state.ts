import type { Pool, PoolClient } from "pg";
import type { PreparedSettlement, Scheme, SettlementOutcome, StellarNetwork } from "../types.js";

export interface ChannelLease {
  network: StellarNetwork;
  address: string;
  fencingToken: bigint;
}

export interface SettlementRecord {
  id: number;
  scheme: Scheme;
  network: StellarNetwork;
  status: "verified" | "preparing" | "submitting" | "pending" | "success" | "failed" | "unknown";
  actualAmount?: bigint;
  payer?: string;
  channelAddress?: string;
  fencingToken?: bigint;
  envelopeXdr?: string;
  transactionHash?: string;
  response?: SettlementOutcome;
}

export type ClaimResult =
  | { kind: "owner"; record: SettlementRecord }
  | { kind: "wait"; record: SettlementRecord }
  | { kind: "resume"; record: SettlementRecord }
  | { kind: "cached"; record: SettlementRecord }
  | { kind: "conflict"; message: string };

function mapRecord(row: Record<string, unknown>): SettlementRecord {
  const record: SettlementRecord = {
    id: Number(row.id),
    scheme: row.scheme as Scheme,
    network: row.network as StellarNetwork,
    status: row.status as SettlementRecord["status"],
  };
  if (row.actual_amount !== null && row.actual_amount !== undefined) record.actualAmount = BigInt(String(row.actual_amount));
  if (typeof row.payer === "string") record.payer = row.payer;
  if (typeof row.channel_address === "string") record.channelAddress = row.channel_address;
  if (row.fencing_token !== null && row.fencing_token !== undefined) record.fencingToken = BigInt(String(row.fencing_token));
  if (typeof row.envelope_xdr === "string") record.envelopeXdr = row.envelope_xdr;
  if (typeof row.transaction_hash === "string") record.transactionHash = row.transaction_hash;
  if (row.response_json && typeof row.response_json === "object") record.response = row.response_json as SettlementOutcome;
  return record;
}

export class StateStore {
  constructor(private readonly pool: Pool) {}

  async ready(): Promise<boolean> {
    const result = await this.pool.query<{ ok: number }>("SELECT 1 AS ok");
    return result.rows[0]?.ok === 1;
  }

  async upsertChannel(network: StellarNetwork, address: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO channel_accounts(network, address) VALUES ($1, $2)
       ON CONFLICT (network, address) DO UPDATE SET updated_at = now()`,
      [network, address],
    );
  }

  async syncChannels(network: StellarNetwork, addresses: string[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE channel_accounts SET status = 'disabled', updated_at = now()
         WHERE network = $1 AND NOT (address = ANY($2::text[])) AND settlement_record_id IS NULL`,
        [network, addresses],
      );
      for (const address of addresses) {
        await client.query(
          `INSERT INTO channel_accounts(network, address) VALUES ($1, $2)
           ON CONFLICT (network, address) DO UPDATE SET
             status = CASE WHEN channel_accounts.settlement_record_id IS NULL THEN 'idle' ELSE channel_accounts.status END,
             updated_at = now()`,
          [network, address],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async registerIdempotency(
    scope: string,
    key: string,
    fingerprint: string,
    scheme: Scheme,
    network: StellarNetwork,
  ): Promise<{ conflict: boolean; response?: SettlementOutcome }> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO idempotency_records(scope, idempotency_key, fingerprint, scheme, network)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (scope, idempotency_key) DO UPDATE SET updated_at = now()
       RETURNING fingerprint, response_json`,
      [scope, key, fingerprint, scheme, network],
    );
    const row = result.rows[0]!;
    return {
      conflict: row.fingerprint !== fingerprint,
      ...(row.response_json && typeof row.response_json === "object"
        ? { response: row.response_json as SettlementOutcome }
        : {}),
    };
  }

  async claimSettlement(args: {
    scope: string; key: string; fingerprint: string; scheme: Scheme; network: StellarNetwork;
    actual: bigint; workerId: string; leaseMs: number;
  }): Promise<ClaimResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO idempotency_records(scope, idempotency_key, fingerprint, scheme, network)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [args.scope, args.key, args.fingerprint, args.scheme, args.network],
      );
      const selected = await client.query<Record<string, unknown>>(
        `SELECT * FROM idempotency_records WHERE scope = $1 AND idempotency_key = $2 FOR UPDATE`,
        [args.scope, args.key],
      );
      const row = selected.rows[0]!;
      if (row.fingerprint !== args.fingerprint) {
        await client.query("COMMIT");
        return { kind: "conflict", message: "payment identifier was reused with a different request fingerprint" };
      }
      if (row.actual_amount !== null && BigInt(String(row.actual_amount)) !== args.actual) {
        await client.query("COMMIT");
        return { kind: "conflict", message: "payment identifier was reused with a different settlement amount" };
      }
      const record = mapRecord(row);
      if (record.response) {
        await client.query("COMMIT");
        return { kind: "cached", record };
      }
      if (record.transactionHash) {
        await client.query("COMMIT");
        return { kind: "resume", record };
      }
      const leaseAlive = row.worker_lease_until instanceof Date && row.worker_lease_until.getTime() > Date.now();
      if (row.status === "preparing" && leaseAlive && row.worker_id !== args.workerId) {
        await client.query("COMMIT");
        return { kind: "wait", record };
      }
      const claimed = await client.query<Record<string, unknown>>(
        `UPDATE idempotency_records SET status = 'preparing', actual_amount = $2,
           worker_id = $3, worker_lease_until = now() + ($4 * interval '1 millisecond'), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [record.id, args.actual.toString(), args.workerId, args.leaseMs],
      );
      await client.query("COMMIT");
      return { kind: "owner", record: mapRecord(claimed.rows[0]!) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async leaseChannel(
    network: StellarNetwork,
    workerId: string,
    leaseMs: number,
    allowedAddresses?: string[],
  ): Promise<ChannelLease | undefined> {
    const result = await this.pool.query<Record<string, unknown>>(
      `WITH candidate AS (
         SELECT network, address FROM channel_accounts
         WHERE network = $1 AND ($4::text[] IS NULL OR address = ANY($4::text[])) AND (
           status = 'idle' OR (status = 'leased' AND lease_until < now() AND settlement_record_id IS NULL)
         )
         ORDER BY updated_at, address FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE channel_accounts c SET status = 'leased', lease_owner = $2,
         lease_until = now() + ($3 * interval '1 millisecond'),
         fencing_token = c.fencing_token + 1, updated_at = now()
       FROM candidate WHERE c.network = candidate.network AND c.address = candidate.address
       RETURNING c.network, c.address, c.fencing_token`,
      [network, workerId, leaseMs, allowedAddresses ?? null],
    );
    const row = result.rows[0];
    return row ? { network, address: String(row.address), fencingToken: BigInt(String(row.fencing_token)) } : undefined;
  }

  async releaseChannel(lease: ChannelLease): Promise<void> {
    await this.pool.query(
      `UPDATE channel_accounts SET status = 'idle', lease_owner = NULL, lease_until = NULL,
         settlement_record_id = NULL, updated_at = now()
       WHERE network = $1 AND address = $2 AND fencing_token = $3 AND status = 'leased'`,
      [lease.network, lease.address, lease.fencingToken.toString()],
    );
  }

  async storePreparedAndReserve(args: {
    recordId: number; lease: ChannelLease; prepared: PreparedSettlement; scope: string;
    perScopeDailyLimit: bigint; globalDailyLimit: bigint;
  }): Promise<"stored" | "budget_exceeded" | "fence_lost"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const channel = await client.query(
        `SELECT 1 FROM channel_accounts WHERE network = $1 AND address = $2
         AND fencing_token = $3 AND status = 'leased' FOR UPDATE`,
        [args.lease.network, args.lease.address, args.lease.fencingToken.toString()],
      );
      if (channel.rowCount !== 1) {
        await client.query("ROLLBACK");
        return "fence_lost";
      }
      const allowed = await this.reserveBudget(
        client, args.scope, args.prepared.estimatedTotalFee,
        args.perScopeDailyLimit, args.globalDailyLimit,
      );
      if (!allowed) {
        await client.query("ROLLBACK");
        return "budget_exceeded";
      }
      await client.query(
        `UPDATE idempotency_records SET status = 'submitting', payer = $2, channel_address = $3,
           fencing_token = $4, envelope_xdr = $5, transaction_hash = $6,
           estimated_fee_stroops = $7, updated_at = now()
         WHERE id = $1`,
        [args.recordId, args.prepared.payer, args.lease.address, args.lease.fencingToken.toString(),
          args.prepared.envelopeXdr, args.prepared.transactionHash, args.prepared.estimatedTotalFee.toString()],
      );
      await client.query(
        `UPDATE channel_accounts SET status = 'unresolved', settlement_record_id = $4, updated_at = now()
         WHERE network = $1 AND address = $2 AND fencing_token = $3`,
        [args.lease.network, args.lease.address, args.lease.fencingToken.toString(), args.recordId],
      );
      await this.audit(client, args.recordId, "prepared", { transactionHash: args.prepared.transactionHash });
      await client.query("COMMIT");
      return "stored";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async reserveBudget(client: PoolClient, scope: string, amount: bigint, perScope: bigint, global: bigint): Promise<boolean> {
    await client.query(
      `INSERT INTO sponsor_daily_usage(usage_day, scope, sponsored_stroops)
       VALUES (CURRENT_DATE, $1, 0), (CURRENT_DATE, '__global__', 0) ON CONFLICT DO NOTHING`,
      [scope],
    );
    const rows = await client.query<{ scope: string; sponsored_stroops: string }>(
      `SELECT scope, sponsored_stroops FROM sponsor_daily_usage
       WHERE usage_day = CURRENT_DATE AND scope IN ($1, '__global__') ORDER BY scope FOR UPDATE`,
      [scope],
    );
    const usage = new Map(rows.rows.map(row => [row.scope, BigInt(row.sponsored_stroops)]));
    if ((usage.get(scope) ?? 0n) + amount > perScope || (usage.get("__global__") ?? 0n) + amount > global) return false;
    await client.query(
      `UPDATE sponsor_daily_usage SET sponsored_stroops = sponsored_stroops + $2
       WHERE usage_day = CURRENT_DATE AND scope IN ($1, '__global__')`,
      [scope, amount.toString()],
    );
    return true;
  }

  async markPending(recordId: number): Promise<void> {
    await this.pool.query("UPDATE idempotency_records SET status = 'pending', updated_at = now() WHERE id = $1", [recordId]);
  }

  async complete(recordId: number, outcome: SettlementOutcome, status: "success" | "failed"): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ channel_address: string | null; network: StellarNetwork }>(
        `UPDATE idempotency_records SET status = $2, response_json = $3, updated_at = now()
         WHERE id = $1 RETURNING channel_address, network`,
        [recordId, status, JSON.stringify(outcome)],
      );
      const row = result.rows[0];
      if (row?.channel_address) {
        await client.query(
          `UPDATE channel_accounts SET status = 'idle', lease_owner = NULL, lease_until = NULL,
             settlement_record_id = NULL, updated_at = now()
           WHERE network = $1 AND address = $2 AND settlement_record_id = $3`,
          [row.network, row.channel_address, recordId],
        );
      }
      await this.audit(client, recordId, status, {});
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markUnknown(recordId: number, reason: string): Promise<void> {
    await this.pool.query(
      `UPDATE idempotency_records SET status = 'unknown', error_reason = $2,
         worker_id = NULL, worker_lease_until = NULL, updated_at = now() WHERE id = $1`,
      [recordId, reason],
    );
  }

  async listUnresolved(): Promise<SettlementRecord[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM idempotency_records
       WHERE transaction_hash IS NOT NULL AND response_json IS NULL
         AND status IN ('submitting', 'pending', 'unknown') ORDER BY updated_at`,
    );
    return result.rows.map(mapRecord);
  }

  async getRecord(recordId: number): Promise<SettlementRecord | undefined> {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM idempotency_records WHERE id = $1", [recordId]);
    return result.rows[0] ? mapRecord(result.rows[0]) : undefined;
  }

  async consumeSimulations(scope: string, count: number, maximum: number): Promise<boolean> {
    const result = await this.pool.query<{ simulations: number }>(
      `INSERT INTO simulation_windows(window_start, scope, simulations)
       VALUES (date_trunc('minute', now()), $1, $2)
       ON CONFLICT (window_start, scope) DO UPDATE
         SET simulations = simulation_windows.simulations + EXCLUDED.simulations
       RETURNING simulations`, [scope, count],
    );
    return (result.rows[0]?.simulations ?? maximum + 1) <= maximum;
  }

  async unresolvedCount(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM idempotency_records WHERE status IN ('preparing', 'submitting', 'pending', 'unknown')",
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private async audit(client: PoolClient, recordId: number, event: string, details: Record<string, unknown>): Promise<void> {
    await client.query(
      "INSERT INTO settlement_audit(settlement_record_id, event, details) VALUES ($1, $2, $3)",
      [recordId, event, JSON.stringify(details)],
    );
  }
}
