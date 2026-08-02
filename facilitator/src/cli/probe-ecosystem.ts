import { resolve } from "node:path";
import { probeEcosystemDataset } from "../search/ecosystem/dataset.js";

const root = resolve(process.argv[2] ?? "eval-dataset/ecosystem");
const requestedLimit = process.env.ECOSYSTEM_PROBE_LIMIT;
// A live catalog can contain many thousands of services. Keep the default
// command safe for public endpoints; set ECOSYSTEM_PROBE_LIMIT=0 to probe all.
const limit = requestedLimit === undefined ? 500 : Math.max(0, Number(requestedLimit));
const result = await probeEcosystemDataset(root, {
  limit,
  concurrency: Number(process.env.ECOSYSTEM_PROBE_CONCURRENCY ?? 8),
  timeout_ms: Number(process.env.ECOSYSTEM_PROBE_TIMEOUT_MS ?? 5_000),
});
console.log(JSON.stringify({ root, ...result }, null, 2));
