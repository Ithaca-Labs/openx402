import { describe, expect, it } from "vitest";
import { POOL_SYSTEMS, type PoolSystem } from "../schema/schema-v2.js";
import {
  PoolSnapshotBindingV2Schema,
  RetrievalProfilesV2Schema,
  poolBindingDifferences,
  type PoolSnapshotBindingV2,
} from "./pool-snapshot-v2.js";

const A = "a".repeat(64);
const B = "b".repeat(64);

function binding(): PoolSnapshotBindingV2 {
  const systemRuns = Object.fromEntries(POOL_SYSTEMS.map(system => [system, {
    path: `runs/${system}-v2.jsonl`,
    artifact: { sha256: A, bytes: 100 },
    profile_id: `${system}-v2`,
    run_id: `run-${system}`,
    generated_at: "2026-08-07T00:00:00.000Z",
    query_count: 100,
    requested_depth: 20,
  }])) as Record<PoolSystem, unknown>;
  return PoolSnapshotBindingV2Schema.parse({
    dataset: {
      manifest_path: "manifests/dataset-v2.json",
      manifest_sha256: A,
      catalog_sha256: A,
      sidecar_sha256: A,
      queries_sha256: A,
    },
    retrieval_profiles: {
      path: "retrieval-profiles-v2.json",
      artifact: { sha256: A, bytes: 100 },
    },
    implementation_inputs: { "../src/search/service.ts": { sha256: A, bytes: 100 } },
    system_runs: systemRuns,
    pool: {
      path: "pool/pool-v2.jsonl",
      artifact: { sha256: A, bytes: 100 },
      run_id: "pool-run",
      pooled_at: "2026-08-07T00:00:00.000Z",
      record_count: 100,
      depth: 20,
    },
  });
}

describe("pool snapshot freshness", () => {
  it("detects changed catalog, profile, implementation, system run, and pool inputs", () => {
    const expected = binding();
    const actual = structuredClone(expected);
    actual.dataset.catalog_sha256 = B;
    actual.retrieval_profiles.artifact.sha256 = B;
    actual.implementation_inputs["../src/search/service.ts"]!.sha256 = B;
    actual.system_runs.hybrid.artifact.sha256 = B;
    actual.pool.artifact.sha256 = B;

    expect(poolBindingDifferences(expected, actual)).toEqual([
      "frozen dataset changed",
      "retrieval profile contract changed",
      "retrieval implementation inputs changed",
      "hybrid system run changed",
      "pool artifact changed",
    ]);
  });

  it("requires exactly one committed definition for all five systems", () => {
    const raw = {
      schema_version: "2.0.0",
      contract: "stellar-bazaar-retrieval-profiles-v2",
      pool_depth: 20,
      repool_policy: {
        catalog_change: "any-byte-change",
        query_change: "any-byte-change",
        profile_change: "any-byte-change",
        implementation_change: "any-byte-change",
        system_run_change: "any-byte-change",
        reason: "test",
      },
      implementation_inputs: ["tools/pool.ts"],
      profiles: POOL_SYSTEMS.map(system => ({
        system,
        profile_id: `${system}-v2`,
        runner: "test",
        parameters: { result_depth: 20 },
      })),
    };
    expect(RetrievalProfilesV2Schema.safeParse(raw).success).toBe(true);
    const missingBm25 = { ...raw, profiles: raw.profiles.filter(profile => profile.system !== "bm25") };
    expect(RetrievalProfilesV2Schema.safeParse(missingBm25).success).toBe(false);
  });
});
