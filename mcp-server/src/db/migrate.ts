import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Pool } from "pg";

const MIGRATION_NAME = /^(\d+)_[^/]*\.sql$/;

/**
 * Applies forward-only numbered migrations under a single advisory lock so
 * concurrent replicas converge on the same schema. Uses its own tracking
 * table (`mcp_schema_migrations`) and advisory lock id, distinct from the
 * facilitator's (`schema_migrations` / `pg_advisory_xact_lock(402, 1)`), so
 * both migration sets can run safely against the same physical database.
 */
export async function migrate(pool: Pool, directory = resolve("migrations")): Promise<void> {
  const files = (await readdir(directory)).filter(name => MIGRATION_NAME.test(name)).sort();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(402, 2)");
    await client.query(`CREATE TABLE IF NOT EXISTS mcp_schema_migrations (
      version integer PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = new Set(
      (await client.query<{ version: string }>("SELECT version FROM mcp_schema_migrations")).rows
        .map(row => Number(row.version)),
    );
    for (const file of files) {
      const version = Number(MIGRATION_NAME.exec(file)![1]);
      if (applied.has(version)) continue;
      await client.query(await readFile(join(directory, file), "utf8"));
      await client.query(
        "INSERT INTO mcp_schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING",
        [version],
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
