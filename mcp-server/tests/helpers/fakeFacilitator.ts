import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * A minimal HTTP server that serves exactly the documented, public Bazaar
 * discovery contract (`bazaar.md`, `facilitator/src/http/discovery.ts`):
 * `/discovery/resources`, `/discovery/search`, `/discovery/resource`. Used
 * to integration-test mcp-server's HTTP client and tool layer against real
 * sockets and real JSON framing without requiring a full facilitator
 * process (Postgres schema, Stellar RPC, a real settled payment) -- and
 * without importing facilitator/src/* into this package's test suite,
 * which would violate the same boundary the production code respects.
 */
export interface FakeResource {
  resource: string;
  type: "http" | "mcp";
  x402Version: number;
  lastUpdated: string;
  description?: string;
  accepts: Array<{ scheme: string; network: string; asset: string; amount: string; payTo: string; maxTimeoutSeconds: number; extra: Record<string, unknown> }>;
  extensions?: Record<string, unknown>;
}

export class FakeFacilitator {
  private server?: Server;
  private port = 0;
  resources: FakeResource[] = [];

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>(resolve => this.server!.listen(0, "127.0.0.1", resolve));
    this.port = (this.server!.address() as { port: number }).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>(resolve => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("content-type", "application/json");

    if (url.pathname === "/discovery/resources") {
      const type = url.searchParams.get("type");
      const items = this.resources.filter(r => !type || r.type === type);
      res.end(JSON.stringify({ x402Version: 2, items, pagination: { limit: 20, offset: 0, total: items.length, cursor: null }, partialResults: false }));
      return;
    }
    if (url.pathname === "/discovery/search") {
      const query = url.searchParams.get("query");
      if (!query) { res.statusCode = 400; res.end(JSON.stringify({ error: "query_required" })); return; }
      const type = url.searchParams.get("type");
      const matches = this.resources.filter(r => (!type || r.type === type) && matchesQuery(r, query));
      res.end(JSON.stringify({ x402Version: 2, resources: matches, partialResults: false, pagination: { limit: 20, cursor: null } }));
      return;
    }
    if (url.pathname === "/discovery/resource") {
      const type = url.searchParams.get("type");
      const target = url.searchParams.get("url");
      const toolName = url.searchParams.get("toolName");
      const match = this.resources.find(r => r.type === type && r.resource === target
        && (type !== "mcp" || bazaarToolName(r) === toolName));
      if (!match) { res.statusCode = 404; res.end(JSON.stringify({ error: "not_found" })); return; }
      res.end(JSON.stringify({ x402Version: 2, resource: match }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not_found" }));
  }
}

function bazaarToolName(resource: FakeResource): string | undefined {
  const bazaar = resource.extensions?.bazaar as { info?: { input?: { toolName?: string } } } | undefined;
  return bazaar?.info?.input?.toolName;
}

function matchesQuery(resource: FakeResource, query: string): boolean {
  const haystack = `${resource.resource} ${resource.description ?? ""}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}
