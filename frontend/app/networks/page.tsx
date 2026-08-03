import type { Metadata } from "next";

import { NetworksPage } from "@/components/data-pages";
import { loadDashboardData } from "@/lib/facilitator";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Networks — openx402",
  description: "Compare supported openx402 settlement networks and environments.",
};

export default async function Page() {
  return <NetworksPage data={await loadDashboardData({ scope: "networks" })} />;
}
