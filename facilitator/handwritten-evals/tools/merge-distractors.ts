/**
 * Step 4 merge/validation — BUILD-PLAN §1, §4, §6, §9 step 4, and §11.
 *
 * Reads isolated distractor shards, validates the real v2 schemas, enforces the frozen assignment
 * policy, scans all searchable metadata in the complete corpus for forbidden capabilities, and
 * appends the distractor records to the existing 100-record labeled catalog only after every gate passes.
 * With no distractor shards it performs a clean zero-record dry run and writes nothing.
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  DISTRACTOR_AGENTS_PER_WAVE,
  DISTRACTOR_RECORDS_PER_SHARD,
  DISTRACTOR_UPTO_NUMBERS,
  DISTRACTOR_WAVES,
  FIRST_DISTRACTOR_NUMBER,
  LAST_DISTRACTOR_NUMBER,
  distractorAssignment,
  distractorResourceId,
} from "../distractor-config.js";
import {
  CatalogRecordSchema,
  checkSidecarAgainstWire,
  DISTRIBUTION_TARGETS,
  RELEASE_COUNTS,
  SidecarRecordSchema,
  type CatalogRecord,
  type SidecarRecord,
} from "../schema/schema-v2.js";
import { assertExactSignatureSync, scanForbiddenRecords } from "./forbidden-scanner.js";

const ROOT = resolve(import.meta.dirname, "..");
const STAGING = resolve(ROOT, "staging/distractors");
const PROMPT_MANIFEST = resolve(ROOT, "staging/distractor-prompts/manifest.jsonl");
const FORBIDDEN = resolve(ROOT, "forbidden-capabilities.md");
const CATALOG_PATH = resolve(ROOT, "catalog/catalog-v2.jsonl");
const SIDECAR_PATH = resolve(ROOT, "catalog/sidecar-v2.jsonl");

const EXPECTED_UPTO_IDS = new Set(DISTRACTOR_UPTO_NUMBERS.map(distractorResourceId));
const RUN_PATTERN = /^run-distractors-w(\d{2})-a(\d{2})$/;

const ForbiddenCapabilitySchema = z.object({
  id: z.string().regex(/^FC-\d{2}$/),
  name: z.string().min(1),
  signatures: z.array(z.string().min(2)).min(1),
}).strict();

const PromptManifestSchema = z.object({
  run_id: z.string().min(1),
  shard_id: z.string().min(1),
  prompt_hash: z.string().min(1),
  resource_ids: z.array(z.string()).length(DISTRACTOR_RECORDS_PER_SHARD),
}).passthrough();

type ForbiddenCapability = z.infer<typeof ForbiddenCapabilitySchema>;
type PromptManifestRecord = z.infer<typeof PromptManifestSchema>;

const errors: string[] = [];

function fail(message: string): void {
  errors.push(message);
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

async function loadJsonl(path: string, required = true): Promise<unknown[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (!required && (error as NodeJS.ErrnoException).code === "ENOENT") return [];
    fail(`${path}: ${(error as Error).message}`);
    return [];
  }

  return text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        fail(`${path}:${index + 1}: invalid JSON — ${(error as Error).message}`);
        return null;
      }
    })
    .filter(value => value !== null);
}

async function listRunDirectories(): Promise<string[]> {
  try {
    return (await readdir(STAGING, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function loadForbiddenCapabilities(): Promise<ForbiddenCapability[]> {
  const markdown = await readFile(FORBIDDEN, "utf8");
  const match = markdown.match(
    /<!-- FORBIDDEN_SIGNATURES_START -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- FORBIDDEN_SIGNATURES_END -->/,
  );
  if (!match) throw new Error(`${FORBIDDEN}: machine-readable signature block not found`);

  const parsed = z.array(ForbiddenCapabilitySchema).length(10).safeParse(JSON.parse(match[1]!));
  if (!parsed.success) throw new Error(`${FORBIDDEN}: ${formatIssues(parsed.error)}`);
  const capabilities = parsed.data;

  const ids = capabilities.map(capability => capability.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${FORBIDDEN}: duplicate capability ids`);

  const humanText = markdown.split("## Machine-readable scanner signatures", 1)[0]!;
  for (const [index, capability] of capabilities.entries()) {
    const next = capabilities[index + 1];
    const startMarker = `## ${capability.id} — ${capability.name}`;
    const start = humanText.indexOf(startMarker);
    const end = next ? humanText.indexOf(`## ${next.id} — ${next.name}`) : humanText.length;
    if (start < 0 || end < 0) throw new Error(`${FORBIDDEN}: missing human section ${startMarker}`);
    const section = humanText.slice(start, end);
    assertExactSignatureSync(section, capability.signatures, `${FORBIDDEN}: ${capability.id}`);
  }
  return capabilities;
}

function scanForbidden(
  records: readonly CatalogRecord[],
  capabilities: readonly ForbiddenCapability[],
): number {
  const hits = scanForbiddenRecords(records, capabilities);
  for (const hit of hits) {
    fail(
      `${hit.resourceId} ${hit.field}: forbidden ${hit.capabilityId} ${hit.capabilityName} ` +
      `signature "${hit.signature}"`,
    );
  }
  return hits.length;
}

function resourceNumber(resourceId: string): number {
  return Number(resourceId.slice(4));
}

function parseCatalog(rawRecords: unknown[], source: string): CatalogRecord[] {
  const records: CatalogRecord[] = [];
  for (const raw of rawRecords) {
    const parsed = CatalogRecordSchema.safeParse(raw);
    if (!parsed.success) {
      fail(`${source} wire ${(raw as { resource_id?: string })?.resource_id ?? "?"}: ${formatIssues(parsed.error)}`);
    } else {
      records.push(parsed.data);
    }
  }
  return records;
}

function parseSidecars(
  rawRecords: unknown[],
  source: string,
  enforceDistractorShape = false,
): SidecarRecord[] {
  const records: SidecarRecord[] = [];
  for (const raw of rawRecords) {
    const parsed = SidecarRecordSchema.safeParse(raw);
    if (!parsed.success) {
      fail(`${source} sidecar ${(raw as { resource_id?: string })?.resource_id ?? "?"}: ${formatIssues(parsed.error)}`);
      continue;
    }
    if (enforceDistractorShape && Object.prototype.hasOwnProperty.call(raw, "axes")) {
      fail(`${parsed.data.resource_id}: distractor sidecar must omit axes`);
    }
    if (enforceDistractorShape && Object.prototype.hasOwnProperty.call(raw, "mcp")) {
      fail(`${parsed.data.resource_id}: distractor sidecar must omit mcp`);
    }
    records.push(parsed.data);
  }
  return records;
}

async function loadPromptManifest(): Promise<Map<string, PromptManifestRecord>> {
  const rawRecords = await loadJsonl(PROMPT_MANIFEST);
  const records = new Map<string, PromptManifestRecord>();
  for (const raw of rawRecords) {
    const parsed = PromptManifestSchema.safeParse(raw);
    if (!parsed.success) {
      fail(`${PROMPT_MANIFEST}: ${formatIssues(parsed.error)}`);
      continue;
    }
    if (records.has(parsed.data.run_id)) fail(`${PROMPT_MANIFEST}: duplicate run_id ${parsed.data.run_id}`);
    records.set(parsed.data.run_id, parsed.data);
  }
  const expectedPrompts = DISTRACTOR_WAVES * DISTRACTOR_AGENTS_PER_WAVE;
  if (records.size !== expectedPrompts) {
    fail(`${PROMPT_MANIFEST}: expected ${expectedPrompts} prompt records, got ${records.size}`);
  }
  return records;
}

function reportErrors(): never {
  console.error(`\n${errors.length} validation failure(s):\n`);
  for (const error of errors) console.error(`  FAIL  ${error}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [capabilities, runDirectories, promptManifest, labeledCatalogRaw, labeledSidecarRaw] = await Promise.all([
    loadForbiddenCapabilities(),
    listRunDirectories(),
    loadPromptManifest(),
    loadJsonl(CATALOG_PATH),
    loadJsonl(SIDECAR_PATH),
  ]);

  const labeledCatalog = parseCatalog(labeledCatalogRaw, "catalog");
  const labeledSidecars = parseSidecars(labeledSidecarRaw, "catalog");
  if (labeledCatalog.length !== RELEASE_COUNTS.resources.labeled) {
    fail(`existing catalog: expected 100 labeled wire records, got ${labeledCatalog.length}`);
  }
  if (labeledSidecars.length !== RELEASE_COUNTS.resources.labeled) {
    fail(`existing catalog: expected 100 labeled sidecars, got ${labeledSidecars.length}`);
  }
  if (labeledSidecars.some(record => record.is_distractor)) {
    fail("existing 100-record sidecar contains a distractor before Step 4 merge");
  }

  const distractorCatalog: CatalogRecord[] = [];
  const distractorSidecars: SidecarRecord[] = [];

  for (const run of runDirectories) {
    if (!RUN_PATTERN.test(run)) {
      fail(`${run}: unexpected distractor staging directory name`);
      continue;
    }
    const [wireRaw, sidecarRaw] = await Promise.all([
      loadJsonl(resolve(STAGING, run, "wire.jsonl")),
      loadJsonl(resolve(STAGING, run, "sidecar.jsonl")),
    ]);
    if (wireRaw.length !== DISTRACTOR_RECORDS_PER_SHARD) {
      fail(`${run}: expected ${DISTRACTOR_RECORDS_PER_SHARD} wire records, got ${wireRaw.length}`);
    }
    if (sidecarRaw.length !== DISTRACTOR_RECORDS_PER_SHARD) {
      fail(`${run}: expected ${DISTRACTOR_RECORDS_PER_SHARD} sidecar records, got ${sidecarRaw.length}`);
    }
    distractorCatalog.push(...parseCatalog(wireRaw, run));
    distractorSidecars.push(...parseSidecars(sidecarRaw, run, true));
  }

  console.log(`distractor records: ${distractorCatalog.length} wire, ${distractorSidecars.length} sidecar`);
  const httpCount = distractorSidecars.filter(record => record.resource_type === "http").length;
  const mcpCount = distractorSidecars.filter(record => record.resource_type === "mcp").length;
  console.log(`resource_type distribution: http=${httpCount} mcp=${mcpCount} (chosen target ${RELEASE_COUNTS.resources.distractor}/0)`);

  const completeCorpus = [...labeledCatalog, ...distractorCatalog];
  const forbiddenHits = scanForbidden(completeCorpus, capabilities);
  console.log(`forbidden-capability scan: ${completeCorpus.length} catalog records, ${forbiddenHits} hits`);

  if (distractorCatalog.length === 0 && distractorSidecars.length === 0 && runDirectories.length === 0) {
    if (errors.length > 0) reportErrors();
    console.log("0 records; nothing to merge");
    return;
  }

  const expectedRunDirectories = DISTRACTOR_WAVES * DISTRACTOR_AGENTS_PER_WAVE;
  if (runDirectories.length !== expectedRunDirectories) {
    fail(`expected ${expectedRunDirectories} run directories, got ${runDirectories.length}`);
  }
  if (distractorCatalog.length !== RELEASE_COUNTS.resources.distractor) {
    fail(`expected ${RELEASE_COUNTS.resources.distractor} distractor wire records, got ${distractorCatalog.length}`);
  }
  if (distractorSidecars.length !== RELEASE_COUNTS.resources.distractor) {
    fail(`expected ${RELEASE_COUNTS.resources.distractor} distractor sidecars, got ${distractorSidecars.length}`);
  }

  const catalogIds = distractorCatalog.map(record => record.resource_id);
  const sidecarIds = distractorSidecars.map(record => record.resource_id);
  for (const [label, ids] of [["wire", catalogIds], ["sidecar", sidecarIds]] as const) {
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicates.length > 0) fail(`duplicate distractor ${label} ids: ${[...new Set(duplicates)].join(", ")}`);
  }

  const expectedIds = Array.from(
    { length: LAST_DISTRACTOR_NUMBER - FIRST_DISTRACTOR_NUMBER + 1 },
    (_, index) => distractorResourceId(FIRST_DISTRACTOR_NUMBER + index),
  );
  for (const id of expectedIds) {
    if (!catalogIds.includes(id)) fail(`missing distractor wire ${id}`);
    if (!sidecarIds.includes(id)) fail(`missing distractor sidecar ${id}`);
  }
  const catalogById = new Map(distractorCatalog.map(record => [record.resource_id, record]));
  const sidecarById = new Map(distractorSidecars.map(record => [record.resource_id, record]));

  for (const id of new Set([...catalogIds, ...sidecarIds])) {
    if (!catalogById.has(id)) fail(`${id}: sidecar has no matching wire record`);
    if (!sidecarById.has(id)) fail(`${id}: wire has no matching sidecar record`);
  }

  for (const sidecar of distractorSidecars) {
    const number = resourceNumber(sidecar.resource_id);
    if (number < FIRST_DISTRACTOR_NUMBER || number > LAST_DISTRACTOR_NUMBER) {
      fail(`${sidecar.resource_id}: distractor id outside ${distractorResourceId(FIRST_DISTRACTOR_NUMBER)}..${distractorResourceId(LAST_DISTRACTOR_NUMBER)}`);
      continue;
    }
    const expected = distractorAssignment(number);
    if (sidecar.provider_id !== expected.providerId) {
      fail(`${sidecar.resource_id}: provider_id ${sidecar.provider_id}, expected ${expected.providerId}`);
    }
    if (sidecar.generation.run_id !== expected.runId) {
      fail(`${sidecar.resource_id}: run_id ${sidecar.generation.run_id}, expected ${expected.runId}`);
    }
    if (sidecar.generation.shard_id !== expected.shardId) {
      fail(`${sidecar.resource_id}: shard_id ${sidecar.generation.shard_id}, expected ${expected.shardId}`);
    }
    if (sidecar.derived_from.generation_id !== sidecar.generation.run_id) {
      fail(
        `${sidecar.resource_id}: derived_from.generation_id ${sidecar.derived_from.generation_id} ` +
        `must equal generation.run_id ${sidecar.generation.run_id}`,
      );
    }
    const prompt = promptManifest.get(expected.runId);
    if (!prompt) {
      fail(`${sidecar.resource_id}: no prompt manifest entry for ${expected.runId}`);
    } else {
      if (sidecar.generation.prompt_hash !== prompt.prompt_hash) {
        fail(`${sidecar.resource_id}: prompt_hash does not match ${expected.runId} manifest`);
      }
      if (prompt.shard_id !== expected.shardId || !prompt.resource_ids.includes(sidecar.resource_id)) {
        fail(`${sidecar.resource_id}: prompt manifest assignment mismatch`);
      }
    }
    if (!sidecar.is_distractor) fail(`${sidecar.resource_id}: is_distractor must be true`);
    if (sidecar.resource_type !== "http") fail(`${sidecar.resource_id}: distractors are HTTP-only`);
    if (sidecar.is_sparse) fail(`${sidecar.resource_id}: package requires is_sparse false`);
    if (sidecar.adversarial_kind !== null) fail(`${sidecar.resource_id}: adversarial_kind must be null`);
    if (sidecar.family !== null || sidecar.family_slot !== null) {
      fail(`${sidecar.resource_id}: family and family_slot must be null`);
    }
    if (sidecar.review_status !== "pending" || sidecar.reviewed_at !== null || sidecar.owner_note !== null) {
      fail(`${sidecar.resource_id}: new author output must have pending/null/null review provenance`);
    }

    const wire = catalogById.get(sidecar.resource_id);
    if (!wire) continue;
    const hostname = new URL(wire.wire.resource.url).hostname;
    if (hostname !== `${expected.providerId}.stellar-bazaar.example`) {
      fail(`${sidecar.resource_id}: hostname ${hostname}, expected ${expected.providerId}.stellar-bazaar.example`);
    }
    for (const error of checkSidecarAgainstWire(sidecar, wire.wire)) fail(error);
  }

  const uptoIds = distractorCatalog
    .filter(record => record.wire.accepts.some(option => option.scheme === "upto"))
    .map(record => record.resource_id)
    .sort();
  const exactOnlyCount = distractorCatalog.length - uptoIds.length;
  const maxUpto = Math.floor(RELEASE_COUNTS.resources.distractor * DISTRIBUTION_TARGETS.distractor_upto_max_fraction);
  console.log(`scheme distribution: exact_only=${exactOnlyCount} upto-bearing=${uptoIds.length} (maximum ${maxUpto})`);
  if (uptoIds.length > maxUpto) fail(`upto-bearing distractors ${uptoIds.length}, maximum ${maxUpto}`);
  for (const id of uptoIds) {
    if (!EXPECTED_UPTO_IDS.has(id)) fail(`${id}: upto is not assigned to this resource`);
    const schemes = new Set(catalogById.get(id)?.wire.accepts.map(option => option.scheme));
    if (!schemes.has("exact")) fail(`${id}: assigned upto exception must also carry exact`);
  }
  for (const id of EXPECTED_UPTO_IDS) {
    if (!uptoIds.includes(id)) fail(`${id}: assigned exact+upto exception lacks upto`);
  }

  if (httpCount !== RELEASE_COUNTS.resources.distractor || mcpCount !== 0) {
    fail(`HTTP-only target violated: http=${httpCount} mcp=${mcpCount}`);
  }
  const allSidecars = [...labeledSidecars, ...distractorSidecars];
  const providerNumbers = allSidecars.map(record => Number(record.provider_id.slice("provider-".length)));
  if (providerNumbers.some(number => number < 1 || number > RELEASE_COUNTS.providers)) {
    fail("provider_id outside provider-001..provider-120 budget");
  }

  if (errors.length > 0) reportErrors();

  const mergedCatalog = [...labeledCatalog, ...distractorCatalog]
    .sort((left, right) => left.resource_id.localeCompare(right.resource_id));
  const mergedSidecars = [...labeledSidecars, ...distractorSidecars]
    .sort((left, right) => left.resource_id.localeCompare(right.resource_id));
  if (mergedCatalog.length !== RELEASE_COUNTS.resources.total || mergedSidecars.length !== RELEASE_COUNTS.resources.total) {
    throw new Error("internal count error before write");
  }

  await Promise.all([
    writeFile(CATALOG_PATH, `${mergedCatalog.map(record => JSON.stringify(record)).join("\n")}\n`),
    writeFile(SIDECAR_PATH, `${mergedSidecars.map(record => JSON.stringify(record)).join("\n")}\n`),
  ]);
  console.log(`merged ${distractorCatalog.length} distractors; catalog now has ${mergedCatalog.length} records`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
