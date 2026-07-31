import type {
  EmbeddingIdentity, EmbeddingProvider, ProviderHealth, RerankIdentity,
  RerankResult, RerankerProvider,
} from "../types.js";
import { ProviderUnavailableError, validateVectors } from "../types.js";

/**
 * Generic HTTP providers.
 *
 * No vendor is hardcoded. The operator supplies a URL and an optional bearer
 * token through environment variables; the request and response shapes are the
 * two de-facto conventions (an `{input, model}` → `{data:[{embedding}]}`
 * embeddings endpoint and a `{query, documents}` → `{results:[{index,
 * relevance_score}]}` rerank endpoint). Both calls are bounded by a timeout and
 * a response-size cap, and a failure degrades search rather than breaking it.
 */

const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export interface RemoteProviderConfig {
  url: string;
  apiKey?: string;
  timeoutMs: number;
  modelId: string;
  modelRevision: string;
}

async function post(
  config: RemoteProviderConfig,
  body: unknown,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("provider timeout")), config.timeoutMs);
  const onAbort = (): void => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ProviderUnavailableError(
        `remote provider returned ${response.status} ${response.statusText}`,
      );
    }
    const size = Number(response.headers.get("content-length") ?? 0);
    if (size > MAX_RESPONSE_BYTES) {
      throw new ProviderUnavailableError("remote provider response exceeded the size cap");
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new ProviderUnavailableError("remote provider response exceeded the size cap");
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export interface RemoteEmbeddingConfig extends RemoteProviderConfig {
  dimension: number;
  pooling: "cls" | "mean";
  normalization: "l2" | "none";
}

export class RemoteEmbeddingProvider implements EmbeddingProvider {
  readonly identity: EmbeddingIdentity;

  constructor(private readonly config: RemoteEmbeddingConfig) {
    this.identity = {
      modelId: config.modelId,
      modelRevision: config.modelRevision,
      dimension: config.dimension,
      pooling: config.pooling,
      normalization: config.normalization,
      provider: "remote",
    };
  }

  async health(): Promise<ProviderHealth> {
    if (!this.config.url) {
      return { status: "degraded", detail: "search.semantic.remote_url_env resolved to no URL" };
    }
    return { status: "ready", detail: `remote endpoint ${new URL(this.config.url).origin}` };
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) return [];
    const payload = await post(this.config, { input: texts, model: this.config.modelId }, signal) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
      embeddings?: number[][];
    };
    const vectors = payload.embeddings
      ?? (payload.data ?? [])
        .slice()
        .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
        .map(entry => entry.embedding ?? []);
    validateVectors(vectors, this.config.dimension, texts.length);
    return vectors;
  }
}

export class RemoteRerankerProvider implements RerankerProvider {
  readonly identity: RerankIdentity;

  constructor(private readonly config: RemoteProviderConfig) {
    this.identity = {
      modelId: config.modelId, modelRevision: config.modelRevision, provider: "remote",
    };
  }

  async health(): Promise<ProviderHealth> {
    if (!this.config.url) {
      return { status: "degraded", detail: "search.reranking.remote_url_env resolved to no URL" };
    }
    return { status: "ready", detail: `remote endpoint ${new URL(this.config.url).origin}` };
  }

  async rerank(query: string, documents: string[], signal?: AbortSignal): Promise<RerankResult[]> {
    if (documents.length === 0) return [];
    const payload = await post(
      this.config, { model: this.config.modelId, query, documents, top_n: documents.length }, signal,
    ) as { results?: Array<{ index?: number; relevance_score?: number; score?: number }> };
    const results = payload.results ?? [];
    if (results.length === 0) {
      throw new ProviderUnavailableError("remote reranker returned no results");
    }
    return results.map(entry => {
      const index = entry.index ?? 0;
      const score = entry.relevance_score ?? entry.score;
      if (index < 0 || index >= documents.length || typeof score !== "number" || !Number.isFinite(score)) {
        throw new ProviderUnavailableError("remote reranker returned a malformed result");
      }
      return { index, score };
    });
  }
}
