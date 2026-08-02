import { Router, type Request } from "express";
import type { AppConfig } from "../types.js";
import type { AnalyticsStore } from "../db/analytics.js";
import type { CatalogStore } from "../db/catalog.js";
import type { SearchStore } from "../db/search.js";
import type { EmbeddingWorker } from "../search/worker.js";

/**
 * Operator analytics. These routes are internal: they carry provenance, status
 * and liveness fields that must never enter a Bazaar wire response.
 */
function single(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function window(req: Request): { days: number } {
  const raw = Number(single(req.query.days) ?? 30);
  const allowed = [0, 1, 7, 14, 30];
  return { days: allowed.includes(raw) ? raw : 30 };
}

function paging(req: Request, config: AppConfig): { limit: number; offset: number } {
  const limit = Number(single(req.query.limit) ?? config.analytics.defaultPageSize);
  const offset = Number(single(req.query.offset) ?? 0);
  return {
    limit: Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), config.analytics.maxPageSize)
      : config.analytics.defaultPageSize,
    offset: Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0,
  };
}

function redact(config: AppConfig, address: unknown): unknown {
  if (!config.analytics.redactAddresses || typeof address !== "string") return address;
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : "…";
}

export function createAnalyticsRouter(
  config: AppConfig,
  analytics: AnalyticsStore,
  catalog: CatalogStore,
  search?: SearchStore,
  worker?: EmbeddingWorker,
): Router {
  const router = Router();

  router.use((_req, res, next) => {
    if (!config.analytics.enabled) {
      res.status(404).json({ error: "analytics_disabled" });
      return;
    }
    next();
  });

  router.get("/overview", async (req, res, next) => {
    try {
      res.json(await analytics.overview(window(req)));
    } catch (error) { next(error); }
  });

  router.get("/overview/timeseries", async (req, res, next) => {
    try {
      const bucket = single(req.query.bucket) === "hour" ? "hour" : "day";
      res.json({ bucket, series: await analytics.timeseries(window(req), bucket) });
    } catch (error) { next(error); }
  });

  router.get("/overview/breakdowns", async (req, res, next) => {
    try {
      res.json(await analytics.breakdowns(window(req)));
    } catch (error) { next(error); }
  });

  router.get("/volume/daily", async (req, res, next) => {
    try {
      res.json({ days: await analytics.dailyVolume(window(req)) });
    } catch (error) { next(error); }
  });

  router.get("/transactions", async (req, res, next) => {
    try {
      const page = paging(req, config);
      const result = await analytics.transactions({
        ...page,
        ...(single(req.query.payer) ? { payer: single(req.query.payer)! } : {}),
        ...(single(req.query.payTo) ? { payTo: single(req.query.payTo)! } : {}),
        ...(single(req.query.network) ? { network: single(req.query.network)! } : {}),
        ...(single(req.query.scheme) ? { scheme: single(req.query.scheme)! } : {}),
        ...(single(req.query.asset) ? { asset: single(req.query.asset)! } : {}),
        ...(single(req.query.status) ? { status: single(req.query.status)! } : {}),
        ...(single(req.query.resourceId) ? { resourceId: Number(single(req.query.resourceId)) } : {}),
      });
      res.json({
        items: result.items.map(item => ({
          ...item, payer: redact(config, item.payer), pay_to: redact(config, item.pay_to),
        })),
        pagination: { ...page, total: result.total },
      });
    } catch (error) { next(error); }
  });

  router.get("/transactions/:hash", async (req, res, next) => {
    try {
      const found = await analytics.transactionByHash(req.params.hash);
      if (!found) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json(found);
    } catch (error) { next(error); }
  });

  for (const role of ["buyers", "sellers"] as const) {
    const key = role === "buyers" ? "buyer" : "seller";
    router.get(`/${role}`, async (req, res, next) => {
      try {
        const page = paging(req, config);
        const result = await analytics.participants(key, window(req), page);
        res.json({
          items: result.items.map(item => ({ ...item, address: redact(config, item.address) })),
          concentration: result.concentration,
          pagination: { ...page, total: result.total },
        });
      } catch (error) { next(error); }
    });

    router.get(`/${role}/:address`, async (req, res, next) => {
      try {
        res.json(await analytics.participantDetail(key, req.params.address, window(req)));
      } catch (error) { next(error); }
    });

    router.get(`/${role}/:address/transactions`, async (req, res, next) => {
      try {
        const page = paging(req, config);
        const filter = key === "buyer" ? { payer: req.params.address } : { payTo: req.params.address };
        const result = await analytics.transactions({ ...page, ...filter });
        res.json({ items: result.items, pagination: { ...page, total: result.total } });
      } catch (error) { next(error); }
    });

    router.get(`/${role}/:address/counterparties`, async (req, res, next) => {
      try {
        const page = paging(req, config);
        res.json({ items: await analytics.counterparties(key, req.params.address, window(req), page) });
      } catch (error) { next(error); }
    });
  }

  /** Indexing health: generations, queue depth and the exact degraded reason. */
  router.get("/search/status", async (_req, res, next) => {
    try {
      const status = worker?.status();
      const generation = search ? await search.activeGeneration() : undefined;
      const coverage = generation && search ? await search.indexCoverage(generation.id) : null;
      res.json({
        lexical: {
          enabled: config.search.lexical.enabled,
          language: config.search.lexical.language,
          weight: config.search.lexical.weight,
          candidateCount: config.search.lexical.candidateCount,
          // PostgreSQL FTS with ts_rank_cd. This is not BM25.
          ranking: "postgresql_fts_ts_rank_cd",
        },
        semantic: {
          enabled: config.search.semantic.enabled,
          provider: config.search.semantic.provider,
          model: config.search.semantic.modelId,
          revision: config.search.semantic.revision,
          dimension: config.search.semantic.dimension,
          weight: config.search.semantic.weight,
          vectorSupport: status?.vectorSupport ?? (search ? await search.hasVectorSupport() : false),
          health: status?.provider ?? { status: "disabled" },
          candidateCount: config.search.semantic.candidateCount,
        },
        reranking: {
          enabled: config.search.reranking.enabled,
          provider: config.search.reranking.provider,
          model: config.search.reranking.modelId,
          topK: config.search.reranking.topK,
          fallbackToHybrid: config.search.reranking.fallbackToHybrid,
        },
        fusion: { rrfK: config.search.rrfK, minimumRelevanceScore: config.search.minimumRelevanceScore },
        activeGeneration: generation ?? null,
        indexCoverage: coverage,
        worker: status ?? null,
        queue: generation && search ? await search.queueDepth(generation.id) : {},
      });
    } catch (error) { next(error); }
  });

  router.get("/search/generations", async (_req, res, next) => {
    try {
      res.json({ items: search ? await search.generations() : [] });
    } catch (error) { next(error); }
  });

  /** Search-to-payment conversion, attributed by resource within a window. */
  router.get("/search/conversion", async (req, res, next) => {
    try {
      const hours = Number(single(req.query.hours) ?? 24);
      res.json(await analytics.searchConversion(Number.isFinite(hours) && hours > 0 ? Math.min(hours, 720) : 24));
    } catch (error) { next(error); }
  });

  router.get("/origins", async (req, res, next) => {
    try {
      res.json({ items: await analytics.origins(paging(req, config)) });
    } catch (error) { next(error); }
  });

  router.get("/resources", async (req, res, next) => {
    try {
      res.json({ items: await analytics.recentResources(paging(req, config).limit) });
    } catch (error) { next(error); }
  });

  router.get("/resources/:id", async (req, res, next) => {
    try {
      const detail = await catalog.resourceDetail(Number(req.params.id));
      if (!detail) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json(detail);
    } catch (error) { next(error); }
  });

  router.get("/resources/:id/observability", async (req, res, next) => {
    try {
      res.json(await analytics.resourceObservability(Number(req.params.id)));
    } catch (error) { next(error); }
  });

  router.get("/resources/:id/invocations", async (req, res, next) => {
    try {
      const page = paging(req, config);
      const result = await analytics.transactions({ ...page, resourceId: Number(req.params.id) });
      res.json({ items: result.items, pagination: { ...page, total: result.total } });
    } catch (error) { next(error); }
  });

  return router;
}
