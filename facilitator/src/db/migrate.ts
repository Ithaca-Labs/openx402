import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";

export async function migrate(pool: Pool): Promise<void> {
  const sql = await readFile(resolve("migrations/001_core.sql"), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(402, 1)");
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
