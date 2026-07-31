import { createHash, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { ZodError } from "zod";
import type { AppConfig, RequestEnvelope } from "../types.js";
import { BusyError, ConflictError, FacilitatorCore } from "../orchestrator.js";
import { StateStore } from "../db/state.js";
import { parseEnvelope } from "./schema.js";

declare global {
  namespace Express {
    interface Request { facilitatorPrincipal?: string }
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function auth(config: AppConfig) {
  const expected = config.apiKeys.map(digest);
  return (req: Request, res: Response, next: NextFunction): void => {
    const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (expected.length === 0) {
      req.facilitatorPrincipal = `anonymous:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
      next();
      return;
    }
    const provided = digest(bearer ?? "");
    const matched = expected.some(value => timingSafeEqual(value, provided));
    if (!matched) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.facilitatorPrincipal = `api-key:${provided.toString("hex")}`;
    next();
  };
}

function requestId(req: Request, res: Response, next: NextFunction): void {
  const value = typeof req.headers["x-request-id"] === "string"
    ? req.headers["x-request-id"].slice(0, 128)
    : crypto.randomUUID();
  res.setHeader("x-request-id", value);
  next();
}

export function createApp(config: AppConfig, core: FacilitatorCore, state: StateStore): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(helmet());
  app.use(requestId);
  app.use(express.json({ limit: config.limits.maxRequestBytes, strict: true }));
  const authenticate = auth(config);

  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (_req, res) => {
    const ready = await state.ready().catch(() => false);
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready" });
  });
  app.get("/supported", authenticate, (_req, res) => res.json(core.supported()));

  app.post("/verify", authenticate, async (req, res, next) => {
    try {
      const request = parseEnvelope(req.body);
      const result = await core.verify(request, req.facilitatorPrincipal!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/settle", authenticate, async (req, res, next) => {
    let request: RequestEnvelope | undefined;
    try {
      request = parseEnvelope(req.body);
      const result = await core.settle(request, req.facilitatorPrincipal!);
      res.json(result);
    } catch (error) {
      if (error instanceof ConflictError) {
        res.status(409).json({ error: "payment_identifier_conflict", message: error.message });
        return;
      }
      if (error instanceof BusyError) {
        res.setHeader("retry-after", "1");
        res.status(503).json({
          success: false,
          transaction: "",
          network: request?.paymentRequirements.network ?? "stellar:testnet",
          errorReason: "settle_stellar_temporarily_unavailable",
        });
        return;
      }
      next(error);
    }
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ConflictError) {
      res.status(409).json({ error: "payment_identifier_conflict", message: error.message });
      return;
    }
    if (error instanceof ZodError || (error instanceof SyntaxError && "body" in error)) {
      const isSettle = req.path === "/settle";
      res.status(400).json(isSettle
        ? { success: false, transaction: "", network: "stellar:testnet", errorReason: "invalid_request" }
        : { isValid: false, invalidReason: "invalid_request" });
      return;
    }
    const reason = error instanceof Error && ["unsupported_network", "unsupported_scheme"].includes(error.message)
      ? error.message
      : "internal_error";
    const isSettle = req.path === "/settle";
    res.status(reason === "internal_error" ? 500 : 200).json(isSettle
      ? { success: false, transaction: "", network: "stellar:testnet", errorReason: reason }
      : { isValid: false, invalidReason: reason });
  });
  return app;
}
