"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { trackSiteEvent } from "@/lib/site-analytics";

export function SiteAnalyticsTracker() {
  const pathname = usePathname();
  const lastTrackedPath = useRef<string | null>(null);

  useEffect(() => {
    if (lastTrackedPath.current === pathname) return;
    lastTrackedPath.current = pathname;
    trackSiteEvent({ eventType: "page_view", pagePath: pathname });
  }, [pathname]);

  useEffect(() => {
    const target = document.querySelector<HTMLElement>("[data-site-analytics-impression]");
    if (!target) return;

    let recorded = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (recorded || !entries.some((entry) => entry.isIntersecting)) return;
        recorded = true;
        trackSiteEvent({ eventType: "impression", pagePath: pathname, elementKey: "primary-content" });
        observer.disconnect();
      },
      { threshold: 0.25 },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
