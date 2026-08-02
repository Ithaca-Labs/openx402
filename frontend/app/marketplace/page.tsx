import type { Metadata } from "next";

import { MarketplacePage } from "@/components/data-pages";
import { loadDashboardData } from "@/lib/facilitator";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketplace — openx402",
  description: "Browse discoverable paid services and merchants in the openx402 ecosystem.",
};

export default async function Page() {
  return <MarketplacePage data={await loadDashboardData()} />;
}
