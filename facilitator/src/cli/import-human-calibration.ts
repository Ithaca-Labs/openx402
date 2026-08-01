import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { encodeJsonl, readJsonl, rejectDuplicates, sha256 } from "../search/release/io.js";
import { HumanCalibrationSchema, HumanReviewImportSchema } from "../search/release/schema.js";

const source = process.argv[2];
if (!source) throw new Error("usage: npm run benchmark:import-human -- <human-review.jsonl> [dataset-root]");
const root = resolve(process.argv[3] ?? "eva-datasetl");
const imports = await readJsonl(resolve(source), HumanReviewImportSchema);
rejectDuplicates(imports, value => `${value.query_id}\0${value.resource_id}`, "human review pair");
const path = resolve(root, "calibration/human-review-v1.jsonl");
const calibration = await readJsonl(path, HumanCalibrationSchema);
const byPair = new Map(imports.map(value => [`${value.query_id}\0${value.resource_id}`, value]));
for (const key of byPair.keys()) {
  if (!calibration.some(value => `${value.query_id}\0${value.resource_id}` === key)) throw new Error(`human review pair is outside the frozen calibration sample: ${key}`);
}
const merged = calibration.map(value => {
  const review = byPair.get(`${value.query_id}\0${value.resource_id}`);
  return review ? { ...value, ...review } : value;
});
const text = encodeJsonl(merged);
await writeFile(path, text);
const manifestPath = resolve(root, "manifests/dataset-v1.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown> & { hashes: Record<string, string> };
manifest.hashes["calibration/human-review-v1.jsonl"] = sha256(text);
manifest.human_review_status = "imported_pending_agreement_gate";
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Imported ${imports.length} genuine human reviews into ${path}. Run benchmark:calibration next.`);
