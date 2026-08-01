import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { agreement } from "../../src/search/release/agreement.js";
import { validateReleaseDataset } from "../../src/search/release/validate.js";

describe("release search benchmark", () => {
  it("validates the checked-in 300 x 100 dataset and complete pair matrix", async () => {
    const dataset = await validateReleaseDataset(resolve("eva-datasetl"));
    expect(dataset.catalog).toHaveLength(300);
    expect(dataset.queries).toHaveLength(100);
    expect(dataset.qrels).toHaveLength(30_000);
    expect(new Set(dataset.sidecars.map(value => value.provider_id)).size).toBe(50);
    expect(dataset.qrels.every(value => value.provisional)).toBe(true);
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
});
