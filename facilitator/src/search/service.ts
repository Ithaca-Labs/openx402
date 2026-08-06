import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { SearchConfig } from "../types.js";
import type { CatalogStore, DiscoveryOptions, DiscoveryRow } from "../db/catalog.js";
import type { ModelGeneration, SearchStore } from "../db/search.js";
import { toVectorLiteral } from "../db/search.js";
import type { EmbeddingProvider, ProviderHealth, RerankerProvider } from "./types.js";
import { applyOriginDiversity, compare, fuse, type FusedResult } from "./fusion.js";
import { describeSearchQuery, normalizeSearchQuery, type SearchQueryShape } from "./query.js";

export type SearchMode = "lexical" | "semantic" | "hybrid";

export interface SearchRequest extends Omit<DiscoveryOptions, "query" | "language"> {
  query: string;
  /** Requested mode. The effective mode may degrade; see `DegradationReport`. */
  mode?: SearchMode;
}

/** Exactly what happened to each optional branch. Surfaced in metrics and eval. */
export interface DegradationReport {
  requestedMode: SearchMode;
  effectiveMode: SearchMode;
  lexical: "used" | "disabled";
  semantic: "used" | "disabled" | "unavailable" | "timeout" | "error" | "empty";
  reranking: "used" | "disabled" | "unavailable" | "timeout" | "error" | "skipped";
  detail?: string | undefined;
  latencyMs: number;
  semanticLatencyMs?: number;
  rerankLatencyMs?: number;
  /** Retrieval diagnostics retained for evaluation and operational analytics. */
  candidateCounts: {
    lexical: number;
    semantic: number;
    fused: number;
    reranked: number;
  };
  queryShape: SearchQueryShape;
}

export interface SearchResult {
  rows: DiscoveryRow[];
  total: number;
  partialResults: boolean;
  degraded: DegradationReport;
  sessionId: string;
  generationId?: number;
  scores: Map<number, number>;
}

function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<{ value?: T; outcome: "ok" | "timeout" | "error"; error?: unknown; ms: number }> {
  const controller = new AbortController();
  const started = Date.now();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  return work(controller.signal)
    .then(value => ({ value, outcome: "ok" as const, ms: Date.now() - started }))
    .catch(error => ({
      outcome: controller.signal.aborted ? ("timeout" as const) : ("error" as const),
      error,
      ms: Date.now() - started,
    }))
    .finally(() => clearTimeout(timer));
}

/**
 * Hybrid retrieval.
 *
 * The pipeline is: structured filters → PostgreSQL FTS candidates → vector
 * candidates (when available) → weighted RRF → optional reranking of the top k →
 * deterministic tie-break. Every optional stage degrades independently and is
 * reported; search never fails because a model is missing.
 */
export class SearchService {
  constructor(
    private readonly config: SearchConfig,
    private readonly catalog: CatalogStore,
    private readonly store: SearchStore,
    private readonly embedder?: EmbeddingProvider,
    private readonly reranker?: RerankerProvider,
  ) {}

  async search(request: SearchRequest): Promise<SearchResult> {
    const started = Date.now();
    const requestedMode = request.mode ?? (this.config.semantic.enabled ? "hybrid" : "lexical");
    const queryShape = describeSearchQuery(request.query);
    const degraded: DegradationReport = {
      requestedMode,
      effectiveMode: "lexical",
      lexical: "disabled",
      semantic: "disabled",
      reranking: "disabled",
      latencyMs: 0,
      candidateCounts: { lexical: 0, semantic: 0, fused: 0, reranked: 0 },
      queryShape,
    };

    const scoped: DiscoveryOptions & { candidateCount: number } = {
      ...request,
      query: request.query,
      language: this.config.lexical.language,
      candidateCount: this.config.lexical.candidateCount,
    };

    const wantsLexical = this.config.lexical.enabled && requestedMode !== "semantic";
    const lexical = wantsLexical ? await this.catalog.lexicalCandidates(scoped) : [];
    degraded.candidateCounts.lexical = lexical.length;
    if (wantsLexical) degraded.lexical = "used";

    const semantic = requestedMode === "lexical"
      ? []
      : await this.semanticCandidates(request, degraded);
    degraded.candidateCounts.semantic = semantic.length;

    const branches = [
      ...(lexical.length > 0 ? [{ name: "lexical", weight: this.config.lexical.weight, candidates: lexical }] : []),
      ...(semantic.length > 0 ? [{ name: "semantic", weight: this.config.semantic.weight, candidates: semantic }] : []),
    ];
    degraded.effectiveMode = branches.length === 2
      ? "hybrid"
      : branches[0]?.name === "semantic" ? "semantic" : "lexical";

    let fused = fuse(branches, this.config.rrfK);
    if (this.config.minimumRelevanceScore > 0) {
      fused = fused.filter(entry => entry.score >= this.config.minimumRelevanceScore);
    }
    degraded.candidateCounts.fused = fused.length;

    fused = await this.rerank(request.query, fused, degraded);
    // Rerankers replace the fused score. Re-apply the configured threshold to
    // the score that is actually returned, otherwise a low-confidence reranked
    // result can violate threshold soundness (§12.4 invariant 2).
    if (this.config.minimumRelevanceScore > 0) {
      fused = fused.filter(entry => entry.score >= this.config.minimumRelevanceScore);
    }

    const origins = await this.catalog.origins(fused.map(entry => entry.resourceId));
    fused = applyOriginDiversity(fused, origins, this.config.originDiversityLimit);

    const total = fused.length;
    const page = fused.slice(request.offset, request.offset + request.limit);
    const hydrated = await this.catalog.hydrate(page.map(entry => entry.versionId), request.snapshot);
    const rows: DiscoveryRow[] = [];
    let dropped = 0;
    for (const entry of page) {
      const row = hydrated.get(entry.versionId);
      if (row) rows.push(row);
      else dropped += 1;
    }

    degraded.latencyMs = Date.now() - started;
    return {
      rows,
      total,
      // A page is partial when more results remain, when a candidate vanished
      // between ranking and hydration, or when an enabled branch degraded.
      partialResults: request.offset + page.length < total
        || dropped > 0
        || degraded.semantic === "timeout" || degraded.semantic === "error"
        || degraded.semantic === "unavailable"
        || degraded.reranking === "timeout" || degraded.reranking === "error"
        || degraded.reranking === "unavailable",
      degraded,
      sessionId: randomUUID(),
      ...(this.generation ? { generationId: this.generation.id } : {}),
      scores: new Map(page.map(entry => [entry.versionId, entry.score])),
    };
  }

  private generation: ModelGeneration | undefined;

  /** Caches the active generation so a search does not re-read it every call. */
  async refreshGeneration(): Promise<ModelGeneration | undefined> {
    this.generation = await this.store.activeGeneration();
    return this.generation;
  }

  private async semanticCandidates(
    request: SearchRequest,
    degraded: DegradationReport,
  ): Promise<Array<{ resourceId: number; versionId: number }>> {
    if (!this.config.semantic.enabled || !this.embedder) {
      degraded.semantic = "disabled";
      return [];
    }
    if (degraded.queryShape.normalizedLength === 0 || degraded.queryShape.stopwordOnly) {
      degraded.semantic = "empty";
      return [];
    }
    if (!await this.store.hasVectorSupport()) {
      degraded.semantic = "unavailable";
      degraded.detail = "pgvector is not installed; serving lexical results";
      return [];
    }
    const generation = this.generation ?? await this.refreshGeneration();
    if (!generation) {
      degraded.semantic = "unavailable";
      degraded.detail = "no active embedding generation; serving lexical results";
      return [];
    }
    const embedded = await withTimeout(
      signal => this.embedder!.embed([normalizeSearchQuery(request.query)], signal),
      this.config.semantic.timeoutMs,
    );
    degraded.semanticLatencyMs = embedded.ms;
    if (embedded.outcome !== "ok" || !embedded.value?.[0]) {
      degraded.semantic = embedded.outcome === "timeout" ? "timeout" : "error";
      degraded.detail = embedded.error instanceof Error ? embedded.error.message : degraded.detail;
      return [];
    }
    const vector = embedded.value[0];
    if (vector.length !== generation.dimension) {
      degraded.semantic = "error";
      degraded.detail = `query embedding dimension ${vector.length} does not match generation ${generation.id} (${generation.dimension})`;
      return [];
    }
    const candidates = await this.catalog.semanticCandidates(
      { ...request, query: undefined, candidateCount: this.config.semantic.candidateCount },
      toVectorLiteral(vector),
      generation,
    );
    // A nearest-neighbour index always returns rows, even for an unrelated
    // query. Apply the fixed guard when lexical retrieval has no evidence at
    // all; once the catalog has lexical evidence, the semantic pool is allowed
    // to broaden recall and fusion keeps its contribution bounded by weight.
    const hasLexicalEvidence = degraded.candidateCounts.lexical > 0;
    const confident = hasLexicalEvidence
      ? candidates
      : candidates.filter(candidate => candidate.distance <= this.config.semantic.maxDistance);
    degraded.semantic = confident.length > 0 ? "used" : "empty";
    return confident.map(({ resourceId, versionId }) => ({ resourceId, versionId }));
  }

  private async rerank(
    query: string,
    fused: FusedResult[],
    degraded: DegradationReport,
  ): Promise<FusedResult[]> {
    if (!this.config.reranking.enabled || !this.reranker) {
      degraded.reranking = "disabled";
      return fused;
    }
    if (fused.length === 0) {
      degraded.reranking = "skipped";
      return fused;
    }
    const health: ProviderHealth = await this.reranker.health()
      .catch(error => ({ status: "degraded" as const, detail: error instanceof Error ? error.message : "reranker health probe failed" }));
    if (health.status !== "ready") {
      degraded.reranking = "unavailable";
      degraded.detail = health.detail ?? degraded.detail;
      // `fallback_to_hybrid` decides whether an unusable reranker still returns
      // fused results or nothing at all.
      return this.config.reranking.fallbackToHybrid ? fused : [];
    }
    const head = fused.slice(0, this.config.reranking.topK);
    const tail = fused.slice(this.config.reranking.topK);
    degraded.candidateCounts.reranked = head.length;
    const documents = await this.catalog.documents(head.map(entry => entry.versionId));
    const texts = head.map(entry => documents.get(entry.versionId) ?? "");
    const scored = await withTimeout(
      signal => this.reranker!.rerank(normalizeSearchQuery(query), texts, signal),
      this.config.reranking.timeoutMs,
    );
    degraded.rerankLatencyMs = scored.ms;
    if (scored.outcome !== "ok" || !scored.value) {
      degraded.reranking = scored.outcome === "timeout" ? "timeout" : "error";
      degraded.detail = scored.error instanceof Error ? scored.error.message : degraded.detail;
      return this.config.reranking.fallbackToHybrid ? fused : [];
    }
    degraded.reranking = "used";
    const byIndex = new Map(scored.value.map(entry => [entry.index, entry.score]));
    const reranked = head
      .map((entry, index) => ({ ...entry, score: byIndex.get(index) ?? 0 }))
      .sort(compare);
    // The tail keeps its fused order but must never outrank a reranked result.
    return [...reranked, ...tail];
  }
}

/** Persists what was shown, so ranking quality can be measured after the fact. */
export class ImpressionRecorder {
  constructor(
    private readonly pool: Pool,
    private readonly config: SearchConfig,
  ) {}

  async record(args: {
    sessionId: string; query: string; result: SearchResult; rows: DiscoveryRow[];
  }): Promise<void> {
    if (!this.config.impressions.enabled || args.rows.length === 0) return;
    const queryHash = Buffer.from(args.query).toString("base64url").slice(0, 64);
    const rankingConfig = {
      rrfK: this.config.rrfK,
      lexicalWeight: this.config.lexical.weight,
      semanticWeight: this.config.semantic.weight,
      minimumRelevanceScore: this.config.minimumRelevanceScore,
      rerankTopK: this.config.reranking.topK,
    };
    const values: unknown[] = [];
    const tuples = args.rows.map((row, index) => {
      const base = values.length;
      values.push(
        args.sessionId, queryHash,
        this.config.impressions.retainQueryText ? args.query.slice(0, 512) : null,
        args.result.degraded.effectiveMode, args.result.degraded.reranking === "used",
        args.result.generationId ?? null, JSON.stringify(rankingConfig),
        row.resourceId, row.versionId, index + 1,
        args.result.scores.get(row.versionId) ?? 0,
        JSON.stringify(args.result.degraded), args.result.degraded.latencyMs,
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13})`;
    });
    await this.pool.query(
      `INSERT INTO search_impressions(
         session_id, query_hash, query_text, mode, reranked, generation_id, ranking_config,
         resource_id, version_id, position, score, degraded, latency_ms)
       VALUES ${tuples.join(",")}`,
      values,
    );
  }

  async prune(): Promise<number> {
    const result = await this.pool.query(
      "DELETE FROM search_impressions WHERE created_at < now() - ($1 * interval '1 day')",
      [this.config.impressions.retentionDays],
    );
    return result.rowCount ?? 0;
  }
}
