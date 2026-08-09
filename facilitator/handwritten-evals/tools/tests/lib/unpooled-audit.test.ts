import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  POOL_BUILD_SYSTEMS,
  PoolRecordSchema,
  PUBNET_USDC,
  QrelRecordSchema,
  QUERY_CLASS_TARGETS,
  RELEASE_COUNTS,
  TESTNET_USDC,
} from "../../../schema/schema-v2.js";
import { deterministicEligibility } from "../../lib/pool.js";
import {
  assertNoUnpooledAuditPackLeakage,
  AUDIT_BATCH_COUNT,
  TARGET_AUDIT_PAIR_COUNT,
  applyUnpooledAuditOwnerReview,
  currentUnpooledAuditSourceHash,
  finalizeUnpooledAudit,
  parseUnpooledAuditPrerequisites,
  prepareUnpooledAudit,
  UnpooledAuditPendingReportSchema,
  UnpooledAuditFinalReportSchema,
  unpooledArtifactHash,
  validateUnpooledAuditImports,
  writeUnpooledAuditPreparationExclusive,
  type UnpooledAuditDenseVectors,
  type UnpooledAuditImport,
  type UnpooledAuditManifest,
  type UnpooledAuditOwnerDecision,
} from "../../lib/unpooled-audit.js";

const NOW = "2026-08-07T00:00:00.000Z";
const PAY_TO = "GAOH2NR3A3R2VS6TUE6L75A3OMJ4UKJWEHHNL5GIIEQTS5RVZEK5LAP4";
const CLASS_SEQUENCE = Object.entries(QUERY_CLASS_TARGETS)
  .flatMap(([queryClass, count]) => Array.from({ length: count }, () => queryClass));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function generation(runId: string) {
  return {
    provider: "anthropic" as const,
    model: "claude-test-revision-20260807",
    prompt_hash: `sha256:${"a".repeat(64)}`,
    run_id: runId,
    shard_id: `shard-${runId}`,
    temperature: 0,
    generated_at: NOW,
  };
}

function catalog(index: number) {
  const id = `res-${String(index).padStart(4, "0")}`;
  return {
    resource_id: id,
    wire: {
      x402Version: 2 as const,
      resource: {
        url: `https://fixture-${index}.audit.example/value`,
        serviceName: `Topic Listing ${index}`,
        description: `Shared astronomy topic lookup with independent detail number ${index}.`,
        tags: ["shared", "astronomy", "topic"],
        mimeType: "application/json",
      },
      accepts: [{
        scheme: "exact" as const,
        network: "stellar:pubnet" as const,
        asset: PUBNET_USDC,
        amount: "10000",
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
        extra: { areFeesSponsored: false },
      }],
      extensions: { bazaar: {} },
    },
  };
}

function sidecar(index: number) {
  const id = `res-${String(index).padStart(4, "0")}`;
  const labeled = index <= 100;
  const type = labeled && index > 85 ? "mcp" as const : "http" as const;
  const base = {
    resource_id: id,
    authorship: "agent" as const,
    resource_type: type,
    is_distractor: !labeled,
    is_sparse: false,
    adversarial_kind: null,
    provider_id: `provider-${String(((index - 1) % 120) + 1).padStart(3, "0")}`,
    generation: generation(`resource-author-${index}`),
    derived_from: { kind: "agent_generated" as const, generation_id: `resource-author-${index}`, rationale: "fixture" },
    review_status: "approved" as const,
    reviewed_at: NOW,
    owner_note: null,
    family: labeled ? ((index - 1) % 20) + 1 : null,
    family_slot: labeled ? ((index - 1) % 5) + 1 : null,
    category: "fixture",
    is_live: false as const,
    settlement_verified: false as const,
    asset_decimals: 7 as const,
    price_usd_snapshot: { value: 0.001, as_of: NOW, basis: "fixed_fixture_minimum_option_value" as const },
  };
  if (!labeled) return base;
  return {
    ...base,
    axes: {
      capability: `fixture-capability-${index}`,
      resource_type: type,
      input_method: type === "mcp" ? "not_applicable" as const : "GET" as const,
      input_shape: type === "mcp" ? "tool_arguments" as const : "query_params" as const,
      output_shape: "json" as const,
      coverage: "global" as const,
      freshness: "daily" as const,
      price_tier: 0.001 as const,
      networks: ["stellar:pubnet" as const],
      scheme_set: "exact_only" as const,
      attestation: "unsigned" as const,
    },
    ...(type === "mcp" ? {
      mcp: {
        server_name: `server-${index}`,
        tool_name: `tool-${index}`,
        transport: "streamable-http" as const,
        tool_count: 1,
        input_schema_shape: "flat_scalars" as const,
      },
    } : {}),
  };
}

function query(index: number) {
  const queryClass = CLASS_SEQUENCE[index - 1]! as keyof typeof QUERY_CLASS_TARGETS;
  const noResult = queryClass === "no_result";
  const mcpNumber = CLASS_SEQUENCE.slice(0, index).filter(value => value === "mcp").length - 1;
  const mcpSubtypes = ["tuple_identity", "tool_schema", "transport", "http_vs_mcp"] as const;
  return {
    query_id: `qry-${String(index).padStart(3, "0")}`,
    split: index % 2 === 1 ? "development" as const : "release" as const,
    query_class: queryClass,
    query: "shared astronomy topic lookup",
    filters: queryClass === "structured" ? { network: "stellar:pubnet" as const } : {},
    evaluation_constraints: queryClass === "price_category" ? { max_price_usd: 0.05 } : {},
    expects_no_result: noResult,
    phrasing_register: "terse_agent" as const,
    ...(queryClass === "mcp" ? { mcp_subtype: mcpSubtypes[mcpNumber % mcpSubtypes.length]! } : {}),
    family: noResult ? null : ((index - 1) % 20) + 1,
    ...(noResult ? { forbidden_capability: `absent capability ${index}` } : {}),
    generation: generation(`query-author-${index}`),
    derived_from: { kind: "agent_generated" as const, generation_id: `query-author-${index}`, use_case: "fixture" },
    review_status: "approved" as const,
    reviewed_at: NOW,
    owner_note: null,
  };
}

function pooled(queryIndex: number) {
  return PoolRecordSchema.parse({
    query_id: `qry-${String(queryIndex).padStart(3, "0")}`,
    resource_id: "res-0001",
    origin: "system_pool",
    contributions: POOL_BUILD_SYSTEMS.map(system => ({ system, rank: 1 })),
    best_rank: 1,
    pool_depth: 20,
    blinded: true,
    pooled_at: NOW,
    run_id: "pool-run",
  });
}

function sources() {
  return {
    catalog: Array.from({ length: RELEASE_COUNTS.resources.total }, (_, index) => catalog(index + 1)),
    sidecars: Array.from({ length: RELEASE_COUNTS.resources.total }, (_, index) => sidecar(index + 1)),
    queries: Array.from({ length: 100 }, (_, index) => query(index + 1)),
    pool: Array.from({ length: 100 }, (_, index) => pooled(index + 1)),
  };
}

function auditors() {
  return Array.from({ length: AUDIT_BATCH_COUNT }, (_, index) =>
    generation(`audit-agent-${String(index + 1).padStart(2, "0")}`));
}

/** Deterministic 8-dim fixture vector; real runs use cached `text-embedding-3-large` vectors instead. */
function fixtureVector(seed: string): number[] {
  const digest = createHash("sha256").update(seed).digest();
  return Array.from(digest.subarray(0, 8), byte => (byte / 255) + 0.001);
}

function denseVectors(raw = sources()): UnpooledAuditDenseVectors {
  return {
    queries: new Map(raw.queries.map(record => [record.query_id, fixtureVector(`query:${record.query_id}`)])),
    catalog: new Map(raw.catalog.map(record => [record.resource_id, fixtureVector(`resource:${record.resource_id}`)])),
  };
}

function prepare(raw = sources()) {
  return prepareUnpooledAudit(raw, {
    pipelineRunId: "unpooled-run-1",
    createdAt: NOW,
    seed: "0123456789abcdef",
    auditors: auditors(),
    denseVectors: denseVectors(raw),
    additionalForbiddenRunIds: ["grader-a-run", "grader-b-run"],
  });
}

function imports(manifest: UnpooledAuditManifest): UnpooledAuditImport[] {
  return manifest.batches.map(batch => ({
    version: 1,
    role: "unpooled_auditor",
    pack_id: batch.pack_id,
    auditor: batch.auditor,
    judgments: batch.assignments.map((assignment, index) => ({
      task_id: assignment.task_id,
      candidate_id: assignment.candidate_id,
      grade: index % 4,
      rationale: `Independent audit rationale ${index}.`,
      judged_at: NOW,
    })),
  }));
}

function ownerDecision(
  report: ReturnType<typeof finalizeUnpooledAudit>["report"],
  qrels: ReturnType<typeof finalizeUnpooledAudit>["qrels"],
  threshold = 0.6,
): UnpooledAuditOwnerDecision {
  return {
    version: 1 as const,
    pipeline_run_id: report.pipeline_run_id,
    source_hash: report.source_hash,
    raw_report_hash: unpooledArtifactHash(report),
    reviewer: "benchmark-owner",
    reviewed_at: NOW,
    materiality_threshold: threshold,
    pooling_decision: "approved" as const,
    rationale: "The measured unpooled relevance rate is below the predeclared materiality threshold.",
    pair_decisions: qrels.map(qrel => ({
      query_id: qrel.query_id,
      resource_id: qrel.resource_id,
      decision: "approved" as const,
      grade: qrel.grade,
      reviewer: "benchmark-owner",
      reviewed_at: NOW,
      rationale: qrel.rationale ?? "Owner reviewed the audit judgment.",
      notes: null,
    })),
  };
}

describe("Pass 2b preparation", () => {
  it("deterministically creates 10 blind packs targeting 2 pairs/query and an owner-only mapping", () => {
    const raw = sources();
    const first = prepare(raw);
    const second = prepare(raw);
    expect(first).toEqual(second);
    expect(first.packs).toHaveLength(10);
    expect(first.manifest.batches.flatMap(batch => batch.assignments)).toHaveLength(TARGET_AUDIT_PAIR_COUNT);
    expect(first.packs.every(pack => pack.tasks.length === 10 && pack.tasks.every(task => task.candidates.length === 2))).toBe(true);
    expect(first.manifest.sampler.bm25_is_relevance_judgment).toBe(false);
    expect(first.manifest.sampler.dense_is_relevance_judgment).toBe(false);
    const pooledPairs = new Set(raw.pool.map(record => `${record.query_id}/${record.resource_id}`));
    const parsed = parseUnpooledAuditPrerequisites(raw);
    const queryById = new Map(parsed.dataset.queries.map(record => [record.query_id, record]));
    const catalogById = new Map(parsed.dataset.catalog.map(record => [record.resource_id, record]));
    const sidecarById = new Map(parsed.dataset.sidecars.map(record => [record.resource_id, record]));
    for (const assignment of first.manifest.batches.flatMap(batch => batch.assignments)) {
      expect(pooledPairs.has(`${assignment.query_id}/${assignment.resource_id}`)).toBe(false);
      if (assignment.audit_source === "bm25_residual") expect(assignment.source_score).toBeGreaterThan(0);
      if (assignment.audit_source === "random_eligible") {
        expect(assignment.source_rank).toBeNull();
        expect(assignment.source_score).toBeNull();
      }
      expect(deterministicEligibility(
        queryById.get(assignment.query_id)!, catalogById.get(assignment.resource_id)!, sidecarById.get(assignment.resource_id)!,
      ).eligible).toBe(true);
    }
    // With 500 richly overlapping fixture resources and only one pooled per query, bm25_residual alone
    // should cover this fixture — the fallback stages exist for the real corpus's narrower queries.
    const sourceCounts = first.manifest.batches.flatMap(batch => batch.assignments)
      .reduce<Record<string, number>>((acc, item) => { acc[item.audit_source] = (acc[item.audit_source] ?? 0) + 1; return acc; }, {});
    expect(sourceCounts.bm25_residual).toBe(TARGET_AUDIT_PAIR_COUNT);
    for (const pack of first.packs) {
      expect(() => assertNoUnpooledAuditPackLeakage(pack)).not.toThrow();
      expect(JSON.stringify(pack)).not.toMatch(/query_id|resource_id|provider_id|family|author|system|rank|score|qrel/i);
    }
  });

  it("refuses incomplete corpora and pool-builder pools", () => {
    const partial = sources();
    partial.catalog.pop();
    expect(() => prepare(partial)).toThrow(new RegExp(
      `expected ${RELEASE_COUNTS.resources.total} catalog records, got ${RELEASE_COUNTS.resources.total - 1}`,
    ));
    const incompletePool = sources();
    incompletePool.pool[0] = PoolRecordSchema.parse({
      ...incompletePool.pool[0],
      contributions: incompletePool.pool[0]!.contributions.filter(item => item.system !== "bm25"),
    });
    expect(() => prepare(incompletePool)).toThrow(/incomplete pool; missing bm25/);
  });

  it("refuses an author or reused grader as an audit agent", () => {
    const assigned = auditors();
    assigned[0] = { ...assigned[0]!, run_id: "query-author-1" };
    expect(() => prepareUnpooledAudit(sources(), {
      pipelineRunId: "bad", createdAt: NOW, seed: "0123456789abcdef", auditors: assigned, denseVectors: denseVectors(),
    })).toThrow(/not an independent fresh context/);
    const reused = auditors();
    reused[0] = { ...reused[0]!, run_id: "grader-a-run" };
    expect(() => prepareUnpooledAudit(sources(), {
      pipelineRunId: "bad", createdAt: NOW, seed: "0123456789abcdef", auditors: reused, denseVectors: denseVectors(),
      additionalForbiddenRunIds: ["grader-a-run"],
    })).toThrow(/not an independent fresh context/);
  });

  it("falls back to dense/random sampling and marks a query exhausted when candidates run short", () => {
    const raw = sources();
    // Force qry-001 to reject every catalog resource except the one already pooled (res-0001), which
    // is given a unique testnet payment option nothing else offers. No BM25/dense fallback candidate
    // can exist: total eligible+unpooled drops to zero for this query, regardless of lexical or
    // semantic similarity, which is the genuine "nothing left to audit" case this handles gracefully.
    raw.queries[0] = { ...raw.queries[0]!, filters: { network: "stellar:testnet" } } as typeof raw.queries[0];
    raw.catalog[0] = {
      ...raw.catalog[0]!,
      wire: {
        ...raw.catalog[0]!.wire,
        accepts: [
          ...raw.catalog[0]!.wire.accepts,
          {
            scheme: "exact" as const, network: "stellar:testnet" as const, asset: TESTNET_USDC,
            amount: "10000", payTo: PAY_TO, maxTimeoutSeconds: 60, extra: { areFeesSponsored: false },
          },
        ],
      },
    } as unknown as typeof raw.catalog[0];
    raw.sidecars[0] = {
      ...raw.sidecars[0]!,
      axes: { ...(raw.sidecars[0] as { axes?: object }).axes, networks: ["stellar:pubnet", "stellar:testnet"] },
    } as unknown as typeof raw.sidecars[0];
    const preparation = prepare(raw);
    const batch = preparation.manifest.batches.find(item => item.query_ids.includes("qry-001"))!;
    expect(batch.population_exhausted_query_ids).toContain("qry-001");
    expect(batch.assignments.some(item => item.query_id === "qry-001")).toBe(false);
    expect(preparation.packs.flatMap(pack => pack.tasks)).toHaveLength(99);
    const total = preparation.manifest.batches.flatMap(item => item.assignments).length;
    expect(total).toBe(TARGET_AUDIT_PAIR_COUNT - 2);
  });
});
describe("fresh audit import validation and report", () => {
  it("requires all assigned opaque pairs exactly once", () => {
    const raw = sources();
    const preparation = prepare(raw);
    const records = imports(preparation.manifest);
    expect(validateUnpooledAuditImports(parseUnpooledAuditPrerequisites(raw), preparation.manifest, records, denseVectors(raw))).toHaveLength(200);
    records[0]!.judgments[19] = records[0]!.judgments[0]!;
    expect(() => validateUnpooledAuditImports(parseUnpooledAuditPrerequisites(raw), preparation.manifest, records, denseVectors(raw)))
      .toThrow(/duplicate judgment assignment/);
  });

  it("rejects missing batches and mismatched auditor provenance", () => {
    const raw = sources();
    const preparation = prepare(raw);
    const records = imports(preparation.manifest);
    expect(() => validateUnpooledAuditImports(parseUnpooledAuditPrerequisites(raw), preparation.manifest, records.slice(1), denseVectors(raw)))
      .toThrow(/expected 10 audit imports, got 9/);
    records[0] = { ...records[0]!, auditor: { ...records[0]!.auditor, run_id: "different-auditor" } };
    expect(() => validateUnpooledAuditImports(parseUnpooledAuditPrerequisites(raw), preparation.manifest, records, denseVectors(raw)))
      .toThrow(/auditor provenance does not match assignment/);
  });

  it("computes grade>=2 relevance and can emit only pending-owner-review status", () => {
    const raw = sources();
    const preparation = prepare(raw);
    const result = finalizeUnpooledAudit(raw, preparation.manifest, imports(preparation.manifest), NOW, denseVectors(raw));
    expect(UnpooledAuditPendingReportSchema.parse(result.report)).toEqual(result.report);
    expect(result.report.status).toBe("pending_owner_review");
    expect(result.report.owner_review).toBe("pending");
    expect(result.report.audited_pair_count).toBe(200);
    expect(result.report.relevant_pair_count).toBe(100);
    expect(result.report.audited_relevance_rate).toBe(0.5);
    expect(JSON.stringify(result.report)).not.toContain("approved");
    expect(result.qrels).toHaveLength(200);
    expect(result.qrels.every(record => QrelRecordSchema.safeParse(record).success)).toBe(true);
    expect(result.poolRecords).toHaveLength(200);
    expect(result.poolRecords.every(record => record.origin === "unpooled_audit" && record.contributions.length === 0)).toBe(true);
  });

  it("refuses finalization after a frozen source changes", () => {
    const raw = sources();
    const preparation = prepare(raw);
    const records = imports(preparation.manifest);
    raw.catalog[10]!.wire.resource.description = "Shared astronomy topic changed after preparation.";
    expect(() => finalizeUnpooledAudit(raw, preparation.manifest, records, NOW, denseVectors(raw))).toThrow(/source_hash does not match current inputs/);
  });
});

describe("owner finalization", () => {
  it("requires complete append-only owner review and emits reviewed qrels", () => {
    const raw = sources();
    const preparation = prepare(raw);
    const pending = finalizeUnpooledAudit(raw, preparation.manifest, imports(preparation.manifest), NOW, denseVectors(raw));
    const result = applyUnpooledAuditOwnerReview(pending.report, pending.qrels, ownerDecision(pending.report, pending.qrels));
    expect(UnpooledAuditFinalReportSchema.parse(result.report)).toEqual(result.report);
    expect(result.report.status).toBe("approved");
    expect(result.report.audited_relevance_rate).toBe(0.5);
    expect(result.report.reviewed_qrels_hash).toBe(unpooledArtifactHash(result.reviewedQrels));
    expect(result.reviewedQrels).toHaveLength(TARGET_AUDIT_PAIR_COUNT);
    expect(result.reviewedQrels.every(qrel => qrel.judge === "reviewed_agent"
      && qrel.review_status === "approved" && qrel.reviewed_by === "benchmark-owner")).toBe(true);
    expect(pending.qrels.every(qrel => qrel.judge === "agent" && qrel.review_status === "pending")).toBe(true);
    expect(currentUnpooledAuditSourceHash({ ...raw, pool: [...raw.pool, ...pending.poolRecords] }))
      .toBe(pending.report.source_hash);
  });

  it("recomputes the rate after corrections and enforces the materiality decision", () => {
    const raw = sources();
    const preparation = prepare(raw);
    const pending = finalizeUnpooledAudit(raw, preparation.manifest, imports(preparation.manifest), NOW, denseVectors(raw));
    const owner = ownerDecision(pending.report, pending.qrels, 0.5);
    const correctedIndex = pending.qrels.findIndex(qrel => qrel.grade === 0);
    owner.pair_decisions[correctedIndex] = {
      ...owner.pair_decisions[correctedIndex]!, decision: "corrected", grade: 3,
      notes: "Owner found the candidate fully relevant after review.",
    };
    expect(() => applyUnpooledAuditOwnerReview(pending.report, pending.qrels, owner)).toThrow(/pooling_decision must be repool_required/);
    const result = applyUnpooledAuditOwnerReview(pending.report, pending.qrels, {
      ...owner, pooling_decision: "repool_required",
    });
    expect(result.report.status).toBe("repool_required");
    expect(result.report.corrected_pair_count).toBe(1);
    expect(result.report.audited_relevance_rate).toBe(101 / 200);
  });

  it("rejects stale, incomplete, or rejected owner evidence", () => {
    const raw = sources();
    const preparation = prepare(raw);
    const pending = finalizeUnpooledAudit(raw, preparation.manifest, imports(preparation.manifest), NOW, denseVectors(raw));
    const owner = ownerDecision(pending.report, pending.qrels);
    expect(() => applyUnpooledAuditOwnerReview(pending.report, pending.qrels, {
      ...owner, raw_report_hash: `sha256:${"f".repeat(64)}`,
    })).toThrow(/raw_report_hash/);
    expect(() => applyUnpooledAuditOwnerReview(pending.report, pending.qrels, {
      ...owner, pair_decisions: owner.pair_decisions.slice(1),
    })).toThrow();
    const rejected = { ...owner.pair_decisions[0]!, decision: "rejected" as const, grade: null,
      notes: "Fresh audit replacement required." };
    expect(() => applyUnpooledAuditOwnerReview(pending.report, pending.qrels, {
      ...owner, pair_decisions: [rejected, ...owner.pair_decisions.slice(1)],
    })).toThrow(/fresh replacement audit/);
  });
});

describe("owner-only preparation writes", () => {
  it("separates the 0600 mapping from agent packs and never overwrites", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "unpooled-audit-"));
    temporaryDirectories.push(directory);
    const preparation = prepare();
    const written = await writeUnpooledAuditPreparationExclusive(directory, preparation);
    expect((await stat(written.ownerManifestPath)).mode & 0o777).toBe(0o600);
    expect(written.packPaths).toHaveLength(10);
    expect(JSON.parse(await readFile(written.packPaths[0]!, "utf8"))).toEqual(preparation.packs[0]);
    await expect(writeUnpooledAuditPreparationExclusive(directory, preparation)).rejects.toMatchObject({ code: "EEXIST" });
    expect(JSON.parse(await readFile(written.ownerManifestPath, "utf8"))).toEqual(preparation.manifest);
  });
});
