/**
 * Live local-model tests. Not part of `npm test`.
 *
 *   npm run test:live-model
 *
 * These download real ONNX weights from Hugging Face and are excluded from
 * ordinary CI: the default suite proves the pipeline with deterministic fake
 * providers, and this proves the local ONNX runtime path itself.
 *
 * `FACILITATOR_LIVE_MODEL_REPO` selects the repository. It defaults to
 * `Xenova/all-MiniLM-L6-v2` (~25 MB) so the runtime can be verified quickly;
 * set it to `Xenova/bge-m3` with `FACILITATOR_LIVE_MODEL_DIM=1024` to exercise
 * the shipped default at its real size.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalEmbeddingProvider } from "../../src/search/providers/local.js";

const REPO = process.env.FACILITATOR_LIVE_MODEL_REPO ?? "Xenova/all-MiniLM-L6-v2";
const DIMENSION = Number(process.env.FACILITATOR_LIVE_MODEL_DIM ?? 384);
const REVISION = process.env.FACILITATOR_LIVE_MODEL_REVISION ?? "main";

let cacheDir: string;

beforeAll(async () => {
  cacheDir = process.env.FACILITATOR_LIVE_MODEL_CACHE
    ?? await mkdtemp(join(tmpdir(), "x402-models-"));
});

afterAll(async () => {
  if (!process.env.FACILITATOR_LIVE_MODEL_CACHE) {
    await rm(cacheDir, { recursive: true, force: true }).catch(() => undefined);
  }
});

function provider(dimension = DIMENSION): LocalEmbeddingProvider {
  return new LocalEmbeddingProvider({
    cacheDir, offline: false, dtype: "fp32",
    modelId: REPO, repo: REPO, revision: REVISION,
    dimension, pooling: "cls", normalization: "l2",
  });
}

describe("local ONNX embedding runtime", { timeout: 900_000 }, () => {
  it("loads the pinned model and produces normalized vectors of the declared dimension", async () => {
    const local = provider();
    const health = await local.warm();
    if (health.status !== "ready") {
      throw new Error(`local runtime unavailable: ${health.detail}`);
    }
    const vectors = await local.embed([
      "Returns current weather and forecasts for a city.",
      "Analyzes a public company using fundamentals.",
    ]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(DIMENSION);
    const norm = Math.sqrt(vectors[0]!.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 4);
  });

  it("is deterministic for identical input", async () => {
    const local = provider();
    const [first] = await local.embed(["weather forecast for a city"]);
    const [second] = await local.embed(["weather forecast for a city"]);
    expect(first).toEqual(second);
  });

  it("places related text closer than unrelated text", async () => {
    const local = provider();
    const [weather, climate, finance] = await local.embed([
      "current weather and forecast for a city",
      "climate conditions and temperature outlook",
      "stock ticker valuation and quarterly filings",
    ]);
    const dot = (left: number[], right: number[]): number =>
      left.reduce((sum, value, index) => sum + value * right[index]!, 0);
    expect(dot(weather!, climate!)).toBeGreaterThan(dot(weather!, finance!));
  });

  it("rejects a configured dimension that the model does not produce", async () => {
    const wrong = provider(DIMENSION + 1);
    await wrong.warm();
    await expect(wrong.embed(["weather"])).rejects.toThrow(/dimension/);
  });

  it("records the artifact checksum it actually loaded", async () => {
    const local = provider();
    await local.warm();
    expect(local.identity.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});
