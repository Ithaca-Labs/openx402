import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import helmet from "helmet";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { AppConfig } from "../config.js";
import { registerTools, type ToolDeps } from "../tools/index.js";
import { bearerAuth, type AuthedRequest } from "./auth.js";

const SERVER_INFO = { name: "openx402-mcp-server", version: "0.1.0" };

/**
 * Builds the Express app exposing the Streamable HTTP endpoint (`/mcp`, the
 * primary network transport) and an SSE endpoint (`/sse` + `/messages`, kept
 * only for compatibility with existing x402 E2E fixtures). Health/readiness
 * distinguishes discovery-only from payment-ready so an operator can tell at
 * a glance whether paid calls are actually possible.
 */
export function createHttpApp(config: AppConfig, deps: ToolDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));

  const paymentsReady = Boolean(deps.signerProvider)
    && (config.transport === "stdio" || config.httpApiKeys.length > 0)
    && (config.budget.store === "postgres" || config.transport === "stdio");

  app.get("/healthz", (_req, res) => {
    res.json({
      status: "ok",
      discovery: "ready",
      payments: paymentsReady ? "ready" : "disabled",
      networks: config.networks,
    });
  });
  app.get("/readyz", (_req, res) => res.json({ ready: true }));

  // Auth is required only once paid calls are actually possible -- an
  // operator running discovery-only (no signer configured) never needs an
  // API key, matching "no required API key for public search". Config
  // loading already guarantees httpApiKeys is non-empty whenever a signer is
  // configured on a non-stdio transport.
  const requireAuth = Boolean(deps.signerProvider);
  const auth = bearerAuth(config.httpApiKeys);

  const streamableTransports = new Map<string, StreamableHTTPServerTransport>();

  async function handleStreamable(req: AuthedRequest, res: Response): Promise<void> {
    const sessionId = req.headers["mcp-session-id"];
    const existing = typeof sessionId === "string" ? streamableTransports.get(sessionId) : undefined;
    if (existing) {
      await existing.handleRequest(req, res, req.body);
      return;
    }

    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: id => { streamableTransports.set(id, transport); },
      onsessionclosed: id => { streamableTransports.delete(id); },
    });
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    registerTools(server, deps, { agentId: req.agentId ?? "anonymous-discovery" });
    // Same upstream exactOptionalPropertyTypes friction as mcpConnection.ts.
    await server.connect(transport as Parameters<typeof server.connect>[0]);
    await transport.handleRequest(req, res, req.body);
  }

  app.post("/mcp", requireAuth ? auth : (_req, _res, next) => next(), (req, res) => {
    handleStreamable(req as AuthedRequest, res).catch(error => {
      if (!res.headersSent) res.status(500).json({ error: "internal_error", message: (error as Error).message });
    });
  });
  app.get("/mcp", requireAuth ? auth : (_req, _res, next) => next(), (req, res) => {
    handleStreamable(req as AuthedRequest, res).catch(error => {
      if (!res.headersSent) res.status(500).json({ error: "internal_error", message: (error as Error).message });
    });
  });
  app.delete("/mcp", requireAuth ? auth : (_req, _res, next) => next(), (req, res) => {
    handleStreamable(req as AuthedRequest, res).catch(error => {
      if (!res.headersSent) res.status(500).json({ error: "internal_error", message: (error as Error).message });
    });
  });

  // SSE: kept only for compatibility with existing x402 E2E fixtures.
  // Streamable HTTP above is the primary network transport.
  const sseTransports = new Map<string, SSEServerTransport>();
  app.get("/sse", requireAuth ? auth : (_req, _res, next) => next(), async (req: AuthedRequest, res: Response) => {
    const transport = new SSEServerTransport("/messages", res);
    sseTransports.set(transport.sessionId, transport);
    res.on("close", () => sseTransports.delete(transport.sessionId));
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    registerTools(server, deps, { agentId: req.agentId ?? "anonymous-discovery" });
    // Same upstream exactOptionalPropertyTypes friction as mcpConnection.ts.
    await server.connect(transport as Parameters<typeof server.connect>[0]);
  });
  app.post("/messages", requireAuth ? auth : (_req, _res, next) => next(), async (req: Request, res: Response) => {
    const sessionId = String(req.query.sessionId ?? "");
    const transport = sseTransports.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: "no_such_sse_session" });
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  });

  return app;
}
