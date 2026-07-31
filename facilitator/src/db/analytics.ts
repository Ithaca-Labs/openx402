import type { Pool } from "pg";

export interface PaymentEventInput {
  settlementRecordId?: number;
  stage: "verified" | "settled";
  status: "valid" | "invalid" | "success" | "failed" | "unknown";
  network: string;
  scheme: string;
  asset: string;
  assetSymbol?: string;
  assetDecimals?: number;
  payer?: string;
  payTo: string;
  maxAmount: string;
  amount?: string;
  feeStroops?: string;
  transactionHash?: string;
  facilitatorId: string;
  resourceId?: number;
  resourceVersionId?: number;
  paymentOptionId?: number;
  resourceUrl?: string;
  errorReason?: string;
}

export interface TimeWindow {
  /** Days of history; 0 means all time. */
  days: number;
}

function since(days: number): string {
  return days > 0 ? `AND occurred_at >= now() - (${Number(days)} * interval '1 day')` : "";
}

const SETTLED = "stage = 'settled'";

export class AnalyticsStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Appends one analytics fact and its daily rollup. Called on the same
   * soft-failure path as cataloging so it can never fail a payment.
   */
  async record(event: PaymentEventInput): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // A settlement that resolves from `unknown` to a terminal status rewrites
      // its own fact, so the rollup must be corrected rather than doubled.
      const previous = event.settlementRecordId !== undefined
        ? (await client.query<Record<string, unknown>>(
            `SELECT status, amount, fee_stroops, occurred_at::date AS usage_day, network, scheme,
                    asset, pay_to
             FROM payment_events WHERE settlement_record_id = $1 AND stage = $2 FOR UPDATE`,
            [event.settlementRecordId, event.stage],
          )).rows[0]
        : undefined;
      await client.query(
        `INSERT INTO payment_events(
           settlement_record_id, stage, status, network, scheme, asset, asset_symbol,
           asset_decimals, payer, pay_to, max_amount, amount, fee_stroops, transaction_hash,
           facilitator_id, resource_id, resource_version_id, payment_option_id, resource_url,
           error_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (settlement_record_id, stage) WHERE settlement_record_id IS NOT NULL
         DO UPDATE SET status = EXCLUDED.status, amount = EXCLUDED.amount,
           fee_stroops = EXCLUDED.fee_stroops, transaction_hash = EXCLUDED.transaction_hash,
           error_reason = EXCLUDED.error_reason, resource_id = COALESCE(EXCLUDED.resource_id, payment_events.resource_id)`,
        [
          event.settlementRecordId ?? null, event.stage, event.status, event.network, event.scheme,
          event.asset, event.assetSymbol ?? null, event.assetDecimals ?? null, event.payer ?? null,
          event.payTo, event.maxAmount, event.amount ?? null, event.feeStroops ?? null,
          event.transactionHash ?? null, event.facilitatorId, event.resourceId ?? null,
          event.resourceVersionId ?? null, event.paymentOptionId ?? null, event.resourceUrl ?? null,
          event.errorReason ?? null,
        ],
      );
      if (event.stage === "settled") {
        if (previous) {
          await client.query(
            `UPDATE payment_daily_totals SET
               transactions = transactions - 1,
               amount = amount - $7,
               fee_stroops = fee_stroops - $8
             WHERE usage_day = $1 AND network = $2 AND scheme = $3 AND asset = $4
               AND pay_to = $5 AND status = $6`,
            [
              previous.usage_day, previous.network, previous.scheme, previous.asset,
              previous.pay_to, previous.status, String(previous.amount ?? "0"),
              String(previous.fee_stroops ?? "0"),
            ],
          );
        }
        await client.query(
          `INSERT INTO payment_daily_totals(
             usage_day, network, scheme, asset, pay_to, status, transactions, amount, fee_stroops)
           VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, 1, $6, $7)
           ON CONFLICT (usage_day, network, scheme, asset, pay_to, status) DO UPDATE SET
             transactions = payment_daily_totals.transactions + 1,
             amount = payment_daily_totals.amount + EXCLUDED.amount,
             fee_stroops = payment_daily_totals.fee_stroops + EXCLUDED.fee_stroops`,
          [event.network, event.scheme, event.asset, event.payTo, event.status,
            event.amount ?? "0", event.feeStroops ?? "0"],
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

  async overview(window: TimeWindow): Promise<Record<string, unknown>> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT
         count(*) FILTER (WHERE ${SETTLED}) AS total_transactions,
         count(*) FILTER (WHERE ${SETTLED} AND status = 'success') AS successful_transactions,
         count(*) FILTER (WHERE ${SETTLED} AND status = 'failed') AS failed_transactions,
         count(*) FILTER (WHERE stage = 'verified') AS total_verifications,
         COALESCE(sum(amount) FILTER (WHERE ${SETTLED} AND status = 'success'), 0) AS total_amount,
         COALESCE(sum(fee_stroops) FILTER (WHERE ${SETTLED}), 0) AS total_sponsored_fee_stroops,
         count(DISTINCT payer) FILTER (WHERE ${SETTLED}) AS unique_buyers,
         count(DISTINCT pay_to) FILTER (WHERE ${SETTLED}) AS unique_sellers,
         count(DISTINCT facilitator_id) AS unique_facilitators,
         count(DISTINCT network) AS unique_networks,
         count(DISTINCT resource_id) FILTER (WHERE resource_id IS NOT NULL) AS unique_resources,
         max(occurred_at) AS latest_activity,
         min(occurred_at) AS first_activity
       FROM payment_events WHERE true ${since(window.days)}`,
    );
    const resources = await this.pool.query<Record<string, unknown>>(
      `SELECT count(*) AS cataloged_resources,
              count(*) FILTER (WHERE status = 'active') AS active_resources,
              count(*) FILTER (WHERE status = 'stale') AS stale_resources,
              count(*) FILTER (WHERE status = 'quarantined') AS quarantined_resources,
              count(DISTINCT origin) AS origins
       FROM catalog_resources`,
    );
    return { ...result.rows[0], ...resources.rows[0] };
  }

  async timeseries(window: TimeWindow, bucket: "hour" | "day"): Promise<Array<Record<string, unknown>>> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT date_trunc($1, occurred_at) AS bucket_start,
              count(*) AS total_transactions,
              COALESCE(sum(amount) FILTER (WHERE status = 'success'), 0) AS total_amount,
              count(DISTINCT payer) AS unique_buyers,
              count(DISTINCT pay_to) AS unique_sellers
       FROM payment_events WHERE ${SETTLED} ${since(window.days)}
       GROUP BY 1 ORDER BY 1`,
      [bucket],
    );
    return result.rows;
  }

  async transactions(options: {
    limit: number; offset: number; payer?: string; payTo?: string; network?: string;
    scheme?: string; asset?: string; status?: string; resourceId?: number;
  }): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const values: unknown[] = [];
    const conditions = [SETTLED];
    for (const [column, value] of [
      ["payer", options.payer], ["pay_to", options.payTo], ["network", options.network],
      ["scheme", options.scheme], ["asset", options.asset], ["status", options.status],
    ] as const) {
      if (!value) continue;
      values.push(value);
      conditions.push(`${column} = $${values.length}`);
    }
    if (options.resourceId !== undefined) {
      values.push(options.resourceId);
      conditions.push(`resource_id = $${values.length}`);
    }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const counted = await this.pool.query<{ total: string }>(
      `SELECT count(*) AS total FROM payment_events ${where}`, values,
    );
    values.push(options.limit, options.offset);
    const rows = await this.pool.query<Record<string, unknown>>(
      `SELECT id, occurred_at, network, scheme, asset, asset_symbol, asset_decimals, payer,
              pay_to, max_amount, amount, fee_stroops, transaction_hash, status, facilitator_id,
              resource_id, resource_url, error_reason
       FROM payment_events ${where}
       ORDER BY occurred_at DESC, id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return { items: rows.rows, total: Number(counted.rows[0]?.total ?? 0) };
  }

  async transactionByHash(hash: string): Promise<Record<string, unknown> | undefined> {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM payment_events WHERE transaction_hash = $1 ORDER BY occurred_at DESC LIMIT 1",
      [hash],
    );
    return result.rows[0];
  }

  /** Buyer or seller leaderboard, including concentration shares. */
  async participants(
    role: "buyer" | "seller",
    window: TimeWindow,
    options: { limit: number; offset: number },
  ): Promise<{ items: Array<Record<string, unknown>>; total: number; concentration: Record<string, unknown> }> {
    const self = role === "buyer" ? "payer" : "pay_to";
    const other = role === "buyer" ? "pay_to" : "payer";
    const where = `WHERE ${SETTLED} AND ${self} IS NOT NULL ${since(window.days)}`;
    const counted = await this.pool.query<{ total: string }>(
      `SELECT count(DISTINCT ${self}) AS total FROM payment_events ${where}`,
    );
    const rows = await this.pool.query<Record<string, unknown>>(
      `SELECT ${self} AS address,
              count(*) AS tx_count,
              COALESCE(sum(amount) FILTER (WHERE status = 'success'), 0) AS total_amount,
              count(DISTINCT ${other}) AS unique_counterparties,
              count(DISTINCT network) AS unique_networks,
              array_agg(DISTINCT network) AS networks,
              array_agg(DISTINCT facilitator_id) AS facilitators,
              max(occurred_at) AS latest_activity
       FROM payment_events ${where}
       GROUP BY 1 ORDER BY total_amount DESC, tx_count DESC, address
       LIMIT $1 OFFSET $2`,
      [options.limit, options.offset],
    );
    const concentration = await this.pool.query<Record<string, unknown>>(
      `WITH totals AS (
         SELECT ${self} AS address, COALESCE(sum(amount) FILTER (WHERE status = 'success'), 0) AS amount,
                count(*) AS transactions
         FROM payment_events ${where} GROUP BY 1
       ), ranked AS (
         SELECT amount, transactions, row_number() OVER (ORDER BY amount DESC) AS position FROM totals
       )
       SELECT COALESCE(sum(amount), 0) AS total_amount,
              COALESCE(sum(amount) FILTER (WHERE position <= 1), 0) AS top1_amount,
              COALESCE(sum(amount) FILTER (WHERE position <= 5), 0) AS top5_amount,
              COALESCE(sum(amount) FILTER (WHERE position <= 10), 0) AS top10_amount,
              COALESCE(sum(transactions), 0) AS total_transactions,
              COALESCE(sum(transactions) FILTER (WHERE position <= 5), 0) AS top5_transactions,
              count(*) AS participants
       FROM ranked`,
    );
    return {
      items: rows.rows,
      total: Number(counted.rows[0]?.total ?? 0),
      concentration: concentration.rows[0] ?? {},
    };
  }

  async participantDetail(role: "buyer" | "seller", address: string, window: TimeWindow): Promise<Record<string, unknown>> {
    const self = role === "buyer" ? "payer" : "pay_to";
    const other = role === "buyer" ? "pay_to" : "payer";
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT count(*) AS tx_count,
              count(*) FILTER (WHERE status = 'success') AS successful,
              COALESCE(sum(amount) FILTER (WHERE status = 'success'), 0) AS total_amount,
              count(DISTINCT ${other}) AS unique_counterparties,
              array_agg(DISTINCT network) AS networks,
              array_agg(DISTINCT scheme) AS schemes,
              array_agg(DISTINCT facilitator_id) AS facilitators,
              min(occurred_at) AS first_activity,
              max(occurred_at) AS latest_activity
       FROM payment_events WHERE ${SETTLED} AND ${self} = $1 ${since(window.days)}`,
      [address],
    );
    return result.rows[0] ?? {};
  }

  async counterparties(
    role: "buyer" | "seller",
    address: string,
    window: TimeWindow,
    options: { limit: number; offset: number },
  ): Promise<Array<Record<string, unknown>>> {
    const self = role === "buyer" ? "payer" : "pay_to";
    const other = role === "buyer" ? "pay_to" : "payer";
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT ${other} AS address, count(*) AS tx_count,
              COALESCE(sum(amount) FILTER (WHERE status = 'success'), 0) AS total_amount,
              array_agg(DISTINCT network) AS networks,
              max(occurred_at) AS latest_activity
       FROM payment_events WHERE ${SETTLED} AND ${self} = $1 ${since(window.days)}
       GROUP BY 1 ORDER BY total_amount DESC, address LIMIT $2 OFFSET $3`,
      [address, options.limit, options.offset],
    );
    return result.rows;
  }

  /** Network, scheme, asset and status breakdowns in one pass. */
  async breakdowns(window: TimeWindow): Promise<Record<string, Array<Record<string, unknown>>>> {
    const aggregate = async (column: string) => (await this.pool.query<Record<string, unknown>>(
      `SELECT ${column} AS key, count(*) AS tx_count,
              COALESCE(sum(amount) FILTER (WHERE status = 'success'), 0) AS total_amount,
              count(DISTINCT payer) AS unique_buyers,
              count(DISTINCT pay_to) AS unique_sellers,
              count(DISTINCT facilitator_id) AS unique_facilitators,
              max(occurred_at) AS latest_activity
       FROM payment_events WHERE ${SETTLED} ${since(window.days)} GROUP BY 1 ORDER BY tx_count DESC`,
    )).rows;
    return {
      networks: await aggregate("network"),
      schemes: await aggregate("scheme"),
      assets: await aggregate("asset"),
      statuses: await aggregate("status"),
    };
  }

  async dailyVolume(window: TimeWindow): Promise<Array<Record<string, unknown>>> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT usage_day, network, scheme, asset, status,
              sum(transactions) AS transactions, sum(amount) AS amount,
              sum(fee_stroops) AS fee_stroops
       FROM payment_daily_totals
       WHERE ${window.days > 0 ? `usage_day >= CURRENT_DATE - ${Number(window.days)}` : "true"}
       GROUP BY 1,2,3,4,5 ORDER BY usage_day DESC`,
    );
    return result.rows;
  }

  async recentResources(limit: number): Promise<Array<Record<string, unknown>>> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT r.id, r.resource_key, r.type, r.origin, r.resource_url, r.method, r.tool_name,
              r.status, r.owner_pay_to, r.first_seen, r.last_seen, r.last_seen_paid,
              v.version, v.verification, v.provenance, v.description, v.service_name, v.tags
       FROM catalog_resources r
       LEFT JOIN catalog_resource_versions v ON v.id = r.active_version_id
       ORDER BY r.id DESC LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  async origins(options: { limit: number; offset: number }): Promise<Array<Record<string, unknown>>> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT r.origin,
              count(*) AS resources,
              count(*) FILTER (WHERE r.status = 'active') AS active_resources,
              max(r.last_seen) AS last_seen,
              COALESCE(sum(e.tx_count), 0) AS tx_count,
              COALESCE(sum(e.total_amount), 0) AS total_amount
       FROM catalog_resources r
       LEFT JOIN LATERAL (
         SELECT count(*) AS tx_count,
                COALESCE(sum(amount) FILTER (WHERE status = 'success'), 0) AS total_amount
         FROM payment_events WHERE resource_id = r.id AND stage = 'settled'
       ) e ON true
       GROUP BY r.origin ORDER BY tx_count DESC, r.origin LIMIT $1 OFFSET $2`,
      [options.limit, options.offset],
    );
    return result.rows;
  }

  /** Per-resource invocation counts and status classes derived from settlements. */
  async resourceObservability(resourceId: number): Promise<Record<string, unknown>> {
    const windows = [1, 6, 24, 72, 168, 360, 720];
    const columns = windows.map(hours =>
      `count(*) FILTER (WHERE occurred_at >= now() - (${hours} * interval '1 hour')) AS calls_${hours}h,
       count(*) FILTER (WHERE status = 'success' AND occurred_at >= now() - (${hours} * interval '1 hour')) AS success_${hours}h`,
    ).join(",\n");
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT count(*) AS calls_all_time,
              count(*) FILTER (WHERE status = 'success') AS success_all_time,
              count(*) FILTER (WHERE status = 'failed') AS failed_all_time,
              count(*) FILTER (WHERE status = 'unknown') AS unknown_all_time,
              count(DISTINCT payer) AS unique_buyers,
              COALESCE(sum(amount) FILTER (WHERE status = 'success'), 0) AS total_amount,
              max(occurred_at) AS latest_activity,
              ${columns}
       FROM payment_events WHERE resource_id = $1 AND stage = 'settled'`,
      [resourceId],
    );
    return result.rows[0] ?? {};
  }
}
