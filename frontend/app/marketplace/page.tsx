import type { Metadata } from "next";

import { MarketplacePage } from "@/components/data-pages";
import { loadDashboardData, parseDashboardSearch, type RawSearchParams } from "@/lib/facilitator";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketplace — openx402",
  description: "Browse discoverable paid services and merchants in the openx402 ecosystem.",
};

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const search = parseDashboardSearch(await searchParams);
  return <MarketplacePage data={await loadDashboardData({ scope: "marketplace", search })} search={search} />;
}
