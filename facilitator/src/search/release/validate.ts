import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { validateDiscoveryExtension, validateDiscoveryExtensionSpec } from "@x402/extensions/bazaar";
import {
  CatalogRecordSchema, HumanCalibrationSchema, QrelRecordSchema, QueryRecordSchema,
  RELEASE_COUNTS, SidecarRecordSchema, type CatalogRecord, type QueryRecord, type SidecarRecord,
} from "./schema.js";
import { readJsonl, rejectDuplicates, sha256 } from "./io.js";

export interface ReleaseDataset {
  catalog: CatalogRecord[];
  sidecars: SidecarRecord[];
  queries: QueryRecord[];
  qrels: Awaited<ReturnType<typeof loadQrels>>;
}

const file = (root: string, name: string) => resolve(root, name);

async function loadQrels(root: string) {
  return readJsonl(file(root, "qrels/qrels-v1.jsonl"), QrelRecordSchema);
}

export async function validateReleaseDataset(root: string): Promise<ReleaseDataset> {
  const catalog = await readJsonl(file(root, "catalog/catalog-v1.jsonl"), CatalogRecordSchema);
  const sidecars = await readJsonl(file(root, "catalog/evaluation-sidecar-v1.jsonl"), SidecarRecordSchema);
  const queries = await readJsonl(file(root, "queries/queries-v1.jsonl"), QueryRecordSchema);
  const qrels = await loadQrels(root);
  const manifest = z.object({ hashes: z.record(z.string().regex(/^[a-f0-9]{64}$/)) }).passthrough()
    .parse(JSON.parse(await readFile(file(root, "manifests/dataset-v1.json"), "utf8")));
  for (const name of ["catalog/catalog-v1.jsonl", "catalog/evaluation-sidecar-v1.jsonl", "queries/queries-v1.jsonl", "qrels/qrels-v1.jsonl", "calibration/human-review-v1.jsonl"]) {
    const actual = sha256(await readFile(file(root, name)));
    if (manifest.hashes[name] !== actual) throw new Error(`${name}: SHA-256 does not match dataset manifest`);
  }

  if (catalog.length !== RELEASE_COUNTS.resources) throw new Error(`expected 300 catalog records, got ${catalog.length}`);
  if (queries.length !== RELEASE_COUNTS.queries) throw new Error(`expected 100 queries, got ${queries.length}`);
  if (qrels.length !== RELEASE_COUNTS.qrels) throw new Error(`expected 30000 qrels, got ${qrels.length}`);
  if (sidecars.length !== RELEASE_COUNTS.resources) throw new Error(`expected 300 sidecars, got ${sidecars.length}`);
  rejectDuplicates(catalog, value => value.resource_id, "resource_id");
  rejectDuplicates(catalog, value => value.wire.resource.url, "resource URL");
  rejectDuplicates(sidecars, value => value.resource_id, "sidecar resource_id");
  rejectDuplicates(queries, value => value.query_id, "query_id");
  rejectDuplicates(queries, value => value.query.trim().toLocaleLowerCase("en-US"), "query text");
  rejectDuplicates(qrels, value => `${value.query_id}\0${value.resource_id}`, "qrel pair");

  const resourceIds = new Set(catalog.map(value => value.resource_id));
  const queryIds = new Set(queries.map(value => value.query_id));
  if (sidecars.some(value => !resourceIds.has(value.resource_id))) throw new Error("sidecar references an unknown resource");
  if (qrels.some(value => !resourceIds.has(value.resource_id) || !queryIds.has(value.query_id))) throw new Error("qrel references an unknown query/resource");
  for (const query of queries) {
    const rows = qrels.filter(value => value.query_id === query.query_id);
    if (rows.length !== RELEASE_COUNTS.resources) throw new Error(`${query.query_id} has ${rows.length} qrels`);
  }
  const catalogById = new Map(catalog.map(value => [value.resource_id, value]));
  const sidecarById = new Map(sidecars.map(value => [value.resource_id, value]));
  const queryById = new Map(queries.map(value => [value.query_id, value]));
  for (const qrel of qrels) {
    const query = queryById.get(qrel.query_id)!;
    const record = catalogById.get(qrel.resource_id)!;
    const sidecar = sidecarById.get(qrel.resource_id)!;
    const option = record.wire.accepts[0]!;
    const input = (record.wire.extensions.bazaar.info as Record<string, unknown>).input as Record<string, unknown>;
    let eligible = !Object.entries(query.filters).some(([key, wanted]) => {
      if (wanted === undefined) return false;
      const actual = key === "type" ? input.type
        : key === "extensions" ? (wanted in record.wire.extensions ? wanted : undefined)
          : key === "payTo" ? option.payTo : option[key as keyof typeof option];
      return actual !== wanted;
    });
    if (query.evaluation_constraints.category !== undefined && query.evaluation_constraints.category !== sidecar.category) eligible = false;
    if (query.evaluation_constraints.max_price_usd !== undefined && sidecar.price_usd_snapshot.value > query.evaluation_constraints.max_price_usd) eligible = false;
    if (qrel.eligible !== eligible) throw new Error(`${qrel.query_id}/${qrel.resource_id}: qrel eligibility is inconsistent with deterministic constraints`);
  }

  const sources = Object.fromEntries(Object.keys(RELEASE_COUNTS.sources).map(key => [key, 0])) as Record<string, number>;
  for (const value of sidecars) sources[value.source_class] = (sources[value.source_class] ?? 0) + 1;
  for (const [name, count] of Object.entries(RELEASE_COUNTS.sources)) {
    if (sources[name] !== count) throw new Error(`expected ${count} ${name} resources, got ${sources[name]}`);
  }
  const sidecarsById = new Map(sidecars.map(value => [value.resource_id, value]));
  for (const record of catalog) {
    const input = (record.wire.extensions.bazaar.info as Record<string, unknown>).input as Record<string, unknown>;
    const expectedType = sidecarsById.get(record.resource_id)!.source_class === "generated_mcp" ? "mcp" : "http";
    if (input.type !== expectedType) throw new Error(`${record.resource_id}: expected ${expectedType} Bazaar input`);
  }
  if (new Set(sidecars.map(value => value.provider_id)).size !== RELEASE_COUNTS.providers) throw new Error("dataset must use exactly 50 provider identities");
  for (const category of ["weather", "finance", "blockchain", "identity", "documents", "news", "risk", "language", "media", "logistics"]) {
    const count = sidecars.filter(value => value.category === category).length;
    if (count !== 30) throw new Error(`expected 30 ${category} resources, got ${count}`);
  }
  if (queries.filter(value => value.split === "development").length !== 70 || queries.filter(value => value.split === "release").length !== 30) {
    throw new Error("query split must be exactly 70 development / 30 release");
  }
  const expectedClasses = { capability: 30, structured: 20, semantic: 15, price_category: 10, adversarial: 10, no_result: 10, cold_start: 5 };
  for (const [queryClass, expected] of Object.entries(expectedClasses)) {
    const actual = queries.filter(value => value.query_class === queryClass).length;
    if (actual !== expected) throw new Error(`expected ${expected} ${queryClass} queries, got ${actual}`);
  }
  for (const record of catalog) {
    const extension = record.wire.extensions.bazaar;
    const spec = validateDiscoveryExtensionSpec(extension);
    const schema = validateDiscoveryExtension(extension as never);
    if (!spec.valid || !schema.valid) throw new Error(`${record.resource_id}: invalid upstream Bazaar metadata: ${[...(spec.errors ?? []), ...(schema.errors ?? [])].join("; ")}`);
  }
  return { catalog, sidecars, queries, qrels };
}

export async function validateHumanCalibration(path: string): Promise<{ total: number; reviewed: number }> {
  const rows = await readJsonl(path, HumanCalibrationSchema);
  rejectDuplicates(rows, value => `${value.query_id}\0${value.resource_id}`, "calibration pair");
  return { total: rows.length, reviewed: rows.filter(value => value.human_grade !== null).length };
}
