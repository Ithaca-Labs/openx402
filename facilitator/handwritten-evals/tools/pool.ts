/**
 * Deterministic five-system pooling for BUILD-PLAN §8 / §9 step 7.
 *
 * This module validates retrieval output and hard filters only. It never creates
 * or infers relevance judgments.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import {
  CatalogRecordSchema,
  checkSidecarAgainstWire,
  POOL_SYSTEMS,
  PoolRecordSchema,
  QUERY_CLASS_TARGETS,
  QueryIdSchema,
  QueryRecordSchema,
  RELEASE_COUNTS,
  ResourceIdSchema,
  SidecarRecordSchema,
  type CatalogRecord,
  type PoolRecord,
  type PoolSystem,
  type QueryRecord,
  type SidecarRecord,
} from "../schema/schema-v2.js";
import { buildCatalogIndex } from "./bm25.js";

export const POOL_DEPTH = 20;

export const SYSTEM_RUN_FILENAMES: Readonly<Record<PoolSystem, string>> = {
  lexical: "lexical-v2.jsonl",
  semantic: "semantic-v2.jsonl",
  hybrid: "hybrid-v2.jsonl",
  reranked: "reranked-v2.jsonl",
  bm25: "bm25-v2.jsonl",
};

export const SystemRunResultSchema = z.object({
  resource_id: ResourceIdSchema,
  rank: z.number().int().min(1).max(POOL_DEPTH),
  score: z.number().finite().optional(),
}).strict();

export const SystemRunRecordSchema = z.object({
  system: z.enum(POOL_SYSTEMS),
  query_id: QueryIdSchema,
  run_id: z.string().min(1),
  generated_at: z.string().datetime(),
  latency_ms: z.number().finite().nonnegative(),
  requested_depth: z.literal(POOL_DEPTH),
  total_results: z.number().int().nonnegative(),
  results: z.array(SystemRunResultSchema).max(POOL_DEPTH),
}).strict().superRefine((value, context) => {
  const expectedLength = Math.min(value.requested_depth, value.total_results);
  if (value.results.length !== expectedLength) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["results"],
      message: `expected ${expectedLength} results for requested_depth=${value.requested_depth} and total_results=${value.total_results}`,
    });
  }
  const ids = value.results.map(result => result.resource_id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["results"],
      message: "ranked results must not repeat a resource_id",
    });
  }
  for (const [index, result] of value.results.entries()) {
    if (result.rank !== index + 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["results", index, "rank"],
        message: `ranks must be contiguous and ordered; expected ${index + 1}`,
      });
    }
  }
});

export type SystemRunResult = z.infer<typeof SystemRunResultSchema>;
export type SystemRunRecord = z.infer<typeof SystemRunRecordSchema>;
export type SystemRuns = Record<PoolSystem, SystemRunRecord[]>;

export interface V2Dataset {
  catalog: CatalogRecord[];
  sidecars: SidecarRecord[];
  queries: QueryRecord[];
}

async function readJsonl<S extends z.ZodTypeAny>(path: string, schema: S): Promise<Array<z.output<S>>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const records: Array<z.output<S>> = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`${path}:${index + 1}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ");
      throw new Error(`${path}:${index + 1}: ${issues}`);
    }
    records.push(parsed.data);
  }
  return records;
}

function assertUnique<T>(records: readonly T[], key: (record: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const record of records) {
    const value = key(record);
    if (seen.has(value)) throw new Error(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function expectedIds(prefix: "res" | "qry", count: number, width: number): Set<string> {
  return new Set(Array.from({ length: count }, (_, index) =>
    `${prefix}-${String(index + 1).padStart(width, "0")}`));
}

function assertExactSet(actual: Iterable<string>, expected: ReadonlySet<string>, label: string): void {
  const values = new Set(actual);
  const missing = [...expected].filter(value => !values.has(value));
  const unexpected = [...values].filter(value => !expected.has(value));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${label} id set is incomplete: missing=${missing.slice(0, 5).join(",") || "none"}; `
      + `unexpected=${unexpected.slice(0, 5).join(",") || "none"}`,
    );
  }
}

/** Refuses partial or mismatched inputs before any run or pool is produced. */
export function validateDatasetCompleteness(dataset: V2Dataset): void {
  const { catalog, sidecars, queries } = dataset;
  if (catalog.length !== RELEASE_COUNTS.resources.total) {
    throw new Error(`expected ${RELEASE_COUNTS.resources.total} catalog records, got ${catalog.length}`);
  }
  if (sidecars.length !== RELEASE_COUNTS.resources.total) {
    throw new Error(`expected ${RELEASE_COUNTS.resources.total} sidecar records, got ${sidecars.length}`);
  }
  if (queries.length !== RELEASE_COUNTS.queries.total) {
    throw new Error(`expected ${RELEASE_COUNTS.queries.total} queries, got ${queries.length}`);
  }

  assertUnique(catalog, record => record.resource_id, "catalog resource_id");
  assertUnique(sidecars, record => record.resource_id, "sidecar resource_id");
  assertUnique(queries, record => record.query_id, "query_id");

  const resourceIds = expectedIds("res", RELEASE_COUNTS.resources.total, 4);
  const queryIds = expectedIds("qry", RELEASE_COUNTS.queries.total, 3);
  assertExactSet(catalog.map(record => record.resource_id), resourceIds, "catalog");
  assertExactSet(sidecars.map(record => record.resource_id), resourceIds, "sidecar");
  assertExactSet(queries.map(record => record.query_id), queryIds, "query");

  const catalogById = new Map(catalog.map(record => [record.resource_id, record]));
  for (const sidecar of sidecars) {
    const catalogRecord = catalogById.get(sidecar.resource_id);
    if (!catalogRecord) throw new Error(`sidecar references unknown resource ${sidecar.resource_id}`);
    const errors = checkSidecarAgainstWire(sidecar, catalogRecord.wire);
    if (errors.length > 0) throw new Error(errors.join("; "));
  }

  const labeled = sidecars.filter(record => !record.is_distractor);
  const distractors = sidecars.filter(record => record.is_distractor);
  if (labeled.length !== RELEASE_COUNTS.resources.labeled) {
    throw new Error(`expected ${RELEASE_COUNTS.resources.labeled} labeled resources, got ${labeled.length}`);
  }
  if (distractors.length !== RELEASE_COUNTS.resources.distractor) {
    throw new Error(`expected ${RELEASE_COUNTS.resources.distractor} distractors, got ${distractors.length}`);
  }
  for (const type of ["http", "mcp"] as const) {
    const count = labeled.filter(record => record.resource_type === type).length;
    if (count !== RELEASE_COUNTS.resource_types[type]) {
      throw new Error(`expected ${RELEASE_COUNTS.resource_types[type]} labeled ${type} resources, got ${count}`);
    }
  }

  for (const split of ["development", "release"] as const) {
    const count = queries.filter(query => query.split === split).length;
    if (count !== RELEASE_COUNTS.queries[split]) {
      throw new Error(`expected ${RELEASE_COUNTS.queries[split]} ${split} queries, got ${count}`);
    }
  }
  for (const [queryClass, expected] of Object.entries(QUERY_CLASS_TARGETS)) {
    const count = queries.filter(query => query.query_class === queryClass).length;
    if (count !== expected) throw new Error(`expected ${expected} ${queryClass} queries, got ${count}`);
  }
}

export async function loadV2Dataset(root: string): Promise<V2Dataset> {
  const catalog = await readJsonl(resolve(root, "catalog/catalog-v2.jsonl"), CatalogRecordSchema);
  const sidecars = await readJsonl(resolve(root, "catalog/sidecar-v2.jsonl"), SidecarRecordSchema);
  const queries = await readJsonl(resolve(root, "queries/queries-v2.jsonl"), QueryRecordSchema);
  const dataset = { catalog, sidecars, queries };
  validateDatasetCompleteness(dataset);
  return dataset;
}

/** Loads one named system run and proves complete per-query top-20 coverage. */
export async function loadSystemRunJsonl(
  path: string,
  expectedSystem: PoolSystem,
  queryIds: ReadonlySet<string>,
  resourceIds: ReadonlySet<string>,
): Promise<SystemRunRecord[]> {
  const records = await readJsonl(path, SystemRunRecordSchema);
  assertUnique(records, record => record.query_id, `${expectedSystem} run query_id`);
  for (const record of records) {
    if (record.system !== expectedSystem) {
      throw new Error(`${path}: expected system ${expectedSystem}, got ${record.system}`);
    }
    if (!queryIds.has(record.query_id)) throw new Error(`${path}: unknown query_id ${record.query_id}`);
    for (const result of record.results) {
      if (!resourceIds.has(result.resource_id)) {
        throw new Error(`${path}: ${record.query_id} references unknown resource_id ${result.resource_id}`);
      }
    }
  }
  assertExactSet(records.map(record => record.query_id), queryIds, `${expectedSystem} run`);
  const runIds = new Set(records.map(record => record.run_id));
  if (runIds.size !== 1) throw new Error(`${path}: one system file must contain exactly one run_id`);
  return records;
}

export async function loadSystemRuns(
  runDirectory: string,
  queryIds: ReadonlySet<string>,
  resourceIds: ReadonlySet<string>,
  overrides: Partial<SystemRuns> = {},
): Promise<SystemRuns> {
  const entries = await Promise.all(POOL_SYSTEMS.map(async system => {
    const override = overrides[system];
    const records = override ?? await loadSystemRunJsonl(
      resolve(runDirectory, SYSTEM_RUN_FILENAMES[system]), system, queryIds, resourceIds,
    );
    validateSystemRunRecords(records, system, queryIds, resourceIds);
    return [system, records] as const;
  }));
  return Object.fromEntries(entries) as SystemRuns;
}

export function validateSystemRunRecords(
  records: readonly SystemRunRecord[],
  expectedSystem: PoolSystem,
  queryIds: ReadonlySet<string>,
  resourceIds: ReadonlySet<string>,
): void {
  const parsed = records.map((record, index) => {
    const result = SystemRunRecordSchema.safeParse(record);
    if (!result.success) throw new Error(`${expectedSystem} record ${index + 1}: ${result.error.message}`);
    return result.data;
  });
  assertUnique(parsed, record => record.query_id, `${expectedSystem} run query_id`);
  for (const record of parsed) {
    if (record.system !== expectedSystem) {
      throw new Error(`expected system ${expectedSystem}, got ${record.system}`);
    }
    if (!queryIds.has(record.query_id)) throw new Error(`${expectedSystem}: unknown query_id ${record.query_id}`);
    for (const result of record.results) {
      if (!resourceIds.has(result.resource_id)) {
        throw new Error(`${expectedSystem}/${record.query_id}: unknown resource_id ${result.resource_id}`);
      }
    }
  }
  assertExactSet(parsed.map(record => record.query_id), queryIds, `${expectedSystem} run`);
  if (new Set(parsed.map(record => record.run_id)).size !== 1) {
    throw new Error(`${expectedSystem}: one system run must contain exactly one run_id`);
  }
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

/** Applies every deterministic filter/constraint represented by QueryRecordSchema. */
export function deterministicEligibility(
  query: QueryRecord,
  catalog: CatalogRecord,
  sidecar: SidecarRecord,
): EligibilityResult {
  const reasons: string[] = [];
  const filters = query.filters;
  const constraints = query.evaluation_constraints;

  if (filters.type !== undefined && sidecar.resource_type !== filters.type) reasons.push("filters.type");
  if (filters.extensions !== undefined
      && !Object.prototype.hasOwnProperty.call(catalog.wire.extensions, filters.extensions)) {
    reasons.push("filters.extensions");
  }

  const paymentFilterPresent = filters.network !== undefined || filters.scheme !== undefined
    || filters.payTo !== undefined || filters.asset !== undefined;
  if (paymentFilterPresent && !catalog.wire.accepts.some(option =>
    (filters.network === undefined || option.network === filters.network)
    && (filters.scheme === undefined || option.scheme === filters.scheme)
    && (filters.payTo === undefined || option.payTo === filters.payTo)
    && (filters.asset === undefined || option.asset === filters.asset))) {
    reasons.push("filters.payment_option");
  }

  if (constraints.max_price_usd !== undefined
      && sidecar.price_usd_snapshot.value > constraints.max_price_usd) {
    reasons.push("evaluation_constraints.max_price_usd");
  }
  if (constraints.category !== undefined && sidecar.category !== constraints.category) {
    reasons.push("evaluation_constraints.category");
  }
  if (constraints.freshness !== undefined && sidecar.axes?.freshness !== constraints.freshness) {
    reasons.push("evaluation_constraints.freshness");
  }
  if (constraints.resource_type !== undefined && sidecar.resource_type !== constraints.resource_type) {
    reasons.push("evaluation_constraints.resource_type");
  }
  return { eligible: reasons.length === 0, reasons };
}

export interface RunMetadata {
  runId: string;
  generatedAt: string;
  /** Injectable monotonic clock for deterministic tests. */
  now?: () => number;
}

/** Produces the fifth-system BM25 top-20 run without semantic judgments. */
export function generateBm25Run(dataset: V2Dataset, metadata: RunMetadata): SystemRunRecord[] {
  validateDatasetCompleteness(dataset);
  const index = buildCatalogIndex(dataset.catalog);
  const catalogById = new Map(dataset.catalog.map(record => [record.resource_id, record]));
  const sidecarById = new Map(dataset.sidecars.map(record => [record.resource_id, record]));
  const now = metadata.now ?? (() => performance.now());

  return [...dataset.queries]
    .sort((left, right) => left.query_id.localeCompare(right.query_id))
    .map(query => {
      const startedAt = now();
      const eligibleHits = index.search(query.query, index.size).filter(hit => {
        const catalog = catalogById.get(hit.id);
        const sidecar = sidecarById.get(hit.id);
        return catalog !== undefined && sidecar !== undefined
          && deterministicEligibility(query, catalog, sidecar).eligible;
      });
      const results = eligibleHits.slice(0, POOL_DEPTH).map((hit, index) => ({
        resource_id: hit.id,
        rank: index + 1,
        score: hit.score,
      }));
      const latencyMs = now() - startedAt;
      return SystemRunRecordSchema.parse({
        system: "bm25",
        query_id: query.query_id,
        run_id: metadata.runId,
        generated_at: metadata.generatedAt,
        latency_ms: latencyMs,
        requested_depth: POOL_DEPTH,
        total_results: eligibleHits.length,
        results,
      });
    });
}

/** Ensures all five systems respected the dataset's deterministic filters. */
export function validateRunEligibility(dataset: V2Dataset, runs: SystemRuns): void {
  const catalogById = new Map(dataset.catalog.map(record => [record.resource_id, record]));
  const sidecarById = new Map(dataset.sidecars.map(record => [record.resource_id, record]));
  const queryById = new Map(dataset.queries.map(record => [record.query_id, record]));
  for (const system of POOL_SYSTEMS) {
    for (const record of runs[system]) {
      const query = queryById.get(record.query_id)!;
      for (const result of record.results) {
        const catalog = catalogById.get(result.resource_id)!;
        const sidecar = sidecarById.get(result.resource_id)!;
        const eligibility = deterministicEligibility(query, catalog, sidecar);
        if (!eligibility.eligible) {
          throw new Error(
            `${system}/${record.query_id}/${result.resource_id}: hard-filter violation: ${eligibility.reasons.join(", ")}`,
          );
        }
      }
    }
  }
}

export interface PoolMetadata {
  runId: string;
  pooledAt: string;
}

/** Deduplicates the five top-20s while preserving every contributing system/rank. */
export function buildPool(
  dataset: V2Dataset,
  runs: SystemRuns,
  metadata: PoolMetadata,
): PoolRecord[] {
  validateDatasetCompleteness(dataset);
  const queryIds = new Set(dataset.queries.map(query => query.query_id));
  const resourceIds = new Set(dataset.catalog.map(record => record.resource_id));
  for (const system of POOL_SYSTEMS) {
    validateSystemRunRecords(runs[system], system, queryIds, resourceIds);
  }
  validateRunEligibility(dataset, runs);

  const records: PoolRecord[] = [];
  for (const query of [...dataset.queries].sort((a, b) => a.query_id.localeCompare(b.query_id))) {
    const pairs = new Map<string, Array<{ system: PoolSystem; rank: number }>>();
    for (const system of POOL_SYSTEMS) {
      const run = runs[system].find(record => record.query_id === query.query_id)!;
      for (const result of run.results) {
        const contributions = pairs.get(result.resource_id) ?? [];
        contributions.push({ system, rank: result.rank });
        pairs.set(result.resource_id, contributions);
      }
    }
    for (const resourceId of [...pairs.keys()].sort()) {
      const contributions = pairs.get(resourceId)!;
      records.push(PoolRecordSchema.parse({
        query_id: query.query_id,
        resource_id: resourceId,
        origin: "system_pool",
        contributions,
        best_rank: Math.min(...contributions.map(contribution => contribution.rank)),
        pool_depth: POOL_DEPTH,
        blinded: true,
        pooled_at: metadata.pooledAt,
        run_id: metadata.runId,
      }));
    }
  }
  return records;
}

/** Proves that `pool-v2.jsonl` is exactly the union of every recorded system top-20. */
export function validateExactPoolCoverage(
  pool: readonly PoolRecord[],
  runs: SystemRuns,
): void {
  const expected = new Map<string, Map<PoolSystem, number>>();
  for (const system of POOL_SYSTEMS) {
    for (const run of runs[system]) {
      for (const result of run.results) {
        const key = `${run.query_id}\u0000${result.resource_id}`;
        const contributions = expected.get(key) ?? new Map<PoolSystem, number>();
        contributions.set(system, result.rank);
        expected.set(key, contributions);
      }
    }
  }

  const systemPool = pool.filter(record => record.origin === "system_pool");
  const actual = new Map<string, PoolRecord>();
  for (const [index, raw] of systemPool.entries()) {
    const record = PoolRecordSchema.parse(raw);
    if (record.pool_depth !== POOL_DEPTH) throw new Error(`pool record ${index + 1}: pool_depth must be ${POOL_DEPTH}`);
    const key = `${record.query_id}\u0000${record.resource_id}`;
    if (actual.has(key)) throw new Error(`duplicate system_pool pair ${record.query_id}/${record.resource_id}`);
    actual.set(key, record);
  }
  if (new Set(systemPool.map(record => record.run_id)).size !== 1) {
    throw new Error("system_pool rows must carry exactly one pool run_id");
  }
  if (new Set(systemPool.map(record => record.pooled_at)).size !== 1) {
    throw new Error("system_pool rows must carry exactly one pooled_at timestamp");
  }

  const missing = [...expected.keys()].filter(key => !actual.has(key));
  const extra = [...actual.keys()].filter(key => !expected.has(key));
  if (missing.length > 0 || extra.length > 0) {
    const display = (key: string) => key.replace("\u0000", "/");
    throw new Error(
      `pool pair set differs from five-system top-${POOL_DEPTH}: `
      + `missing=${missing.slice(0, 5).map(display).join(",") || "none"}; `
      + `extra=${extra.slice(0, 5).map(display).join(",") || "none"}`,
    );
  }
  for (const [key, expectedContributions] of expected) {
    const record = actual.get(key)!;
    const actualContributions = new Map(record.contributions.map(item => [item.system, item.rank]));
    for (const system of POOL_SYSTEMS) {
      const expectedRank = expectedContributions.get(system);
      const actualRank = actualContributions.get(system);
      if (expectedRank !== actualRank) {
        throw new Error(
          `${key.replace("\u0000", "/")}: ${system} contribution expected ${expectedRank ?? "absent"}, `
          + `found ${actualRank ?? "absent"}`,
        );
      }
    }
  }
}

export function encodeJsonl(records: readonly unknown[]): string {
  return records.length === 0 ? "" : `${records.map(record => JSON.stringify(record)).join("\n")}\n`;
}
