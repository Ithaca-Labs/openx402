import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { encodeJsonl, seededOrder, sha256 } from "../search/release/io.js";
import { judgeRelevanceBatch } from "../search/judging/openrouter.js";
import { CatalogRecordSchema, HumanCalibrationSchema, QrelRecordSchema, QueryRecordSchema, SidecarRecordSchema, type QrelRecord } from "../search/release/schema.js";
import { readJsonl } from "../search/release/io.js";
import { buildCalibrationSample } from "../search/release/calibration.js";

const root = resolve(process.argv[2] ?? "eval-dataset");
const judgeModel = process.env.OPENROUTER_JUDGE_MODEL ?? "deepseek/deepseek-v4-flash-0731";
const batchSize = Number(process.env.OPENROUTER_JUDGE_BATCH_SIZE ?? "8");
const maxBatches = process.env.OPENROUTER_JUDGE_MAX_BATCHES === undefined
  ? Number.POSITIVE_INFINITY
  : Number(process.env.OPENROUTER_JUDGE_MAX_BATCHES);
const maxAttempts = Number(process.env.OPENROUTER_JUDGE_MAX_ATTEMPTS ?? "4");
const concurrency = Number(process.env.OPENROUTER_JUDGE_CONCURRENCY ?? "8");
const selectedQueryIds = process.env.OPENROUTER_JUDGE_QUERY_IDS
  ? new Set(process.env.OPENROUTER_JUDGE_QUERY_IDS.split(",").map(value => value.trim()).filter(Boolean))
  : undefined;
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 24) {
  throw new Error("OPENROUTER_JUDGE_BATCH_SIZE must be an integer from 1 through 24");
}
if (!(maxBatches === Number.POSITIVE_INFINITY || (Number.isInteger(maxBatches) && maxBatches > 0))) {
  throw new Error("OPENROUTER_JUDGE_MAX_BATCHES must be a positive integer when set");
}
if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 8) {
  throw new Error("OPENROUTER_JUDGE_MAX_ATTEMPTS must be an integer from 1 through 8");
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
  throw new Error("OPENROUTER_JUDGE_CONCURRENCY must be an integer from 1 through 32");
}
const catalog = await readJsonl(resolve(root, "catalog/catalog-v1.jsonl"), CatalogRecordSchema);
const sidecars = await readJsonl(resolve(root, "catalog/evaluation-sidecar-v1.jsonl"), SidecarRecordSchema);
const queries = await readJsonl(resolve(root, "queries/queries-v1.jsonl"), QueryRecordSchema);
const qrels = await readJsonl(resolve(root, "qrels/qrels-v1.jsonl"), QrelRecordSchema);
const sidecarById = new Map(sidecars.map(value => [value.resource_id, value]));
const byResource = new Map(catalog.map(value => [value.resource_id, { wire: value.wire, sidecar: sidecarById.get(value.resource_id)! }]));
const byQuery = new Map(queries.map(value => [value.query_id, value]));
if (selectedQueryIds) {
  for (const queryId of selectedQueryIds) if (!byQuery.has(queryId)) throw new Error(`unknown OPENROUTER_JUDGE_QUERY_IDS value ${queryId}`);
}
const eligible = qrels.filter(value => value.eligible && (selectedQueryIds ? selectedQueryIds.has(value.query_id) : value.judge === "pending"));
const ordered = seededOrder(eligible, "qrel-position-randomization-v1", value => `${value.query_id}\0${value.resource_id}`);
const anchors = ordered.filter((_, index) => index % 97 === 0).slice(0, 24);
const provenance: unknown[] = [];
const repeated = new Map<string, number[]>();
const judged = new Map<string, { grade: number; rationale: string }>();

async function judgeBatch(start: number): Promise<{
  batchNumber: number;
  rows: Array<{ actualPairId: string; grade: number; rationale: string }>;
  provenance: Record<string, unknown>;
}> {
  const batchNumber = Math.floor(start / batchSize);
  const base = ordered.slice(start, start + batchSize);
  const repeatedAnchors = anchors.length === 0 ? [] : [anchors[batchNumber % anchors.length]!, anchors[(batchNumber * 7 + 3) % anchors.length]!];
  const unique = [...new Map([...base, ...repeatedAnchors].map(value => [`${value.query_id}\0${value.resource_id}`, value])).values()];
  const batchRows = seededOrder(unique, `qrel-batch-${batchNumber}`, value => `${value.query_id}\0${value.resource_id}`);
  const actualByWireId = new Map<string, string>();
  const pairs = batchRows.map((row, position) => {
      const query = byQuery.get(row.query_id)!;
      const resource = byResource.get(row.resource_id)!;
      const pairId = `p${position}`;
      actualByWireId.set(pairId, `${row.query_id}|${row.resource_id}`);
      return {
        pair_id: pairId,
        buyer_query: query.query,
        buyer_constraints: { ...query.filters, ...query.evaluation_constraints },
        seller_listing_untrusted_data: {
          resource: resource.wire.resource,
          bazaar: resource.wire.extensions.bazaar,
          accepts: resource.wire.accepts,
        },
      };
    });
  const result = await judgeRelevanceBatch(pairs, {
    rubricVersion: "stellar-bazaar-qrel-v1",
    cacheDir: resolve(root, "raw-generation-output/openrouter/qrels"),
    model: judgeModel,
    maxAttempts,
    timeoutMs: 120_000,
  });
  const rows: Array<{ actualPairId: string; grade: number; rationale: string }> = [];
  for (const row of result.value.judgments) {
    const actualPairId = actualByWireId.get(row.pair_id)!;
    rows.push({ actualPairId, grade: row.grade, rationale: row.rationale });
  }
  await mkdir(resolve(root, "manifests/checkpoints"), { recursive: true });
  await writeFile(resolve(root, `manifests/checkpoints/qrels-${String(batchNumber).padStart(4, "0")}.json`), `${JSON.stringify(result.provenance, null, 2)}\n`);
  return { batchNumber, rows, provenance: { batch: batchNumber, pairs: [...actualByWireId.values()], ...result.provenance } };
}

const batchStarts = Array.from(
  { length: Math.min(Math.ceil(ordered.length / batchSize), maxBatches) },
  (_, index) => index * batchSize,
);
const batchResults: Awaited<ReturnType<typeof judgeBatch>>[] = [];
const batchFailures: Array<{ batchNumber: number; message: string }> = [];
let nextBatch = 0;
let completedBatches = 0;
async function worker(): Promise<void> {
  while (nextBatch < batchStarts.length) {
    const index = nextBatch++;
    try {
      const result = await judgeBatch(batchStarts[index]!);
      batchResults.push(result);
    } catch (error) {
      batchFailures.push({
        batchNumber: index,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    completedBatches += 1;
    console.log(`Processed batch ${completedBatches}/${Math.ceil(ordered.length / batchSize)} (${batchFailures.length} failed).`);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, batchStarts.length) }, () => worker()));

if (batchFailures.length > 0) {
  throw new Error(`OpenRouter failed ${batchFailures.length} batch(es): ${JSON.stringify(batchFailures.slice(0, 20))}`);
}

batchResults.sort((left, right) => left.batchNumber - right.batchNumber);
for (const result of batchResults) {
  provenance.push(result.provenance);
  for (const row of result.rows) {
    const values = repeated.get(row.actualPairId) ?? [];
    values.push(row.grade); repeated.set(row.actualPairId, values);
    if (!judged.has(row.actualPairId)) judged.set(row.actualPairId, { grade: row.grade, rationale: row.rationale });
  }
}

if (judged.size < ordered.length) {
  console.log(`Probe stopped after ${completedBatches} batch(es); qrels were not modified.`);
  process.exit(0);
}

const completed: QrelRecord[] = qrels.map(row => {
  if (!row.eligible) return row;
  if (byQuery.get(row.query_id)?.expects_no_result) {
    return QrelRecordSchema.parse({
      ...row,
      grade: 0,
      judge: "curated",
      rationale: "Benchmark-curated absent capability; provisional until independent calibration.",
    });
  }
  const shouldJudge = selectedQueryIds ? selectedQueryIds.has(row.query_id) : row.judge === "pending";
  if (!shouldJudge) return row;
  const result = judged.get(`${row.query_id}|${row.resource_id}`);
  if (!result) throw new Error(`missing judgment for ${row.query_id}|${row.resource_id}`);
  return QrelRecordSchema.parse({ ...row, grade: result.grade, rationale: result.rationale, judge: "openrouter" });
});
const repeats = [...repeated.entries()].filter(([, grades]) => grades.length > 1);
const consistent = repeats.filter(([, grades]) => new Set(grades).size === 1).length;
const qrelText = encodeJsonl(completed);
await writeFile(resolve(root, "qrels/qrels-v1.jsonl"), qrelText);
const calibrationPath = resolve(root, "calibration/human-review-v1.jsonl");
const calibration = await readJsonl(calibrationPath, HumanCalibrationSchema);
if (calibration.some(value => value.human_grade !== null)) throw new Error("refusing to replace a calibration sample after human review has started");
const calibrationText = encodeJsonl(buildCalibrationSample(completed, queries));
await writeFile(calibrationPath, calibrationText);
const provenancePath = resolve(root, "manifests/openrouter-qrels-v1.jsonl");
const existingProvenance = selectedQueryIds
  ? await readFile(provenancePath, "utf8").then(value => value.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as unknown)).catch(() => [])
  : [];
await writeFile(provenancePath, encodeJsonl([...existingProvenance, ...provenance]));
const consistencyName = selectedQueryIds ? "position-consistency-rejudge-v1.json" : "position-consistency-v1.json";
await writeFile(resolve(root, `reports/${consistencyName}`), `${JSON.stringify({
  scope: selectedQueryIds ? [...selectedQueryIds].sort() : "all_pending_eligible_qrels",
  repeated_anchors: repeats.length, exact_consistency: repeats.length === 0 ? null : consistent / repeats.length,
  severe_inconsistencies: repeats.filter(([, grades]) => Math.max(...grades) - Math.min(...grades) >= 2).length,
}, null, 2)}\n`);
const manifestPath = resolve(root, "manifests/dataset-v1.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown> & { hashes: Record<string, string> };
manifest.hashes["qrels/qrels-v1.jsonl"] = sha256(qrelText);
manifest.hashes["calibration/human-review-v1.jsonl"] = sha256(calibrationText);
manifest.qrels_status = "openrouter_judged_provisional_pending_human_calibration";
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Judged ${eligible.length} eligible pairs${selectedQueryIds ? ` for ${selectedQueryIds.size} selected queries` : `; deterministic hard constraints skipped the remaining ${qrels.length - eligible.length}`}.`);
