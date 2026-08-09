#!/usr/bin/env node
/** Reuses the already-built embedding index to test the tuned hybrid weighting
 * (semantic-favored, tighter rrf_k) against the real facilitator search. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { CatalogStore } from "../src/db/catalog.js";
import { SearchStore } from "../src/db/search.js";
import { seedSuite, runProfile, type FixtureResource } from "../src/search/harness.js";
import type { EvalSuite } from "../src/search/evaluate.js";
import { catalogConfig, searchConfig } from "../tests/helpers/bazaar.js";

const EVAL_ROOT = resolve(import.meta.dirname, "../handwritten-evals");
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required -- point it at an isolated Postgres instance, never a shared/production database");

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
    url: res.url, payTo: accept.payTo, serviceName: res.serviceName, description: res.description,
    tags: res.tags, amount: accept.amount, scheme: accept.scheme, network: accept.network, asset: accept.asset,
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
    queries: queryRows.map((q: any) => ({ query: q.query, queryClass: q.query_class, judgments: [] })),
  };
  const catalog = new CatalogStore(pool);
  const searchStore = new SearchStore(pool);

  // Resources are already seeded and indexed from the prior run; re-seeding
  // the same fixture ids just resolves existing keys (idempotent lookups).
  const keys = await seedSuite(catalog, suite, catalogConfig());

  const config = searchConfig({
    lexical: { enabled: true, language: "simple", weight: 0.2, candidateCount: 250 },
    semantic: {
      enabled: true, provider: "local", modelId: "BAAI/bge-m3", repo: "Xenova/bge-m3",
      revision: "4de13258303883538bd53b696b452bf8099f0858", dimension: 1024, pooling: "cls",
      normalization: "l2", weight: 0.8, timeoutMs: 60_000, candidateCount: 250, maxDistance: 0.9,
    },
    rrfK: 6,
    models: { cacheDir: resolve(import.meta.dirname, "../.models"), offline: false, dtype: "q8", requirePinnedRevision: false },
  });

  const options = { suite, pool, catalog, searchStore, searchConfig: config, catalogConfig: catalogConfig(), limit: 20, keys };
  console.error("running tuned hybrid profile (lexical=0.2, semantic=0.8, rrf_k=6)...");
  const result = await runProfile(options, "hybrid_tuned", {});
  console.error(`effective mode: ${result.mode}`);

  const records = result.perQuery.map((entry, index) => ({
    system: "hybrid_tuned",
    query_id: queryRows[index].query_id,
    run_id: "real-facilitator-eval-tuned-v1",
    generated_at: new Date().toISOString(),
    latency_ms: entry.metrics.latencyMs ?? 0,
    requested_depth: 20,
    total_results: entry.returned.length,
    results: entry.returned.slice(0, 20).map((resourceId, i) => ({ resource_id: resourceId, rank: i + 1 })),
  }));
  const outPath = resolve(EVAL_ROOT, "runs/real-hybrid-tuned-v2.jsonl");
  await writeFile(outPath, records.map(r => JSON.stringify(r)).join("\n") + "\n");
  console.error(`wrote ${outPath}`);
  await pool.end();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
