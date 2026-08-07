/**
 * Deterministic Step 6 dataset freeze contract (BUILD-PLAN §§6, 9, 11, 12.1).
 *
 * This module validates and hashes inputs. It never reads or writes qrels: the release-query
 * index contains query IDs and semantic-record hashes only, so it cannot expose judgments.
 */

import { createHash } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import {
  CatalogRecordSchema,
  checkSidecarAgainstWire,
  MCP_QUERY_SUBTYPES,
  QUERY_CLASS_TARGETS,
  QueryRecordSchema,
  RELEASE_COUNTS,
  SidecarRecordSchema,
  type CatalogRecord,
  type QueryRecord,
  type SidecarRecord,
} from "../schema/schema-v2.js";

export const DATASET_MANIFEST_PATH = "manifests/dataset-v2.json";
export const RELEASE_QUERY_INDEX_PATH = "manifests/release-queries-v2.json";
export const RELEASE_RUN_LEDGER_PATH = "manifests/release-runs-v2.jsonl";

/** Every input whose bytes define the frozen v2 dataset or its interpretation. */
export const FROZEN_INPUT_PATHS = [
  "BUILD-PLAN.md",
  "forbidden-capabilities.md",
  "schema/schema-v2.ts",
  "spec/axes.md",
  "spec/families.md",
  "catalog/catalog-v2.jsonl",
  "catalog/sidecar-v2.jsonl",
  "queries/queries-v2.jsonl",
] as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ACCEPTED_REVIEW_STATUSES = new Set(["approved", "corrected"]);

export const ArtifactHashSchema = z.object({
  sha256: z.string().regex(SHA256_PATTERN),
  bytes: z.number().int().nonnegative(),
}).strict();

export const ReleaseQueryHashSchema = z.object({
  query_id: z.string().regex(/^qry-\d{3}$/),
  sha256: z.string().regex(SHA256_PATTERN),
}).strict();

export const ReleaseQueryIndexV2Schema = z.object({
  dataset_version: z.literal("v2"),
  contract: z.literal("stellar-bazaar-release-query-index-v2"),
  count: z.literal(RELEASE_COUNTS.queries.release),
  hash_basis: z.literal("canonical-schema-parsed-query-record"),
  judgments_included: z.literal(false),
  queries: z.array(ReleaseQueryHashSchema).length(RELEASE_COUNTS.queries.release),
}).strict().superRefine((value, context) => {
  const ids = value.queries.map(query => query.query_id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["queries"], message: "duplicate release query ID" });
  }
  if (ids.some((id, index) => index > 0 && ids[index - 1]! >= id)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["queries"], message: "release queries must be sorted by ID" });
  }
});

const queryClassCountsShape = z.object({
  capability: z.literal(QUERY_CLASS_TARGETS.capability),
  structured: z.literal(QUERY_CLASS_TARGETS.structured),
  semantic: z.literal(QUERY_CLASS_TARGETS.semantic),
  price_category: z.literal(QUERY_CLASS_TARGETS.price_category),
  mcp: z.literal(QUERY_CLASS_TARGETS.mcp),
  adversarial: z.literal(QUERY_CLASS_TARGETS.adversarial),
  no_result: z.literal(QUERY_CLASS_TARGETS.no_result),
  cold_start: z.literal(QUERY_CLASS_TARGETS.cold_start),
}).strict();

export const DatasetManifestV2Schema = z.object({
  dataset_version: z.literal("v2"),
  contract: z.literal("stellar-bazaar-dataset-freeze-v2"),
  status: z.literal("pass"),
  frozen_at: z.string().datetime(),
  counts: z.object({
    resources: z.object({
      labeled: z.literal(RELEASE_COUNTS.resources.labeled),
      distractor: z.literal(RELEASE_COUNTS.resources.distractor),
      total: z.literal(RELEASE_COUNTS.resources.total),
    }).strict(),
    labeled_resource_types: z.object({
      http: z.literal(RELEASE_COUNTS.resource_types.http),
      mcp: z.literal(RELEASE_COUNTS.resource_types.mcp),
    }).strict(),
    queries: z.object({
      development: z.literal(RELEASE_COUNTS.queries.development),
      release: z.literal(RELEASE_COUNTS.queries.release),
      total: z.literal(RELEASE_COUNTS.queries.total),
    }).strict(),
    query_classes: queryClassCountsShape,
  }).strict(),
  hashes: z.record(z.string().min(1), z.string().regex(SHA256_PATTERN)),
  artifacts: z.record(z.string().min(1), ArtifactHashSchema),
  release_holdout: z.object({
    query_index_path: z.literal(RELEASE_QUERY_INDEX_PATH),
    query_index_sha256: z.string().regex(SHA256_PATTERN),
    judgments_included: z.literal(false),
    judgments_access: z.literal("sealed-from-normal-tuning"),
    release_run_ledger_path: z.literal(RELEASE_RUN_LEDGER_PATH),
  }).strict(),
}).strict().superRefine((value, context) => {
  const required = [...FROZEN_INPUT_PATHS, RELEASE_QUERY_INDEX_PATH];
  for (const path of required) {
    if (!value.hashes[path] || !value.artifacts[path]) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["hashes", path], message: "missing frozen artifact" });
    } else if (value.hashes[path] !== value.artifacts[path]!.sha256) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["hashes", path], message: "hash maps disagree" });
    }
  }
  if (value.release_holdout.query_index_sha256 !== value.hashes[RELEASE_QUERY_INDEX_PATH]) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["release_holdout", "query_index_sha256"],
      message: "release index hash does not match hashes map",
    });
  }
});

export type DatasetManifestV2 = z.infer<typeof DatasetManifestV2Schema>;
export type ReleaseQueryIndexV2 = z.infer<typeof ReleaseQueryIndexV2Schema>;

export interface FreezeDatasetV2Options {
  root: string;
  frozenAt?: string;
  manifestPath?: string;
  releaseQueryIndexPath?: string;
}

export interface FreezeDatasetV2Result {
  manifest: DatasetManifestV2;
  releaseQueryIndex: ReleaseQueryIndexV2;
  manifestPath: string;
  releaseQueryIndexPath: string;
}

export class FreezeValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`dataset freeze refused:\n${issues.map(issue => `- ${issue}`).join("\n")}`);
    this.name = "FreezeValidationError";
    this.issues = issues;
  }
}

export function sha256Bytes(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable JSON used for per-query hashes and tamper-evident contracts. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export async function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const bytes = await readFile(path);
  return { sha256: sha256Bytes(bytes), bytes: bytes.byteLength };
}

interface ParsedJsonl<T> {
  records: T[];
  issues: string[];
}

async function parseJsonl<TSchema extends z.ZodTypeAny>(
  path: string,
  schema: TSchema,
): Promise<ParsedJsonl<z.output<TSchema>>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    return { records: [], issues: [`${path}: ${(error as Error).message}`] };
  }
  const records: z.output<TSchema>[] = [];
  const issues: string[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      issues.push(`${path}:${index + 1}: invalid JSON: ${(error as Error).message}`);
      continue;
    }
    const parsed = schema.safeParse(raw);
    if (parsed.success) records.push(parsed.data);
    else issues.push(
      `${path}:${index + 1}: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  }
  return { records, issues };
}

function exactIdSet(prefix: "res" | "qry", width: number, count: number): Set<string> {
  return new Set(Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(width, "0")}`));
}

function checkIds(label: string, ids: string[], expected: Set<string>, issues: string[]): void {
  const actual = new Set(ids);
  if (actual.size !== ids.length) issues.push(`${label}: duplicate IDs (${ids.length - actual.size})`);
  const missing = [...expected].filter(id => !actual.has(id));
  const unexpected = [...actual].filter(id => !expected.has(id));
  if (missing.length > 0) issues.push(`${label}: missing IDs ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "..." : ""}`);
  if (unexpected.length > 0) issues.push(`${label}: unexpected IDs ${unexpected.slice(0, 10).join(", ")}`);
}

function validateDatasetRecords(
  catalog: CatalogRecord[],
  sidecars: SidecarRecord[],
  queries: QueryRecord[],
): string[] {
  const issues: string[] = [];
  if (catalog.length !== RELEASE_COUNTS.resources.total) {
    issues.push(`catalog must contain exactly ${RELEASE_COUNTS.resources.total} records, found ${catalog.length}`);
  }
  if (sidecars.length !== RELEASE_COUNTS.resources.total) {
    issues.push(`sidecar must contain exactly ${RELEASE_COUNTS.resources.total} records, found ${sidecars.length}`);
  }
  if (queries.length !== RELEASE_COUNTS.queries.total) {
    issues.push(`queries must contain exactly ${RELEASE_COUNTS.queries.total} records, found ${queries.length}`);
  }

  const resourceIds = exactIdSet("res", 4, RELEASE_COUNTS.resources.total);
  checkIds("catalog", catalog.map(record => record.resource_id), resourceIds, issues);
  checkIds("sidecar", sidecars.map(record => record.resource_id), resourceIds, issues);
  checkIds("queries", queries.map(record => record.query_id), exactIdSet("qry", 3, RELEASE_COUNTS.queries.total), issues);

  const catalogById = new Map(catalog.map(record => [record.resource_id, record]));
  const sidecarById = new Map(sidecars.map(record => [record.resource_id, record]));
  for (const record of catalog) {
    if (!sidecarById.has(record.resource_id)) issues.push(`${record.resource_id}: catalog record has no sidecar`);
  }
  for (const sidecar of sidecars) {
    const catalogRecord = catalogById.get(sidecar.resource_id);
    if (!catalogRecord) issues.push(`${sidecar.resource_id}: sidecar has no catalog record`);
    else issues.push(...checkSidecarAgainstWire(sidecar, catalogRecord.wire));
  }

  const labeled = sidecars.filter(record => !record.is_distractor);
  const distractors = sidecars.filter(record => record.is_distractor);
  if (labeled.length !== RELEASE_COUNTS.resources.labeled) {
    issues.push(`sidecar must contain exactly 100 labeled resources, found ${labeled.length}`);
  }
  if (distractors.length !== RELEASE_COUNTS.resources.distractor) {
    issues.push(`sidecar must contain exactly ${RELEASE_COUNTS.resources.distractor} distractors, found ${distractors.length}`);
  }
  for (const resourceType of ["http", "mcp"] as const) {
    const actual = labeled.filter(record => record.resource_type === resourceType).length;
    const expected = RELEASE_COUNTS.resource_types[resourceType];
    if (actual !== expected) issues.push(`labeled resource type ${resourceType}: expected ${expected}, found ${actual}`);
  }
  const unacceptedResources = sidecars.filter(record => !ACCEPTED_REVIEW_STATUSES.has(record.review_status));
  if (unacceptedResources.length > 0) {
    issues.push(`${unacceptedResources.length} resources are not owner-approved/corrected`);
  }
  const unacceptedQueries = queries.filter(record => !ACCEPTED_REVIEW_STATUSES.has(record.review_status));
  if (unacceptedQueries.length > 0) issues.push(`${unacceptedQueries.length} queries are not owner-approved/corrected`);

  for (const split of ["development", "release"] as const) {
    const actual = queries.filter(query => query.split === split).length;
    const expected = RELEASE_COUNTS.queries[split];
    if (actual !== expected) issues.push(`query split ${split}: expected ${expected}, found ${actual}`);
  }
  for (const [queryClass, expected] of Object.entries(QUERY_CLASS_TARGETS)) {
    const actual = queries.filter(query => query.query_class === queryClass).length;
    if (actual !== expected) issues.push(`query class ${queryClass}: expected ${expected}, found ${actual}`);
  }
  const mcpDevelopment = queries.filter(query => query.query_class === "mcp" && query.split === "development").length;
  const mcpRelease = queries.filter(query => query.query_class === "mcp" && query.split === "release").length;
  if (![4, 5].includes(mcpDevelopment) || ![4, 5].includes(mcpRelease)) {
    issues.push(`MCP queries must split proportionally (4/5) across development/release, found ${mcpDevelopment}/${mcpRelease}`);
  }
  const mcpSubtypes = new Set(queries.filter(query => query.query_class === "mcp").map(query => query.mcp_subtype));
  for (const subtype of MCP_QUERY_SUBTYPES) {
    if (!mcpSubtypes.has(subtype)) issues.push(`MCP query subtype ${subtype} is not represented`);
  }
  return issues;
}

/**
 * Writes a complete file atomically and refuses to replace an existing frozen artifact.
 * `link(temp, target)` supplies the no-clobber atomic publication that `rename` cannot.
 */
export async function writeNewFileAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const handle = await open(temporary, "wx", 0o644);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`${path}: frozen artifact already exists; refusing to overwrite`);
    }
    throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function freezeDatasetV2(options: FreezeDatasetV2Options): Promise<FreezeDatasetV2Result> {
  const root = resolve(options.root);
  const manifestPath = resolve(root, options.manifestPath ?? DATASET_MANIFEST_PATH);
  const releaseQueryIndexPath = resolve(root, options.releaseQueryIndexPath ?? RELEASE_QUERY_INDEX_PATH);
  const [catalogResult, sidecarResult, queryResult] = await Promise.all([
    parseJsonl(resolve(root, "catalog/catalog-v2.jsonl"), CatalogRecordSchema),
    parseJsonl(resolve(root, "catalog/sidecar-v2.jsonl"), SidecarRecordSchema),
    parseJsonl(resolve(root, "queries/queries-v2.jsonl"), QueryRecordSchema),
  ]);
  const issues = [
    ...catalogResult.issues,
    ...sidecarResult.issues,
    ...queryResult.issues,
    ...validateDatasetRecords(catalogResult.records, sidecarResult.records, queryResult.records),
  ];
  for (const relativePath of FROZEN_INPUT_PATHS) {
    try {
      await readFile(resolve(root, relativePath));
    } catch (error) {
      issues.push(`${relativePath}: ${(error as Error).message}`);
    }
  }
  if (issues.length > 0) throw new FreezeValidationError(issues);

  const releaseQueries = queryResult.records
    .filter(query => query.split === "release")
    .sort((left, right) => left.query_id.localeCompare(right.query_id));
  const releaseQueryIndex = ReleaseQueryIndexV2Schema.parse({
    dataset_version: "v2",
    contract: "stellar-bazaar-release-query-index-v2",
    count: releaseQueries.length,
    hash_basis: "canonical-schema-parsed-query-record",
    judgments_included: false,
    queries: releaseQueries.map(query => ({ query_id: query.query_id, sha256: sha256Bytes(canonicalJson(query)) })),
  });
  const releaseIndexText = `${JSON.stringify(releaseQueryIndex, null, 2)}\n`;
  const releaseIndexArtifact = {
    sha256: sha256Bytes(releaseIndexText),
    bytes: Buffer.byteLength(releaseIndexText),
  };

  const entries = await Promise.all(FROZEN_INPUT_PATHS.map(async path => [path, await hashFile(resolve(root, path))] as const));
  const artifacts: Record<string, { sha256: string; bytes: number }> = Object.fromEntries(entries);
  artifacts[RELEASE_QUERY_INDEX_PATH] = releaseIndexArtifact;
  const hashes = Object.fromEntries(Object.entries(artifacts).map(([path, artifact]) => [path, artifact.sha256]));
  const queryClasses = Object.fromEntries(
    Object.keys(QUERY_CLASS_TARGETS).map(queryClass => [
      queryClass,
      queryResult.records.filter(query => query.query_class === queryClass).length,
    ]),
  );
  const labeled = sidecarResult.records.filter(record => !record.is_distractor);
  const manifest = DatasetManifestV2Schema.parse({
    dataset_version: "v2",
    contract: "stellar-bazaar-dataset-freeze-v2",
    status: "pass",
    frozen_at: options.frozenAt ?? new Date().toISOString(),
    counts: {
      resources: {
        labeled: labeled.length,
        distractor: sidecarResult.records.length - labeled.length,
        total: sidecarResult.records.length,
      },
      labeled_resource_types: {
        http: labeled.filter(record => record.resource_type === "http").length,
        mcp: labeled.filter(record => record.resource_type === "mcp").length,
      },
      queries: {
        development: queryResult.records.filter(query => query.split === "development").length,
        release: releaseQueries.length,
        total: queryResult.records.length,
      },
      query_classes: queryClasses,
    },
    hashes,
    artifacts,
    release_holdout: {
      query_index_path: RELEASE_QUERY_INDEX_PATH,
      query_index_sha256: releaseIndexArtifact.sha256,
      judgments_included: false,
      judgments_access: "sealed-from-normal-tuning",
      release_run_ledger_path: RELEASE_RUN_LEDGER_PATH,
    },
  });

  // The index is published first. The manifest is the commit marker and is always published last.
  await writeNewFileAtomic(releaseQueryIndexPath, releaseIndexText);
  await writeNewFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, releaseQueryIndex, manifestPath, releaseQueryIndexPath };
}
