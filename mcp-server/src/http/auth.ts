import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export interface AuthedRequest extends Request {
  agentId?: string;
}

/**
 * Bearer-token auth for the remote Streamable HTTP/SSE transport. The
 * resolved `agentId` is a stable hash of the presented key, never the raw
 * key -- it only needs to be a stable budget-bucket boundary, not reversible.
 */
export function bearerAuth(apiKeys: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (apiKeys.length === 0) {
      res.status(503).json({ error: "authentication_not_configured" });
      return;
    }
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token || !apiKeys.includes(token)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.agentId = createHash("sha256").update(token).digest("hex").slice(0, 32);
    next();
  };
}
