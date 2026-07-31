import type { Pool } from "pg";
import { bazaar } from "@openx402/bazaar-sdk";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { CatalogConfig, SearchConfig } from "../types.js";
import { CatalogStore } from "../db/catalog.js";
import { SearchStore } from "../db/search.js";
import { extractCandidate } from "../bazaar/extract.js";
import { SearchService, type SearchMode } from "./service.js";
import { EmbeddingWorker } from "./worker.js";
import { createEmbeddingProvider, createRerankerProvider } from "./providers/index.js";
import {
  aggregate, scoreQuery, type EvalSuite, type QueryMetrics, type SuiteMetrics,
} from "./evaluate.js";

/** One seller declaration in a fixture suite. */
export interface FixtureResource {
  id: string;
  kind: "http" | "mcp";
  url: string;
  payTo: string;
  serviceName?: string;
  description?: string;
  tags?: string[];
  method?: "GET" | "HEAD" | "DELETE" | "POST" | "PUT" | "PATCH";
  query?: Record<string, never>;
  body?: Record<string, never>;
  toolName?: string;
  inputSchema?: Record<string, unknown>;
  example?: Record<string, unknown>;
  output?: Record<string, unknown>;
  amount?: string;
  scheme?: string;
  network?: string;
  asset?: string;
}

const DEFAULT_ASSET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

/** Compiles a fixture entry into the payload a facilitator would actually see. */
export function fixturePayload(resource: FixtureResource): {
  payload: PaymentPayload; requirements: PaymentRequirements;
} {
  const metadata = resource.kind === "mcp"
    ? bazaar.mcp({
        toolName: resource.toolName!,
        ...(resource.description ? { description: resource.description } : {}),
        ...(resource.serviceName ? { serviceName: resource.serviceName } : {}),
        ...(resource.tags ? { tags: resource.tags } : {}),
        transport: "streamable-http",
        inputSchema: resource.inputSchema ?? { type: "object", properties: {} },
        ...(resource.example ? { example: resource.example } : {}),
        ...(resource.output ? { output: resource.output } : {}),
      } as Parameters<typeof bazaar.mcp>[0])
    : bazaar.http({
        method: resource.method ?? "GET",
        ...(resource.description ? { description: resource.description } : {}),
        ...(resource.serviceName ? { serviceName: resource.serviceName } : {}),
        ...(resource.tags ? { tags: resource.tags } : {}),
        ...(resource.query ? { query: resource.query } : {}),
        ...(resource.body ? { body: resource.body } : {}),
        ...(resource.output ? { output: resource.output } : {}),
      } as Parameters<typeof bazaar.http>[0]);

  const requirements = {
    scheme: resource.scheme ?? "exact",
    network: resource.network ?? "stellar:testnet",
    asset: resource.asset ?? DEFAULT_ASSET,
    amount: resource.amount ?? "1000",
    payTo: resource.payTo,
    maxTimeoutSeconds: 60,
    extra: {},
  } as PaymentRequirements;

  return {
    requirements,
    payload: {
      x402Version: 2,
      resource: { url: resource.url, ...metadata.resource },
      accepted: requirements,
      payload: { transaction: "AAAA" },
      extensions: { ...metadata.extensions },
    } as unknown as PaymentPayload,
  };
}

/**
 * Catalogs a fixture suite, returning fixture id → catalog resource key.
 * Judgments are written against fixture ids so a suite survives a database
 * reset and a reindex.
 */
export async function seedSuite(
  catalog: CatalogStore,
  suite: EvalSuite,
  config: CatalogConfig,
): Promise<Map<string, string>> {
  const keys = new Map<string, string>();
  for (const raw of suite.resources) {
    const resource = raw as unknown as FixtureResource;
    const { payload, requirements } = fixturePayload(resource);
    const extracted = extractCandidate(payload, requirements, config);
    if (extracted.kind !== "candidate") {
      throw new Error(`fixture ${resource.id} was rejected: ${JSON.stringify(extracted)}`);
    }
    await catalog.observe(extracted.candidate, {
      stage: "settled", activate: true, duplicateChanged: "version_and_verify",
    });
    keys.set(resource.id, extracted.candidate.resourceKey);
  }
  return keys;
}

export interface ProfileResult {
  name: string;
  mode: SearchMode;
  reranked: boolean;
  metrics: SuiteMetrics;
  perQuery: Array<{
    query: string;
    queryClass: string;
    metrics: QueryMetrics;
    returned: string[];
    degraded: Record<string, unknown>;
  }>;
}

export interface RunnerOptions {
  suite: EvalSuite;
  pool: Pool;
  catalog: CatalogStore;
  searchStore: SearchStore;
  searchConfig: SearchConfig;
  catalogConfig: CatalogConfig;
  limit: number;
  /** fixture id → catalog resource key, from `seedSuite`. */
  keys: Map<string, string>;
}

/**
 * Runs one retrieval profile over a seeded suite.
 *
 * The profile is expressed purely as a `SearchConfig` override, so
 * "lexical-only", "hybrid" and "hybrid + rerank" run through exactly the same
 * code path a real request takes.
 */
export async function runProfile(
  options: RunnerOptions,
  name: string,
  overrides: Partial<SearchConfig>,
): Promise<ProfileResult> {
  const config: SearchConfig = { ...options.searchConfig, ...overrides };
  const embedder = createEmbeddingProvider(config);
  const reranker = createRerankerProvider(config);
  const service = new SearchService(config, options.catalog, options.searchStore, embedder, reranker);
  await service.refreshGeneration();

  const byKey = new Map([...options.keys].map(([id, key]) => [key, id]));
  const resourceKeys = await resourceKeyByVersion(options.pool);
  const snapshot = await options.catalog.watermark();
  const perQuery: ProfileResult["perQuery"] = [];
  const scored: Array<{ query: EvalSuite["queries"][number]; metrics: QueryMetrics; degraded: Record<string, unknown> }> = [];

  for (const query of options.suite.queries) {
    const started = Date.now();
    const result = await service.search({
      filters: (query.filters ?? {}) as Record<string, string>,
      limit: options.limit,
      offset: 0,
      snapshot,
      includeStale: false,
      includeUnverified: false,
      staleAfterHours: 168,
      query: query.query,
    });
    const ranked = result.rows
      .map(row => resourceKeys.get(row.versionId))
      .filter((key): key is string => key !== undefined)
      .map(key => byKey.get(key) ?? key);
    const metrics = scoreQuery(
      { ...query, judgments: query.judgments },
      ranked,
      Date.now() - started,
    );
    perQuery.push({
      query: query.query,
      queryClass: query.queryClass,
      metrics,
      returned: ranked,
      degraded: result.degraded as unknown as Record<string, unknown>,
    });
    scored.push({ query, metrics, degraded: result.degraded as unknown as Record<string, unknown> });
  }

  const effective = perQuery[0]?.degraded.effectiveMode as SearchMode | undefined;
  return {
    name,
    mode: effective ?? "lexical",
    reranked: perQuery.some(entry => entry.degraded.reranking === "used"),
    metrics: aggregate(scored, options.suite.resources.length),
    perQuery,
  };
}

async function resourceKeyByVersion(pool: Pool): Promise<Map<number, string>> {
  const rows = await pool.query<{ version_id: string; resource_key: string }>(
    `SELECT v.id AS version_id, r.resource_key
     FROM catalog_resource_versions v JOIN catalog_resources r ON r.id = v.resource_id`,
  );
  return new Map(rows.rows.map(row => [Number(row.version_id), row.resource_key]));
}

/** Drains the embedding queue so a profile runs against a complete index. */
export async function buildIndex(
  searchStore: SearchStore,
  config: SearchConfig,
  workerId: string,
): Promise<{ stored: number; status: ReturnType<EmbeddingWorker["status"]> }> {
  const provider = createEmbeddingProvider(config);
  const worker = new EmbeddingWorker(config, searchStore, workerId, provider);
  await worker.prepare();
  const stored = await worker.drain();
  return { stored, status: worker.status() };
}
