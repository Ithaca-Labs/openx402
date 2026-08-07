import type { Pool, PoolClient } from "pg";
import type { CatalogCandidate, PaymentOption, RejectionCode } from "../bazaar/extract.js";
import {
  compileSearchDocumentParts,
  SEARCH_DOCUMENT_COMPILER_VERSION,
} from "../bazaar/document.js";
import { canonicalJson } from "../bazaar/sanitize.js";
import { generationTable } from "./search.js";
import { createHash } from "node:crypto";
import { buildSearchTsquery, describeSearchQuery, normalizeSearchQuery } from "../search/query.js";

export type CatalogOutcome =
  | "indexed"
  | "refreshed"
  | "versioned"
  | "pending"
  | "rejected"
  | "quarantined"
  | "skipped";

export interface CatalogWriteResult {
  outcome: CatalogOutcome;
  resourceId?: number;
  versionId?: number;
  paymentOptionId?: number;
  code?: RejectionCode;
}

export interface ObservationContext {
  stage: "verified" | "settled";
  /** True when this observation may activate a version for public discovery. */
  activate: boolean;
  payer?: string;
  settlementRecordId?: number;
  duplicateChanged: "version_and_verify" | "reject";
}

export interface DiscoveryFilters {
  type?: string | undefined;
  network?: string | undefined;
  scheme?: string | undefined;
  payTo?: string | undefined;
  asset?: string | undefined;
  extensions?: string | undefined;
}

export interface DiscoveryOptions {
  filters: DiscoveryFilters;
  limit: number;
  offset: number;
  snapshot: bigint;
  includeStale: boolean;
  includeUnverified: boolean;
  staleAfterHours: number;
  query?: string | undefined;
  /** PostgreSQL text-search configuration. Defaults to `simple`. */
  language?: string | undefined;
}

export interface LexicalCandidateRow {
  resourceId: number;
  versionId: number;
  /** `ts_rank_cd`. Only its rank position is used; it is never fused directly. */
  score: number;
}

export interface SemanticCandidateRow {
  resourceId: number;
  versionId: number;
  /** Cosine distance in [0, 2]. Only its rank position is used. */
  distance: number;
}

export interface DiscoveryRow {
  resourceId: number;
  versionId: number;
  resource: string;
  type: "http" | "mcp";
  x402Version: number;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
  extensions?: Record<string, unknown>;
  lastUpdated: string;
  accepts: Array<Record<string, unknown>>;
}

export interface DiscoveryPage {
  rows: DiscoveryRow[];
  total: number;
  /** True when rows were dropped after the snapshot or another page exists. */
  partialResults: boolean;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const DISCOVERY_COLUMNS = `r.id AS resource_id, r.type, r.resource_url, r.status,
  v.id AS version_id, v.x402_version, v.description, v.mime_type, v.service_name,
  v.tags, v.icon_url, v.extensions, GREATEST(v.activated_at, v.created_at) AS last_updated`;

function optionRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    scheme: row.scheme,
    network: row.network,
    asset: row.asset,
    amount: String(row.amount),
    payTo: row.pay_to,
    maxTimeoutSeconds: Number(row.max_timeout_seconds),
    extra: row.extra ?? {},
  };
}

export class CatalogStore {
  constructor(private readonly pool: Pool) {}

  async watermark(): Promise<bigint> {
    const result = await this.pool.query<{ watermark: string }>("SELECT catalog_watermark() AS watermark");
    return BigInt(result.rows[0]?.watermark ?? "0");
  }

  /**
   * Records one catalog observation. Every write path is transactional and takes
   * its catalog version from `catalog_next_version()`, whose row lock is held
   * until commit; version order therefore equals commit order on every replica.
   */
  async observe(candidate: CatalogCandidate, context: ObservationContext): Promise<CatalogWriteResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const version = await this.nextVersion(client);
      const existing = await client.query<Record<string, unknown>>(
        "SELECT * FROM catalog_resources WHERE resource_key = $1 FOR UPDATE",
        [candidate.resourceKey],
      );
      const result = existing.rows[0]
        ? await this.updateResource(client, existing.rows[0], candidate, context, version)
        : await this.createResource(client, candidate, context, version);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async nextVersion(client: PoolClient): Promise<string> {
    const result = await client.query<{ version: string }>("SELECT catalog_next_version() AS version");
    return result.rows[0]!.version;
  }

  private async createResource(
    client: PoolClient,
    candidate: CatalogCandidate,
    context: ObservationContext,
    version: string,
  ): Promise<CatalogWriteResult> {
    const resource = await client.query<{ id: string }>(
      `INSERT INTO catalog_resources(
         resource_key, type, origin, resource_url, route_template, method, tool_name,
         owner_pay_to, status, created_version, updated_version, last_seen_paid)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$9,$10) RETURNING id`,
      [
        candidate.resourceKey, candidate.type, candidate.origin, candidate.resourceUrl,
        candidate.routeTemplate ?? null, candidate.method ?? null, candidate.toolName ?? null,
        candidate.paymentOption.payTo, version,
        context.stage === "settled" ? new Date() : null,
      ],
    );
    const resourceId = Number(resource.rows[0]!.id);
    const versionId = await this.insertVersion(client, resourceId, 1, candidate, context, version);
    const optionId = await this.upsertOption(client, resourceId, versionId, candidate.paymentOption, version);
    if (context.activate) {
      await client.query(
        "UPDATE catalog_resources SET active_version_id = $2, updated_version = $3, updated_at = now() WHERE id = $1",
        [resourceId, versionId, version],
      );
      await this.indexVersion(client, resourceId, versionId, candidate, version);
    }
    return {
      outcome: context.activate ? "indexed" : "pending",
      resourceId, versionId, paymentOptionId: optionId,
    };
  }

  private async updateResource(
    client: PoolClient,
    row: Record<string, unknown>,
    candidate: CatalogCandidate,
    context: ObservationContext,
    version: string,
  ): Promise<CatalogWriteResult> {
    const resourceId = Number(row.id);
    const ownerPayTo = String(row.owner_pay_to);

    // A second seller may never silently replace an active listing. The rival
    // declaration is stored as a quarantined candidate for operator review.
    if (ownerPayTo !== candidate.paymentOption.payTo) {
      const versionId = await this.insertVersion(
        client, resourceId, await this.nextVersionNumber(client, resourceId), candidate,
        { ...context, activate: false }, version, "quarantined", "payto_ownership_conflict",
      );
      return { outcome: "quarantined", resourceId, versionId, code: "payto_ownership_conflict" };
    }

    await client.query(
      `UPDATE catalog_resources SET last_seen = now(),
         last_seen_paid = CASE WHEN $2 THEN now() ELSE last_seen_paid END,
         status = CASE WHEN status = 'stale' THEN 'active' ELSE status END,
         updated_version = $3, updated_at = now()
       WHERE id = $1`,
      [resourceId, context.stage === "settled", version],
    );

    const same = await client.query<Record<string, unknown>>(
      "SELECT * FROM catalog_resource_versions WHERE resource_id = $1 AND declaration_hash = $2",
      [resourceId, candidate.declarationHash],
    );

    if (same.rows[0]) {
      const versionRow = same.rows[0];
      const versionId = Number(versionRow.id);
      const optionId = await this.upsertOption(client, resourceId, versionId, candidate.paymentOption, version);
      if (context.activate && versionRow.status !== "active") {
        await this.activate(client, resourceId, versionId, candidate, version);
        return { outcome: "versioned", resourceId, versionId, paymentOptionId: optionId };
      }
      if (!context.activate && versionRow.status !== "active") {
        return { outcome: "pending", resourceId, versionId, paymentOptionId: optionId };
      }
      if (context.activate && versionRow.status === "active") {
        // A declaration can advertise several payment options. Refresh the
        // deterministic document after adding or replacing one so every live
        // option is represented in lexical text and the embedding job.
        await this.indexVersion(client, resourceId, versionId, candidate, version);
      }
      return { outcome: "refreshed", resourceId, versionId, paymentOptionId: optionId };
    }

    if (context.duplicateChanged === "reject") {
      return { outcome: "rejected", resourceId, code: "duplicate_change_rejected" };
    }

    const nextNumber = await this.nextVersionNumber(client, resourceId);
    const versionId = await this.insertVersion(client, resourceId, nextNumber, candidate, context, version);
    const optionId = await this.upsertOption(client, resourceId, versionId, candidate.paymentOption, version);
    if (context.activate) {
      await this.activate(client, resourceId, versionId, candidate, version);
      return { outcome: "versioned", resourceId, versionId, paymentOptionId: optionId };
    }
    return { outcome: "pending", resourceId, versionId, paymentOptionId: optionId };
  }

  private async nextVersionNumber(client: PoolClient, resourceId: number): Promise<number> {
    const result = await client.query<{ next: string }>(
      "SELECT COALESCE(max(version), 0) + 1 AS next FROM catalog_resource_versions WHERE resource_id = $1",
      [resourceId],
    );
    return Number(result.rows[0]!.next);
  }

  private async insertVersion(
    client: PoolClient,
    resourceId: number,
    number: number,
    candidate: CatalogCandidate,
    context: ObservationContext,
    version: string,
    status: "candidate" | "active" | "quarantined" = context.activate ? "active" : "candidate",
    rejectedReason?: string,
  ): Promise<number> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO catalog_resource_versions(
         resource_id, version, declaration_hash, status, verification, x402_version,
         description, service_name, tags, icon_url, mime_type, route_template, method,
         tool_name, transport, bazaar_extension, extensions, input_schema, input_example,
         output_type, output_schema, output_example, declared_pay_to, rejected_reason,
         created_version, activated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
       RETURNING id`,
      [
        resourceId, number, candidate.declarationHash, status,
        // Cataloging only runs after this facilitator validated a real payment
        // bound to the declared payTo, asset and network.
        status === "active" ? "payment_observed" : "unverified",
        candidate.x402Version,
        candidate.description ?? null, candidate.serviceName ?? null, candidate.tags,
        candidate.iconUrl ?? null, candidate.mimeType ?? null, candidate.routeTemplate ?? null,
        candidate.method ?? null, candidate.toolName ?? null, candidate.transport ?? null,
        JSON.stringify(candidate.bazaarExtension), JSON.stringify(candidate.extensions),
        candidate.inputSchema === undefined ? null : JSON.stringify(candidate.inputSchema),
        candidate.inputExample === undefined ? null : JSON.stringify(candidate.inputExample),
        candidate.outputType ?? null,
        candidate.outputSchema === undefined ? null : JSON.stringify(candidate.outputSchema),
        candidate.outputExample === undefined ? null : JSON.stringify(candidate.outputExample),
        candidate.paymentOption.payTo, rejectedReason ?? null, version,
        status === "active" ? new Date() : null,
      ],
    );
    return Number(result.rows[0]!.id);
  }

  private async activate(
    client: PoolClient,
    resourceId: number,
    versionId: number,
    candidate: CatalogCandidate,
    version: string,
  ): Promise<void> {
    await client.query(
      `UPDATE catalog_resource_versions SET status = 'superseded', retired_version = $3,
         retired_at = now()
       WHERE resource_id = $1 AND id <> $2 AND status = 'active'`,
      [resourceId, versionId, version],
    );
    await client.query(
      `UPDATE catalog_resource_versions SET status = 'active', verification = 'payment_observed',
         activated_at = COALESCE(activated_at, now()), retired_version = NULL, retired_at = NULL
       WHERE id = $1`,
      [versionId],
    );
    await client.query(
      "UPDATE catalog_resources SET active_version_id = $2, updated_version = $3, updated_at = now() WHERE id = $1",
      [resourceId, versionId, version],
    );
    await this.indexVersion(client, resourceId, versionId, candidate, version);
  }

  /**
   * A changed price never overwrites the option that historical settlements
   * point at: the previous row is retired at this catalog version and a new row
   * is appended.
   */
  private async upsertOption(
    client: PoolClient,
    resourceId: number,
    versionId: number,
    option: PaymentOption,
    version: string,
  ): Promise<number> {
    const live = await client.query<{ id: string }>(
      `SELECT id FROM catalog_payment_options
       WHERE version_id = $1 AND option_hash = $2 AND retired_version IS NULL`,
      [versionId, option.optionHash],
    );
    if (live.rows[0]) {
      await client.query("UPDATE catalog_payment_options SET last_seen = now() WHERE id = $1", [live.rows[0].id]);
      return Number(live.rows[0].id);
    }
    await client.query(
      `UPDATE catalog_payment_options SET retired_version = $3, retired_at = now()
       WHERE version_id = $1 AND scheme = $2 AND network = $4 AND asset = $5 AND pay_to = $6
         AND retired_version IS NULL`,
      [versionId, option.scheme, version, option.network, option.asset, option.payTo],
    );
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO catalog_payment_options(
         resource_id, version_id, option_hash, x402_version, scheme, network, asset,
         asset_symbol, asset_decimals, amount, pay_to, max_timeout_seconds, extra, created_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (version_id, option_hash) DO UPDATE SET
         retired_version = NULL, retired_at = NULL, last_seen = now()
       RETURNING id`,
      [
        resourceId, versionId, option.optionHash, option.x402Version, option.scheme,
        option.network, option.asset, option.assetSymbol ?? null, option.assetDecimals ?? null,
        option.amount, option.payTo, option.maxTimeoutSeconds, JSON.stringify(option.extra), version,
      ],
    );
    return Number(inserted.rows[0]!.id);
  }

  private async indexVersion(
    client: PoolClient,
    resourceId: number,
    versionId: number,
    candidate: CatalogCandidate,
    version: string,
  ): Promise<void> {
    const options = await client.query<Record<string, unknown>>(
      `SELECT scheme, network, amount, asset, asset_symbol, pay_to FROM catalog_payment_options
       WHERE version_id = $1 AND retired_version IS NULL ORDER BY network, scheme, asset`,
      [versionId],
    );
    const compiled = compileSearchDocumentParts(candidate, options.rows.map(row => ({
      scheme: String(row.scheme), network: String(row.network), amount: String(row.amount),
      asset: String(row.asset),
      ...(row.pay_to ? { payTo: String(row.pay_to) } : {}),
      ...(row.asset_symbol ? { assetSymbol: String(row.asset_symbol) } : {}),
    })));
    const sourceHash = sha256(canonicalJson({
      compilerVersion: SEARCH_DOCUMENT_COMPILER_VERSION,
      document: compiled.document,
      lexicalHigh: compiled.lexicalHigh,
      lexicalMedium: compiled.lexicalMedium,
      lexicalLow: compiled.lexicalLow,
    }));
    await client.query(
      `INSERT INTO catalog_search_documents(
         version_id, resource_id, source_hash, document,
         lexical_high, lexical_medium, lexical_low, compiler_version, created_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (version_id) DO UPDATE SET
         source_hash = EXCLUDED.source_hash,
         document = EXCLUDED.document,
         lexical_high = EXCLUDED.lexical_high,
         lexical_medium = EXCLUDED.lexical_medium,
         lexical_low = EXCLUDED.lexical_low,
         compiler_version = EXCLUDED.compiler_version,
         updated_at = now()`,
      [
        versionId, resourceId, sourceHash, compiled.document,
        compiled.lexicalHigh, compiled.lexicalMedium, compiled.lexicalLow,
        SEARCH_DOCUMENT_COMPILER_VERSION, version,
      ],
    );
    // The lexical document is already searchable; the job row is the durable
    // hand-off to the embedding worker. Request-time cataloging never waits for
    // model inference. A running service targets its active generation so jobs
    // created after startup are immediately claimable; generation 0 is reserved
    // for catalog writes that happen before the worker creates a generation.
    await client.query(
      `INSERT INTO catalog_index_jobs(kind, resource_id, version_id, source_hash, generation)
       VALUES (
         'embedding', $1, $2, $3,
         COALESCE((
           SELECT id FROM search_model_generations
           WHERE status = 'active'
           ORDER BY id DESC LIMIT 1
         ), 0)
       )
       ON CONFLICT (kind, version_id, generation) DO UPDATE SET
         source_hash = EXCLUDED.source_hash,
         state = CASE WHEN catalog_index_jobs.source_hash = EXCLUDED.source_hash
                      THEN catalog_index_jobs.state ELSE 'pending' END,
         updated_at = now()`,
      [resourceId, versionId, sourceHash],
    );
  }

  async recordObservation(entry: {
    resourceId?: number; versionId?: number; resourceKey?: string; resourceUrl?: string;
    stage: "verified" | "settled"; outcome: CatalogOutcome;
    wireStatus: "success" | "processing" | "rejected"; rejectedReason?: string;
    internalReason?: string; declarationHash?: string; network?: string; scheme?: string;
    payTo?: string; payer?: string; settlementRecordId?: number;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO catalog_observations(
         resource_id, version_id, resource_key, resource_url, stage, outcome, wire_status,
         rejected_reason, internal_reason, declaration_hash, network, scheme, pay_to, payer,
         settlement_record_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        entry.resourceId ?? null, entry.versionId ?? null, entry.resourceKey ?? null,
        entry.resourceUrl ?? null, entry.stage, entry.outcome, entry.wireStatus,
        entry.rejectedReason ?? null, entry.internalReason ?? null, entry.declarationHash ?? null,
        entry.network ?? null, entry.scheme ?? null, entry.payTo ?? null, entry.payer ?? null,
        entry.settlementRecordId ?? null,
      ],
    );
  }

  /** Demotes resources that stopped being observed. */
  async sweepStale(staleAfterHours: number): Promise<number> {
    const result = await this.pool.query(
      `UPDATE catalog_resources SET status = 'stale', updated_version = catalog_next_version(),
         updated_at = now()
       WHERE status = 'active' AND last_seen < now() - ($1 * interval '1 hour')`,
      [staleAfterHours],
    );
    return result.rowCount ?? 0;
  }

  async setResourceStatus(
    resourceKey: string,
    status: "active" | "disabled" | "quarantined" | "tombstoned",
    reason?: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE catalog_resources SET status = $2, quarantine_reason = $3,
         updated_version = catalog_next_version(), updated_at = now()
       WHERE resource_key = $1`,
      [resourceKey, status, reason ?? null],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Snapshot read. `created_version <= snapshot` and
   * `retired_version > snapshot` reproduce exactly the catalog the cursor was
   * issued against, so concurrent cataloging cannot shift, duplicate or skip a
   * page. Rows that left the visible set after the snapshot (quarantine, stale
   * demotion, tombstone) are reported through `partialResults`.
   */
  async list(options: DiscoveryOptions): Promise<DiscoveryPage> {
    const scope = this.scope(options);
    const { values, snapshotConditions, visibility, from, rank } = scope;
    const base = `${from} WHERE ${[...snapshotConditions, ...visibility].join(" AND ")}`;

    const counted = await this.pool.query<{ total: string; snapshot_total: string }>(
      `SELECT count(*) FILTER (WHERE ${visibility.join(" AND ")}) AS total, count(*) AS snapshot_total
       ${from} WHERE ${snapshotConditions.join(" AND ")}`,
      values,
    );
    const total = Number(counted.rows[0]?.total ?? 0);
    const snapshotTotal = Number(counted.rows[0]?.snapshot_total ?? 0);

    values.push(options.limit, options.offset);
    const order = options.query ? `ORDER BY rank DESC, r.id DESC` : `ORDER BY r.id DESC`;
    const rows = await this.pool.query<Record<string, unknown>>(
      `SELECT ${DISCOVERY_COLUMNS}${rank}
       ${base} ${order} LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    return {
      total,
      partialResults: options.offset + rows.rows.length < total || snapshotTotal > total,
      rows: await this.attachAccepts(rows.rows, options.snapshot),
    };
  }

  /**
   * Lexical candidate retrieval for the hybrid pipeline.
   *
   * PostgreSQL full-text search with `ts_rank_cd`. This is FTS, not BM25: no
   * BM25 extension is installed, and the score is never compared directly with a
   * vector distance — only its rank position enters fusion.
   */
  async lexicalCandidates(options: DiscoveryOptions & { candidateCount: number }): Promise<LexicalCandidateRow[]> {
    const normalizedQuery = normalizeSearchQuery(options.query ?? "");
    if (normalizedQuery.length === 0) return [];
    const { values, snapshotConditions, visibility, from, rank } = this.scope(options);
    values.push(options.candidateCount);
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT r.id AS resource_id, v.id AS version_id${rank}
       ${from} WHERE ${[...snapshotConditions, ...visibility].join(" AND ")}
       ORDER BY rank DESC, r.id DESC LIMIT $${values.length}`,
      values,
    );
    return result.rows.map(row => ({
      resourceId: Number(row.resource_id),
      versionId: Number(row.version_id),
      score: Number(row.rank ?? 0),
    }));
  }

  /**
   * Semantic candidate retrieval, restricted to one model generation so vectors
   * from different models are never compared. Cosine distance is used, matching
   * the generation's HNSW operator class.
   */
  async semanticCandidates(
    options: DiscoveryOptions & { candidateCount: number },
    vectorLiteral: string,
    generation: { id: number; dimension: number },
  ): Promise<SemanticCandidateRow[]> {
    const { values, snapshotConditions, visibility, from } = this.scope({ ...options, query: undefined });
    values.push(vectorLiteral, options.candidateCount);
    const vectorIndex = values.length - 1;
    const storage = generationTable(generation.id);
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT r.id AS resource_id, v.id AS version_id,
              (e.embedding <=> $${vectorIndex}::vector(${generation.dimension})) AS distance
       ${from}
       JOIN ${storage} e ON e.version_id = v.id AND e.status = 'ready'
       WHERE ${[...snapshotConditions, ...visibility].join(" AND ")}
       ORDER BY distance ASC, r.id DESC LIMIT $${values.length}`,
      values,
    );
    return result.rows.map(row => ({
      resourceId: Number(row.resource_id),
      versionId: Number(row.version_id),
      distance: Number(row.distance),
    }));
  }

  /**
   * Exact single-resource lookup by catalog identity `(type, url, toolName)`.
   * For a caller that already holds this tuple (e.g. an agent-facing MCP
   * server resolving a stable resource reference it derived itself) and needs
   * current terms without paging through `list()`. Returns the same
   * `DiscoveryRow` shape as browse/search; no sequential id is exposed.
   */
  async getByKey(
    key: { type: "http" | "mcp"; url: string; toolName?: string },
    options: Omit<DiscoveryOptions, "filters" | "query" | "language">,
  ): Promise<DiscoveryRow | undefined> {
    const { values, snapshotConditions, visibility, from } = this.scope({
      ...options, filters: {}, query: undefined,
    });
    values.push(key.type);
    snapshotConditions.push(`r.type = $${values.length}`);
    values.push(key.url);
    snapshotConditions.push(`r.resource_url = $${values.length}`);
    if (key.type === "mcp") {
      values.push(key.toolName ?? "");
      snapshotConditions.push(`r.tool_name = $${values.length}`);
    }
    const rows = await this.pool.query<Record<string, unknown>>(
      `SELECT ${DISCOVERY_COLUMNS}
       ${from} WHERE ${[...snapshotConditions, ...visibility].join(" AND ")}
       ORDER BY r.id DESC LIMIT 1`,
      values,
    );
    const hydrated = await this.attachAccepts(rows.rows, options.snapshot);
    return hydrated[0];
  }

  /** Loads full discovery rows for an explicit, already-ordered version list. */
  async hydrate(versionIds: number[], snapshot: bigint): Promise<Map<number, DiscoveryRow>> {
    if (versionIds.length === 0) return new Map();
    const rows = await this.pool.query<Record<string, unknown>>(
      `SELECT ${DISCOVERY_COLUMNS}
       FROM catalog_resources r JOIN catalog_resource_versions v ON v.resource_id = r.id
       WHERE v.id = ANY($1::bigint[])`,
      [versionIds],
    );
    const hydrated = await this.attachAccepts(rows.rows, snapshot);
    return new Map(hydrated.map(row => [row.versionId, row]));
  }

  /** The compiled document text behind each version, used for reranking. */
  async documents(versionIds: number[]): Promise<Map<number, string>> {
    if (versionIds.length === 0) return new Map();
    const rows = await this.pool.query<{ version_id: string; document: string }>(
      "SELECT version_id, document FROM catalog_search_documents WHERE version_id = ANY($1::bigint[])",
      [versionIds],
    );
    return new Map(rows.rows.map(row => [Number(row.version_id), row.document]));
  }

  /** Origins for the diversity cap, keyed by resource id. */
  async origins(resourceIds: number[]): Promise<Map<number, string>> {
    if (resourceIds.length === 0) return new Map();
    const rows = await this.pool.query<{ id: string; origin: string }>(
      "SELECT id, origin FROM catalog_resources WHERE id = ANY($1::bigint[])",
      [resourceIds],
    );
    return new Map(rows.rows.map(row => [Number(row.id), row.origin]));
  }

  /** Number of resources visible under a snapshot and filter set. */
  async countVisible(options: DiscoveryOptions): Promise<{ total: number; snapshotTotal: number }> {
    const { values, snapshotConditions, visibility, from } = this.scope({ ...options, query: undefined });
    const counted = await this.pool.query<{ total: string; snapshot_total: string }>(
      `SELECT count(*) FILTER (WHERE ${visibility.join(" AND ")}) AS total, count(*) AS snapshot_total
       ${from} WHERE ${snapshotConditions.join(" AND ")}`,
      values,
    );
    return {
      total: Number(counted.rows[0]?.total ?? 0),
      snapshotTotal: Number(counted.rows[0]?.snapshot_total ?? 0),
    };
  }

  private async attachAccepts(
    rows: Array<Record<string, unknown>>,
    snapshot: bigint,
  ): Promise<DiscoveryRow[]> {
    const versionIds = rows.map(row => Number(row.version_id));
    const accepts = new Map<number, Array<Record<string, unknown>>>();
    if (versionIds.length > 0) {
      const optionRows = await this.pool.query<Record<string, unknown>>(
        `SELECT * FROM catalog_payment_options
         WHERE version_id = ANY($1::bigint[]) AND created_version <= $2
           AND (retired_version IS NULL OR retired_version > $2)
         ORDER BY network, scheme, asset, amount`,
        [versionIds, snapshot.toString()],
      );
      for (const row of optionRows.rows) {
        const list = accepts.get(Number(row.version_id)) ?? [];
        list.push(optionRow(row));
        accepts.set(Number(row.version_id), list);
      }
    }
    return rows.map(row => ({
      resourceId: Number(row.resource_id),
      versionId: Number(row.version_id),
      resource: String(row.resource_url),
      type: row.type as "http" | "mcp",
      x402Version: Number(row.x402_version),
      ...(row.description ? { description: String(row.description) } : {}),
      ...(row.mime_type ? { mimeType: String(row.mime_type) } : {}),
      ...(row.service_name ? { serviceName: String(row.service_name) } : {}),
      ...(Array.isArray(row.tags) && row.tags.length > 0 ? { tags: row.tags as string[] } : {}),
      ...(row.icon_url ? { iconUrl: String(row.icon_url) } : {}),
      ...(row.extensions && Object.keys(row.extensions).length > 0
        ? { extensions: row.extensions as Record<string, unknown> } : {}),
      lastUpdated: (row.last_updated as Date).toISOString(),
      accepts: accepts.get(Number(row.version_id)) ?? [],
    }));
  }

  /**
   * Builds the shared snapshot scope. Browse, lexical retrieval, semantic
   * retrieval and counting all read exactly the same catalog slice, so a filter
   * can never mean one thing in one branch and something else in another.
   */
  private scope(options: DiscoveryOptions): {
    values: unknown[]; snapshotConditions: string[]; visibility: string[]; from: string; rank: string;
  } {
    const filters = options.filters;
    const values: unknown[] = [options.snapshot.toString()];
    const normalizedQuery = normalizeSearchQuery(options.query ?? "");
    // Conditions that depend only on immutable snapshot columns.
    const snapshotConditions: string[] = [
      "r.created_version <= $1",
      "v.created_version <= $1",
      "(v.retired_version IS NULL OR v.retired_version > $1)",
    ];
    // Conditions that read mutable lifecycle state. A row that stops satisfying
    // them after the cursor was issued is a security/liveness omission, not a
    // pagination error, and is reported through `partialResults`.
    const visibility: string[] = [];

    if (filters.type) {
      values.push(filters.type);
      snapshotConditions.push(`r.type = $${values.length}`);
    }
    if (filters.extensions) {
      values.push(filters.extensions);
      snapshotConditions.push(`v.extensions ? $${values.length}`);
    }
    const optionConditions: string[] = ["o.version_id = v.id", "o.created_version <= $1",
      "(o.retired_version IS NULL OR o.retired_version > $1)"];
    for (const [column, value] of [
      ["network", filters.network], ["scheme", filters.scheme],
      ["pay_to", filters.payTo], ["asset", filters.asset],
    ] as const) {
      if (!value) continue;
      values.push(value);
      optionConditions.push(`o.${column} = $${values.length}`);
    }
    snapshotConditions.push(
      `EXISTS (SELECT 1 FROM catalog_payment_options o WHERE ${optionConditions.join(" AND ")})`,
    );

    const statuses = options.includeStale ? ["active", "stale"] : ["active"];
    values.push(statuses);
    visibility.push(`r.status = ANY($${values.length}::text[])`);
    if (!options.includeStale) {
      values.push(options.staleAfterHours);
      visibility.push(`r.last_seen >= now() - ($${values.length} * interval '1 hour')`);
    }
    if (!options.includeUnverified) visibility.push("v.verification = 'payment_observed'");

    let rank = "";
    if (options.query) {
      values.push(options.language ?? "simple");
      const language = values.length;
      values.push(buildSearchTsquery(options.query ?? ""));
      const index = values.length;
      // The expression is built from quoted tokens in query.ts and remains a
      // parameter. It combines a phrase clause with an OR token fallback.
      snapshotConditions.push(`d.tsv @@ to_tsquery($${language}::regconfig, $${index})`);
      rank = `, ts_rank_cd('{1,0.45,0.18,0}'::real[], d.tsv,
        to_tsquery($${language}::regconfig, $${index}), 32) AS rank`;
      const shape = describeSearchQuery(options.query ?? "");
      if (shape.hasIdentifier || shape.hasUrl) {
        values.push(normalizedQuery.toLowerCase());
        const exact = values.length;
        // FTS tokenization is intentionally permissive for punctuation-heavy
        // identifiers. A bounded exact-substring bonus keeps an explicitly
        // supplied URL/tool/route identifier ahead of generic shared host
        // tokens while remaining parameterized and seller-data-only.
        rank = `, ts_rank_cd('{1,0.45,0.18,0}'::real[], d.tsv,
          to_tsquery($${language}::regconfig, $${index}), 32)
          + CASE WHEN position($${exact} IN lower(concat_ws(' ',
              v.service_name, v.tool_name, v.route_template, r.resource_url, v.method))) > 0
            THEN 2 ELSE 0 END AS rank`;
      }
    }

    const from = `
      FROM catalog_resources r
      JOIN LATERAL (
        SELECT * FROM catalog_resource_versions cv
        WHERE cv.resource_id = r.id AND cv.created_version <= $1
          AND cv.status IN ('active', 'superseded')
        ORDER BY cv.version DESC LIMIT 1
      ) v ON true
      ${options.query ? "JOIN catalog_search_documents d ON d.version_id = v.id" : ""}`;

    return { values, snapshotConditions, visibility, from, rank };
  }

  async resourceDetail(resourceId: number): Promise<Record<string, unknown> | undefined> {
    const resource = await this.pool.query<Record<string, unknown>>(
      `SELECT r.*, v.id AS version_id, v.version, v.description, v.service_name, v.tags,
              v.icon_url, v.mime_type, v.transport, v.input_schema, v.input_example,
              v.output_type, v.output_schema, v.output_example, v.bazaar_extension,
              v.verification, v.provenance, v.observed_at, v.activated_at, v.declaration_hash
       FROM catalog_resources r
       LEFT JOIN catalog_resource_versions v ON v.id = r.active_version_id
       WHERE r.id = $1`,
      [resourceId],
    );
    const row = resource.rows[0];
    if (!row) return undefined;
    const options = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM catalog_payment_options WHERE resource_id = $1 ORDER BY retired_version NULLS FIRST, id`,
      [resourceId],
    );
    const versions = await this.pool.query<Record<string, unknown>>(
      `SELECT id, version, status, verification, declaration_hash, rejected_reason,
              observed_at, activated_at, retired_at
       FROM catalog_resource_versions WHERE resource_id = $1 ORDER BY version DESC`,
      [resourceId],
    );
    const observations = await this.pool.query<Record<string, unknown>>(
      `SELECT stage, outcome, wire_status, rejected_reason, internal_reason, observed_at
       FROM catalog_observations WHERE resource_id = $1 ORDER BY observed_at DESC LIMIT 50`,
      [resourceId],
    );
    return { resource: row, paymentOptions: options.rows, versions: versions.rows, observations: observations.rows };
  }
}
