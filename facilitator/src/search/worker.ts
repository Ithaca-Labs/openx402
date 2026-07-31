import type { SearchConfig } from "../types.js";
import type { EmbeddingJob, ModelGeneration, SearchStore } from "../db/search.js";
import type { EmbeddingProvider, ProviderHealth } from "./types.js";
import { validateVectors } from "./types.js";

export interface WorkerStatus {
  running: boolean;
  generation?: ModelGeneration;
  provider: ProviderHealth;
  vectorSupport: boolean;
  processed: number;
  failed: number;
  deadLettered: number;
  lastError?: string;
  lastRunAt?: string;
}

/**
 * Embedding indexer.
 *
 * Claims durable jobs from `catalog_index_jobs` with `FOR UPDATE SKIP LOCKED`
 * and a fencing token, so several replicas share the queue safely and a crashed
 * worker's lease expires without losing or duplicating work. Nothing here runs
 * on a request path: cataloging enqueues and returns immediately.
 */
export class EmbeddingWorker {
  private timer: NodeJS.Timeout | undefined;
  private stopped = true;
  private inFlight: Promise<void> | undefined;
  private generation: ModelGeneration | undefined;
  private providerHealth: ProviderHealth = { status: "disabled" };
  private processed = 0;
  private failed = 0;
  private deadLettered = 0;
  private lastError: string | undefined;
  private lastRunAt: string | undefined;
  private vectorSupport = false;

  constructor(
    private readonly config: SearchConfig,
    private readonly store: SearchStore,
    private readonly workerId: string,
    private readonly provider?: EmbeddingProvider,
  ) {}

  /**
   * Registers the active generation and enqueues anything missing. Safe to call
   * on every boot: an unchanged model identity resolves to the same generation.
   */
  async prepare(): Promise<WorkerStatus> {
    if (!this.provider || !this.config.semantic.enabled) {
      this.providerHealth = { status: "disabled", detail: "semantic search is disabled" };
      return this.status();
    }
    this.vectorSupport = await this.store.hasVectorSupport();
    if (!this.vectorSupport) {
      this.providerHealth = {
        status: "degraded",
        detail: "pgvector is not installed on this PostgreSQL server; running lexical-only",
      };
      return this.status();
    }
    // Warming loads the model when the provider supports it. A failure here is a
    // degraded state, never a boot failure.
    const warm = (this.provider as { warm?: () => Promise<ProviderHealth> }).warm;
    this.providerHealth = warm
      ? await warm.call(this.provider).catch(error => ({
          status: "degraded" as const,
          detail: error instanceof Error ? error.message : String(error),
        }))
      : await this.provider.health().catch(() => ({ status: "degraded" as const }));

    try {
      this.generation = await this.store.activateGeneration(this.provider.identity);
      await this.store.propagateStaleness(this.generation.id);
      await this.store.enqueueMissing(this.generation.id);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.providerHealth = { status: "degraded", detail: this.lastError };
    }
    return this.status();
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = (): void => {
      if (this.stopped) return;
      this.inFlight = this.runOnce()
        .then(() => undefined)
        .catch(error => {
          this.lastError = error instanceof Error ? error.message : String(error);
        })
        .finally(() => {
          if (this.stopped) return;
          this.timer = setTimeout(tick, this.config.indexing.pollMs);
          this.timer.unref();
        });
    };
    tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight?.catch(() => undefined);
  }

  /** One drain pass. Returns how many vectors were stored. */
  async runOnce(): Promise<number> {
    if (!this.provider || !this.generation || this.providerHealth.status === "disabled") return 0;
    this.lastRunAt = new Date().toISOString();
    let stored = 0;
    for (let batch = 0; batch < this.config.indexing.workerConcurrency; batch += 1) {
      const jobs = await this.store.claimJobs({
        generationId: this.generation.id,
        workerId: this.workerId,
        leaseMs: this.config.indexing.leaseMs,
        batchSize: this.config.indexing.batchSize,
      });
      await this.store.discardOrphans(this.generation.id, this.workerId);
      if (jobs.length === 0) break;
      stored += await this.processBatch(jobs);
    }
    return stored;
  }

  private async processBatch(jobs: EmbeddingJob[]): Promise<number> {
    const generation = this.generation!;
    try {
      const vectors = await this.provider!.embed(jobs.map(job => job.document));
      validateVectors(vectors, generation.dimension, jobs.length);
      const stored = await this.store.storeEmbeddings(
        generation,
        jobs.map((job, index) => ({ job, vector: vectors[index]! })),
      );
      this.processed += stored;
      this.providerHealth = { status: "ready" };
      this.lastError = undefined;
      return stored;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.providerHealth = { status: "degraded", detail: message };
      const outcome = await this.store.failJobs(jobs, message, {
        maxAttempts: this.config.indexing.maxAttempts,
        backoffBaseMs: this.config.indexing.backoffBaseMs,
        backoffMaxMs: this.config.indexing.backoffMaxMs,
      });
      this.failed += outcome.retried;
      this.deadLettered += outcome.dead;
      await this.store.recordGenerationError(generation.id, message).catch(() => undefined);
      return 0;
    }
  }

  /** Drains the queue until it is empty or the pass budget is exhausted. */
  async drain(maxPasses = 100): Promise<number> {
    let total = 0;
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const stored = await this.runOnce();
      total += stored;
      if (stored === 0) break;
    }
    return total;
  }

  status(): WorkerStatus {
    return {
      running: !this.stopped,
      ...(this.generation ? { generation: this.generation } : {}),
      provider: this.providerHealth,
      vectorSupport: this.vectorSupport,
      processed: this.processed,
      failed: this.failed,
      deadLettered: this.deadLettered,
      ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(this.lastRunAt ? { lastRunAt: this.lastRunAt } : {}),
    };
  }
}
