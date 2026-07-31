import pg from "pg";
import { loadConfig } from "../config.js";
import { migrate } from "../db/migrate.js";

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl });
try {
  await migrate(pool);
  console.log("database migrations applied");
} finally {
  await pool.end();
}
