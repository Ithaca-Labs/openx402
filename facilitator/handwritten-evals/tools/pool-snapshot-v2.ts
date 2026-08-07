/** Deterministic pool freshness contract for BUILD-PLAN §12.3. */

import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  ALL_RUN_SYSTEMS,
  PoolRecordSchema,
  type PoolRecord,
  type RunSystem,
} from "../schema/schema-v2.js";
import {
  DATASET_MANIFEST_PATH,
  hashFile,
} from "./manifest-v2.js";
import {
  SYSTEM_RUN_FILENAMES,
  loadSystemRuns,
  loadV2Dataset,
  validateExactPoolCoverage,
  validateRunEligibility,
  type SystemRunRecord,
  type SystemRuns,
} from "./pool.js";
import { verifyFrozenDataset } from "./release-run-ledger-v2.js";

export const RETRIEVAL_PROFILES_PATH = "retrieval-profiles-v2.json";
export const POOL_SNAPSHOT_PATH = "pool/pool-snapshot-v2.json";
export const POOL_ARTIFACT_PATH = "pool/pool-v2.jsonl";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const ArtifactHashSchema = z.object({
  sha256: Sha256Schema,
  bytes: z.number().int().nonnegative(),
}).strict();
const ParameterSchema = z.union([z.string(), z.number().finite(), z.boolean()]);

export const RetrievalProfileV2Schema = z.object({
  system: z.enum(ALL_RUN_SYSTEMS),
  profile_id: z.string().regex(/^[a-z0-9][a-z0-9._-]+$/),
  runner: z.string().min(1),
  parameters: z.record(z.string().min(1), ParameterSchema),
}).strict();

export const RetrievalProfilesV2Schema = z.object({
  schema_version: z.literal("2.0.0"),
  contract: z.literal("stellar-bazaar-retrieval-profiles-v2"),
  pool_depth: z.literal(20),
  repool_policy: z.object({
    catalog_change: z.literal("any-byte-change"),
    query_change: z.literal("any-byte-change"),
    profile_change: z.literal("any-byte-change"),
    implementation_change: z.literal("any-byte-change"),
    system_run_change: z.literal("any-byte-change"),
    reason: z.string().min(1),
  }).strict(),
  implementation_inputs: z.array(z.string().min(1)).min(1),
  profiles: z.array(RetrievalProfileV2Schema).length(ALL_RUN_SYSTEMS.length),
}).strict().superRefine((value, context) => {
  const systems = value.profiles.map(profile => profile.system);
  for (const system of ALL_RUN_SYSTEMS) {
    if (systems.filter(candidate => candidate === system).length !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profiles"],
        message: `must define ${system} exactly once`,
      });
    }
  }
  if (new Set(value.implementation_inputs).size !== value.implementation_inputs.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["implementation_inputs"],
      message: "must not contain duplicates",
    });
  }
});

const SystemRunBindingSchema = z.object({
  path: z.string().min(1),
  artifact: ArtifactHashSchema,
  profile_id: z.string().min(1),
  run_id: z.string().min(1),
  generated_at: z.string().datetime(),
  query_count: z.literal(100),
  requested_depth: z.literal(20),
}).strict();

const systemRunBindingsShape = Object.fromEntries(
  ALL_RUN_SYSTEMS.map(system => [system, SystemRunBindingSchema]),
) as { [K in RunSystem]: typeof SystemRunBindingSchema };

export const PoolSnapshotBindingV2Schema = z.object({
  dataset: z.object({
    manifest_path: z.literal(DATASET_MANIFEST_PATH),
    manifest_sha256: Sha256Schema,
    catalog_sha256: Sha256Schema,
    sidecar_sha256: Sha256Schema,
    queries_sha256: Sha256Schema,
  }).strict(),
  retrieval_profiles: z.object({
    path: z.literal(RETRIEVAL_PROFILES_PATH),
    artifact: ArtifactHashSchema,
  }).strict(),
  implementation_inputs: z.record(z.string().min(1), ArtifactHashSchema),
  system_runs: z.object(systemRunBindingsShape).strict(),
  pool: z.object({
    path: z.literal(POOL_ARTIFACT_PATH),
    artifact: ArtifactHashSchema,
    run_id: z.string().min(1),
    pooled_at: z.string().datetime(),
    record_count: z.number().int().positive(),
    depth: z.literal(20),
  }).strict(),
}).strict();

export const PoolSnapshotV2Schema = z.object({
  schema_version: z.literal("2.0.0"),
  contract: z.literal("stellar-bazaar-pool-snapshot-v2"),
  generated_at: z.string().datetime(),
  binding: PoolSnapshotBindingV2Schema,
}).strict();

export type RetrievalProfilesV2 = z.infer<typeof RetrievalProfilesV2Schema>;
export type PoolSnapshotBindingV2 = z.infer<typeof PoolSnapshotBindingV2Schema>;
export type PoolSnapshotV2 = z.infer<typeof PoolSnapshotV2Schema>;

export class StalePoolError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`pool snapshot is stale; re-run all retrieval profiles, re-pool, and grade new candidates:\n${issues.map(issue => `- ${issue}`).join("\n")}`);
    this.name = "StalePoolError";
    this.issues = issues;
  }
}

function containedBy(parent: string, child: string): boolean {
  const result = relative(resolve(parent), resolve(child));
  return result === "" || (!isAbsolute(result) && result !== ".." && !result.startsWith(`..${sep}`));
}

function implementationPath(root: string, path: string): string {
  if (isAbsolute(path)) throw new Error(`${path}: implementation input must be relative`);
  const absolute = resolve(root, path);
  const facilitatorRoot = resolve(root, "..");
  if (!containedBy(facilitatorRoot, absolute)) {
    throw new Error(`${path}: implementation input must stay below the facilitator root`);
  }
  return absolute;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readPool(path: string): Promise<PoolRecord[]> {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      return [PoolRecordSchema.parse(JSON.parse(line))];
    } catch (error) {
      throw new Error(`${path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function oneValue(records: readonly SystemRunRecord[], key: "run_id" | "generated_at", system: RunSystem): string {
  const values = new Set(records.map(record => record[key]));
  if (values.size !== 1) throw new Error(`${system}: records must carry exactly one ${key}`);
  return [...values][0]!;
}

async function systemRunBinding(
  root: string,
  runs: SystemRuns,
  profiles: RetrievalProfilesV2,
): Promise<PoolSnapshotBindingV2["system_runs"]> {
  const entries = await Promise.all(ALL_RUN_SYSTEMS.map(async system => {
    const path = `runs/${SYSTEM_RUN_FILENAMES[system]}`;
    const profile = profiles.profiles.find(candidate => candidate.system === system)!;
    const records = runs[system];
    return [system, {
      path,
      artifact: await hashFile(resolve(root, path)),
      profile_id: profile.profile_id,
      run_id: oneValue(records, "run_id", system),
      generated_at: oneValue(records, "generated_at", system),
      query_count: 100 as const,
      requested_depth: 20 as const,
    }] as const;
  }));
  return Object.fromEntries(entries) as PoolSnapshotBindingV2["system_runs"];
}

async function currentBinding(
  root: string,
  runs: SystemRuns,
  pool: PoolRecord[],
): Promise<PoolSnapshotBindingV2> {
  const frozen = await verifyFrozenDataset(root);
  const profilesPath = resolve(root, RETRIEVAL_PROFILES_PATH);
  const profiles = RetrievalProfilesV2Schema.parse(await readJson(profilesPath));
  const implementationEntries = await Promise.all(profiles.implementation_inputs.map(async path => [
    path,
    await hashFile(implementationPath(root, path)),
  ] as const));
  const poolRunIds = new Set(pool.map(record => record.run_id));
  const pooledAtValues = new Set(pool.map(record => record.pooled_at));
  if (poolRunIds.size !== 1) throw new Error("pool records must carry exactly one run_id");
  if (pooledAtValues.size !== 1) throw new Error("pool records must carry exactly one pooled_at");
  return PoolSnapshotBindingV2Schema.parse({
    dataset: {
      manifest_path: DATASET_MANIFEST_PATH,
      manifest_sha256: frozen.manifestSha256,
      catalog_sha256: frozen.manifest.hashes["catalog/catalog-v2.jsonl"],
      sidecar_sha256: frozen.manifest.hashes["catalog/sidecar-v2.jsonl"],
      queries_sha256: frozen.manifest.hashes["queries/queries-v2.jsonl"],
    },
    retrieval_profiles: {
      path: RETRIEVAL_PROFILES_PATH,
      artifact: await hashFile(profilesPath),
    },
    implementation_inputs: Object.fromEntries(implementationEntries),
    system_runs: await systemRunBinding(root, runs, profiles),
    pool: {
      path: POOL_ARTIFACT_PATH,
      artifact: await hashFile(resolve(root, POOL_ARTIFACT_PATH)),
      run_id: [...poolRunIds][0],
      pooled_at: [...pooledAtValues][0],
      record_count: pool.length,
      depth: 20,
    },
  });
}

/** Returns deterministic, human-readable reasons that a pool must be rebuilt. */
export function poolBindingDifferences(
  expectedInput: PoolSnapshotBindingV2,
  actualInput: PoolSnapshotBindingV2,
): string[] {
  const expected = PoolSnapshotBindingV2Schema.parse(expectedInput);
  const actual = PoolSnapshotBindingV2Schema.parse(actualInput);
  const issues: string[] = [];
  const compare = (label: string, left: unknown, right: unknown): void => {
    if (JSON.stringify(left) !== JSON.stringify(right)) issues.push(`${label} changed`);
  };
  compare("frozen dataset", expected.dataset, actual.dataset);
  compare("retrieval profile contract", expected.retrieval_profiles, actual.retrieval_profiles);
  compare("retrieval implementation inputs", expected.implementation_inputs, actual.implementation_inputs);
  for (const system of ALL_RUN_SYSTEMS) {
    compare(`${system} system run`, expected.system_runs[system], actual.system_runs[system]);
  }
  compare("pool artifact", expected.pool, actual.pool);
  return issues;
}

/** Creates the binding after all five complete runs and the exact pool have been written. */
export async function createPoolSnapshot(
  rootInput: string,
  generatedAt: string,
): Promise<PoolSnapshotV2> {
  const root = resolve(rootInput);
  const dataset = await loadV2Dataset(root);
  const queryIds = new Set(dataset.queries.map(query => query.query_id));
  const resourceIds = new Set(dataset.catalog.map(record => record.resource_id));
  const runs = await loadSystemRuns(resolve(root, "runs"), queryIds, resourceIds);
  const pool = await readPool(resolve(root, POOL_ARTIFACT_PATH));
  validateRunEligibility(dataset, runs);
  validateExactPoolCoverage(pool, runs);
  return PoolSnapshotV2Schema.parse({
    schema_version: "2.0.0",
    contract: "stellar-bazaar-pool-snapshot-v2",
    generated_at: generatedAt,
    binding: await currentBinding(root, runs, pool),
  });
}

/** Fails if dataset, profile, implementation, run, or pool bytes changed since pooling. */
export async function verifyPoolSnapshot(rootInput: string): Promise<PoolSnapshotV2> {
  const root = resolve(rootInput);
  const snapshotPath = resolve(root, POOL_SNAPSHOT_PATH);
  const snapshot = PoolSnapshotV2Schema.parse(await readJson(snapshotPath));
  const dataset = await loadV2Dataset(root);
  const queryIds = new Set(dataset.queries.map(query => query.query_id));
  const resourceIds = new Set(dataset.catalog.map(record => record.resource_id));
  const runs = await loadSystemRuns(resolve(root, "runs"), queryIds, resourceIds);
  const pool = await readPool(resolve(root, POOL_ARTIFACT_PATH));
  validateRunEligibility(dataset, runs);
  validateExactPoolCoverage(pool, runs);
  const issues = poolBindingDifferences(snapshot.binding, await currentBinding(root, runs, pool));
  if (issues.length > 0) throw new StalePoolError(issues);
  return snapshot;
}

/** Stable artifact hash type re-export for gate integrations. */
export type PoolArtifactHash = z.infer<typeof ArtifactHashSchema>;
