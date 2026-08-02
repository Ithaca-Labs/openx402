import type { Metadata } from "next";

import DiscoverPage from "@/components/home-page";
import { loadDashboardData } from "@/lib/facilitator";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Discover — openx402",
  description: "Overall statistics and featured services across the openx402 payment ecosystem.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = (await searchParams).q?.trim().slice(0, 512);
  const data = await loadDashboardData(query);
  return <DiscoverPage data={data} {...(query ? { query } : {})} />;
}
