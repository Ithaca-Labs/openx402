import type { Metadata } from "next";

import DiscoverPage from "@/components/home-page";
import { loadDashboardData, parseDashboardSearch, type RawSearchParams } from "@/lib/facilitator";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Discover — openx402",
  description: "Overall statistics and featured services across the openx402 payment ecosystem.",
};

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const search = parseDashboardSearch(await searchParams);
  const data = await loadDashboardData({ scope: "discover", search });
  return <DiscoverPage data={data} search={search} />;
}
