import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { encodeJsonl, readJsonl, rejectDuplicates, sha256 } from "../search/release/io.js";
import { validateEcosystemDataset } from "../search/ecosystem/validate.js";
import { EcosystemJudgmentSchema, EcosystemOutcomeSchema } from "../search/ecosystem/schema.js";

const root = resolve(process.argv[2] ?? "eval-dataset/ecosystem");
const kind = process.argv[3];
const input = process.argv[4];
if (kind !== "judgments" && kind !== "outcomes") throw new Error("usage: benchmark:import-ecosystem <root> <judgments|outcomes> <jsonl>");
if (!input) throw new Error("usage: benchmark:import-ecosystem <root> <judgments|outcomes> <jsonl>");

const dataset = await validateEcosystemDataset(root);
const rows = kind === "judgments"
  ? await readJsonl(resolve(input), EcosystemJudgmentSchema)
  : await readJsonl(resolve(input), EcosystemOutcomeSchema);
rejectDuplicates(rows as Array<{ query_id: string; resource_id: string }>, value => `${value.query_id}\0${value.resource_id}`, `ecosystem ${kind} pair`);
const resourceIds = new Set(dataset.resources.map(value => value.resource_id));
const queryIds = new Set(dataset.queries.map(value => value.query_id));
if (rows.some(value => !resourceIds.has(value.resource_id) || !queryIds.has(value.query_id))) {
  throw new Error(`${kind} contain an unknown query_id or resource_id`);
}

const relative = `${kind}/${kind}-v1.jsonl`;
const text = encodeJsonl(rows);
await writeFile(resolve(root, relative), text);
const manifestPath = resolve(root, "manifests/dataset-v1.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
  counts: Record<string, number>;
  hashes: Record<string, string>;
};
manifest.counts[kind] = rows.length;
manifest.hashes[relative] = sha256(text);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ root, kind, records: rows.length, path: resolve(root, relative) }, null, 2));
