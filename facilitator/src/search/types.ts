/**
 * Provider contracts for semantic search.
 *
 * Every provider is optional. A provider that is unavailable reports why and the
 * search path degrades: reranking falls back to hybrid, embeddings fall back to
 * PostgreSQL full-text search. Search never fails because a model is absent.
 */

export interface ProviderHealth {
  /** `ready` when the provider can serve; `degraded` when it is configured but unusable. */
  status: "ready" | "degraded" | "disabled";
  /** Exact, actionable reason when not ready. Surfaced in `/health/ready` detail. */
  detail?: string;
}

export interface EmbeddingIdentity {
  /** Logical model identity recorded on every vector, e.g. `BAAI/bge-m3`. */
  modelId: string;
  /** Immutable revision: a commit sha for local weights, a version for a remote API. */
  modelRevision: string;
  dimension: number;
  pooling: "cls" | "mean";
  normalization: "l2" | "none";
  provider: string;
  /** Optional artifact checksum when the provider can verify one. */
  checksum?: string;
}

export interface EmbeddingProvider {
  readonly identity: EmbeddingIdentity;
  /** Cheap, non-throwing readiness probe. Must not download anything. */
  health(): Promise<ProviderHealth>;
  /**
   * Embeds a batch of already-compiled, human-readable documents.
   *
   * Implementations must return one vector per input, in input order, each of
   * exactly `identity.dimension` elements. Callers validate this.
   */
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
  close?(): Promise<void>;
}

export interface RerankIdentity {
  modelId: string;
  modelRevision: string;
  provider: string;
}

export interface RerankResult {
  /** Index into the input `documents` array. */
  index: number;
  score: number;
}

export interface RerankerProvider {
  readonly identity: RerankIdentity;
  health(): Promise<ProviderHealth>;
  /** Scores each document against the query. Order of the result is not significant. */
  rerank(query: string, documents: string[], signal?: AbortSignal): Promise<RerankResult[]>;
  close?(): Promise<void>;
}

/** Thrown when a provider is configured but its runtime cannot be used. */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export function validateVectors(vectors: number[][], expected: number, count: number): void {
  if (vectors.length !== count) {
    throw new ProviderUnavailableError(
      `embedding provider returned ${vectors.length} vectors for ${count} inputs`,
    );
  }
  for (const vector of vectors) {
    if (vector.length !== expected) {
      throw new ProviderUnavailableError(
        `embedding provider returned dimension ${vector.length}, expected ${expected}`,
      );
    }
    for (const value of vector) {
      if (!Number.isFinite(value)) {
        throw new ProviderUnavailableError("embedding provider returned a non-finite value");
      }
    }
  }
}
