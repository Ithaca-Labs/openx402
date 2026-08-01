import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildCalibrationSample } from "../search/release/calibration.js";
import { encodeJsonl, readJsonl, sha256 } from "../search/release/io.js";
import { QrelRecordSchema, QueryRecordSchema } from "../search/release/schema.js";
import { validateReleaseDataset } from "../search/release/validate.js";

const root = resolve(process.argv[2] ?? "eval-dataset");
const queryPath = resolve(root, "queries/queries-v1.jsonl");
const qrelPath = resolve(root, "qrels/qrels-v1.jsonl");
const calibrationPath = resolve(root, "calibration/human-review-v1.jsonl");
const queries = await readJsonl(queryPath, QueryRecordSchema);
const qrels = await readJsonl(qrelPath, QrelRecordSchema);
const noResultIds = new Set(queries.filter(query => query.expects_no_result).map(query => query.query_id));

const curated = qrels.map(row => noResultIds.has(row.query_id) && row.eligible
  ? QrelRecordSchema.parse({
      ...row,
      grade: 0,
      judge: "curated",
      provisional: true,
      rationale: "Benchmark-curated absent capability; provisional until independent calibration.",
    })
  : row);
const qrelText = encodeJsonl(curated);
const calibrationText = encodeJsonl(buildCalibrationSample(curated, queries));
await writeFile(qrelPath, qrelText);
await writeFile(calibrationPath, calibrationText);

const manifestPath = resolve(root, "manifests/dataset-v1.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown> & { hashes: Record<string, string> };
manifest.hashes["qrels/qrels-v1.jsonl"] = sha256(qrelText);
manifest.hashes["calibration/human-review-v1.jsonl"] = sha256(calibrationText);
manifest.qrels_status = "openrouter_judged_with_curated_no_result_provisional";
manifest.human_review_status = "not_started";
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

await validateReleaseDataset(root);
console.log(`Curated ${noResultIds.size} no-result queries and rebuilt the stratified calibration sample.`);
