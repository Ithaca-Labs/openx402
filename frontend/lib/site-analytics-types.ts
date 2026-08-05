export type SiteAnalyticsEvent = {
  eventType: "page_view" | "impression";
  visitorId: string;
  pagePath: string;
  elementKey?: string;
};

export type SiteAnalyticsOverview = {
  days: number;
  summary: {
    uniqueVisitors: number;
    uniquePageVisits: number;
    pageViews: number;
    impressions: number;
  };
  series: Array<{
    day: string;
    uniquePageVisits: number;
    pageViews: number;
    impressions: number;
  }>;
  pages: Array<{
    pagePath: string;
    uniquePageVisits: number;
    pageViews: number;
    impressions: number;
    latestActivity: string | null;
  }>;
};
