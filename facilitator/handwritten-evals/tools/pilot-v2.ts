/** Mandatory Step 1 pilot preparation and evidence gates. No agent execution or inferred evidence. */
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { CatalogRecordSchema, GraderRefSchema, QrelRecordSchema, QueryRecordSchema, SidecarRecordSchema,
  type CatalogRecord, type QrelRecord, type QueryRecord, type SidecarRecord } from "../schema/schema-v2.js";
import { PilotReportEvidenceSchema } from "./report-v2.js";
import { BlindAdjudicationPackSchema, BlindGradingPackSchema, GraderImportSchema, AdjudicatorImportSchema } from "./grading-pipeline.js";
import { matchesForbiddenSignature } from "./forbidden-scanner.js";

const signatures = ["transactional email", "email delivery", "send email", "email sending", "smtp relay", "mail delivery", "bulk email", "email api"];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const opaque = (kind: "task" | "candidate", ...parts: string[]) => `${kind}-${sha(parts.join("\0")).slice(0, 16)}`;

export const PilotRunEvidenceSchema = z.object({
  role: z.enum(["resource_author", "distractor_author", "query_author", "grader_a", "grader_b", "adjudicator", "forbidden_auditor", "repair"]),
  run_id: z.string().min(1), model: z.string().min(1), prompt_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  started_at: z.string().datetime(), finished_at: z.string().datetime(),
  input_tokens: z.number().int().positive(), output_tokens: z.number().int().positive(),
  wall_clock_seconds: z.number().positive(), api_cost_usd: z.number().nonnegative(),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.finished_at) < Date.parse(value.started_at)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["finished_at"], message: "must not precede started_at" });
});

export const PilotOwnerEvidenceSchema = z.object({
  status: z.literal("approved"), reviewed_at: z.string().datetime(), owner_review_seconds: z.number().positive(),
  owner_corrections: z.number().int().nonnegative(), rejection_count: z.number().int().nonnegative(),
  regeneration_count: z.number().int().nonnegative(), forbidden_exclusion_approved: z.literal(true),
  forbidden_owner_review_seconds: z.number().positive(), notes: z.string().min(1),
}).strict();

export const ForbiddenAuditImportSchema = z.object({
  version: z.literal(1), role: z.literal("forbidden_auditor"), pack_id: z.literal("pilot-fc02-audit"),
  auditor: GraderRefSchema, findings: z.array(z.object({ candidate_id: z.string().regex(/^candidate-[a-f0-9]{16}$/),
    capability_present: z.boolean(), rationale: z.string().min(1), audited_at: z.string().datetime() }).strict()).length(15),
}).strict();

export const PilotRankingSchema = z.object({ query_id: z.string().regex(/^qry-00[1-6]$/),
  results: z.array(z.string().regex(/^res-00(?:0[1-9]|1[0-5])$/)).length(10) }).strict();

export const PilotManifestSchema = z.object({
  version: z.literal(1), created_at: z.string().datetime(), source_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  scanner_wall_clock_seconds: z.number().nonnegative(), scanner_hits: z.literal(0),
  grader_packs: z.object({ a: z.string(), b: z.string() }).strict(),
  assignments: z.object({ a: z.array(z.object({ task_id: z.string(), candidate_id: z.string(), query_id: z.string(), resource_id: z.string() }).strict()).length(90),
    b: z.array(z.object({ task_id: z.string(), candidate_id: z.string(), query_id: z.string(), resource_id: z.string() }).strict()).length(90) }).strict(),
  audit_assignments: z.array(z.object({ candidate_id: z.string(), resource_id: z.string() }).strict()).length(15),
}).strict();

function shuffled<T>(values: readonly T[], seed: string, key: (value: T) => string): T[] {
  return [...values].sort((a, b) => sha(`${seed}\0${key(a)}`).localeCompare(sha(`${seed}\0${key(b)}`)));
}

function listing(catalog: CatalogRecord, sidecar: SidecarRecord) {
  const resource = catalog.wire.resource;
  return { resource_type: sidecar.resource_type,
    ...(resource.serviceName ? { serviceName: resource.serviceName } : {}),
    ...(resource.description ? { description: resource.description } : {}),
    ...(resource.tags ? { tags: resource.tags } : {}), ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
    ...(sidecar.mcp ? { mcp: sidecar.mcp } : {}) };
}

export function preparePilot(raw: { catalog: unknown[]; sidecars: unknown[]; queries: unknown[] }, createdAt: string) {
  z.string().datetime().parse(createdAt);
  const catalog = z.array(CatalogRecordSchema).length(15).parse(raw.catalog);
  const sidecars = z.array(SidecarRecordSchema).length(15).parse(raw.sidecars);
  const queries = z.array(QueryRecordSchema).length(6).parse(raw.queries);
  const expectedResources = Array.from({ length: 15 }, (_, i) => `res-${String(i + 1).padStart(4, "0")}`);
  if (catalog.map(item => item.resource_id).join() !== expectedResources.join()
      || sidecars.map(item => item.resource_id).join() !== expectedResources.join()) throw new Error("pilot resources must be ordered res-0001..res-0015");
  for (let index = 0; index < 15; index += 1) {
    const sidecar = sidecars[index]!;
    if (index < 5 && (sidecar.is_distractor || sidecar.family !== 1 || sidecar.family_slot !== index + 1)) throw new Error(`${sidecar.resource_id}: labeled F1 slot mismatch`);
    if (index >= 5 && (!sidecar.is_distractor || sidecar.family !== null || sidecar.family_slot !== null)) throw new Error(`${sidecar.resource_id}: distractor shape mismatch`);
  }
  if (queries.slice(0, 5).some((item, i) => item.query_id !== `qry-00${i + 1}` || item.query_class !== "capability" || item.family !== 1 || item.expects_no_result)) throw new Error("pilot capability query assignment mismatch");
  const noResult = queries[5]!;
  if (noResult.query_id !== "qry-006" || noResult.query_class !== "no_result" || noResult.family !== null
      || !noResult.expects_no_result || noResult.forbidden_capability !== "Transactional email delivery") throw new Error("pilot no-result assignment mismatch");

  const scanStart = performance.now();
  let scannerHits = 0;
  for (const record of catalog) {
    const resource = record.wire.resource;
    const fields = [resource.serviceName, resource.description, resource.mimeType, ...(resource.tags ?? [])].filter((value): value is string => Boolean(value));
    for (const field of fields) for (const signature of signatures) if (matchesForbiddenSignature(field, signature)) scannerHits += 1;
  }
  const scannerWallClockSeconds = (performance.now() - scanStart) / 1_000;
  if (scannerHits) throw new Error(`pilot FC-02 deterministic scanner found ${scannerHits} hit(s)`);

  const sourceHash = `sha256:${sha(JSON.stringify({ catalog, sidecars, queries }))}`;
  const catalogById = new Map(catalog.map(item => [item.resource_id, item]));
  const sidecarById = new Map(sidecars.map(item => [item.resource_id, item]));
  const assignments = { a: [] as Array<{ task_id: string; candidate_id: string; query_id: string; resource_id: string }>,
    b: [] as Array<{ task_id: string; candidate_id: string; query_id: string; resource_id: string }> };
  const packs = {} as { a: z.infer<typeof BlindGradingPackSchema>; b: z.infer<typeof BlindGradingPackSchema> };
  for (const slot of ["a", "b"] as const) {
    const seed = `${sourceHash}\0grader-${slot}`;
    packs[slot] = BlindGradingPackSchema.parse({ version: 1, role: "grader", pack_id: `pilot-grader-${slot}`,
      instructions: "Grade capability relevance 0–3 under BUILD-PLAN §7. All candidates are blinded; return every grade with a rationale.",
      tasks: shuffled(queries, `${seed}\0queries`, item => item.query_id).map(query => {
        const taskId = opaque("task", seed, query.query_id);
        return { task_id: taskId, query: query.query, candidates: shuffled(catalog, `${seed}\0${query.query_id}`, item => item.resource_id).map(record => {
          const candidateId = opaque("candidate", seed, query.query_id, record.resource_id);
          assignments[slot].push({ task_id: taskId, candidate_id: candidateId, query_id: query.query_id, resource_id: record.resource_id });
          return { candidate_id: candidateId, listing: listing(record, sidecarById.get(record.resource_id)!) };
        }) };
      }) });
  }
  const auditAssignments = shuffled(catalog, `${sourceHash}\0audit`, item => item.resource_id).map(record => ({
    candidate_id: opaque("candidate", sourceHash, "audit", record.resource_id), resource_id: record.resource_id,
  }));
  const auditPack = { version: 1, role: "forbidden_auditor", pack_id: "pilot-fc02-audit",
    capability: "Transactional email delivery", definition: "Outbound delivery of transactional or bulk email to recipients.",
    candidates: auditAssignments.map(item => ({ candidate_id: item.candidate_id,
      description: catalogById.get(item.resource_id)!.wire.resource.description ?? catalogById.get(item.resource_id)!.wire.resource.serviceName ?? "" })) };
  const manifest = PilotManifestSchema.parse({ version: 1, created_at: createdAt, source_hash: sourceHash,
    scanner_wall_clock_seconds: scannerWallClockSeconds, scanner_hits: 0,
    grader_packs: { a: packs.a.pack_id, b: packs.b.pack_id }, assignments, audit_assignments: auditAssignments });
  return { catalog, sidecars, queries, packs, auditPack, manifest };
}

function importMap(raw: unknown, slot: "a" | "b", manifest: z.infer<typeof PilotManifestSchema>, expected: z.infer<typeof GraderRefSchema>) {
  const parsed = GraderImportSchema.parse(raw);
  if (parsed.role !== `grader_${slot}` || parsed.pack_id !== manifest.grader_packs[slot]
      || parsed.grader.run_id !== expected.run_id || parsed.grader.model !== expected.model
      || parsed.grader.prompt_hash !== expected.prompt_hash) throw new Error(`grader ${slot} provenance mismatch`);
  const source = new Map(manifest.assignments[slot].map(item => [`${item.task_id}\0${item.candidate_id}`, item]));
  if (parsed.judgments.length !== 90) throw new Error(`grader ${slot} must return 90 judgments`);
  const resolved = new Map(parsed.judgments.map(item => {
    const assignment = source.get(`${item.task_id}\0${item.candidate_id}`);
    if (!assignment) throw new Error(`grader ${slot}: unassigned judgment`);
    return [`${assignment.query_id}\0${assignment.resource_id}`, item] as const;
  }));
  if (resolved.size !== 90) throw new Error(`grader ${slot}: duplicate or missing assigned judgment`);
  return resolved;
}

export function buildAdjudicationPack(manifestRaw: unknown, aRaw: unknown, bRaw: unknown,
  refs: { a: z.infer<typeof GraderRefSchema>; b: z.infer<typeof GraderRefSchema> },
  catalogRaw: unknown[], sidecarsRaw: unknown[], queriesRaw: unknown[]) {
  const manifest = PilotManifestSchema.parse(manifestRaw);
  const a = importMap(aRaw, "a", manifest, refs.a); const b = importMap(bRaw, "b", manifest, refs.b);
  const catalog = z.array(CatalogRecordSchema).length(15).parse(catalogRaw);
  const sidecars = z.array(SidecarRecordSchema).length(15).parse(sidecarsRaw);
  const queries = z.array(QueryRecordSchema).length(6).parse(queriesRaw);
  const catalogById = new Map(catalog.map(item => [item.resource_id, item]));
  const sidecarById = new Map(sidecars.map(item => [item.resource_id, item]));
  const queryById = new Map(queries.map(item => [item.query_id, item]));
  const tasks: unknown[] = []; const assignments: Array<{ task_id: string; candidate_id: string; query_id: string; resource_id: string }> = [];
  for (const [pair, aj] of a) {
    const bj = b.get(pair)!; if (aj.grade === bj.grade) continue;
    const [queryId, resourceId] = pair.split("\0"); const taskId = opaque("task", manifest.source_hash, "adjudicate", pair);
    const candidateId = opaque("candidate", manifest.source_hash, "adjudicate", pair);
    tasks.push({ task_id: taskId, query: queryById.get(queryId!)!.query, candidate: { candidate_id: candidateId,
      listing: listing(catalogById.get(resourceId!)!, sidecarById.get(resourceId!)!) } });
    assignments.push({ task_id: taskId, candidate_id: candidateId, query_id: queryId!, resource_id: resourceId! });
  }
  return { pack: BlindAdjudicationPackSchema.parse({ version: 1, role: "adjudicator", pack_id: "pilot-adjudicator", tasks }), assignments };
}

export function derivePilotReport(input: {
  manifest: unknown; runs: unknown[]; owner: unknown; audit: unknown; rankings: unknown[]; qrels: unknown[];
  graderA: unknown; graderB: unknown; adjudicator: unknown;
  adjudicationAssignments: Array<{ task_id: string; candidate_id: string; query_id: string; resource_id: string }>;
  promptManifest: unknown[];
}) {
  const manifest = PilotManifestSchema.parse(input.manifest);
  const runs = z.array(PilotRunEvidenceSchema).min(7).parse(input.runs);
  const owner = PilotOwnerEvidenceSchema.parse(input.owner);
  const audit = ForbiddenAuditImportSchema.parse(input.audit);
  const rankings = z.array(PilotRankingSchema).length(6).parse(input.rankings);
  const qrels = z.array(QrelRecordSchema).parse(input.qrels) as QrelRecord[];
  const runIds = new Set(runs.map(item => item.run_id)); if (runIds.size !== runs.length) throw new Error("pilot run ids must be unique");
  const promptRows = z.array(z.object({ role: z.string(), run_id: z.string(), prompt_hash: z.string() }).passthrough()).length(7).parse(input.promptManifest);
  const promptByRole = new Map(promptRows.map(item => [item.role.replaceAll("-", "_"), item]));
  for (const role of ["resource_author", "distractor_author", "query_author", "grader_a", "grader_b", "adjudicator", "forbidden_auditor"] as const) {
    const run = runs.find(item => item.role === role); if (!run) throw new Error(`missing actual ${role} run evidence`);
    const prompt = promptByRole.get(role);
    if (!prompt || run.run_id !== prompt.run_id || run.prompt_hash !== prompt.prompt_hash) throw new Error(`${role}: run evidence does not match frozen prompt`);
  }
  const repairRuns = runs.filter(item => item.role === "repair").length;
  if (owner.regeneration_count !== repairRuns || owner.rejection_count < owner.regeneration_count) {
    throw new Error("owner rejection/regeneration counts do not match actual repair runs");
  }
  const graderARun = runs.find(item => item.role === "grader_a")!;
  const graderBRun = runs.find(item => item.role === "grader_b")!;
  const a = importMap(input.graderA, "a", manifest, graderARun);
  const b = importMap(input.graderB, "b", manifest, graderBRun);
  const disagreementPairs = [...a].filter(([pair, judgment]) => b.get(pair)!.grade !== judgment.grade).map(([pair]) => pair).sort();
  const adjudicatorRun = runs.find(item => item.role === "adjudicator")!;
  const adjudicator = AdjudicatorImportSchema.parse(input.adjudicator);
  if (adjudicator.pack_id !== "pilot-adjudicator" || adjudicator.adjudicator.run_id !== adjudicatorRun.run_id
      || adjudicator.adjudicator.model !== adjudicatorRun.model
      || adjudicator.adjudicator.prompt_hash !== adjudicatorRun.prompt_hash) throw new Error("adjudicator provenance mismatch");
  const assignmentByOpaque = new Map(input.adjudicationAssignments.map(item => [`${item.task_id}\0${item.candidate_id}`, item]));
  const adjudicatedPairs = adjudicator.judgments.map(item => {
    const assignment = assignmentByOpaque.get(`${item.task_id}\0${item.candidate_id}`);
    if (!assignment) throw new Error("unassigned adjudication judgment");
    return `${assignment.query_id}\0${assignment.resource_id}`;
  }).sort();
  if (new Set(adjudicatedPairs).size !== adjudicatedPairs.length
      || adjudicatedPairs.join("\n") !== disagreementPairs.join("\n")) throw new Error("adjudicator must cover every disagreement exactly once");
  const auditRun = runs.find(item => item.role === "forbidden_auditor")!;
  if (audit.auditor.run_id !== auditRun.run_id || audit.auditor.model !== auditRun.model
      || audit.auditor.prompt_hash !== auditRun.prompt_hash) throw new Error("forbidden audit provenance mismatch");
  const expectedAuditIds = manifest.audit_assignments.map(item => item.candidate_id).sort();
  const actualAuditIds = audit.findings.map(item => item.candidate_id).sort();
  if (new Set(actualAuditIds).size !== 15 || actualAuditIds.join("\n") !== expectedAuditIds.join("\n")
      || audit.findings.some(item => item.capability_present)) throw new Error("FC-02 audit is incomplete or found a capability match");
  const reviewed = new Set(qrels.filter(item => item.judge === "reviewed_agent" && item.rationale?.trim())
    .map(item => `${item.query_id}\0${item.resource_id}`));
  const expectedPairs = manifest.assignments.a.map(item => `${item.query_id}\0${item.resource_id}`).sort();
  if (qrels.length !== 90 || reviewed.size !== 90 || [...reviewed].sort().join("\n") !== expectedPairs.join("\n")) {
    throw new Error("owner-reviewed pilot qrels must cover all 6×15 pairs exactly once");
  }
  const judgedFractions = rankings.map(row => row.results.filter(id => reviewed.has(`${row.query_id}\0${id}`)).length / 10);
  const threshold = Math.min(...judgedFractions);
  const generationRuns = runs.filter(item => item.role !== "forbidden_auditor");
  const sum = (items: typeof runs, key: "input_tokens" | "output_tokens" | "wall_clock_seconds" | "api_cost_usd") => items.reduce((total, item) => total + item[key], 0);
  const scale = 10_000 / 15;
  const report = {
    status: owner.status, pilot_scope: { resources: 5, distractors: 10, capability_queries: 5, no_result_queries: 1, graders: 2, adjudicators: 1 },
    judged_at_10_threshold: threshold,
    generation_grading_cost: { agent_runs: generationRuns.length, input_tokens: sum(generationRuns, "input_tokens"), output_tokens: sum(generationRuns, "output_tokens"), wall_clock_seconds: sum(generationRuns, "wall_clock_seconds"), api_cost_usd: sum(generationRuns, "api_cost_usd"),
      rejection_count: owner.rejection_count, regeneration_count: owner.regeneration_count,
      owner_review_seconds: owner.owner_review_seconds, owner_corrections: owner.owner_corrections },
    forbidden_audit_cost: { scanner_wall_clock_seconds: manifest.scanner_wall_clock_seconds,
      agent_audit: { agent_runs: 1, input_tokens: auditRun.input_tokens, output_tokens: auditRun.output_tokens,
        wall_clock_seconds: auditRun.wall_clock_seconds, api_cost_usd: auditRun.api_cost_usd },
      owner_review_seconds: owner.forbidden_owner_review_seconds,
      projection: { catalog_records: 1_000, capabilities: 10, agent_runs: 10,
        input_tokens: Math.ceil(auditRun.input_tokens * scale), output_tokens: Math.ceil(auditRun.output_tokens * scale),
        api_cost_usd: auditRun.api_cost_usd * scale, owner_review_seconds: owner.forbidden_owner_review_seconds * scale } },
  };
  return PilotReportEvidenceSchema.parse(report);
}
