import { NextResponse } from "next/server";

import { recordFrontendAnalyticsEvent } from "@/lib/site-analytics-store";
import type { SiteAnalyticsEvent } from "@/lib/site-analytics-types";

function parseEvent(value: unknown): SiteAnalyticsEvent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const event = value as Record<string, unknown>;
  const validEventType = event.eventType === "page_view" || event.eventType === "impression";
  const validVisitorId = typeof event.visitorId === "string" && /^[a-zA-Z0-9_-]{16,128}$/.test(event.visitorId);
  const validPath = typeof event.pagePath === "string" && /^\/[\w./-]{0,511}$/.test(event.pagePath);
  const validElement = event.elementKey === undefined
    || (typeof event.elementKey === "string" && /^[a-z0-9_-]{1,96}$/.test(event.elementKey));

  if (!validEventType || !validVisitorId || !validPath || !validElement) return undefined;
  return {
    eventType: event.eventType as SiteAnalyticsEvent["eventType"],
    visitorId: event.visitorId as string,
    pagePath: event.pagePath as string,
    ...(typeof event.elementKey === "string" ? { elementKey: event.elementKey } : {}),
  };
}

export async function POST(request: Request) {
  try {
    const event = parseEvent(await request.json());
    if (!event) return new NextResponse(null, { status: 204 });

    await recordFrontendAnalyticsEvent(event);
    return new NextResponse(null, { status: 204 });
  } catch {
    // Analytics is optional telemetry and should never surface a failure to the visitor.
    return new NextResponse(null, { status: 204 });
  }
}
