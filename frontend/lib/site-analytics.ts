"use client";

type BrowserAnalyticsEvent = {
  eventType: "page_view" | "impression";
  pagePath: string;
  elementKey?: string;
};

const VISITOR_STORAGE_KEY = "openx402-site-visitor";

function visitorId() {
  try {
    const existing = window.localStorage.getItem(VISITOR_STORAGE_KEY);
    if (existing) return existing;

    const generated = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(VISITOR_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function trackSiteEvent(event: BrowserAnalyticsEvent) {
  const body = JSON.stringify({ ...event, visitorId: visitorId() });
  void fetch("/api/site-analytics/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Analytics must never interrupt a public explorer interaction.
  });
}
