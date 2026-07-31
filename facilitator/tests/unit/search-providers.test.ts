import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FailingEmbeddingProvider, FakeEmbeddingProvider, FakeRerankerProvider,
} from "../../src/search/providers/fake.js";
import { LocalEmbeddingProvider, LocalRerankerProvider } from "../../src/search/providers/local.js";
import { RemoteEmbeddingProvider, RemoteRerankerProvider } from "../../src/search/providers/remote.js";
import { createEmbeddingProvider, createRerankerProvider } from "../../src/search/providers/index.js";
import { ProviderUnavailableError, validateVectors } from "../../src/search/types.js";
import { searchConfig } from "../helpers/bazaar.js";

describe("deterministic fake providers", () => {
  const provider = new FakeEmbeddingProvider(64);

  it("produces identical vectors for identical text", async () => {
    const [first] = await provider.embed(["current weather for a city"]);
    const [second] = await provider.embed(["current weather for a city"]);
    expect(first).toEqual(second);
  });

  it("produces unit vectors of the declared dimension", async () => {
    const [vector] = await provider.embed(["weather forecast"]);
    expect(vector).toHaveLength(64);
    const norm = Math.sqrt(vector!.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 10);
  });

  it("places overlapping documents closer than unrelated ones", async () => {
    const [weather, forecast, finance] = await provider.embed([
      "weather forecast for a city",
      "weather conditions and forecast",
      "stock ticker fundamentals valuation",
    ]);
    const dot = (left: number[], right: number[]): number =>
      left.reduce((sum, value, index) => sum + value * right[index]!, 0);
    expect(dot(weather!, forecast!)).toBeGreaterThan(dot(weather!, finance!));
  });

  it("scores reranking by token overlap, deterministically", async () => {
    const reranker = new FakeRerankerProvider();
    const scores = await reranker.rerank("weather forecast", [
      "weather forecast for a city",
      "stock ticker fundamentals",
    ]);
    expect(scores[0]!.score).toBeGreaterThan(scores[1]!.score);
    expect(await reranker.rerank("weather forecast", ["weather forecast for a city"]))
      .toEqual([{ index: 0, score: expect.any(Number) }]);
  });

  it("reports its failure reason rather than throwing at health time", async () => {
    const failing = new FailingEmbeddingProvider("model file is missing");
    expect(await failing.health()).toEqual({ status: "degraded", detail: "model file is missing" });
    await expect(failing.embed()).rejects.toThrow("model file is missing");
  });
});

describe("dimension validation", () => {
  it("rejects a wrong dimension, a wrong count and a non-finite value", () => {
    expect(() => validateVectors([[1, 2, 3]], 4, 1)).toThrow(ProviderUnavailableError);
    expect(() => validateVectors([[1, 2]], 2, 2)).toThrow(/returned 1 vectors for 2 inputs/);
    expect(() => validateVectors([[1, Number.NaN]], 2, 1)).toThrow(/non-finite/);
    expect(() => validateVectors([[1, 2]], 2, 1)).not.toThrow();
  });
});

describe("local providers without the optional runtime", () => {
  it("reports the exact missing runtime instead of crashing", async () => {
    const provider = new LocalEmbeddingProvider({
      cacheDir: "/nonexistent", offline: true, dtype: "q8",
      modelId: "BAAI/bge-m3", repo: "Xenova/bge-m3", revision: "0".repeat(40),
      dimension: 1024, pooling: "cls", normalization: "l2",
    });
    const health = await provider.health();
    expect(health.status).toBe("degraded");
    const warmed = await provider.warm();
    expect(warmed.status).toBe("degraded");
    // Either the runtime is absent or the pinned artifact cannot be loaded
    // offline; both must name the concrete requirement.
    expect(warmed.detail).toMatch(/@huggingface\/transformers|failed to load/);
    expect(provider.identity).toMatchObject({
      modelId: "BAAI/bge-m3", dimension: 1024, pooling: "cls", normalization: "l2", provider: "local",
    });
  });

  it("explains that no ONNX export of the default reranker is published", async () => {
    const reranker = new LocalRerankerProvider({
      cacheDir: "/nonexistent", offline: true, dtype: "q8",
      modelId: "BAAI/bge-reranker-v2-m3", repo: "", revision: "0".repeat(40),
    });
    const health = await reranker.health();
    expect(health.status).toBe("degraded");
    expect(health.detail).toContain("no ONNX export of BAAI/bge-reranker-v2-m3");
    expect(health.detail).toContain("search.reranking.repo");
    await expect(reranker.rerank("q", ["d"])).rejects.toThrow(ProviderUnavailableError);
  });
});

describe("remote providers", () => {
  let server: Server;
  let base: string;
  let lastBody: Record<string, unknown> = {};
  let mode: "ok" | "slow" | "bad" | "error" = "ok";

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", chunk => { raw += chunk; });
      req.on("end", () => {
        lastBody = JSON.parse(raw || "{}");
        const respond = (): void => {
          if (mode === "error") {
            res.writeHead(503).end("upstream down");
            return;
          }
          res.setHeader("content-type", "application/json");
          if (req.url === "/embeddings") {
            const input = (lastBody.input as string[]) ?? [];
            res.end(JSON.stringify(mode === "bad"
              ? { data: input.map((_, index) => ({ index, embedding: [1, 2] })) }
              : { data: input.map((_, index) => ({ index, embedding: [index, 1, 0, 0] })) }));
            return;
          }
          const documents = (lastBody.documents as string[]) ?? [];
          res.end(JSON.stringify(mode === "bad"
            ? { results: [{ index: 99, relevance_score: 1 }] }
            : { results: documents.map((_, index) => ({ index, relevance_score: 1 - index / 10 })) }));
        };
        if (mode === "slow") setTimeout(respond, 300);
        else respond();
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const embedder = (timeoutMs = 2_000): RemoteEmbeddingProvider => new RemoteEmbeddingProvider({
    url: `${base}/embeddings`, timeoutMs, modelId: "vendor/model", modelRevision: "2024-01",
    dimension: 4, pooling: "mean", normalization: "l2",
  });

  it("sends the model and input and preserves input order", async () => {
    mode = "ok";
    const vectors = await embedder().embed(["a", "b"]);
    expect(lastBody).toMatchObject({ model: "vendor/model", input: ["a", "b"] });
    expect(vectors).toEqual([[0, 1, 0, 0], [1, 1, 0, 0]]);
  });

  it("rejects a response whose dimension disagrees with the configuration", async () => {
    mode = "bad";
    await expect(embedder().embed(["a"])).rejects.toThrow(/dimension 2, expected 4/);
  });

  it("aborts on the configured timeout", async () => {
    mode = "slow";
    await expect(embedder(50).embed(["a"])).rejects.toThrow();
  });

  it("surfaces an upstream failure as an unavailable provider", async () => {
    mode = "error";
    await expect(embedder().embed(["a"])).rejects.toThrow(/returned 503/);
  });

  it("reranks through the documents/results convention", async () => {
    mode = "ok";
    const reranker = new RemoteRerankerProvider({
      url: `${base}/rerank`, timeoutMs: 2_000, modelId: "vendor/rerank", modelRevision: "1",
    });
    const scored = await reranker.rerank("weather", ["a", "b"]);
    expect(lastBody).toMatchObject({ query: "weather", documents: ["a", "b"] });
    expect(scored).toEqual([{ index: 0, score: 1 }, { index: 1, score: 0.9 }]);

    mode = "bad";
    await expect(reranker.rerank("weather", ["a"])).rejects.toThrow(/malformed/);
  });

  it("reports a missing URL as degraded rather than throwing", async () => {
    const provider = new RemoteEmbeddingProvider({
      url: "", timeoutMs: 100, modelId: "m", modelRevision: "1",
      dimension: 4, pooling: "mean", normalization: "l2",
    });
    expect(await provider.health()).toMatchObject({ status: "degraded" });
  });
});

describe("provider factory", () => {
  it("returns nothing when semantic search or reranking is switched off", () => {
    const config = searchConfig({
      semantic: { ...searchConfig().semantic, enabled: false },
    });
    expect(createEmbeddingProvider(config)).toBeUndefined();
    expect(createRerankerProvider(searchConfig())).toBeUndefined();
  });

  it("builds the provider named in configuration", () => {
    const base = searchConfig();
    expect(createEmbeddingProvider(base)?.identity.provider).toBe("fake");
    expect(createEmbeddingProvider({
      ...base, semantic: { ...base.semantic, provider: "local" },
    })?.identity.provider).toBe("local");
    expect(createRerankerProvider({
      ...base, reranking: { ...base.reranking, enabled: true },
    })?.identity.provider).toBe("fake");
    expect(createRerankerProvider({
      ...base, reranking: { ...base.reranking, enabled: true, provider: "local" },
    })?.identity.provider).toBe("local");
  });
});
