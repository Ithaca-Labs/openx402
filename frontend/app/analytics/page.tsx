import type { Metadata } from "next";

import { AnalyticsPage } from "@/components/analytics-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Analytics — openx402",
  description: "Private anonymous usage analytics for the openx402 explorer.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <AnalyticsPage />;
}
