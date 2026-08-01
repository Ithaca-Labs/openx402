import pg from "pg";
import { migrate } from "../db/migrate.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  await migrate(pool);
  console.log("mcp-server migrations applied");
} finally {
  await pool.end();
}
