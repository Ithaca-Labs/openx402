/** Independent full-catalog forbidden-capability audit — BUILD-PLAN §6. */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  CatalogRecordSchema,
  GraderRefSchema,
  RELEASE_COUNTS,
  ResourceIdSchema,
  SidecarRecordSchema,
  type CatalogRecord,
  type SidecarRecord,
} from "../schema/schema-v2.js";
import { assertExactSignatureSync, scanForbiddenRecords } from "./forbidden-scanner.js";

const CAPABILITY_COUNT = 10;
const OpaqueListingIdSchema = z.string().regex(/^listing-[a-f0-9]{16}$/);
export const ForbiddenAuditorAssignmentSchema = GraderRefSchema.omit({ prompt_hash: true });

export const ForbiddenCapabilityDefinitionSchema = z.object({
  id: z.string().regex(/^FC-\d{2}$/),
  name: z.string().min(1),
  definition: z.string().min(1),
  boundary_basis: z.string().min(1),
  signatures: z.array(z.string().min(2)).min(1),
}).strict();

export const ForbiddenAuditListingSchema = z.object({
  listing_id: OpaqueListingIdSchema,
  serviceName: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  mimeType: z.string().optional(),
}).strict();

export const ForbiddenAuditPackSchema = z.object({
  version: z.literal(1),
  role: z.literal("forbidden_capability_auditor"),
  pack_id: z.string().min(1),
  capability: ForbiddenCapabilityDefinitionSchema.omit({ signatures: true, boundary_basis: true }),
  instructions: z.string().min(1),
  listings: z.array(ForbiddenAuditListingSchema).length(RELEASE_COUNTS.resources.total),
}).strict();

const AuditAssignmentSchema = z.object({
  listing_id: OpaqueListingIdSchema,
  resource_id: ResourceIdSchema,
  author_run_id: z.string().min(1),
}).strict();

export const ForbiddenAuditManifestSchema = z.object({
  version: z.literal(1),
  audit_run_id: z.string().min(1),
  created_at: z.string().datetime(),
  corpus_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  forbidden_source_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  deterministic_scan_passed: z.literal(true),
  deterministic_hit_count: z.literal(0),
  audits: z.array(z.object({
    capability_id: z.string().regex(/^FC-\d{2}$/),
    pack_id: z.string().min(1),
    prompt_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    auditor: GraderRefSchema,
    assignments: z.array(AuditAssignmentSchema).length(RELEASE_COUNTS.resources.total),
  }).strict()).length(CAPABILITY_COUNT),
}).strict();

export const ForbiddenAuditDecisionSchema = z.object({
  listing_id: OpaqueListingIdSchema,
  possible_match: z.boolean(),
  rationale: z.string().min(1).max(1_000).nullable(),
}).strict().superRefine((value, context) => {
  if (value.possible_match && value.rationale === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["rationale"], message: "possible match requires rationale" });
  }
});

export const ForbiddenAuditImportSchema = z.object({
  version: z.literal(1),
  role: z.literal("forbidden_capability_auditor"),
  capability_id: z.string().regex(/^FC-\d{2}$/),
  pack_id: z.string().min(1),
  auditor: GraderRefSchema,
  audited_at: z.string().datetime(),
  decisions: z.array(ForbiddenAuditDecisionSchema).length(RELEASE_COUNTS.resources.total),
}).strict();

export const OwnerMatchDecisionSchema = z.object({
  resource_id: ResourceIdSchema,
  decision: z.enum(["false_positive", "confirmed_match"]),
  rationale: z.string().min(1).max(2_000),
}).strict();

export const ForbiddenAuditOwnerSignoffSchema = z.object({
  version: z.literal(1),
  capabilities: z.array(z.object({
    capability_id: z.string().regex(/^FC-\d{2}$/),
    status: z.enum(["approved_absent", "blocked_present"]),
    reviewer: z.string().min(1),
    reviewed_at: z.string().datetime(),
    notes: z.string().min(1).max(2_000).nullable(),
    match_decisions: z.array(OwnerMatchDecisionSchema),
  }).strict()).length(CAPABILITY_COUNT),
}).strict();

export const ForbiddenCapabilityAuditReportSchema = z.object({
  version: z.literal(1),
  audit_run_id: z.string().min(1),
  generated_at: z.string().datetime(),
  corpus_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  forbidden_source_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  deterministic_scan_passed: z.literal(true),
  deterministic_hit_count: z.literal(0),
  agent_audits_complete: z.literal(true),
  owner_signoff_complete: z.literal(true),
  overall_passed: z.boolean(),
  capabilities: z.array(z.object({
    capability_id: z.string().regex(/^FC-\d{2}$/),
    capability_name: z.string().min(1),
    auditor: GraderRefSchema,
    audited_records: z.literal(RELEASE_COUNTS.resources.total),
    possible_matches: z.array(z.object({
      resource_id: ResourceIdSchema,
      agent_rationale: z.string().min(1),
      owner_decision: z.enum(["false_positive", "confirmed_match"]),
      owner_rationale: z.string().min(1),
    }).strict()),
    owner_status: z.enum(["approved_absent", "blocked_present"]),
    reviewer: z.string().min(1),
    reviewed_at: z.string().datetime(),
  }).strict()).length(CAPABILITY_COUNT),
}).strict();

export type ForbiddenCapabilityDefinition = z.infer<typeof ForbiddenCapabilityDefinitionSchema>;
export type ForbiddenAuditPack = z.infer<typeof ForbiddenAuditPackSchema>;
export type ForbiddenAuditManifest = z.infer<typeof ForbiddenAuditManifestSchema>;
export type ForbiddenAuditImport = z.infer<typeof ForbiddenAuditImportSchema>;
export type ForbiddenAuditOwnerSignoff = z.infer<typeof ForbiddenAuditOwnerSignoffSchema>;
export type ForbiddenCapabilityAuditReport = z.infer<typeof ForbiddenCapabilityAuditReportSchema>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function forbiddenCorpusHash(catalog: readonly CatalogRecord[], sidecars: readonly SidecarRecord[]): string {
  return `sha256:${sha256(JSON.stringify({ catalog, sidecars }))}`;
}

function opaqueListing(seed: string, capabilityId: string, resourceId: string): string {
  return `listing-${sha256(`${seed}\0${capabilityId}\0${resourceId}`).slice(0, 16)}`;
}

function unique(values: readonly string[], label: string): void {
  const duplicate = values.find((value, index) => values.indexOf(value) !== index);
  if (duplicate) throw new Error(`duplicate ${label}: ${duplicate}`);
}

function parseRecords<TSchema extends z.ZodTypeAny>(schema: TSchema, raw: readonly unknown[], label: string): Array<z.output<TSchema>> {
  return raw.map((value, index) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new Error(`${label}[${index}]: ${parsed.error.message}`);
    return parsed.data;
  });
}

export function parseForbiddenCapabilities(markdown: string): ForbiddenCapabilityDefinition[] {
  const block = markdown.match(/<!-- FORBIDDEN_SIGNATURES_START -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- FORBIDDEN_SIGNATURES_END -->/);
  if (!block) throw new Error("forbidden signature block missing");
  const machine = z.array(ForbiddenCapabilityDefinitionSchema.pick({ id: true, name: true, signatures: true }))
    .length(CAPABILITY_COUNT).parse(JSON.parse(block[1]!));
  return machine.map((item, index) => {
    const next = machine[index + 1];
    const start = markdown.indexOf(`## ${item.id} — ${item.name}`);
    const end = next ? markdown.indexOf(`## ${next.id} — ${next.name}`) : markdown.indexOf("## Machine-readable scanner signatures");
    if (start < 0 || end < 0) throw new Error(`${item.id}: human definition section missing`);
    const section = markdown.slice(start, end);
    const definition = section.match(/\*\*Definition\.\*\*\s*([^\n]+(?:\n(?!\*\*Boundary)[^\n]+)*)/)?.[1]?.replace(/\s+/g, " ").trim();
    const boundary = section.match(/\*\*Boundary basis\.\*\*\s*([^\n]+(?:\n(?!\*\*Scanner)[^\n]+)*)/)?.[1]?.replace(/\s+/g, " ").trim();
    if (!definition || !boundary) throw new Error(`${item.id}: definition or boundary basis missing`);
    assertExactSignatureSync(section, item.signatures, item.id);
    return ForbiddenCapabilityDefinitionSchema.parse({ ...item, definition, boundary_basis: boundary });
  });
}

function validateCorpus(rawCatalog: readonly unknown[], rawSidecars: readonly unknown[]) {
  const catalog = parseRecords(CatalogRecordSchema, rawCatalog, "catalog");
  const sidecars = parseRecords(SidecarRecordSchema, rawSidecars, "sidecars");
  if (catalog.length !== RELEASE_COUNTS.resources.total || sidecars.length !== RELEASE_COUNTS.resources.total) {
    throw new Error(`forbidden audit requires exactly 1000 catalog and sidecar records; got ${catalog.length}/${sidecars.length}`);
  }
  const expected = Array.from({ length: 1_000 }, (_, index) => `res-${String(index + 1).padStart(4, "0")}`);
  const catalogIds = catalog.map(record => record.resource_id);
  const sidecarIds = sidecars.map(record => record.resource_id);
  unique(catalogIds, "catalog resource_id");
  unique(sidecarIds, "sidecar resource_id");
  if ([...catalogIds].sort().join("\n") !== expected.join("\n")) throw new Error("catalog ids must be exactly res-0001..res-1000");
  if ([...sidecarIds].sort().join("\n") !== expected.join("\n")) throw new Error("sidecar ids must be exactly res-0001..res-1000");
  return { catalog, sidecars };
}

function deterministicHits(catalog: readonly CatalogRecord[], capabilities: readonly ForbiddenCapabilityDefinition[]) {
  return scanForbiddenRecords(catalog, capabilities).map(hit => ({
    resource_id: hit.resourceId,
    capability_id: hit.capabilityId,
    signature: hit.signature,
  }));
}

function shuffled<T>(values: readonly T[], seed: string, key: (value: T) => string): T[] {
  return [...values].sort((a, b) => sha256(`${seed}\0${key(a)}`).localeCompare(sha256(`${seed}\0${key(b)}`)));
}

export function prepareForbiddenCapabilityAudit(
  rawCatalog: readonly unknown[],
  rawSidecars: readonly unknown[],
  forbiddenMarkdown: string,
  options: {
    auditRunId: string;
    createdAt: string;
    seed: string;
    auditors: readonly z.infer<typeof ForbiddenAuditorAssignmentSchema>[];
  },
): { packs: ForbiddenAuditPack[]; prompts: string[]; manifest: ForbiddenAuditManifest } {
  z.string().datetime().parse(options.createdAt);
  const { catalog, sidecars } = validateCorpus(rawCatalog, rawSidecars);
  const capabilities = parseForbiddenCapabilities(forbiddenMarkdown);
  if (options.auditors.length !== CAPABILITY_COUNT) throw new Error("exactly 10 auditors are required");
  const auditors = options.auditors.map(value => ForbiddenAuditorAssignmentSchema.parse(value));
  unique(auditors.map(value => value.run_id), "auditor run_id");
  const authorRuns = new Set(sidecars.map(record => record.generation.run_id));
  for (const auditor of auditors) {
    if (authorRuns.has(auditor.run_id)) throw new Error(`${auditor.run_id}: auditor authored a corpus record`);
  }
  const hits = deterministicHits(catalog, capabilities);
  if (hits.length > 0) throw new Error(`deterministic forbidden scan failed with ${hits.length} hit(s)`);
  const sidecarById = new Map(sidecars.map(record => [record.resource_id, record]));
  const packs: ForbiddenAuditPack[] = [];
  const prompts: string[] = [];
  const audits: ForbiddenAuditManifest["audits"] = [];
  for (let index = 0; index < capabilities.length; index++) {
    const capability = capabilities[index]!;
    const auditorBase = auditors[index]!;
    const packId = `${options.auditRunId}-${capability.id.toLowerCase()}`;
    const seed = `${options.seed}\0${capability.id}\0${auditorBase.run_id}`;
    const assignments: ForbiddenAuditManifest["audits"][number]["assignments"] = [];
    const listings = shuffled(catalog, seed, record => record.resource_id).map(record => {
      const listingId = opaqueListing(seed, capability.id, record.resource_id);
      assignments.push({
        listing_id: listingId,
        resource_id: record.resource_id,
        author_run_id: sidecarById.get(record.resource_id)!.generation.run_id,
      });
      const resource = record.wire.resource;
      return ForbiddenAuditListingSchema.parse({
        listing_id: listingId,
        ...(resource.serviceName === undefined ? {} : { serviceName: resource.serviceName }),
        ...(resource.description === undefined ? {} : { description: resource.description }),
        ...(resource.tags === undefined ? {} : { tags: resource.tags }),
        ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
      });
    });
    const pack = ForbiddenAuditPackSchema.parse({
      version: 1,
      role: "forbidden_capability_auditor",
      pack_id: packId,
      capability: { id: capability.id, name: capability.name, definition: capability.definition },
      instructions: "Inspect every listing independently. Mark possible_match true only when the listing may actually provide or plausibly claim this capability; otherwise false. Return exactly one decision per opaque listing id. Do not infer identities.",
      listings,
    });
    const promptBasis = `# Forbidden-capability audit — ${capability.id}\n\nYou are a fresh isolated audit context assigned only ${capability.id}: ${capability.name}.\nRead the attached pack ${packId}. Inspect all 1,000 listings. Do not access catalog files, sidecars, author manifests, retrieval output, another capability pack, or another auditor's decisions. Return one decision for every listing using ForbiddenAuditImportSchema with pack_id ${packId}, capability_id ${capability.id}, run_id ${auditorBase.run_id}, and model ${auditorBase.model}. Set possible_match=true only for a plausible provider/claim of the defined capability and include a concrete rationale for each possible match. Do not approve absence; the owner signs off later. Discard this context after the import is written.`;
    const promptHash = `sha256:${sha256(JSON.stringify({ pack, prompt: promptBasis }))}`;
    const auditor = GraderRefSchema.parse({ ...auditorBase, prompt_hash: promptHash });
    const prompt = `${promptBasis}\nTask-pack prompt_hash: ${promptHash}\n`;
    packs.push(pack);
    prompts.push(prompt);
    audits.push({
      capability_id: capability.id,
      pack_id: packId,
      prompt_hash: promptHash,
      auditor,
      assignments,
    });
  }
  return {
    packs,
    prompts,
    manifest: ForbiddenAuditManifestSchema.parse({
      version: 1,
      audit_run_id: options.auditRunId,
      created_at: options.createdAt,
      corpus_hash: forbiddenCorpusHash(catalog, sidecars),
      forbidden_source_hash: `sha256:${sha256(forbiddenMarkdown)}`,
      deterministic_scan_passed: true,
      deterministic_hit_count: 0,
      audits,
    }),
  };
}

type ResolvedMatch = { resource_id: string; rationale: string };

function validateImports(
  rawImports: readonly unknown[],
  manifest: ForbiddenAuditManifest,
): Map<string, { source: ForbiddenAuditImport; matches: ResolvedMatch[] }> {
  if (rawImports.length !== CAPABILITY_COUNT) throw new Error("exactly 10 independent audit imports are required");
  const imports = rawImports.map(value => ForbiddenAuditImportSchema.parse(value));
  unique(imports.map(value => value.capability_id), "audit import capability_id");
  unique(imports.map(value => value.auditor.run_id), "audit import auditor run_id");
  const result = new Map<string, { source: ForbiddenAuditImport; matches: ResolvedMatch[] }>();
  for (const expected of manifest.audits) {
    const imported = imports.find(value => value.capability_id === expected.capability_id);
    if (!imported) throw new Error(`${expected.capability_id}: audit import missing`);
    if (imported.pack_id !== expected.pack_id || JSON.stringify(imported.auditor) !== JSON.stringify(expected.auditor)) {
      throw new Error(`${expected.capability_id}: pack or auditor provenance mismatch`);
    }
    const assignmentById = new Map(expected.assignments.map(value => [value.listing_id, value]));
    unique(imported.decisions.map(value => value.listing_id), `${expected.capability_id} listing decision`);
    const matches: ResolvedMatch[] = [];
    for (const decision of imported.decisions) {
      const assignment = assignmentById.get(decision.listing_id);
      if (!assignment) throw new Error(`${expected.capability_id}: decision for unassigned listing`);
      if (imported.auditor.run_id === assignment.author_run_id) throw new Error(`${expected.capability_id}: auditor self-audited authored record`);
      if (decision.possible_match) matches.push({ resource_id: assignment.resource_id, rationale: decision.rationale! });
    }
    result.set(expected.capability_id, { source: imported, matches });
  }
  return result;
}

export function finalizeForbiddenCapabilityAudit(
  rawCatalog: readonly unknown[],
  rawSidecars: readonly unknown[],
  forbiddenMarkdown: string,
  rawManifest: unknown,
  rawImports: readonly unknown[],
  rawOwnerSignoff: unknown,
  generatedAt: string,
): ForbiddenCapabilityAuditReport {
  z.string().datetime().parse(generatedAt);
  const { catalog, sidecars } = validateCorpus(rawCatalog, rawSidecars);
  const capabilities = parseForbiddenCapabilities(forbiddenMarkdown);
  const hits = deterministicHits(catalog, capabilities);
  if (hits.length > 0) throw new Error(`deterministic forbidden scan failed with ${hits.length} hit(s)`);
  const manifest = ForbiddenAuditManifestSchema.parse(rawManifest);
  if (manifest.corpus_hash !== forbiddenCorpusHash(catalog, sidecars)) throw new Error("audit manifest corpus hash mismatch");
  if (manifest.forbidden_source_hash !== `sha256:${sha256(forbiddenMarkdown)}`) throw new Error("audit manifest forbidden source hash mismatch");
  const imports = validateImports(rawImports, manifest);
  const owner = ForbiddenAuditOwnerSignoffSchema.parse(rawOwnerSignoff);
  unique(owner.capabilities.map(value => value.capability_id), "owner capability signoff");

  const reports: ForbiddenCapabilityAuditReport["capabilities"] = [];
  for (const capability of capabilities) {
    const audit = imports.get(capability.id)!;
    const signoff = owner.capabilities.find(value => value.capability_id === capability.id);
    if (!signoff) throw new Error(`${capability.id}: explicit owner signoff missing`);
    const matchIds = audit.matches.map(value => value.resource_id).sort();
    const ownerIds = signoff.match_decisions.map(value => value.resource_id).sort();
    unique(ownerIds, `${capability.id} owner match decision`);
    if (matchIds.join("\n") !== ownerIds.join("\n")) throw new Error(`${capability.id}: owner must decide every and only reported match`);
    const ownerById = new Map(signoff.match_decisions.map(value => [value.resource_id, value]));
    const confirmed = signoff.match_decisions.some(value => value.decision === "confirmed_match");
    const expectedStatus = confirmed ? "blocked_present" : "approved_absent";
    if (signoff.status !== expectedStatus) throw new Error(`${capability.id}: owner status must be ${expectedStatus}`);
    reports.push({
      capability_id: capability.id,
      capability_name: capability.name,
      auditor: audit.source.auditor,
      audited_records: RELEASE_COUNTS.resources.total,
      possible_matches: audit.matches.map(match => ({
        resource_id: match.resource_id,
        agent_rationale: match.rationale,
        owner_decision: ownerById.get(match.resource_id)!.decision,
        owner_rationale: ownerById.get(match.resource_id)!.rationale,
      })).sort((a, b) => a.resource_id.localeCompare(b.resource_id)),
      owner_status: signoff.status,
      reviewer: signoff.reviewer,
      reviewed_at: signoff.reviewed_at,
    });
  }
  return ForbiddenCapabilityAuditReportSchema.parse({
    version: 1,
    audit_run_id: manifest.audit_run_id,
    generated_at: generatedAt,
    corpus_hash: manifest.corpus_hash,
    forbidden_source_hash: manifest.forbidden_source_hash,
    deterministic_scan_passed: true,
    deterministic_hit_count: 0,
    agent_audits_complete: true,
    owner_signoff_complete: true,
    overall_passed: reports.every(report => report.owner_status === "approved_absent"),
    capabilities: reports,
  });
}

export async function loadForbiddenMarkdown(path: string): Promise<string> {
  return readFile(path, "utf8");
}
