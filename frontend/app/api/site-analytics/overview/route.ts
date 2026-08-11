import { NextResponse } from "next/server";

import { loadFrontendAnalyticsOverview, SiteAnalyticsStorageError } from "@/lib/site-analytics-store";

function reportingWindow(value: string | null) {
  return value === "7" ? 7 : 30;
}

export async function GET(request: Request) {
  try {
    const days = reportingWindow(new URL(request.url).searchParams.get("days"));
    return NextResponse.json(await loadFrontendAnalyticsOverview(days));
  } catch (error) {
    if (error instanceof SiteAnalyticsStorageError && error.issue === "storage_unconfigured") {
      return NextResponse.json({
        issue: error.issue,
        message: "Frontend analytics storage is not configured. Add ANALYTICS_DATABASE_URL to this web app's server-side environment, then refresh this report.",
      }, { status: 503 });
    }
    return NextResponse.json({
      issue: "storage_unavailable",
      message: "Frontend analytics storage is not reachable. Check ANALYTICS_DATABASE_URL, then refresh this report.",
    }, { status: 503 });
  }
}
