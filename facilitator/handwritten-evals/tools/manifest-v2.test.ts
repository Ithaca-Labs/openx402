import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PUBNET_USDC,
  QUERY_CLASS_TARGETS,
  RELEASE_COUNTS,
  type CatalogRecord,
  type QueryRecord,
  type SidecarRecord,
} from "../schema/schema-v2.js";
import {
  DATASET_MANIFEST_PATH,
  DatasetManifestV2Schema,
  FROZEN_INPUT_PATHS,
  freezeDatasetV2,
  hashFile,
  RELEASE_QUERY_INDEX_PATH,
  ReleaseQueryIndexV2Schema,
} from "./manifest-v2.js";
import {
  FINAL_RELEASE_REPORT_PATH,
  recordReleaseRunEvent,
  readReleaseRunLedger,
  releaseRunEventHash,
  RELEASE_HOLDOUT_CLI_ACKNOWLEDGEMENT,
  RELEASE_HOLDOUT_ENV_ACKNOWLEDGEMENT,
  ReleaseRunLedgerEntryV2Schema,
  verifyFrozenDataset,
  versionedReleaseReportPath,
} from "./release-run-ledger-v2.js";

const PAY_TO = "GAOH2NR3A3R2VS6TUE6L75A3OMJ4UKJWEHHNL5GIIEQTS5RVZEK5LAP4";
const REVIEWED_AT = "2026-08-07T00:00:00.000Z";
const CLASS_SEQUENCE = Object.entries(QUERY_CLASS_TARGETS)
  .flatMap(([queryClass, count]) => Array.from({ length: count }, () => queryClass as QueryRecord["query_class"]));

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function catalogRecord(index: number): CatalogRecord {
  const resourceId = `res-${String(index).padStart(4, "0")}`;
  return {
    resource_id: resourceId,
    wire: {
      x402Version: 2,
      resource: {
        url: `https://resource-${String(index).padStart(4, "0")}.freeze-test.example/v1/value`,
        serviceName: `Fixture ${index}`,
        description: `Independent fixture listing number ${index}.`,
        tags: [`fixture-${index}`],
        mimeType: "application/json",
      },
      accepts: [{
        scheme: "exact",
        network: "stellar:pubnet",
        asset: PUBNET_USDC,
        amount: "0",
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
        extra: { areFeesSponsored: false },
      }],
      extensions: { bazaar: {} },
    },
  };
}

function sidecarRecord(index: number): SidecarRecord {
  const resourceId = `res-${String(index).padStart(4, "0")}`;
  const labeled = index <= 100;
  const resourceType = labeled && index > 85 ? "mcp" as const : "http" as const;
  const common = {
    resource_id: resourceId,
    authorship: "agent" as const,
    resource_type: resourceType,
    is_distractor: !labeled,
    is_sparse: false,
    adversarial_kind: null,
    provider_id: `provider-${String(((index - 1) % 120) + 1).padStart(3, "0")}`,
    generation: {
      provider: "anthropic" as const,
      model: "claude-test-revision-20260807",
      prompt_hash: `sha256:${"a".repeat(64)}`,
      run_id: `fixture-resources-${Math.ceil(index / 10)}`,
      shard_id: `fixture-shard-${Math.ceil(index / 10)}`,
      temperature: 0,
      generated_at: REVIEWED_AT,
    },
    derived_from: {
      kind: "agent_generated" as const,
      generation_id: `fixture-resources-${Math.ceil(index / 10)}`,
      rationale: `Independent test fixture ${resourceId}.`,
    },
    review_status: "approved" as const,
    reviewed_at: REVIEWED_AT,
    owner_note: null,
    family: labeled ? ((index - 1) % 20) + 1 : null,
    family_slot: labeled ? ((index - 1) % 5) + 1 : null,
    category: labeled ? "fixture-labeled" : "fixture-distractor",
    is_live: false as const,
    settlement_verified: false as const,
    asset_decimals: 7 as const,
    price_usd_snapshot: {
      value: 0,
      as_of: REVIEWED_AT,
      basis: "fixed_fixture_minimum_option_value" as const,
    },
  };
  if (!labeled) return common;
  return {
    ...common,
    axes: {
      capability: `fixture-capability-${index}`,
      resource_type: resourceType,
      input_method: resourceType === "mcp" ? "not_applicable" : "GET",
      input_shape: resourceType === "mcp" ? "tool_arguments" : "query_params",
      output_shape: "json",
      coverage: "global",
      freshness: "daily",
      price_tier: 0,
      networks: ["stellar:pubnet"],
      scheme_set: "exact_only",
      attestation: "unsigned",
    },
    ...(resourceType === "mcp" ? {
      mcp: {
        server_name: `fixture-server-${index}`,
        tool_name: `fixture-tool-${index}`,
        transport: index % 2 === 0 ? "sse" as const : "streamable-http" as const,
        tool_count: 1,
        input_schema_shape: "flat_scalars" as const,
      },
    } : {}),
  };
}

function queryRecord(index: number, splitOverride?: "development" | "release"): QueryRecord {
  const queryClass = CLASS_SEQUENCE[index - 1]!;
  const split = splitOverride ?? (index % 2 === 1 ? "development" : "release");
  const isNoResult = queryClass === "no_result";
  const mcpIndex = CLASS_SEQUENCE.slice(0, index).filter(value => value === "mcp").length - 1;
  const mcpSubtypes = ["tuple_identity", "tool_schema", "transport", "http_vs_mcp"] as const;
  return {
    query_id: `qry-${String(index).padStart(3, "0")}`,
    split,
    query_class: queryClass,
    query: `Find independent fixture capability ${index}`,
    filters: queryClass === "structured" ? { network: "stellar:pubnet" } : {},
    evaluation_constraints: queryClass === "price_category" ? { max_price_usd: 0.05 } : {},
    expects_no_result: isNoResult,
    phrasing_register: index % 3 === 0 ? "keyword_only" : index % 2 === 0 ? "verbose_natural" : "terse_agent",
    ...(queryClass === "mcp" ? { mcp_subtype: mcpSubtypes[mcpIndex % mcpSubtypes.length]! } : {}),
    family: isNoResult ? null : ((index - 1) % 20) + 1,
    ...(isNoResult ? { forbidden_capability: `absent fixture capability ${index}` } : {}),
    generation: {
      provider: "anthropic",
      model: "claude-test-revision-20260807",
      prompt_hash: `sha256:${"b".repeat(64)}`,
      run_id: `fixture-queries-${Math.ceil(index / 10)}`,
      shard_id: `fixture-query-shard-${Math.ceil(index / 10)}`,
      temperature: 0,
      generated_at: REVIEWED_AT,
    },
    derived_from: {
      kind: "agent_generated",
      generation_id: `fixture-queries-${Math.ceil(index / 10)}`,
      use_case: `Independent query fixture ${index}.`,
    },
    review_status: "approved",
    reviewed_at: REVIEWED_AT,
    owner_note: null,
  };
}

async function writeJsonl(path: string, records: unknown[]): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${records.map(record => JSON.stringify(record)).join("\n")}\n`);
}

async function datasetFixture(options: {
  resources?: number;
  splitMismatch?: boolean;
  classMismatch?: boolean;
  invalidCatalog?: boolean;
} = {}): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "stellar-v2-freeze-"));
  roots.push(root);
  const resources = options.resources ?? RELEASE_COUNTS.resources.total;
  await Promise.all(FROZEN_INPUT_PATHS
    .filter(path => !path.endsWith(".jsonl"))
    .map(async path => {
      await mkdir(resolve(root, path, ".."), { recursive: true });
      await writeFile(resolve(root, path), `fixture bytes for ${path}\n`);
    }));
  const catalog = Array.from({ length: resources }, (_, i) => catalogRecord(i + 1));
  if (options.invalidCatalog && catalog[0]) catalog[0].wire.resource.url = "https://not-reserved.invalid.test/value";
  await writeJsonl(resolve(root, "catalog/catalog-v2.jsonl"), catalog);
  await writeJsonl(resolve(root, "catalog/sidecar-v2.jsonl"), Array.from({ length: resources }, (_, i) => sidecarRecord(i + 1)));
  const queries = Array.from({ length: 100 }, (_, i) =>
    queryRecord(i + 1, options.splitMismatch && i === 0 ? "release" : undefined));
  if (options.classMismatch && queries[0]) queries[0].query_class = "semantic";
  await writeJsonl(resolve(root, "queries/queries-v2.jsonl"), queries);
  return root;
}

describe("Step 6 dataset freeze", () => {
  it("freezes exactly the release-count resources and 100 correctly distributed queries", async () => {
    const root = await datasetFixture();
    const result = await freezeDatasetV2({ root, frozenAt: REVIEWED_AT });
    expect(DatasetManifestV2Schema.parse(result.manifest)).toEqual(result.manifest);
    expect(ReleaseQueryIndexV2Schema.parse(result.releaseQueryIndex)).toEqual(result.releaseQueryIndex);
    expect(result.manifest.counts.resources).toEqual(RELEASE_COUNTS.resources);
    expect(result.manifest.counts.queries).toEqual({ development: 50, release: 50, total: 100 });
    expect(result.manifest.counts.query_classes).toEqual(QUERY_CLASS_TARGETS);
    expect(Object.keys(result.manifest.hashes).sort()).toEqual([...FROZEN_INPUT_PATHS, RELEASE_QUERY_INDEX_PATH].sort());
    for (const path of FROZEN_INPUT_PATHS) {
      expect(result.manifest.hashes[path]).toBe((await hashFile(resolve(root, path))).sha256);
    }
    expect(result.releaseQueryIndex.judgments_included).toBe(false);
    expect(result.releaseQueryIndex.queries).toHaveLength(50);
    expect(Object.keys(result.releaseQueryIndex).sort()).toEqual([
      "contract", "count", "dataset_version", "hash_basis", "judgments_included", "queries",
    ]);
    expect(Object.keys(result.releaseQueryIndex.queries[0]!).sort()).toEqual(["query_id", "sha256"]);
  });

  it("refuses partial data and publishes no freeze artifacts", async () => {
    const root = await datasetFixture({ resources: RELEASE_COUNTS.resources.total - 1 });
    await expect(freezeDatasetV2({ root })).rejects.toThrow(new RegExp(`exactly ${RELEASE_COUNTS.resources.total}`));
    await expect(readFile(resolve(root, DATASET_MANIFEST_PATH))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(resolve(root, RELEASE_QUERY_INDEX_PATH))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses an incorrect 50/50 split", async () => {
    const root = await datasetFixture({ splitMismatch: true });
    await expect(freezeDatasetV2({ root })).rejects.toThrow(/query split development: expected 50, found 49/);
  });

  it("refuses schema-invalid input", async () => {
    const root = await datasetFixture({ invalidCatalog: true });
    await expect(freezeDatasetV2({ root })).rejects.toThrow(/fixture URL must use reserved \.example/);
  });

  it("refuses incorrect exact query-class targets", async () => {
    const root = await datasetFixture({ classMismatch: true });
    await expect(freezeDatasetV2({ root })).rejects.toThrow(/query class capability: expected 30, found 29/);
  });

  it("never overwrites an existing immutable freeze", async () => {
    const root = await datasetFixture();
    await freezeDatasetV2({ root, frozenAt: REVIEWED_AT });
    const before = await readFile(resolve(root, DATASET_MANIFEST_PATH), "utf8");
    await expect(freezeDatasetV2({ root, frozenAt: "2026-08-08T00:00:00.000Z" })).rejects.toThrow(/already exists/);
    expect(await readFile(resolve(root, DATASET_MANIFEST_PATH), "utf8")).toBe(before);
  });
});

describe("§12.1 release-run ledger", () => {
  it("requires explicit CLI and environment acknowledgements", async () => {
    const root = await datasetFixture();
    await freezeDatasetV2({ root, frozenAt: REVIEWED_AT });
    await expect(recordReleaseRunEvent({
      root,
      phase: "started",
      runId: "release-test-001",
      purpose: "milestone",
      actor: "owner",
      reason: "test milestone",
      acknowledgement: "",
      environmentAcknowledgement: RELEASE_HOLDOUT_ENV_ACKNOWLEDGEMENT,
    })).rejects.toThrow(/exact holdout acknowledgement/);
  });

  it("appends a hash-chained start and terminal event and rejects reuse", async () => {
    const root = await datasetFixture();
    await freezeDatasetV2({ root, frozenAt: REVIEWED_AT });
    const reportPath = versionedReleaseReportPath("release-test-001", "milestone");
    await mkdir(resolve(root, "reports/releases"), { recursive: true });
    await writeFile(resolve(root, reportPath), "{\"status\":\"pass\"}\n");
    const common = {
      root,
      runId: "release-test-001",
      purpose: "milestone" as const,
      actor: "owner",
      acknowledgement: RELEASE_HOLDOUT_CLI_ACKNOWLEDGEMENT,
      environmentAcknowledgement: RELEASE_HOLDOUT_ENV_ACKNOWLEDGEMENT,
    };
    const started = await recordReleaseRunEvent({
      ...common,
      phase: "started",
      reason: "test milestone",
      recordedAt: "2026-08-07T01:00:00.000Z",
    });
    const completed = await recordReleaseRunEvent({
      ...common,
      phase: "completed",
      reason: "test milestone completed",
      reportPath,
      recordedAt: "2026-08-07T01:01:00.000Z",
    });
    expect(started.sequence).toBe(1);
    expect(started.previous_event_hash).toBeNull();
    expect(completed.sequence).toBe(2);
    expect(completed.previous_event_hash).toBe(started.event_hash);
    expect(completed.report).toMatchObject({ path: reportPath, versioned_path: reportPath });
    expect(completed.report?.sha256).toBe((await hashFile(resolve(root, reportPath))).sha256);
    const lines = (await readFile(resolve(root, "manifests/release-runs-v2.jsonl"), "utf8")).trim().split("\n");
    expect(lines.map(line => ReleaseRunLedgerEntryV2Schema.parse(JSON.parse(line)))).toHaveLength(2);
    expect(await readReleaseRunLedger(resolve(root, "manifests/release-runs-v2.jsonl"))).toHaveLength(2);
    await expect(recordReleaseRunEvent({
      ...common,
      phase: "completed",
      reason: "duplicate terminal",
      reportPath,
    })).rejects.toThrow(/already has a terminal event/);
  });

  it("preserves milestone and final reports at distinct immutable paths", async () => {
    const root = await datasetFixture();
    await freezeDatasetV2({ root, frozenAt: REVIEWED_AT });
    await mkdir(resolve(root, "reports/releases"), { recursive: true });
    const acknowledgement = {
      root,
      actor: "owner",
      acknowledgement: RELEASE_HOLDOUT_CLI_ACKNOWLEDGEMENT,
      environmentAcknowledgement: RELEASE_HOLDOUT_ENV_ACKNOWLEDGEMENT,
    };

    const milestoneRunId = "release-milestone-001";
    const milestonePath = versionedReleaseReportPath(milestoneRunId, "milestone");
    await writeFile(resolve(root, milestonePath), "{\"run\":\"milestone\"}\n");
    await recordReleaseRunEvent({
      ...acknowledgement, phase: "started", runId: milestoneRunId, purpose: "milestone",
      reason: "milestone start",
    });
    await recordReleaseRunEvent({
      ...acknowledgement, phase: "completed", runId: milestoneRunId, purpose: "milestone",
      reason: "milestone complete", reportPath: milestonePath,
    });

    const finalRunId = "release-final-001";
    const finalVersionedPath = versionedReleaseReportPath(finalRunId, "final");
    const finalBytes = "{\"run\":\"final\"}\n";
    await Promise.all([
      writeFile(resolve(root, finalVersionedPath), finalBytes),
      writeFile(resolve(root, FINAL_RELEASE_REPORT_PATH), finalBytes),
    ]);
    await recordReleaseRunEvent({
      ...acknowledgement, phase: "started", runId: finalRunId, purpose: "final",
      reason: "final start",
    });
    const completedFinal = await recordReleaseRunEvent({
      ...acknowledgement, phase: "completed", runId: finalRunId, purpose: "final",
      reason: "final complete", reportPath: FINAL_RELEASE_REPORT_PATH,
    });

    expect(completedFinal.report).toMatchObject({
      path: FINAL_RELEASE_REPORT_PATH,
      versioned_path: finalVersionedPath,
    });
    expect(ReleaseRunLedgerEntryV2Schema.safeParse({
      ...completedFinal,
      report: { ...completedFinal.report!, path: "reports/other.json" },
    }).success).toBe(false);
    const ledger = await readReleaseRunLedger(resolve(root, "manifests/release-runs-v2.jsonl"));
    expect(ledger).toHaveLength(4);
    expect(ledger.filter(entry => entry.phase === "completed").map(entry => entry.report?.versioned_path))
      .toEqual([milestonePath, finalVersionedPath]);
  });

  it("rejects changed canonical or immutable report bytes when reading the ledger", async () => {
    const root = await datasetFixture();
    await freezeDatasetV2({ root, frozenAt: REVIEWED_AT });
    await mkdir(resolve(root, "reports/releases"), { recursive: true });
    const runId = "release-final-integrity";
    const versionedPath = versionedReleaseReportPath(runId, "final");
    const original = "{\"status\":\"original\"}\n";
    await Promise.all([
      writeFile(resolve(root, versionedPath), original),
      writeFile(resolve(root, FINAL_RELEASE_REPORT_PATH), original),
    ]);
    const common = {
      root, runId, purpose: "final" as const, actor: "owner",
      acknowledgement: RELEASE_HOLDOUT_CLI_ACKNOWLEDGEMENT,
      environmentAcknowledgement: RELEASE_HOLDOUT_ENV_ACKNOWLEDGEMENT,
    };
    await recordReleaseRunEvent({ ...common, phase: "started", reason: "integrity start" });
    await recordReleaseRunEvent({
      ...common, phase: "completed", reason: "integrity complete",
      reportPath: FINAL_RELEASE_REPORT_PATH,
    });
    const ledgerPath = resolve(root, "manifests/release-runs-v2.jsonl");

    await writeFile(resolve(root, FINAL_RELEASE_REPORT_PATH), "{\"status\":\"changed\"}\n");
    await expect(readReleaseRunLedger(ledgerPath)).rejects.toThrow(/completed report .* differs from recorded SHA-256/);
    await writeFile(resolve(root, FINAL_RELEASE_REPORT_PATH), original);
    await writeFile(resolve(root, versionedPath), "{\"status\":\"changed\"}\n");
    await expect(readReleaseRunLedger(ledgerPath)).rejects.toThrow(/immutable completed report .* differs from recorded SHA-256/);
  });

  it("requires matching final copies and contains ledger-controlled report paths below root", async () => {
    const root = await datasetFixture();
    await freezeDatasetV2({ root, frozenAt: REVIEWED_AT });
    await mkdir(resolve(root, "reports/releases"), { recursive: true });
    const runId = "release-final-mismatch";
    const versionedPath = versionedReleaseReportPath(runId, "final");
    await Promise.all([
      writeFile(resolve(root, versionedPath), "{\"copy\":1}\n"),
      writeFile(resolve(root, FINAL_RELEASE_REPORT_PATH), "{\"copy\":2}\n"),
    ]);
    const common = {
      root, runId, purpose: "final" as const, actor: "owner",
      acknowledgement: RELEASE_HOLDOUT_CLI_ACKNOWLEDGEMENT,
      environmentAcknowledgement: RELEASE_HOLDOUT_ENV_ACKNOWLEDGEMENT,
    };
    await recordReleaseRunEvent({ ...common, phase: "started", reason: "mismatch start" });
    await expect(recordReleaseRunEvent({
      ...common, phase: "completed", reason: "mismatch complete",
      reportPath: FINAL_RELEASE_REPORT_PATH,
    })).rejects.toThrow(/canonical and immutable release report bytes differ/);
    await expect(recordReleaseRunEvent({
      ...common, phase: "completed", reason: "escape attempt", reportPath: "../escape.json",
    })).rejects.toThrow(/must name a file below the handwritten-evals root/);
  });

  it("rejects a hash-valid legacy ledger entry whose report path escapes the dataset root", async () => {
    const root = await datasetFixture();
    const frozen = await freezeDatasetV2({ root, frozenAt: REVIEWED_AT });
    const body = {
      sequence: 1,
      previous_event_hash: null,
      recorded_at: "2026-08-07T01:00:00.000Z",
      phase: "completed" as const,
      run_id: "release-legacy-escape",
      purpose: "milestone" as const,
      actor: "owner",
      reason: "legacy entry",
      dataset_manifest_path: DATASET_MANIFEST_PATH as typeof DATASET_MANIFEST_PATH,
      dataset_manifest_sha256: (await hashFile(resolve(root, DATASET_MANIFEST_PATH))).sha256,
      release_query_index_sha256: frozen.manifest.release_holdout.query_index_sha256,
      report: { path: "reports/../../outside.json", sha256: "0".repeat(64) },
      failure_reason: null,
    };
    const entry = ReleaseRunLedgerEntryV2Schema.parse({ ...body, event_hash: releaseRunEventHash(body) });
    const ledgerPath = resolve(root, "manifests/release-runs-v2.jsonl");
    await writeFile(ledgerPath, `${JSON.stringify(entry)}\n`);
    await expect(readReleaseRunLedger(ledgerPath)).rejects.toThrow(/must name a file below the handwritten-evals root/);
  });

  it("refuses ledger access after any frozen input changes", async () => {
    const root = await datasetFixture();
    await freezeDatasetV2({ root, frozenAt: REVIEWED_AT });
    await writeFile(resolve(root, "spec/axes.md"), "tampered\n");
    await expect(verifyFrozenDataset(root)).rejects.toThrow(/differs from frozen SHA-256/);
  });
});
