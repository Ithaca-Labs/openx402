import { Router, type Request } from "express";
import type { AppConfig } from "../types.js";
import type { AnalyticsStore } from "../db/analytics.js";
import type { CatalogStore } from "../db/catalog.js";

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
