/**
 * BUILD-PLAN §§9–11 status and release-gate audit.
 *
 * This tool never invents missing evidence. It validates artifacts that exist, records every
 * absent semantic/review artifact as blocked, and writes reports/release-gates-v2.json.
 * Use --report-only while the build is incomplete; the default exits non-zero on any blocked gate.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { z } from "zod";
import {
  ADVERSARIAL_KINDS,
  AgentCalibrationSchema,
  axisDifferences,
  CatalogRecordSchema,
  checkSidecarAgainstWire,
  FAMILY_COUNT,
  MCP_QUERY_SUBTYPES,
  NDCG_GAINS,
  POOL_SYSTEMS,
  PoolRecordSchema,
  QrelRecordSchema,
  QUERY_CLASS_TARGETS,
  QueryRecordSchema,
  RELEASE_COUNTS,
  RELEVANCE_THRESHOLDS,
  RESOURCES_PER_FAMILY,
  SidecarRecordSchema,
  unjudgedPooledPairs,
  type CatalogRecord,
  type PoolRecord,
  type QrelRecord,
  type QueryRecord,
  type SidecarRecord,
} from "../schema/schema-v2.js";

const ROOT = resolve(import.meta.dirname, "..");
const REPORTS = resolve(ROOT, "reports");
const OUTPUT = resolve(REPORTS, "release-gates-v2.json");

type GateStatus = "pass" | "blocked";
type StepStatus = "done" | "partial" | "not_started" | "blocked";

interface Gate {
  id: string;
  requirement: string;
  status: GateStatus;
  evidence: string[];
}

interface Step {
  step: number;
  name: string;
  status: StepStatus;
  evidence: string[];
  blockers: string[];
}

interface ValidationResult<T> {
  records: T[];
  errors: string[];
  exists: boolean;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function loadJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`${path}: ${(error as Error).message}`);
  }
}

async function validateJsonl<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<ValidationResult<T>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { records: [], errors: [], exists: false };
    }
    throw error;
  }
  const records: T[] = [];
  const errors: string[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      errors.push(`${path}:${index + 1}: invalid JSON — ${(error as Error).message}`);
      continue;
    }
    const parsed = schema.safeParse(raw);
    if (parsed.success) records.push(parsed.data);
    else errors.push(
      `${path}:${index + 1}: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  }
  return { records, errors, exists: true };
}

function gate(id: string, requirement: string, passes: boolean, ...evidence: string[]): Gate {
  return { id, requirement, status: passes ? "pass" : "blocked", evidence };
}

function evidenceApproved(value: Record<string, unknown> | null): boolean {
  return value?.status === "approved" || value?.status === "pass" || value?.owner_review === "approved";
}

function exactPromptHash(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

function exactModelRevision(value: string): boolean {
  return /\d{4}[-_]\d{2}[-_]\d{2}|\d{8}|revision[:/_-][a-z0-9._-]+/i.test(value);
}

async function main(): Promise<void> {
  const [catalogResult, sidecarResult, queryResult, poolResult, qrelResult, calibrationResult] = await Promise.all([
    validateJsonl(resolve(ROOT, "catalog/catalog-v2.jsonl"), CatalogRecordSchema),
    validateJsonl(resolve(ROOT, "catalog/sidecar-v2.jsonl"), SidecarRecordSchema),
    validateJsonl(resolve(ROOT, "queries/queries-v2.jsonl"), QueryRecordSchema),
    validateJsonl(resolve(ROOT, "pool/pool-v2.jsonl"), PoolRecordSchema),
    validateJsonl(resolve(ROOT, "qrels/qrels-v2.jsonl"), QrelRecordSchema),
    validateJsonl(resolve(ROOT, "reports/calibration-records-v2.jsonl"), AgentCalibrationSchema),
  ]);
  const catalog = catalogResult.records as CatalogRecord[];
  const sidecars = sidecarResult.records as SidecarRecord[];
  const queries = queryResult.records as QueryRecord[];
  const pool = poolResult.records as PoolRecord[];
  const qrels = qrelResult.records as QrelRecord[];
  const schemaErrors = [
    ...catalogResult.errors,
    ...sidecarResult.errors,
    ...queryResult.errors,
    ...poolResult.errors,
    ...qrelResult.errors,
    ...calibrationResult.errors,
  ];

  const catalogById = new Map(catalog.map(record => [record.resource_id, record]));
  const sidecarById = new Map(sidecars.map(record => [record.resource_id, record]));
  const crossErrors: string[] = [];
  for (const sidecar of sidecars) {
    const wire = catalogById.get(sidecar.resource_id);
    if (!wire) crossErrors.push(`${sidecar.resource_id}: sidecar has no catalog record`);
    else crossErrors.push(...checkSidecarAgainstWire(sidecar, wire.wire));
  }
  for (const record of catalog) {
    if (!sidecarById.has(record.resource_id)) crossErrors.push(`${record.resource_id}: catalog has no sidecar`);
  }

  const labeled = sidecars.filter(record => !record.is_distractor);
  const distractors = sidecars.filter(record => record.is_distractor);
  const axisErrors: string[] = [];
  for (let family = 1; family <= FAMILY_COUNT; family++) {
    const members = labeled.filter(record => record.family === family);
    if (members.length !== RESOURCES_PER_FAMILY) {
      axisErrors.push(`family ${family}: ${members.length}/${RESOURCES_PER_FAMILY} resources`);
      continue;
    }
    for (let left = 0; left < members.length; left++) {
      for (let right = left + 1; right < members.length; right++) {
        const a = members[left]!.axes;
        const b = members[right]!.axes;
        if (!a || !b || axisDifferences(a, b).length < 2) {
          axisErrors.push(`${members[left]!.resource_id}/${members[right]!.resource_id}: fewer than 2 axis differences`);
        }
      }
    }
  }

  const queryClassCounts = Object.fromEntries(
    Object.keys(QUERY_CLASS_TARGETS).map(queryClass => [
      queryClass,
      queries.filter(query => query.query_class === queryClass).length,
    ]),
  );
  const queryClassesCorrect = Object.entries(QUERY_CLASS_TARGETS).every(
    ([queryClass, count]) => queryClassCounts[queryClass] === count,
  );
  const querySplitsCorrect = queries.filter(query => query.split === "development").length === 50
    && queries.filter(query => query.split === "release").length === 50;
  const mcpSubtypes = new Set(queries.filter(query => query.query_class === "mcp").map(query => query.mcp_subtype));
  const allMcpSubtypes = MCP_QUERY_SUBTYPES.every(subtype => mcpSubtypes.has(subtype));

  const systemsInPool = new Set(pool.flatMap(record => record.contributions.map(item => item.system)));
  const fiveSystemPool = pool.length > 0
    && POOL_SYSTEMS.every(system => systemsInPool.has(system))
    && pool.every(record => record.pool_depth === 20 && record.contributions.every(item => item.rank <= 20));
  const unjudgedPool = unjudgedPooledPairs(pool, qrels);

  const archiveFiles = [
    "archive/v1/README.md",
    "archive/v1/qrels/qrels-v1.jsonl",
    "archive/v1/manifests/openrouter-qrels-v1.jsonl",
    "archive/v1/reports/calibration-v1.json",
    "archive/v1/reports/position-consistency-v1.json",
    "archive/v1/reports/position-consistency-rejudge-v1.json",
    "archive/v1/src/cli/judge-release-qrels.ts",
  ];
  const archiveChecks = await Promise.all(archiveFiles.map(path => fileExists(resolve(ROOT, path))));
  const archiveComplete = archiveChecks.every(Boolean)
    && await fileExists(resolve(ROOT, "../tests/fixtures/search/golden-v1.json"));

  const [pilot, distributionAudit, unpooledAudit, forbiddenAudit, calibrationReport, finalReport,
    isolationAudit, blindnessAudit, manifest] = await Promise.all([
    loadJson(resolve(REPORTS, "pilot-v2.json")),
    loadJson(resolve(REPORTS, "distribution-audit-v2.json")),
    loadJson(resolve(REPORTS, "unpooled-audit-v2.json")),
    loadJson(resolve(REPORTS, "forbidden-capability-audit-v2.json")),
    loadJson(resolve(REPORTS, "calibration-v2.json")),
    loadJson(resolve(REPORTS, "final-v2.json")),
    loadJson(resolve(REPORTS, "isolation-audit-v2.json")),
    loadJson(resolve(REPORTS, "grading-blindness-v2.json")),
    loadJson(resolve(ROOT, "manifests/dataset-v2.json")),
  ]);

  const pilotComplete = evidenceApproved(pilot)
    && typeof pilot?.judged_at_10_threshold === "number"
    && typeof pilot?.forbidden_audit_cost === "object";
  const allResourcesPresent = catalog.length === RELEASE_COUNTS.resources.total
    && sidecars.length === RELEASE_COUNTS.resources.total
    && labeled.length === RELEASE_COUNTS.resources.labeled
    && distractors.length === RELEASE_COUNTS.resources.distractor;
  const allQueriesPresent = queries.length === RELEASE_COUNTS.queries.total
    && querySplitsCorrect && queryClassesCorrect;
  const provenanceComplete = [...sidecars, ...queries].length > 0
    && [...sidecars, ...queries].every(record =>
      exactPromptHash(record.generation.prompt_hash)
      && exactModelRevision(record.generation.model)
      && record.generation.temperature !== undefined,
    );
  const ownerReviewedResources = sidecars.length === RELEASE_COUNTS.resources.total
    && sidecars.every(record => record.review_status === "approved" || record.review_status === "corrected");
  const ownerReviewedQueries = queries.length === RELEASE_COUNTS.queries.total
    && queries.every(record => record.review_status === "approved" || record.review_status === "corrected");
  const releaseIds = new Set(queries.filter(query => query.split === "release").map(query => query.query_id));
  const releaseQrels = qrels.filter(qrel => releaseIds.has(qrel.query_id));
  const releaseRationales = releaseIds.size === 50
    && releaseQrels.length > 0
    && releaseQrels.every(qrel => Boolean(qrel.rationale));

  const thresholdsReported = finalReport?.relevance_thresholds !== undefined
    && JSON.stringify(finalReport?.ndcg_gains) === JSON.stringify(NDCG_GAINS);
  const calibrationPassed = evidenceApproved(calibrationReport)
    && typeof calibrationReport?.relevant_family_weighted_kappa === "number"
    && calibrationReport.relevant_family_weighted_kappa >= 0.6;
  const significanceReported = finalReport?.significance_reported === true;
  const bm25Reported = finalReport?.bm25_baseline === true && systemsInPool.has("bm25");
  const limitationsReported = Array.isArray(finalReport?.limitations) && finalReport.limitations.length > 0;

  const gates: Gate[] = [
    gate("schema", "All records schema-valid; zero wire validation errors",
      schemaErrors.length === 0 && crossErrors.length === 0,
      `${schemaErrors.length} schema errors`, `${crossErrors.length} wire/sidecar errors`),
    gate("counts", "100 labeled resources, 900 distractors, 100 queries, frozen split and hashes",
      allResourcesPresent && allQueriesPresent && evidenceApproved(manifest),
      `resources ${catalog.length}/1000`, `queries ${queries.length}/100`, `manifest ${manifest ? "present" : "missing"}`),
    gate("axis-differences", "Every labeled sibling pair differs on at least two axes",
      labeled.length === 100 && axisErrors.length === 0, `${axisErrors.length} failures`),
    gate("anti-correlation", "upto, mcp, and network show no prohibited correlation",
      evidenceApproved(distributionAudit), `distribution audit ${distributionAudit ? "present" : "missing"}`),
    gate("adversarial", "At least six adversarial kinds are present",
      new Set(labeled.map(record => record.adversarial_kind).filter(Boolean)).size >= 6,
      `${new Set(labeled.map(record => record.adversarial_kind).filter(Boolean)).size}/${ADVERSARIAL_KINDS.length} kinds`),
    gate("mcp-queries", "All four MCP query subtypes are covered",
      queries.filter(query => query.query_class === "mcp").length === QUERY_CLASS_TARGETS.mcp && allMcpSubtypes,
      `${queries.filter(query => query.query_class === "mcp").length}/9 MCP queries`, `${mcpSubtypes.size}/4 subtypes`),
    gate("pool", "Pool covers top-20 of all five systems and every pooled pair is judged",
      fiveSystemPool && unjudgedPool.length === 0, `${systemsInPool.size}/5 systems`, `${unjudgedPool.length} unjudged pooled pairs`),
    gate("unpooled-audit", "Unpooled audit performed and relevance rate reported",
      evidenceApproved(unpooledAudit) && typeof unpooledAudit?.audited_relevance_rate === "number",
      `unpooled audit ${unpooledAudit ? "present" : "missing"}`),
    gate("judged-at-k", "judged@10 meets the pilot-derived threshold",
      pilotComplete && finalReport?.judged_at_10_gate_passed === true,
      `pilot ${pilotComplete ? "complete" : "missing/incomplete"}`),
    gate("no-result", "Forbidden capabilities scanned, independently audited, owner-approved",
      evidenceApproved(forbiddenAudit) && forbiddenAudit?.deterministic_scan_passed === true,
      `forbidden audit ${forbiddenAudit ? "present" : "missing"}`),
    gate("metric-contract", "Relevance thresholds and nDCG gains are stated",
      thresholdsReported,
      `expected thresholds ${JSON.stringify(RELEVANCE_THRESHOLDS)}`, `expected gains ${JSON.stringify(NDCG_GAINS)}`),
    gate("provenance", "Every generated artifact has exact revision, hash, run/shard, temperature, and review status",
      provenanceComplete, `${provenanceComplete ? "complete" : "missing or placeholder provenance"}`),
    gate("isolation", "No author graded own output; task-pack isolation is auditable",
      evidenceApproved(isolationAudit), `isolation audit ${isolationAudit ? "present" : "missing"}`),
    gate("blindness", "Grading was blind to system, score, rank, author, and other grader",
      evidenceApproved(blindnessAudit), `blindness audit ${blindnessAudit ? "present" : "missing"}`),
    gate("agreement", "Restricted weighted kappa is reported and at least 0.6",
      calibrationPassed, `calibration ${calibrationReport ? "present" : "missing"}`),
    gate("rationales", "All release judgments carry rationales", releaseRationales,
      `${releaseIds.size}/50 release queries`, `${qrels.length} total qrels`),
    gate("owner-review", "Owner reviewed every resource, query, qrel, adjudication, and correction",
      ownerReviewedResources && ownerReviewedQueries && evidenceApproved(calibrationReport),
      `resources reviewed ${sidecars.filter(record => record.review_status !== "pending").length}/${sidecars.length}`,
      `queries reviewed ${queries.filter(record => record.review_status !== "pending").length}/${queries.length}`),
    gate("correction-rates", "Owner correction and rejection rates are reported; originals preserved",
      finalReport?.owner_rates_reported === true && evidenceApproved(isolationAudit),
      `final report ${finalReport ? "present" : "missing"}`),
    gate("significance", "Significance tests accompany point estimates", significanceReported,
      `significance ${significanceReported ? "reported" : "missing"}`),
    gate("bm25", "BM25 baseline is present and participated in pooling", bm25Reported,
      `BM25 ${bm25Reported ? "reported" : "not run"}`),
    gate("limitations", "Limitations section is written", limitationsReported,
      `limitations ${limitationsReported ? "present" : "missing"}`),
  ];

  const step3Done = labeled.length === 100 && ownerReviewedResources && provenanceComplete;
  const step4Done = allResourcesPresent && evidenceApproved(forbiddenAudit);
  const steps: Step[] = [
    { step: 0, name: "v2 schema and v1 archive", status: archiveComplete && schemaErrors.length === 0 ? "done" : "partial",
      evidence: [`archive ${archiveComplete ? "complete" : "incomplete"}`, `${schemaErrors.length} current schema errors`], blockers: [] },
    { step: 1, name: "mandatory end-to-end pilot", status: pilotComplete ? "done" : "blocked",
      evidence: [`pilot report ${pilot ? "present" : "missing"}`], blockers: pilotComplete ? [] : ["pilot evidence and owner review missing"] },
    { step: 2, name: "families and axes", status: axisErrors.length === 0 && labeled.length === 100 ? "done" : "partial",
      evidence: [`${labeled.length}/100 labeled slots`, `${axisErrors.length} axis failures`], blockers: [] },
    { step: 3, name: "100 labeled resources", status: step3Done ? "done" : labeled.length === 100 ? "partial" : "not_started",
      evidence: [`${labeled.length}/100 authored`, `${sidecars.filter(record => record.review_status === "pending").length} pending review`],
      blockers: step3Done ? [] : ["owner acceptance and release-grade provenance missing"] },
    { step: 4, name: "900 distractors and exclusion audit", status: step4Done ? "done" : distractors.length > 0 ? "partial" : "not_started",
      evidence: [`${distractors.length}/900 distractors`], blockers: step4Done ? [] : ["authoring waves, critics, audits, and owner review missing"] },
    { step: 5, name: "100 queries and pass-1 grading", status: allQueriesPresent ? "partial" : "not_started",
      evidence: [`${queries.length}/100 queries`], blockers: allQueriesPresent ? ["pass-1 grading/owner review incomplete"] : ["Step 4 and query authoring not complete"] },
    { step: 6, name: "freeze split and manifest", status: evidenceApproved(manifest) ? "done" : "not_started",
      evidence: [`manifest ${manifest ? "present" : "missing"}`], blockers: evidenceApproved(manifest) ? [] : ["dataset incomplete"] },
    { step: 7, name: "five-system pool", status: fiveSystemPool ? "done" : "not_started",
      evidence: [`${systemsInPool.size}/5 systems`, `${pool.length} pool rows`], blockers: fiveSystemPool ? [] : ["runs and pool builder output missing"] },
    { step: 8, name: "dual grading and unpooled audit", status: qrels.length > 0 ? "partial" : "not_started",
      evidence: [`${qrels.length} qrels`], blockers: qrels.length > 0 ? ["pool completeness/unpooled audit incomplete"] : ["pool and grading absent"] },
    { step: 9, name: "adjudication and owner review", status: calibrationPassed ? "done" : "not_started",
      evidence: [`${calibrationResult.records.length} calibration rows`], blockers: calibrationPassed ? [] : ["adjudication/calibration/owner review absent"] },
    { step: 10, name: "score, significance, and report", status: evidenceApproved(finalReport) ? "done" : "not_started",
      evidence: [`final report ${finalReport ? "present" : "missing"}`], blockers: evidenceApproved(finalReport) ? [] : ["judgments and run outputs absent"] },
  ];

  const blockers = gates.filter(item => item.status === "blocked").map(item => item.id);
  const report = {
    generated_at: new Date().toISOString(),
    status: blockers.length === 0 ? "ready" : "blocked",
    counts: {
      catalog: catalog.length,
      sidecars: sidecars.length,
      labeled: labeled.length,
      distractors: distractors.length,
      queries: queries.length,
      pool: pool.length,
      qrels: qrels.length,
      calibration: calibrationResult.records.length,
    },
    validation_errors: { schema: schemaErrors, cross_record: crossErrors, axes: axisErrors },
    steps,
    gates,
    blockers,
  };

  await mkdir(REPORTS, { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`release-gates-v2: ${report.status}; ${gates.length - blockers.length}/${gates.length} gates pass`);
  console.log(`counts: ${catalog.length} resources, ${queries.length} queries, ${pool.length} pool rows, ${qrels.length} qrels`);
  if (blockers.length > 0) console.log(`blocked: ${blockers.join(", ")}`);
  if (blockers.length > 0 && !process.argv.includes("--report-only")) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
