import { resolve } from "node:path";
import type { SearchConfig } from "../../types.js";
import type { EmbeddingProvider, RerankerProvider } from "../types.js";
import { FakeEmbeddingProvider, FakeRerankerProvider } from "./fake.js";
import { LocalEmbeddingProvider, LocalRerankerProvider } from "./local.js";
import { RemoteEmbeddingProvider, RemoteRerankerProvider } from "./remote.js";

export { FakeEmbeddingProvider, FailingEmbeddingProvider, FakeRerankerProvider } from "./fake.js";
export { LocalEmbeddingProvider, LocalRerankerProvider } from "./local.js";
export { RemoteEmbeddingProvider, RemoteRerankerProvider } from "./remote.js";

/**
 * Builds the configured embedding provider.
 *
 * @returns undefined when semantic search is switched off, which is a normal
 * lexical-only deployment rather than an error.
 */
export function createEmbeddingProvider(config: SearchConfig): EmbeddingProvider | undefined {
  if (!config.semantic.enabled || config.semantic.provider === "disabled") return undefined;
  const semantic = config.semantic;
  switch (semantic.provider) {
    case "fake":
      return new FakeEmbeddingProvider(semantic.dimension, semantic.modelId, semantic.revision);
    case "remote":
      return new RemoteEmbeddingProvider({
        url: semantic.remoteUrl ?? "",
        ...(semantic.remoteApiKey ? { apiKey: semantic.remoteApiKey } : {}),
        timeoutMs: semantic.timeoutMs,
        modelId: semantic.modelId,
        modelRevision: semantic.revision,
        dimension: semantic.dimension,
        pooling: semantic.pooling,
        normalization: semantic.normalization,
      });
    default:
      return new LocalEmbeddingProvider({
        cacheDir: resolve(config.models.cacheDir),
        offline: config.models.offline,
        dtype: config.models.dtype,
        modelId: semantic.modelId,
        repo: semantic.repo,
        revision: semantic.revision,
        dimension: semantic.dimension,
        pooling: semantic.pooling,
        normalization: semantic.normalization,
      });
  }
}

export function createRerankerProvider(config: SearchConfig): RerankerProvider | undefined {
  if (!config.reranking.enabled || config.reranking.provider === "disabled") return undefined;
  const reranking = config.reranking;
  switch (reranking.provider) {
    case "fake":
      return new FakeRerankerProvider();
    case "remote":
      return new RemoteRerankerProvider({
        url: reranking.remoteUrl ?? "",
        ...(reranking.remoteApiKey ? { apiKey: reranking.remoteApiKey } : {}),
        timeoutMs: reranking.timeoutMs,
        modelId: reranking.modelId,
        modelRevision: reranking.revision,
      });
    default:
      return new LocalRerankerProvider({
        cacheDir: resolve(config.models.cacheDir),
        offline: config.models.offline,
        dtype: config.models.dtype,
        modelId: reranking.modelId,
        repo: reranking.repo,
        revision: reranking.revision,
      });
  }
}
