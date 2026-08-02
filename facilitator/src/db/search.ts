import type { Pool, PoolClient } from "pg";
import type { EmbeddingIdentity } from "../search/types.js";

export interface ModelGeneration {
  id: number;
  provider: string;
  modelId: string;
  modelRevision: string;
  dimension: number;
  pooling: "cls" | "mean";
  normalization: "l2" | "none";
  status: "building" | "active" | "retired" | "failed";
  checksum?: string;
  documentsIndexed: number;
}

export interface EmbeddingJob {
  id: number;
  versionId: number;
  resourceId: number;
  generation: number;
  sourceHash: string;
  attempts: number;
  fencingToken: bigint;
  document: string;
}

export interface LexicalCandidate {
  resourceId: number;
  versionId: number;
  score: number;
}

export interface SemanticCandidate {
  resourceId: number;
  versionId: number;
  distance: number;
}

export interface IndexCoverage {
  generationId: number;
  expected: number;
  indexed: number;
  pending: number;
  failed: number;
  complete: boolean;
}

function mapGeneration(row: Record<string, unknown>): ModelGeneration {
  return {
    id: Number(row.id),
    provider: String(row.provider),
    modelId: String(row.model_id),
    modelRevision: String(row.model_revision),
    dimension: Number(row.dimension),
    pooling: row.pooling as "cls" | "mean",
    normalization: row.normalization as "l2" | "none",
    status: row.status as ModelGeneration["status"],
    ...(row.checksum ? { checksum: String(row.checksum) } : {}),
    documentsIndexed: Number(row.documents_indexed ?? 0),
  };
}

/** Serializes a JS vector into the pgvector text input format. */
function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/**
 * Storage table for one generation. The id is an integer this service assigns,
 * never user input, so interpolating it into an identifier is safe.
 */
export function generationTable(generationId: number): string {
  if (!Number.isSafeInteger(generationId) || generationId < 0) {
    throw new Error(`invalid generation id ${generationId}`);
  }
  return `catalog_embeddings_g${generationId}`;
}

export class SearchStore {
  private vectorSupport: boolean | undefined;

  constructor(private readonly pool: Pool) {}

  /**
   * True when pgvector is installed. Everything semantic is gated on this;
   * when false the facilitator serves lexical results and says so in health.
   */
  async hasVectorSupport(): Promise<boolean> {
    if (this.vectorSupport !== undefined) return this.vectorSupport;
    const result = await this.pool.query<{ present: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
          AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'search_create_generation_storage')
          AS present`,
    );
    this.vectorSupport = result.rows[0]?.present === true;
    return this.vectorSupport;
  }

  /**
   * Finds or creates the generation for an embedding identity and makes it the
   * single active one. A different model, revision, dimension, pooling or
   * normalization produces a different row, so incompatible vectors can never be
   * mixed: the previous generation is retired and its documents are re-embedded.
   */
  async activateGeneration(identity: EmbeddingIdentity): Promise<ModelGeneration> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<Record<string, unknown>>(
        `SELECT * FROM search_model_generations
         WHERE provider = $1 AND model_id = $2 AND model_revision = $3
           AND dimension = $4 AND pooling = $5 AND normalization = $6
         FOR UPDATE`,
        [identity.provider, identity.modelId, identity.modelRevision,
          identity.dimension, identity.pooling, identity.normalization],
      );
      let row = existing.rows[0];
      if (!row) {
        const inserted = await client.query<Record<string, unknown>>(
          `INSERT INTO search_model_generations(
             provider, model_id, model_revision, dimension, pooling, normalization, checksum, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'building') RETURNING *`,
          [identity.provider, identity.modelId, identity.modelRevision,
            identity.dimension, identity.pooling, identity.normalization, identity.checksum ?? null],
        );
        row = inserted.rows[0]!;
      }
      const id = Number(row.id);
      if (row.status !== "active") {
        await client.query(
          `UPDATE search_model_generations SET status = 'retired', retired_at = now()
           WHERE status = 'active' AND id <> $1`, [id],
        );
        const activated = await client.query<Record<string, unknown>>(
          `UPDATE search_model_generations
           SET status = 'active', activated_at = COALESCE(activated_at, now()),
               retired_at = NULL, checksum = COALESCE($2, checksum), last_error = NULL
           WHERE id = $1 RETURNING *`,
          [id, identity.checksum ?? null],
        );
        row = activated.rows[0]!;
      }
      await client.query("SELECT search_create_generation_storage($1)", [id]);
      await client.query("COMMIT");
      return mapGeneration(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async activeGeneration(): Promise<ModelGeneration | undefined> {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM search_model_generations WHERE status = 'active'",
    );
    return result.rows[0] ? mapGeneration(result.rows[0]) : undefined;
  }

  async generations(): Promise<ModelGeneration[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM search_model_generations ORDER BY id",
    );
    return result.rows.map(mapGeneration);
  }

  async recordGenerationError(generationId: number, message: string): Promise<void> {
    await this.pool.query(
      "UPDATE search_model_generations SET last_error = $2 WHERE id = $1",
      [generationId, message.slice(0, 2_000)],
    );
  }

  /**
   * Enqueues embedding work for every active document that has no current vector
   * in this generation. Used at startup, after a generation change and by the
   * reindex command; the cataloger also enqueues inline for new versions.
   */
  async enqueueMissing(generationId: number): Promise<number> {
    if (!await this.hasVectorSupport()) return 0;
    // Adopt the unassigned rows the cataloger wrote on the request path, then
    // drop any that the active generation already covers, so queue depth only
    // ever counts real work for the generation being served.
    await this.pool.query(
      `UPDATE catalog_index_jobs SET generation = $1, state = 'pending', next_run_at = now(),
         updated_at = now()
       WHERE kind = 'embedding' AND generation = 0
         AND NOT EXISTS (
           SELECT 1 FROM catalog_index_jobs existing
           WHERE existing.kind = 'embedding' AND existing.generation = $1
             AND existing.version_id = catalog_index_jobs.version_id)`,
      [generationId],
    );
    await this.pool.query("DELETE FROM catalog_index_jobs WHERE kind = 'embedding' AND generation = 0");
    const storage = generationTable(generationId);
    const result = await this.pool.query(
      `INSERT INTO catalog_index_jobs(kind, resource_id, version_id, generation, source_hash, state)
       SELECT 'embedding', d.resource_id, d.version_id, $1, d.source_hash, 'pending'
       FROM catalog_search_documents d
       JOIN catalog_resource_versions v ON v.id = d.version_id
       WHERE v.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM ${storage} e
           WHERE e.version_id = d.version_id
             AND e.source_hash = d.source_hash AND e.status = 'ready')
       ON CONFLICT (kind, version_id, generation) DO UPDATE SET
         source_hash = EXCLUDED.source_hash,
         state = CASE WHEN catalog_index_jobs.state = 'dead' THEN catalog_index_jobs.state
                      WHEN catalog_index_jobs.source_hash = EXCLUDED.source_hash
                           AND catalog_index_jobs.state = 'done' THEN 'done'
                      ELSE 'pending' END,
         next_run_at = LEAST(catalog_index_jobs.next_run_at, now()),
         updated_at = now()`,
      [generationId],
    );
    return result.rowCount ?? 0;
  }

  /**
   * Claims a batch of embedding jobs with `FOR UPDATE SKIP LOCKED` and bumps the
   * fencing token, so a crashed worker's lease expires safely and a resumed
   * worker cannot write under a stale claim.
   */
  async claimJobs(args: {
    generationId: number; workerId: string; leaseMs: number; batchSize: number;
  }): Promise<EmbeddingJob[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `WITH candidate AS (
         SELECT j.id FROM catalog_index_jobs j
         WHERE j.kind = 'embedding' AND j.generation = $1
           AND j.next_run_at <= now()
           AND (j.state = 'pending' OR (j.state = 'leased' AND j.lease_until < now()))
         ORDER BY j.next_run_at, j.id
         FOR UPDATE SKIP LOCKED LIMIT $4
       )
       UPDATE catalog_index_jobs j
       SET state = 'leased', lease_owner = $2,
           lease_until = now() + ($3 * interval '1 millisecond'),
           fencing_token = j.fencing_token + 1, updated_at = now()
       FROM candidate
       WHERE j.id = candidate.id
       RETURNING j.id, j.version_id, j.resource_id, j.generation, j.source_hash,
                 j.attempts, j.fencing_token,
                 (SELECT d.document FROM catalog_search_documents d WHERE d.version_id = j.version_id) AS document`,
      [args.generationId, args.workerId, args.leaseMs, args.batchSize],
    );
    return result.rows
      .filter(row => typeof row.document === "string")
      .map(row => ({
        id: Number(row.id),
        versionId: Number(row.version_id),
        resourceId: Number(row.resource_id),
        generation: Number(row.generation),
        sourceHash: String(row.source_hash),
        attempts: Number(row.attempts),
        fencingToken: BigInt(String(row.fencing_token)),
        document: String(row.document),
      }));
  }

  /** Drops jobs whose document disappeared, so a deleted version cannot loop. */
  async discardOrphans(generationId: number, workerId: string): Promise<number> {
    const result = await this.pool.query(
      `UPDATE catalog_index_jobs SET state = 'dead', dead_reason = 'document missing',
         lease_owner = NULL, lease_until = NULL, updated_at = now(), completed_at = now()
       WHERE kind = 'embedding' AND generation = $1 AND lease_owner = $2 AND state = 'leased'
         AND NOT EXISTS (SELECT 1 FROM catalog_search_documents d WHERE d.version_id = catalog_index_jobs.version_id)`,
      [generationId, workerId],
    );
    return result.rowCount ?? 0;
  }

  /** Stores a batch of vectors and completes their jobs in one transaction. */
  async storeEmbeddings(
    generation: ModelGeneration,
    entries: Array<{ job: EmbeddingJob; vector: number[] }>,
  ): Promise<number> {
    if (entries.length === 0) return 0;
    const storage = generationTable(generation.id);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      let stored = 0;
      for (const { job, vector } of entries) {
        if (vector.length !== generation.dimension) {
          throw new Error(
            `refusing to store dimension ${vector.length} into generation ${generation.id} (${generation.dimension})`,
          );
        }
        const fenced = await this.assertFence(client, job);
        if (!fenced) continue;
        const document = await client.query<{ created_version: string; source_hash: string }>(
          "SELECT created_version, source_hash FROM catalog_search_documents WHERE version_id = $1",
          [job.versionId],
        );
        const current = document.rows[0];
        if (!current || current.source_hash !== job.sourceHash) {
          // The document changed while the batch was in flight: leave the job
          // pending so the newer text is embedded instead.
          await client.query(
            `UPDATE catalog_index_jobs SET state = 'pending', lease_owner = NULL,
               lease_until = NULL, next_run_at = now(), updated_at = now() WHERE id = $1`,
            [job.id],
          );
          continue;
        }
        await client.query(
          `INSERT INTO ${storage}(
             generation_id, version_id, resource_id, embedding_model_id, embedding_model_version,
             embedding_dimension, embedding, source_hash, created_version, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7::vector,$8,$9,'ready')
           ON CONFLICT (version_id) DO UPDATE SET
             embedding = EXCLUDED.embedding, source_hash = EXCLUDED.source_hash,
             created_version = EXCLUDED.created_version, embedding_dimension = EXCLUDED.embedding_dimension,
             embedding_model_id = EXCLUDED.embedding_model_id,
             embedding_model_version = EXCLUDED.embedding_model_version,
             status = 'ready', updated_at = now()`,
          [
            generation.id, job.versionId, job.resourceId, generation.modelId,
            generation.modelRevision, generation.dimension, toVectorLiteral(vector),
            job.sourceHash, current.created_version,
          ],
        );
        await client.query(
          `UPDATE catalog_index_jobs SET state = 'done', lease_owner = NULL, lease_until = NULL,
             last_error = NULL, completed_at = now(), updated_at = now() WHERE id = $1`,
          [job.id],
        );
        stored += 1;
      }
      await client.query(
        `UPDATE search_model_generations SET documents_indexed = (
           SELECT count(*) FROM ${storage} WHERE status = 'ready')
         WHERE id = $1`,
        [generation.id],
      );
      await client.query("COMMIT");
      return stored;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertFence(client: PoolClient, job: EmbeddingJob): Promise<boolean> {
    const current = await client.query<{ fencing_token: string; state: string }>(
      "SELECT fencing_token, state FROM catalog_index_jobs WHERE id = $1 FOR UPDATE",
      [job.id],
    );
    const row = current.rows[0];
    return row !== undefined && BigInt(row.fencing_token) === job.fencingToken;
  }

  /**
   * Records a failed attempt with exponential backoff, and dead-letters the job
   * once the attempt budget is exhausted so a poisoned document cannot spin.
   */
  async failJobs(
    jobs: EmbeddingJob[],
    message: string,
    limits: { maxAttempts: number; backoffBaseMs: number; backoffMaxMs: number },
  ): Promise<{ retried: number; dead: number }> {
    let retried = 0;
    let dead = 0;
    for (const job of jobs) {
      const attempts = job.attempts + 1;
      const exhausted = attempts >= limits.maxAttempts;
      const delay = Math.min(limits.backoffBaseMs * 2 ** (attempts - 1), limits.backoffMaxMs);
      await this.pool.query(
        `UPDATE catalog_index_jobs SET
           attempts = $2,
           state = CASE WHEN $3 THEN 'dead' ELSE 'pending' END,
           dead_reason = CASE WHEN $3 THEN $4 ELSE dead_reason END,
           first_failed_at = COALESCE(first_failed_at, now()),
           last_error = $4,
           next_run_at = now() + ($5 * interval '1 millisecond'),
           lease_owner = NULL, lease_until = NULL, updated_at = now()
         WHERE id = $1 AND fencing_token = $6`,
        [job.id, attempts, exhausted, message.slice(0, 2_000), delay, job.fencingToken.toString()],
      );
      if (exhausted) dead += 1;
      else retried += 1;
    }
    return { retried, dead };
  }

  async queueDepth(generationId: number): Promise<Record<string, number>> {
    const result = await this.pool.query<{ state: string; count: string }>(
      `SELECT state, count(*) AS count FROM catalog_index_jobs
       WHERE kind = 'embedding' AND generation = $1 GROUP BY state`,
      [generationId],
    );
    return Object.fromEntries(result.rows.map(row => [row.state, Number(row.count)]));
  }

  /**
   * Verifies that every active catalog document has a current ready vector for
   * the generation being evaluated. A partial index can make semantic metrics
   * look like model quality, so evaluation callers must check this explicitly.
   */
  async indexCoverage(generationId: number): Promise<IndexCoverage> {
    if (!await this.hasVectorSupport()) {
      return { generationId, expected: 0, indexed: 0, pending: 0, failed: 0, complete: false };
    }
    const storage = generationTable(generationId);
    const tableExists = await this.pool.query<{ present: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = $1) AS present", [storage],
    );
    if (tableExists.rows[0]?.present !== true) {
      return { generationId, expected: 0, indexed: 0, pending: 0, failed: 0, complete: false };
    }
    const counts = await this.pool.query<{ expected: string; indexed: string }>(
      `SELECT
         (SELECT count(*) FROM catalog_search_documents d
          JOIN catalog_resource_versions v ON v.id = d.version_id
          WHERE v.status = 'active') AS expected,
         (SELECT count(*) FROM ${storage} e
          JOIN catalog_search_documents d ON d.version_id = e.version_id
          JOIN catalog_resource_versions v ON v.id = e.version_id
          WHERE v.status = 'active' AND e.status = 'ready' AND e.source_hash = d.source_hash) AS indexed`,
    );
    const queue = await this.queueDepth(generationId);
    const expected = Number(counts.rows[0]?.expected ?? 0);
    const indexed = Number(counts.rows[0]?.indexed ?? 0);
    const pending = (queue.pending ?? 0) + (queue.leased ?? 0);
    const failed = (queue.failed ?? 0) + (queue.dead ?? 0);
    return { generationId, expected, indexed, pending, failed, complete: expected === indexed && pending === 0 && failed === 0 };
  }

  /** Requeues dead-lettered jobs, for use after fixing whatever broke them. */
  async revive(generationId: number): Promise<number> {
    const result = await this.pool.query(
      `UPDATE catalog_index_jobs SET state = 'pending', attempts = 0, dead_reason = NULL,
         next_run_at = now(), updated_at = now()
       WHERE kind = 'embedding' AND generation = $1 AND state = 'dead'`,
      [generationId],
    );
    return result.rowCount ?? 0;
  }

  /**
   * Marks vectors whose document text moved on, so a superseded version cannot
   * keep answering queries with the text it no longer has.
   */
  async propagateStaleness(generationId: number): Promise<number> {
    if (!await this.hasVectorSupport()) return 0;
    const storage = generationTable(generationId);
    const exists = await this.pool.query<{ present: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = $1) AS present", [storage],
    );
    if (exists.rows[0]?.present !== true) return 0;
    const result = await this.pool.query(
      `UPDATE ${storage} e SET status = 'stale', updated_at = now()
       FROM catalog_search_documents d
       WHERE e.version_id = d.version_id
         AND e.status = 'ready' AND e.source_hash <> d.source_hash`,
    );
    return result.rowCount ?? 0;
  }
}

export { toVectorLiteral };
