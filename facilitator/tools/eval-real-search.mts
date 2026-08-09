#!/usr/bin/env node
/** Wires the real facilitator search (lexical Postgres ts_rank_cd + semantic
 * BAAI/bge-m3 + production hybrid RRF) against the handwritten-evals benchmark
 * catalog, on an isolated database. Writes real SystemRunRecordSchema run
 * files for lexical/semantic/hybrid, matching the SCORED_SYSTEMS the
 * benchmark's own report pipeline expects.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx tools/eval-real-search.mts
 *   DATABASE_URL=postgresql://... npx tsx tools/eval-real-search.mts --lexical-weight 0.2 --semantic-weight 0.8 --rrf-k 6 --tag tuned
 *
 * DATABASE_URL must point at an isolated Postgres instance -- never a
 * shared/production database. See ../compose.yaml for a local instance.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { migrate } from "../src/db/migrate.js";
import { CatalogStore } from "../src/db/catalog.js";
import { SearchStore } from "../src/db/search.js";
import { seedSuite, runProfile, buildIndex, type FixtureResource } from "../src/search/harness.js";
import type { EvalSuite } from "../src/search/evaluate.js";
import { catalogConfig, searchConfig } from "../tests/helpers/bazaar.js";

const EVAL_ROOT = resolve(import.meta.dirname, "../handwritten-evals");
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required -- point it at an isolated Postgres instance, never a shared/production database");

function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1]!;
}

// Defaults match the shipped production profile (see facilitator/docs/SEARCH.md).
// Pass --lexical-weight/--semantic-weight/--rrf-k to score a different weighting,
// e.g. the tuned config found by this benchmark: 0.2 / 0.8 / 6.
const LEXICAL_WEIGHT = Number(argValue("--lexical-weight", "0.7"));
const SEMANTIC_WEIGHT = Number(argValue("--semantic-weight", "0.3"));
const RRF_K = Number(argValue("--rrf-k", "20"));
const TAG = argValue("--tag", "default");

async function readJsonl(path: string): Promise<any[]> {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
}

function toFixtureResource(catalogRow: any, sidecarRow: any): FixtureResource {
  const wire = catalogRow.wire;
  const res = wire.resource;
  const accept = wire.accepts[0];
  const base: FixtureResource = {
    id: catalogRow.resource_id,
    kind: sidecarRow.resource_type === "mcp" ? "mcp" : "http",
    url: res.url,
    payTo: accept.payTo,
    serviceName: res.serviceName,
    description: res.description,
    tags: res.tags,
    amount: accept.amount,
    scheme: accept.scheme,
    network: accept.network,
    asset: accept.asset,
  };
  if (base.kind === "mcp") {
    base.toolName = (res.serviceName as string).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    base.inputSchema = { type: "object", properties: {} };
  } else {
    base.method = "GET";
  }
  return base;
}

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  await migrate(pool);

  const [catalogRows, sidecarRows, queryRows] = await Promise.all([
    readJsonl(resolve(EVAL_ROOT, "catalog/catalog-v2.jsonl")),
    readJsonl(resolve(EVAL_ROOT, "catalog/sidecar-v2.jsonl")),
    readJsonl(resolve(EVAL_ROOT, "queries/queries-v2.jsonl")),
  ]);
  const sidecarById = new Map(sidecarRows.map(s => [s.resource_id, s]));

  const resources: FixtureResource[] = catalogRows.map(row => toFixtureResource(row, sidecarById.get(row.resource_id)));

  const suite: EvalSuite = {
    name: "stellar-bazaar-v2",
    resources: resources as unknown as Array<Record<string, unknown>>,
    queries: queryRows.map((q: any) => ({
      query: q.query,
      queryClass: q.query_class,
      judgments: [],
    })),
  };

  const catalog = new CatalogStore(pool);
  const searchStore = new SearchStore(pool);

  console.error(`seeding ${resources.length} resources...`);
  const keys = await seedSuite(catalog, suite, catalogConfig());
  console.error(`seeded ${keys.size} resources`);

  const config = searchConfig({
    lexical: { enabled: true, language: "simple", weight: LEXICAL_WEIGHT, candidateCount: 250 },
    semantic: {
      enabled: true,
      provider: "local",
      modelId: "BAAI/bge-m3",
      repo: "Xenova/bge-m3",
      revision: "4de13258303883538bd53b696b452bf8099f0858",
      dimension: 1024,
      pooling: "cls",
      normalization: "l2",
      weight: SEMANTIC_WEIGHT,
      timeoutMs: 60_000,
      candidateCount: 250,
      maxDistance: 0.9,
    },
    rrfK: RRF_K,
    models: { cacheDir: resolve(import.meta.dirname, "../.models"), offline: false, dtype: "q8", requirePinnedRevision: false },
  });

  console.error(`config: lexical=${LEXICAL_WEIGHT} semantic=${SEMANTIC_WEIGHT} rrf_k=${RRF_K}`);
  console.error("building semantic index (downloading model on first run, this can take a while)...");
  const indexResult = await buildIndex(searchStore, config, "eval-worker-1");
  console.error("index result:", JSON.stringify(indexResult.status), JSON.stringify(indexResult.coverage));

  const options = { suite, pool, catalog, searchStore, searchConfig: config, catalogConfig: catalogConfig(), limit: 20, keys };

  const modes: Array<{ name: string; overrides: Partial<typeof config> }> = [
    { name: "lexical", overrides: { semantic: { ...config.semantic, enabled: false } } },
    { name: "semantic", overrides: { lexical: { ...config.lexical, enabled: false } } },
    { name: "hybrid", overrides: {} },
  ];

  for (const mode of modes) {
    console.error(`running profile: ${mode.name}...`);
    const result = await runProfile(options, mode.name, mode.overrides as any);
    console.error(`  effective mode: ${result.mode}, reranked: ${result.reranked}`);

    const records = result.perQuery.map((entry, index) => ({
      system: mode.name,
      query_id: queryRows[index].query_id,
      run_id: `real-facilitator-eval-${TAG}`,
      generated_at: new Date().toISOString(),
      latency_ms: entry.metrics.latencyMs ?? 0,
      requested_depth: 20,
      total_results: entry.returned.length,
      results: entry.returned.slice(0, 20).map((resourceId, i) => ({ resource_id: resourceId, rank: i + 1 })),
    }));

    const suffix = mode.name === "hybrid" && TAG !== "default" ? `${mode.name}-${TAG}` : mode.name;
    const outPath = resolve(EVAL_ROOT, `runs/real-${suffix}-v2.jsonl`);
    await writeFile(outPath, records.map(r => JSON.stringify(r)).join("\n") + "\n");
    console.error(`  wrote ${outPath}`);
  }

  await pool.end();
  console.error("done.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
