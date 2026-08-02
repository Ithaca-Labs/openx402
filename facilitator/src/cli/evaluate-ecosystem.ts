import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateEcosystemRun } from "../search/ecosystem/evaluate.js";
import { readRecommendationRun, validateEcosystemDataset } from "../search/ecosystem/validate.js";

const root = resolve(process.argv[2] ?? "eval-dataset/ecosystem");
const runPath = resolve(process.argv[3] ?? `${root}/runs/recommendations-v1.jsonl`);
const dataset = await validateEcosystemDataset(root, { requireJudgments: true });
const runs = await readRecommendationRun(runPath);
const report = evaluateEcosystemRun(dataset.resources, dataset.queries, dataset.judgments, runs, dataset.outcomes);
const output = resolve(root, "reports/ecosystem-v1.json");
await mkdir(resolve(root, "reports"), { recursive: true });
await writeFile(output, `${JSON.stringify({
  ...report,
  generated_at: new Date().toISOString(),
  dataset_version: dataset.manifest.dataset_version,
  dataset_hashes: dataset.manifest.hashes,
  recommendation_run: runPath,
}, null, 2)}\n`);
console.log(JSON.stringify({ output, ...report }, null, 2));
