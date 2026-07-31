import { createHash } from "node:crypto";
import type {
  EmbeddingIdentity, EmbeddingProvider, ProviderHealth, RerankResult, RerankerProvider,
} from "../types.js";

/**
 * Deterministic providers for tests and evaluation.
 *
 * These are not a model. They are a fixed, seeded projection of the token set of
 * a document, which makes the whole pipeline — queue, dimension validation,
 * storage, fusion, reranking, degradation — testable without downloading
 * weights or reaching a network. They are never selectable in a production
 * profile: `search.semantic.provider: fake` is rejected unless
 * `FACILITATOR_ALLOW_FAKE_PROVIDERS` is set, which the test harness does.
 */

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Hashes a token to a stable slot and sign, so identical text always maps identically. */
function project(token: string, dimension: number): { slot: number; sign: number } {
  const digest = createHash("sha256").update(token).digest();
  const slot = digest.readUInt32BE(0) % dimension;
  const sign = (digest[4]! & 1) === 0 ? 1 : -1;
  return { slot, sign };
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly identity: EmbeddingIdentity;

  constructor(dimension = 64, modelId = "fake/deterministic-hash", revision = "v1") {
    this.identity = {
      modelId, modelRevision: revision, dimension,
      pooling: "mean", normalization: "l2", provider: "fake",
    };
  }

  async health(): Promise<ProviderHealth> {
    return { status: "ready" };
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(text => {
      const vector = new Array<number>(this.identity.dimension).fill(0);
      const words = tokens(text);
      for (const word of words) {
        const { slot, sign } = project(word, this.identity.dimension);
        vector[slot] = vector[slot]! + sign;
        // A second slot per token reduces collisions enough for fixtures.
        const second = project(`${word}#2`, this.identity.dimension);
        vector[second.slot] = vector[second.slot]! + second.sign * 0.5;
      }
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
      return norm === 0 ? vector.map(() => 0) : vector.map(value => value / norm);
    });
  }
}

/**
 * Deterministic reranker: Jaccard overlap between query and document tokens.
 * It has no model behaviour, but it is stable, monotone in overlap and enough to
 * assert that reranking actually reorders and that lift is measured.
 */
export class FakeRerankerProvider implements RerankerProvider {
  readonly identity = {
    modelId: "fake/token-overlap", modelRevision: "v1", provider: "fake",
  };

  async health(): Promise<ProviderHealth> {
    return { status: "ready" };
  }

  async rerank(query: string, documents: string[]): Promise<RerankResult[]> {
    const needle = new Set(tokens(query));
    return documents.map((document, index) => {
      const haystack = new Set(tokens(document));
      let shared = 0;
      for (const token of needle) if (haystack.has(token)) shared += 1;
      const union = needle.size + haystack.size - shared;
      return { index, score: union === 0 ? 0 : shared / union };
    });
  }
}

/** Provider that always fails, used to prove the degradation paths. */
export class FailingEmbeddingProvider implements EmbeddingProvider {
  readonly identity: EmbeddingIdentity;

  constructor(private readonly reason: string, dimension = 64) {
    this.identity = {
      modelId: "fake/failing", modelRevision: "v1", dimension,
      pooling: "mean", normalization: "l2", provider: "fake",
    };
  }

  async health(): Promise<ProviderHealth> {
    return { status: "degraded", detail: this.reason };
  }

  async embed(): Promise<number[][]> {
    throw new Error(this.reason);
  }
}
