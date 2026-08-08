import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg, { type Pool } from "pg";
import { Cataloger } from "./bazaar/cataloger.js";
import { AnalyticsStore } from "./db/analytics.js";
import { CatalogStore } from "./db/catalog.js";
import { migrate } from "./db/migrate.js";
import { StateStore } from "./db/state.js";
import { FacilitatorCore } from "./orchestrator.js";
import { initializeRuntimes, type RuntimeRegistry } from "./runtime.js";
import type { AppConfig } from "./types.js";

export interface FacilitatorRuntime {
  config: AppConfig;
  pool: Pool;
  state: StateStore;
  catalog: CatalogStore;
  analytics: AnalyticsStore;
  runtimes: RuntimeRegistry;
  core: FacilitatorCore;
  close(): Promise<void>;
}

export interface CreateFacilitatorRuntimeOptions {
  config: AppConfig;
  pool?: Pool;
  runMigrations?: boolean;
  migrationsDirectory?: string;
}

function packagedMigrationsDirectory(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, "../migrations"), resolve(here, "../../migrations")];
  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) {
    throw new Error("facilitator migrations were not packaged; set migrationsDirectory explicitly");
  }
  return found;
}

/**
 * Creates the shared facilitator runtime used by both the HTTP service and
 * in-process self-facilitation. Security and persistence behavior is identical
 * in both packaging modes.
 */
export async function createFacilitatorRuntime(
  options: CreateFacilitatorRuntimeOptions,
): Promise<FacilitatorRuntime> {
  const ownsPool = options.pool === undefined;
  const pool = options.pool ?? new pg.Pool({
    connectionString: options.config.databaseUrl,
    max: 20,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

  try {
    if (options.runMigrations !== false) {
      await migrate(pool, options.migrationsDirectory ?? packagedMigrationsDirectory());
    }
    const state = new StateStore(pool);
    const catalog = new CatalogStore(pool);
    const analytics = new AnalyticsStore(pool);
    const runtimes = await initializeRuntimes(options.config, pool, state);
    const cataloger = new Cataloger(options.config.catalog, catalog, options.config.networks);
    const core = new FacilitatorCore(options.config, runtimes, state, cataloger, analytics);
    await core.recoverUnresolved();

    return {
      config: options.config,
      pool,
      state,
      catalog,
      analytics,
      runtimes,
      core,
      close: async () => {
        if (ownsPool) await pool.end();
      },
    };
  } catch (error) {
    if (ownsPool) await pool.end().catch(() => undefined);
    throw error;
  }
}
