import { loadConfig } from "./config.js";
import { SearchStore } from "./db/search.js";
import { createEmbeddingProvider, createRerankerProvider } from "./search/providers/index.js";
import { ImpressionRecorder, SearchService } from "./search/service.js";
import { EmbeddingWorker } from "./search/worker.js";
import { createApp } from "./http/app.js";
import { createFacilitatorRuntime } from "./factory.js";

const config = loadConfig();
const runtime = await createFacilitatorRuntime({ config });
const { pool, state, catalog, analytics, runtimes, core } = runtime;

const searchStore = new SearchStore(pool);
const embedder = createEmbeddingProvider(config.search);
const reranker = createRerankerProvider(config.search);
const worker = new EmbeddingWorker(config.search, searchStore, config.instanceId, embedder);
// Model loading and the first backfill happen here, off the request path.
const searchStatus = await worker.prepare();
console.log(JSON.stringify({ level: "info", event: "search_ready", search: searchStatus }));
if (config.search.indexing.reindexSchedule === "startup" && searchStatus.generation) {
  await searchStore.enqueueMissing(searchStatus.generation.id).catch(() => undefined);
}
worker.start();
const searchService = new SearchService(config.search, catalog, searchStore, embedder, reranker);
await searchService.refreshGeneration();
const impressions = new ImpressionRecorder(pool, config.search);

const app = createApp(config, core, state, {
  catalog, analytics, search: searchStore, searchService, impressions, worker,
});
const server = app.listen(config.port, "::", () => {
  console.log(JSON.stringify({
    level: "info",
    event: "facilitator_started",
    message: "Facilitator listening",
    port: config.port,
    networks: [...runtimes.networks.keys()],
    instanceId: config.instanceId,
  }));
});

const recovery = setInterval(() => void core.recoverUnresolved(), 15_000);
recovery.unref();

// Liveness demotion. A resource that stopped being observed must not keep
// ranking as healthy just because it was once cataloged.
const staleness = setInterval(
  () => void catalog.sweepStale(config.catalog.staleAfterHours).catch(() => undefined),
  600_000,
);
staleness.unref();

const impressionPrune = setInterval(
  () => void impressions.prune().catch(() => undefined),
  3_600_000,
);
impressionPrune.unref();

async function shutdown(signal: string): Promise<void> {
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
  clearInterval(recovery);
  clearInterval(staleness);
  clearInterval(impressionPrune);
  await worker.stop();
  server.close(async () => {
    await runtime.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
