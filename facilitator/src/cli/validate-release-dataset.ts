import { resolve } from "node:path";
import { validateReleaseDataset } from "../search/release/validate.js";

const root = resolve(process.argv[2] ?? "eval-dataset");
const dataset = await validateReleaseDataset(root);
const pending = dataset.qrels.filter(value => value.judge === "pending").length;
console.log(JSON.stringify({
  root, resources: dataset.catalog.length, queries: dataset.queries.length,
  qrels: dataset.qrels.length, pending_qrels: pending,
}, null, 2));
if (process.argv.includes("--release-ready") && pending > 0) {
  throw new Error(`${pending} eligible qrels are pending OpenRouter judgment`);
}
