import { adaptEntity } from "@/lib/facilitator/adapters";
import { getDiscovery } from "@/lib/facilitator/client";

export const dynamic = "force-dynamic";

const SUGGEST_LIMIT = 5;
const MIN_QUERY_LENGTH = 2;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 500;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 60;
const RATE_MAX_CLIENTS = 5_000;

/**
 * Typeahead sends one request per typing pause, and every miss costs a remote
 * embedding call. The catalog changes far slower than people type, so identical
 * queries collapse onto one upstream call for a minute — shared across all
 * visitors hitting the same warm instance.
 */
const cache = new Map<string, { at: number; items: SuggestItem[] }>();

function cached(key: string): SuggestItem[] | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.items;
}

function remember(key: string, items: SuggestItem[]): void {
  // Map preserves insertion order, so the first key is the oldest.
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), items });
}

/**
 * Per-IP fixed window. Debouncing and the two caches already keep a human well
 * under the ceiling — a continuous minute of typing costs a few requests — so
 * this only bites scripted traffic against an endpoint that fans out to a
 * metered embedding API.
 *
 * Instance-local by design: on serverless the effective ceiling is per warm
 * instance, which bounds the blast radius without a shared store. Swap in Redis
 * if a global limit is ever required.
 */
const clients = new Map<string, { count: number; resetAt: number }>();

/** Trusts `x-forwarded-for` only because the platform edge rewrites it. */
function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function rateLimited(key: string): { limited: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = clients.get(key);

  if (!entry || now >= entry.resetAt) {
    if (clients.size >= RATE_MAX_CLIENTS) {
      for (const [candidate, value] of clients) if (now >= value.resetAt) clients.delete(candidate);
      // Still full when every window is live: drop the oldest insertion.
      if (clients.size >= RATE_MAX_CLIENTS) {
        const oldest = clients.keys().next().value;
        if (oldest !== undefined) clients.delete(oldest);
      }
    }
    clients.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { limited: false, retryAfterSeconds: 0 };
  }

  entry.count += 1;
  return {
    limited: entry.count > RATE_MAX_REQUESTS,
    retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
  };
}

export type SuggestItem = {
  name: string;
  category: string;
  description: string;
  resource: string;
  href?: string;
  accent: string;
};

export async function GET(request: Request) {
  const { limited, retryAfterSeconds } = rateLimited(clientKey(request));
  if (limited) {
    // The overlay reads `items` and closes on an empty list, so a throttled
    // client degrades to "no matches" instead of an error state.
    return Response.json({ items: [] }, {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    });
  }

  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim().slice(0, 512) ?? "";
  const rawType = params.get("type");
  const type = rawType === "http" || rawType === "mcp" ? rawType : undefined;

  if (query.length < MIN_QUERY_LENGTH) return Response.json({ items: [] });

  const cacheKey = `${type ?? ""} ${query.toLowerCase()}`;
  const hit = cached(cacheKey);
  if (hit) return Response.json({ items: hit });

  const result = await getDiscovery({ limit: SUGGEST_LIMIT, query, ...(type ? { type } : {}) });
  // The overlay is a convenience surface: a degraded facilitator closes it quietly
  // instead of pushing an error state into the toolbar.
  if (!result.data) return Response.json({ items: [] });

  const resources = "items" in result.data ? result.data.items : result.data.resources;
  const items: SuggestItem[] = resources.slice(0, SUGGEST_LIMIT).map(resource => {
    const entity = adaptEntity(resource, { analyticsState: "empty" });
    return {
      name: entity.name,
      category: entity.category,
      description: entity.description,
      resource: entity.resource,
      ...(entity.href ? { href: entity.href } : {}),
      accent: entity.accent,
    };
  });

  remember(cacheKey, items);
  return Response.json({ items });
}
