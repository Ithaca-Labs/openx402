import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { EcosystemJudgmentSchema, EcosystemManifestSchema, EcosystemOutcomeSchema, EcosystemQuerySchema, EcosystemRecommendationRunSchema, EcosystemResourceSchema, type EcosystemJudgment, type EcosystemManifest, type EcosystemOutcome, type EcosystemQuery, type EcosystemRecommendationRun, type EcosystemResource } from "./schema.js";
import { readJsonl, rejectDuplicates, sha256 } from "../release/io.js";

export interface EcosystemDataset {
  resources: EcosystemResource[];
  queries: EcosystemQuery[];
  judgments: EcosystemJudgment[];
  outcomes: EcosystemOutcome[];
  manifest: EcosystemManifest;
}

const file = (root: string, relative: string) => resolve(root, relative);

async function readOptional<T>(path: string, schema: Parameters<typeof readJsonl<T>>[1]): Promise<T[]> {
  try {
    return await readJsonl(path, schema);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function verifyHash(root: string, manifest: EcosystemManifest, relative: string): Promise<void> {
  const expected = manifest.hashes[relative];
  if (!expected) return;
  const actual = sha256(await readFile(file(root, relative)));
  if (actual !== expected) throw new Error(`${relative}: SHA-256 does not match ecosystem manifest`);
}

export async function validateEcosystemDataset(root: string, options: { requireJudgments?: boolean } = {}): Promise<EcosystemDataset> {
  const manifest = EcosystemManifestSchema.parse(JSON.parse(await readFile(file(root, "manifests/dataset-v1.json"), "utf8")));
  const resources = await readJsonl(file(root, "catalog/catalog-v1.jsonl"), EcosystemResourceSchema);
  const queries = await readOptional(file(root, "queries/queries-v1.jsonl"), EcosystemQuerySchema);
  const judgments = await readOptional(file(root, "judgments/judgments-v1.jsonl"), EcosystemJudgmentSchema);
  const outcomes = await readOptional(file(root, "outcomes/outcomes-v1.jsonl"), EcosystemOutcomeSchema);
  await verifyHash(root, manifest, "catalog/catalog-v1.jsonl");
  if (queries.length > 0) await verifyHash(root, manifest, "queries/queries-v1.jsonl");
  if (judgments.length > 0) await verifyHash(root, manifest, "judgments/judgments-v1.jsonl");
  if (outcomes.length > 0) await verifyHash(root, manifest, "outcomes/outcomes-v1.jsonl");

  if (resources.length !== manifest.counts.resources) throw new Error(`manifest resources=${manifest.counts.resources}, found ${resources.length}`);
  if (queries.length !== manifest.counts.queries) throw new Error(`manifest queries=${manifest.counts.queries}, found ${queries.length}`);
  if (judgments.length !== manifest.counts.judgments) throw new Error(`manifest judgments=${manifest.counts.judgments}, found ${judgments.length}`);
  if (outcomes.length !== manifest.counts.outcomes) throw new Error(`manifest outcomes=${manifest.counts.outcomes}, found ${outcomes.length}`);
  if (resources.length === 0) throw new Error("ecosystem catalog must contain at least one resource");
  if (options.requireJudgments && (queries.length === 0 || judgments.length === 0)) throw new Error("ecosystem evaluation requires queries and judgments");

  rejectDuplicates(resources, value => value.resource_id, "ecosystem resource_id");
  rejectDuplicates(resources, value => value.canonical_key, "ecosystem canonical_key");
  rejectDuplicates(queries, value => value.query_id, "ecosystem query_id");
  rejectDuplicates(queries, value => value.text.trim().toLocaleLowerCase("en-US"), "ecosystem query text");
  rejectDuplicates(judgments, value => `${value.query_id}\0${value.resource_id}`, "ecosystem judgment pair");
  rejectDuplicates(outcomes, value => `${value.query_id}\0${value.resource_id}`, "ecosystem outcome pair");

  const resourceIds = new Set(resources.map(value => value.resource_id));
  const queryIds = new Set(queries.map(value => value.query_id));
  for (const resource of resources) {
    const sourceKeys = resource.source_records.map(value => `${value.source}:${value.source_record_id}`);
    if (new Set(sourceKeys).size !== sourceKeys.length) throw new Error(`${resource.resource_id}: duplicate source attribution`);
  }
  if (judgments.some(value => !resourceIds.has(value.resource_id) || !queryIds.has(value.query_id))) throw new Error("ecosystem judgment references an unknown query/resource");
  if (outcomes.some(value => !resourceIds.has(value.resource_id) || !queryIds.has(value.query_id))) throw new Error("ecosystem outcome references an unknown query/resource");
  for (const query of queries) {
    const queryJudgments = judgments.filter(value => value.query_id === query.query_id);
    if (query.expects_no_result && queryJudgments.some(value => value.relevance_grade >= 2)) {
      throw new Error(`${query.query_id}: no-result query has a positive judgment`);
    }
  }
  return { resources, queries, judgments, outcomes, manifest };
}

export async function readRecommendationRun(path: string): Promise<EcosystemRecommendationRun[]> {
  const rows = await readJsonl(path, EcosystemRecommendationRunSchema);
  rejectDuplicates(rows, value => value.query_id, "ecosystem recommendation query_id");
  return rows;
}
