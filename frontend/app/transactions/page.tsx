import type { Metadata } from "next";

import { TransactionsPage } from "@/components/data-pages";
import { loadDashboardData, parseDashboardSearch, type RawSearchParams } from "@/lib/facilitator";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Transactions — openx402",
  description: "Inspect tracked openx402 payments and settlement receipts.",
};

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const search = parseDashboardSearch(await searchParams);
  return <TransactionsPage data={await loadDashboardData({ scope: "transactions", search })} search={search} />;
}
