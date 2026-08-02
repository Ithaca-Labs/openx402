import type { Metadata } from "next";

import { EcosystemPage } from "@/components/data-pages";
import { loadDashboardData } from "@/lib/facilitator";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ecosystem — openx402",
  description: "Explore the wider ecosystem around open payment infrastructure.",
};

export default async function Page() {
  return <EcosystemPage data={await loadDashboardData()} />;
}
