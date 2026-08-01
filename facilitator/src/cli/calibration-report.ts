import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { agreement } from "../search/release/agreement.js";
import { encodeJsonl, readJsonl, sha256 } from "../search/release/io.js";
import { QrelRecordSchema } from "../search/release/schema.js";

const input = resolve(process.argv[2] ?? "eva-datasetl/calibration/human-review-v1.jsonl");
const output = resolve(process.argv[3] ?? "eva-datasetl/reports/calibration-v1.json");
const rows = (await readFile(input, "utf8")).trim().split(/\r?\n/).filter(Boolean).map((line, index) => {
  const value = JSON.parse(line) as Record<string, unknown>;
  if (value.human_grade === null || value.human_grade === undefined) return undefined;
  if (!Number.isInteger(value.agent_grade) || !Number.isInteger(value.human_grade)) throw new Error(`${input}:${index + 1}: invalid grades`);
  return { agent: Number(value.agent_grade), human: Number(value.human_grade) };
}).filter((value): value is { agent: number; human: number } => value !== undefined);
const report = agreement(rows);
await writeFile(output, `${JSON.stringify({ generated_at: new Date().toISOString(), status: report.passes ? "pass" : "fail", ...report }, null, 2)}\n`);
if (report.passes) {
  const root = dirname(dirname(output));
  const qrelPath = resolve(root, "qrels/qrels-v1.jsonl");
  const qrels = await readJsonl(qrelPath, QrelRecordSchema);
  if (qrels.some(value => value.judge === "pending")) throw new Error("cannot finalize qrels while eligible pairs are pending");
  const qrelText = encodeJsonl(qrels.map(value => ({ ...value, provisional: false })));
  await writeFile(qrelPath, qrelText);
  const manifestPath = resolve(root, "manifests/dataset-v1.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown> & { hashes: Record<string, string> };
  manifest.hashes["qrels/qrels-v1.jsonl"] = sha256(qrelText);
  manifest.qrels_status = "released_after_openrouter_judging_and_human_calibration";
  manifest.human_review_status = "agreement_gate_passed";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
if (!report.passes) process.exitCode = 1;
