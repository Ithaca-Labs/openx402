import type { Metadata } from "next";

import { AllPage } from "@/components/data-pages";
import { loadDashboardData, parseDashboardSearch, type RawSearchParams } from "@/lib/facilitator";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "All activity — openx402",
  description: "Aggregate activity across the openx402 payment ecosystem.",
};

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const search = parseDashboardSearch(await searchParams);
  return <AllPage data={await loadDashboardData({ scope: "all", search })} search={search} />;
}
