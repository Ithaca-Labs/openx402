export interface ReleaseProfileGateInput {
  name: string;
  reranked: boolean;
  rerankerExecutionRate: number;
  hardFilterViolationRate: number;
  evaluationConstraintViolationRate: number;
  adversarialTop1Rate: number;
  providerFallbacks: number;
  release: {
    recallAt20: number;
    ndcgAt5: number;
    noResultAccuracy: number;
    p95LatencyMs: number;
  };
}

export interface ReleaseGateInput {
  profiles: ReleaseProfileGateInput[];
  indexedEmbeddings: number;
  expectedEmbeddings: number;
  embeddingFailures: number;
  humanCalibrationPassed: boolean;
  releaseQueriesCurated: boolean;
  minimumRelevanceScoreConfigured: boolean;
  hybridP95LimitMs: number;
  rerankerP95LimitMs: number;
}

export function evaluateReleaseGates(input: ReleaseGateInput): Record<string, boolean> {
  const lexical = input.profiles.find(profile => profile.name === "lexical");
  const hybrid = input.profiles.find(profile => profile.name === "hybrid-rrf");
  const reranked = input.profiles.find(profile => profile.name === "hybrid+reranker");
  const all = input.profiles;

  return {
    release_queries_are_curated: input.releaseQueriesCurated,
    human_calibration_passed: input.humanCalibrationPassed,
    embedding_index_complete: input.indexedEmbeddings === input.expectedEmbeddings,
    embedding_failures_zero: input.embeddingFailures === 0,
    production_hard_filter_violations_zero: all.every(profile => profile.hardFilterViolationRate === 0),
    evaluation_constraint_violations_zero: all.every(profile => profile.evaluationConstraintViolationRate === 0),
    provider_fallbacks_zero: all.every(profile => profile.providerFallbacks === 0),
    no_result_threshold_configured: input.minimumRelevanceScoreConfigured,
    hybrid_beats_lexical_ndcg_at_5: Boolean(lexical && hybrid && hybrid.release.ndcgAt5 > lexical.release.ndcgAt5),
    hybrid_beats_lexical_recall_at_20: Boolean(lexical && hybrid && hybrid.release.recallAt20 > lexical.release.recallAt20),
    reranker_executed: Boolean(reranked?.reranked && reranked.rerankerExecutionRate === 1),
    reranker_matches_hybrid_ndcg_at_5: Boolean(hybrid && reranked && reranked.release.ndcgAt5 >= hybrid.release.ndcgAt5),
    reranker_matches_hybrid_recall_at_20: Boolean(hybrid && reranked && reranked.release.recallAt20 >= hybrid.release.recallAt20),
    hybrid_no_result_accuracy_perfect: hybrid?.release.noResultAccuracy === 1,
    reranker_no_result_accuracy_perfect: reranked?.release.noResultAccuracy === 1,
    hybrid_adversarial_top1_rate_zero: hybrid?.adversarialTop1Rate === 0,
    reranker_adversarial_top1_rate_zero: reranked?.adversarialTop1Rate === 0,
    hybrid_p95_within_limit: Boolean(hybrid && hybrid.release.p95LatencyMs <= input.hybridP95LimitMs),
    reranker_p95_within_limit: Boolean(reranked && reranked.release.p95LatencyMs <= input.rerankerP95LimitMs),
  };
}
