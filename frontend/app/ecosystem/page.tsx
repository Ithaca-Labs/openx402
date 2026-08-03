import type { Metadata } from "next";

import { EcosystemPage } from "@/components/data-pages";
import { loadDashboardData, parseDashboardSearch, type RawSearchParams } from "@/lib/facilitator";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ecosystem — openx402",
  description: "Explore the wider ecosystem around open payment infrastructure.",
};

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const search = parseDashboardSearch(await searchParams);
  return <EcosystemPage data={await loadDashboardData({ scope: "ecosystem", search })} search={search} />;
}
