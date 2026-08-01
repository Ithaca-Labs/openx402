import type { Metadata } from "next";

import { TransactionsPage } from "@/components/data-pages";

export const metadata: Metadata = {
  title: "Transactions — openx402",
  description: "Inspect tracked openx402 payments and settlement receipts.",
};

export default function Page() {
  return <TransactionsPage />;
}

