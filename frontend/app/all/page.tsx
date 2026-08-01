import type { Metadata } from "next";

import { AllPage } from "@/components/data-pages";

export const metadata: Metadata = {
  title: "All activity — openx402",
  description: "Aggregate activity across the openx402 payment ecosystem.",
};

export default function Page() {
  return <AllPage />;
}

