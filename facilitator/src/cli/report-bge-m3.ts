import { mkdir, writeFile } from "node:fs/promises";
import { cpus, freemem, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { LocalEmbeddingProvider } from "../search/providers/local.js";

const repo = "Xenova/bge-m3";
const revision = "4de13258303883538bd53b696b452bf8099f0858";
const cacheDir = process.env.FACILITATOR_LIVE_MODEL_CACHE ?? ".models";
const provider = new LocalEmbeddingProvider({
  cacheDir, offline: false, dtype: "fp32", modelId: "BAAI/bge-m3", repo, revision,
  dimension: 1024, pooling: "cls", normalization: "l2",
});
const started = performance.now();
const health = await provider.warm();
if (health.status !== "ready") throw new Error(health.detail ?? "BGE-M3 did not become ready");
const warmMs = performance.now() - started;
const texts = ["current weather and forecast for a city", "climate conditions and temperature outlook", "stock ticker valuation and quarterly filings"];
const inferenceStarted = performance.now();
const vectors = await provider.embed(texts);
const inferenceMs = performance.now() - inferenceStarted;
const dot = (left: number[], right: number[]) => left.reduce((sum, value, index) => sum + value * right[index]!, 0);
const norms = vectors.map(vector => Math.sqrt(dot(vector, vector)));
const report = {
  generated_at: new Date().toISOString(), status: "pass",
  model: { logical_id: "BAAI/bge-m3", onnx_repo: repo, revision, dimension: 1024, dtype: "fp32", pooling: "cls", normalization: "l2", artifact_checksum: provider.identity.checksum },
  measurements: { warm_ms: warmMs, inference_ms: inferenceMs, texts: texts.length, vector_norms: norms, related_similarity: dot(vectors[0]!, vectors[1]!), unrelated_similarity: dot(vectors[0]!, vectors[2]!) },
  assertions: { dimensions_valid: vectors.every(value => value.length === 1024), normalized: norms.every(value => Math.abs(value - 1) < 1e-4), related_above_unrelated: dot(vectors[0]!, vectors[1]!) > dot(vectors[0]!, vectors[2]!), checksum_recorded: /^[a-f0-9]{64}$/.test(provider.identity.checksum ?? "") },
  environment: { node: process.version, platform: platform(), os_release: release(), architecture: process.arch, cpu: cpus()[0]?.model, cpu_count: cpus().length, total_memory_bytes: totalmem(), free_memory_bytes_at_report: freemem() },
  limitations: ["This is a local embedding-runtime validation report, not a retrieval-quality report; provisional qrels prevent release ranking measurements."],
};
if (!Object.values(report.assertions).every(Boolean)) throw new Error(`BGE-M3 assertions failed: ${JSON.stringify(report.assertions)}`);
const path = resolve(process.argv[2] ?? "eva-datasetl/reports/bge-m3-local-v1.json");
await mkdir(resolve(path, ".."), { recursive: true });
await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

