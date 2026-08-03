import type { Metadata } from "next";

import { FacilitatorsPage } from "@/components/data-pages";
import { loadDashboardData } from "@/lib/facilitator";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Facilitators — openx402",
  description: "Compare payment facilitators routing openx402 requests.",
};

export default async function Page() {
  return <FacilitatorsPage data={await loadDashboardData({ scope: "facilitators" })} />;
}
