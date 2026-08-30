import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { agreement } from "../../src/search/release/agreement.js";
import { buildCalibrationSample } from "../../src/search/release/calibration.js";
import { evaluateReleaseGates, type ReleaseProfileGateInput } from "../../src/search/release/gates.js";
import { validateReleaseDataset } from "../../src/search/release/validate.js";

// The 300 x 100 release dataset is a ~7 MB branch-local artifact carried by
// `full-stack`, and it cannot be rebuilt from a services-only checkout: the
// generator reads raw provider snapshots that stay out of version control. A
// checkout without it skips this case rather than failing on a fixture it is
// not meant to hold; the gate and agreement cases below need no dataset.
const datasetRoot = resolve("eval-dataset");
const datasetPresent = existsSync(resolve(datasetRoot, "manifests/dataset-v1.json"));

describe("release search benchmark", () => {
  it.skipIf(!datasetPresent)("validates the checked-in 300 x 100 dataset and complete pair matrix", async () => {
    const dataset = await validateReleaseDataset(datasetRoot);
    expect(dataset.catalog).toHaveLength(300);
    expect(dataset.queries).toHaveLength(100);
    expect(dataset.qrels).toHaveLength(30_000);
    expect(new Set(dataset.sidecars.map(value => value.provider_id)).size).toBe(50);
    expect(dataset.qrels.every(value => value.provisional)).toBe(true);
    expect(dataset.catalog.every(value => value.wire.accepts.every(option => option.scheme === "exact"))).toBe(true);
    expect(dataset.catalog.filter(value => value.wire.accepts.length > 1).length).toBeGreaterThanOrEqual(50);
    expect(dataset.catalog.filter(value => value.wire.accepts.some(option => option.payTo.startsWith("C"))).length).toBeGreaterThanOrEqual(50);
    expect(dataset.queries.filter(value => value.split === "release").every(value => value.derived_from.kind === "curated")).toBe(true);

    const calibration = buildCalibrationSample(dataset.qrels, dataset.queries, 400);
    const pair = new Map(dataset.qrels.map(value => [`${value.query_id}\0${value.resource_id}`, value]));
    const query = new Map(dataset.queries.map(value => [value.query_id, value]));
    expect(calibration).toHaveLength(400);
    expect(new Set(calibration.map(value => query.get(value.query_id)?.query_class)).size).toBe(7);
    expect(new Set(calibration.map(value => pair.get(`${value.query_id}\0${value.resource_id}`)?.eligible))).toEqual(new Set([true, false]));
  });

  it("computes quadratic weighted kappa and disagreement rates", () => {
    const perfect = agreement(Array.from({ length: 300 }, (_, index) => ({ agent: index % 4, human: index % 4 })));
    expect(perfect.weightedKappa).toBe(1);
    expect(perfect.exactAgreement).toBe(1);
    expect(perfect.passes).toBe(true);
    const severe = agreement([{ agent: 0, human: 3 }, { agent: 3, human: 0 }]);
    expect(severe.severeDisagreementRate).toBe(1);
    expect(severe.passes).toBe(false);
  });

  it("requires explicit boolean release quality gates", () => {
    const profile = (
      name: string,
      overrides: Partial<ReleaseProfileGateInput> = {},
    ): ReleaseProfileGateInput => ({
      name, reranked: name === "hybrid+reranker", rerankerExecutionRate: name === "hybrid+reranker" ? 1 : 0,
      hardFilterViolationRate: 0, evaluationConstraintViolationRate: 0,
      adversarialTop1Rate: 0, providerFallbacks: 0,
      release: { recallAt20: 0.8, ndcgAt5: 0.8, noResultAccuracy: 1, p95LatencyMs: 100 },
      ...overrides,
    });
    const passing = evaluateReleaseGates({
      profiles: [
        profile("lexical", { release: { recallAt20: 0.6, ndcgAt5: 0.6, noResultAccuracy: 1, p95LatencyMs: 50 } }),
        profile("hybrid-rrf"), profile("hybrid+reranker", { release: { recallAt20: 0.8, ndcgAt5: 0.81, noResultAccuracy: 1, p95LatencyMs: 150 } }),
      ],
      indexedEmbeddings: 300, expectedEmbeddings: 300, embeddingFailures: 0,
      humanCalibrationPassed: true, releaseQueriesCurated: true, minimumRelevanceScoreConfigured: true,
      hybridP95LimitMs: 200, rerankerP95LimitMs: 200,
    });
    expect(Object.values(passing).every(Boolean)).toBe(true);

    const incomplete = evaluateReleaseGates({
      profiles: [profile("lexical"), profile("hybrid-rrf")],
      indexedEmbeddings: 0, expectedEmbeddings: 300, embeddingFailures: 0,
      humanCalibrationPassed: true, releaseQueriesCurated: true, minimumRelevanceScoreConfigured: true,
      hybridP95LimitMs: 200, rerankerP95LimitMs: 200,
    });
    expect(incomplete.embedding_index_complete).toBe(false);
    expect(Object.values(incomplete).every(Boolean)).toBe(false);
  });
});
