import pg from "pg";
import { loadConfig } from "./config.js";
import { migrate } from "./db/migrate.js";
import { StateStore } from "./db/state.js";
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
const runtimes = await initializeRuntimes(config, pool, state);
const core = new FacilitatorCore(config, runtimes, state);
await core.recoverUnresolved();

const app = createApp(config, core, state);
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

async function shutdown(signal: string): Promise<void> {
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
  clearInterval(recovery);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
