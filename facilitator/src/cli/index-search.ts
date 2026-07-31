/**
 * Indexing and reindex operations.
 *
 *   npm run index -- status              # generations, queue depth, health
 *   npm run index -- backfill            # enqueue anything missing, then drain
 *   npm run index -- reindex             # re-enqueue every active document
 *   npm run index -- revive              # requeue dead-lettered jobs
 *
 * A model, revision, dimension, pooling or normalization change registers a new
 * generation; `reindex` is the explicit migration that fills it. Vectors from
 * different generations are never compared, so the previous generation stays
 * queryable until the new one is activated.
 */
import pg from "pg";
import { loadConfig } from "../config.js";
import { migrate } from "../db/migrate.js";
import { SearchStore } from "../db/search.js";
import { createEmbeddingProvider } from "../search/providers/index.js";
import { EmbeddingWorker } from "../search/worker.js";

const command = process.argv[2] ?? "status";
const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl });
await migrate(pool);

const store = new SearchStore(pool);
const provider = createEmbeddingProvider(config.search);
const worker = new EmbeddingWorker(config.search, store, `${config.instanceId}-cli`, provider);
const status = await worker.prepare();

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

switch (command) {
  case "status": {
    print({
      vectorSupport: await store.hasVectorSupport(),
      worker: status,
      generations: await store.generations(),
      queue: status.generation ? await store.queueDepth(status.generation.id) : {},
    });
    break;
  }
  case "backfill": {
    if (!status.generation) throw new Error("no active generation; semantic search is disabled or degraded");
    const enqueued = await store.enqueueMissing(status.generation.id);
    const stored = await worker.drain();
    print({ enqueued, stored, queue: await store.queueDepth(status.generation.id) });
    break;
  }
  case "reindex": {
    if (!status.generation) throw new Error("no active generation; semantic search is disabled or degraded");
    await store.propagateStaleness(status.generation.id);
    const requeued = await pool.query(
      `UPDATE catalog_index_jobs SET state = 'pending', attempts = 0, next_run_at = now(),
         dead_reason = NULL, updated_at = now()
       WHERE kind = 'embedding' AND generation = $1`,
      [status.generation.id],
    );
    const enqueued = await store.enqueueMissing(status.generation.id);
    const stored = await worker.drain();
    print({
      generation: status.generation, requeued: requeued.rowCount ?? 0, enqueued, stored,
      queue: await store.queueDepth(status.generation.id),
    });
    break;
  }
  case "revive": {
    if (!status.generation) throw new Error("no active generation");
    print({ revived: await store.revive(status.generation.id) });
    break;
  }
  default:
    throw new Error(`unknown command "${command}"; expected status, backfill, reindex or revive`);
}

await pool.end();
