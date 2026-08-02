import { resolve } from "node:path";
import { validateEcosystemDataset } from "../search/ecosystem/validate.js";

const root = resolve(process.argv[2] ?? "eval-dataset/ecosystem");
const dataset = await validateEcosystemDataset(root, { requireJudgments: process.argv.includes("--require-judgments") });
console.log(JSON.stringify({
  root,
  resources: dataset.resources.length,
  queries: dataset.queries.length,
  judgments: dataset.judgments.length,
  outcomes: dataset.outcomes.length,
  sources: dataset.manifest.sources,
  source_errors: dataset.manifest.source_errors,
}, null, 2));
