import pg from "pg";
import { loadConfig } from "./config.js";
import { migrate } from "./db/migrate.js";
import { StateStore } from "./db/state.js";
import { CatalogStore } from "./db/catalog.js";
import { AnalyticsStore } from "./db/analytics.js";
import { Cataloger } from "./bazaar/cataloger.js";
import { createApp } from "./http/app.js";
import { FacilitatorCore } from "./orchestrator.js";
import { initializeRuntimes } from "./runtime.js";

const config = loadConfig();
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

await migrate(pool);
const state = new StateStore(pool);
const catalog = new CatalogStore(pool);
const analytics = new AnalyticsStore(pool);
const runtimes = await initializeRuntimes(config, pool, state);
const cataloger = new Cataloger(config.catalog, catalog, config.networks);
const core = new FacilitatorCore(config, runtimes, state, cataloger, analytics);
await core.recoverUnresolved();

const app = createApp(config, core, state, { catalog, analytics });
const server = app.listen(config.port, () => {
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

async function shutdown(signal: string): Promise<void> {
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
  clearInterval(recovery);
  clearInterval(staleness);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
