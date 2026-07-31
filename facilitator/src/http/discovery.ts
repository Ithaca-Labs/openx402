import { Router, type NextFunction, type Request, type Response } from "express";
import { z, ZodError } from "zod";
import type { AppConfig } from "../types.js";
import type { CatalogStore, DiscoveryFilters, DiscoveryRow } from "../db/catalog.js";
import { decodeCursor, encodeCursor, filterFingerprint } from "./cursor.js";

const filterSchema = z.object({
  // Only the filters the Bazaar specification allows, plus `asset`, which is a
  // structured column this facilitator exposes pending an upstream proposal.
  type: z.enum(["http", "mcp"]).optional(),
  network: z.string().min(1).max(128).optional(),
  scheme: z.string().min(1).max(64).optional(),
  payTo: z.string().min(1).max(128).optional(),
  asset: z.string().min(1).max(128).optional(),
  extensions: z.string().min(1).max(64).optional(),
});

/** The exact Bazaar `DiscoveryResource` shape. No operator field is added. */
function toResource(row: DiscoveryRow): Record<string, unknown> {
  return {
    resource: row.resource,
    type: row.type,
    x402Version: row.x402Version,
    accepts: row.accepts,
    lastUpdated: row.lastUpdated,
    ...(row.description !== undefined ? { description: row.description } : {}),
    ...(row.mimeType !== undefined ? { mimeType: row.mimeType } : {}),
    ...(row.serviceName !== undefined ? { serviceName: row.serviceName } : {}),
    ...(row.tags !== undefined ? { tags: row.tags } : {}),
    ...(row.iconUrl !== undefined ? { iconUrl: row.iconUrl } : {}),
    ...(row.extensions !== undefined ? { extensions: row.extensions } : {}),
  };
}

function parseFilters(query: Request["query"]): DiscoveryFilters {
  const parsed = filterSchema.parse({
    type: single(query.type), network: single(query.network), scheme: single(query.scheme),
    payTo: single(query.payTo), asset: single(query.asset), extensions: single(query.extensions),
  });
  return parsed;
}

function single(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function paging(query: Request["query"], config: AppConfig): { limit: number; offset: number } {
  const limit = Number(single(query.limit) ?? config.discovery.defaultPageSize);
  const offset = Number(single(query.offset) ?? 0);
  return {
    limit: Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), config.discovery.maxPageSize)
      : config.discovery.defaultPageSize,
    offset: Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0,
  };
}

/** Discovery is not a payment route, so it must not answer in payment shapes. */
function fail(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: "invalid_filter",
      details: error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`),
    });
    return;
  }
  next(error);
}

export function createDiscoveryRouter(config: AppConfig, catalog: CatalogStore): Router {
  const router = Router();

  async function page(req: Request, res: Response, query?: string): Promise<void> {
    const filters = parseFilters(req.query);
    const fingerprint = filterFingerprint({ ...filters, query: query ?? null });
    const requested = paging(req.query, config);
    const rawCursor = single(req.query.cursor);

    let snapshot: bigint;
    let offset = requested.offset;
    if (rawCursor) {
      const decoded = decodeCursor(config.discovery.cursorHmacKey, rawCursor);
      if (!decoded || decoded.filters !== fingerprint) {
        res.status(400).json({ error: "invalid_cursor" });
        return;
      }
      snapshot = BigInt(decoded.snapshot);
      offset = decoded.offset;
    } else {
      snapshot = await catalog.watermark();
    }

    const result = await catalog.list({
      filters,
      limit: requested.limit,
      offset,
      snapshot,
      includeStale: config.discovery.includeStale,
      includeUnverified: config.discovery.includeUnverified,
      staleAfterHours: config.catalog.staleAfterHours,
      ...(query ? { query } : {}),
    });

    const nextOffset = offset + result.rows.length;
    const cursor = nextOffset < result.total
      ? encodeCursor(config.discovery.cursorHmacKey, {
          snapshot: snapshot.toString(),
          offset: nextOffset,
          filters: fingerprint,
          expiresAt: Date.now() + config.discovery.cursorTtlMinutes * 60_000,
        })
      : null;

    if (query === undefined) {
      res.json({
        x402Version: 2,
        items: result.rows.map(toResource),
        pagination: { limit: requested.limit, offset, total: result.total, cursor },
        partialResults: result.partialResults,
      });
      return;
    }
    res.json({
      x402Version: 2,
      resources: result.rows.map(toResource),
      partialResults: result.partialResults,
      pagination: { limit: requested.limit, cursor },
    });
  }

  router.get("/resources", async (req, res, next) => {
    try {
      if (!config.discovery.enabled) {
        res.status(404).json({ error: "discovery_disabled" });
        return;
      }
      await page(req, res);
    } catch (error) {
      fail(error, res, next);
    }
  });

  router.get("/search", async (req, res, next) => {
    try {
      if (!config.discovery.enabled) {
        res.status(404).json({ error: "discovery_disabled" });
        return;
      }
      const query = single(req.query.query);
      if (query === undefined) {
        res.status(400).json({ error: "query_required" });
        return;
      }
      await page(req, res, query.slice(0, 512));
    } catch (error) {
      fail(error, res, next);
    }
  });

  return router;
}
