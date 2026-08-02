import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { encodeJsonl, readJsonl, sha256 } from "../release/io.js";
import { QueryRecordSchema } from "../release/schema.js";
import { fetchEcosystemSources, type EcosystemSourceSpec } from "./fetch.js";
import { mergeEcosystemResources, normalizeExternalRecord } from "./normalize.js";
import { applyEcosystemProbes, probeEcosystemResources } from "./probe.js";
import {
  EcosystemManifestSchema,
  EcosystemQuerySchema,
  type EcosystemSource,
} from "./schema.js";
import { validateEcosystemDataset } from "./validate.js";

const ARTIFACTS = [
  "queries/queries-v1.jsonl",
  "judgments/judgments-v1.jsonl",
  "outcomes/outcomes-v1.jsonl",
] as const;

async function ensureWorkspace(root: string): Promise<void> {
  await Promise.all(["catalog", "raw", "manifests", "queries", "judgments", "outcomes", "reports", "runs"]
    .map(directory => mkdir(resolve(root, directory), { recursive: true })));
}

async function optionalArtifact(root: string, relative: string): Promise<{ count: number; hash?: string }> {
  try {
    const bytes = await readFile(resolve(root, relative));
    const count = bytes.toString("utf8").split(/\r?\n/).filter(line => line.trim().length > 0).length;
    return { count, hash: sha256(bytes) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { count: 0 };
    throw error;
  }
}

export interface EcosystemRefreshResult {
  root: string;
  resources: number;
  sources: Array<{ source: EcosystemSource; records: number }>;
  source_errors: Array<{ source: EcosystemSource; url: string; error: string }>;
}

/** Fetches, normalizes, pins, and manifests one live ecosystem snapshot. */
export async function refreshEcosystemDataset(
  root: string,
  options: { sources?: EcosystemSourceSpec[]; fetch_impl?: typeof fetch } = {},
): Promise<EcosystemRefreshResult> {
  const fetched = await fetchEcosystemSources(options.sources, options.fetch_impl);
  if (fetched.results.length === 0) {
    throw new Error(`all ecosystem sources failed: ${fetched.errors.map(value => `${value.source}: ${value.error}`).join("; ")}`);
  }
  const resources = mergeEcosystemResources(fetched.results.flatMap(result => result.records.map(record => normalizeExternalRecord(record, {
    source: result.source,
    sourceUrl: result.url,
    observedAt: result.fetched_at,
    redistribution: result.source === "openx402" ? "allowed" : "derived_only",
  })).filter((value): value is NonNullable<typeof value> => value !== null)));
  if (resources.length === 0) throw new Error("sources returned no records with valid HTTP(S) resource URLs");

  await ensureWorkspace(root);
  const catalogText = encodeJsonl(resources);
  await writeFile(resolve(root, "catalog/catalog-v1.jsonl"), catalogText);
  await Promise.all(fetched.results.map(result => writeFile(
    resolve(root, `raw/${result.source}.jsonl`), encodeJsonl(result.records), { mode: 0o600 },
  )));

  const artifacts = await Promise.all(ARTIFACTS.map(relative => optionalArtifact(root, relative)));
  const queries = artifacts[0]!;
  const judgments = artifacts[1]!;
  const outcomes = artifacts[2]!;
  const manifest = EcosystemManifestSchema.parse({
    dataset_version: "v1.0.0",
    generated_at: new Date().toISOString(),
    hashes: {
      "catalog/catalog-v1.jsonl": sha256(catalogText),
      ...(queries.hash ? { [ARTIFACTS[0]]: queries.hash } : {}),
      ...(judgments.hash ? { [ARTIFACTS[1]]: judgments.hash } : {}),
      ...(outcomes.hash ? { [ARTIFACTS[2]]: outcomes.hash } : {}),
    },
    counts: { resources: resources.length, queries: queries.count, judgments: judgments.count, outcomes: outcomes.count },
    sources: fetched.results.map(value => value.source),
    source_errors: fetched.errors.map(value => ({ source: value.source, error: `${value.url}: ${value.error}` })),
    redistribution: "Foreign raw responses remain local and ignored. The normalized catalog retains source hashes and provenance; external descriptions are not relicensed by this repository.",
  });
  await writeFile(resolve(root, "manifests/dataset-v1.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(resolve(root, "manifests/sources-v1.json"), `${JSON.stringify({
    fetched_at: new Date().toISOString(),
    results: fetched.results.map(({ records: _records, ...result }) => result),
    errors: fetched.errors,
  }, null, 2)}\n`);
  return {
    root,
    resources: resources.length,
    sources: fetched.results.map(value => ({ source: value.source, records: value.records.length })),
    source_errors: fetched.errors,
  };
}

/** Reuses the controlled cohort's information needs in the live cohort. */
export async function seedEcosystemQueries(releaseRoot: string, ecosystemRoot: string): Promise<number> {
  const source = await readJsonl(resolve(releaseRoot, "queries/queries-v1.jsonl"), QueryRecordSchema);
  const queries = source.map((value, index) => EcosystemQuerySchema.parse({
    query_id: `eco-qry-${String(index + 1).padStart(4, "0")}`,
    split: value.split,
    query_class: value.query_class === "price_category" ? "price" : value.query_class,
    text: value.query,
    filters: Object.fromEntries(Object.entries({ ...value.filters, ...value.evaluation_constraints })
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, Array.isArray(item) ? item.map(String) : item])),
    expects_no_result: value.expects_no_result,
    provenance: { kind: "imported", generation_id: "release-query-adapter-v1" },
  }));
  const text = encodeJsonl(queries);
  await mkdir(resolve(ecosystemRoot, "queries"), { recursive: true });
  await writeFile(resolve(ecosystemRoot, ARTIFACTS[0]), text);
  const manifestPath = resolve(ecosystemRoot, "manifests/dataset-v1.json");
  const manifest = EcosystemManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  manifest.counts.queries = queries.length;
  manifest.hashes[ARTIFACTS[0]] = sha256(text);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return queries.length;
}

export interface EcosystemProbeResult {
  probed: number;
  passed: number;
  failed: number;
}

/** Adds bounded liveness evidence to the pinned live snapshot. */
export async function probeEcosystemDataset(
  root: string,
  options: { limit?: number; concurrency?: number; timeout_ms?: number; fetch_impl?: typeof fetch } = {},
): Promise<EcosystemProbeResult> {
  const dataset = await validateEcosystemDataset(root);
  const limit = options.limit ?? 500;
  const selected = limit === 0 ? dataset.resources : dataset.resources.slice(0, Math.max(0, limit));
  const probes = await probeEcosystemResources(selected, {
    concurrency: options.concurrency ?? 8,
    timeout_ms: options.timeout_ms ?? 5_000,
    ...(options.fetch_impl ? { fetch_impl: options.fetch_impl } : {}),
  });
  const catalogText = encodeJsonl(applyEcosystemProbes(dataset.resources, probes));
  await writeFile(resolve(root, "catalog/catalog-v1.jsonl"), catalogText);
  const manifest = {
    ...dataset.manifest,
    generated_at: new Date().toISOString(),
    hashes: { ...dataset.manifest.hashes, "catalog/catalog-v1.jsonl": sha256(catalogText) },
  };
  await writeFile(resolve(root, "manifests/dataset-v1.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    probed: probes.length,
    passed: probes.filter(value => value.liveness === "pass").length,
    failed: probes.filter(value => value.liveness === "fail").length,
  };
}
