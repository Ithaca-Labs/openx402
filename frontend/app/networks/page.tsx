import type { Metadata } from "next";

import { NetworksPage } from "@/components/data-pages";

export const metadata: Metadata = {
  title: "Networks — openx402",
  description: "Compare supported openx402 settlement networks and environments.",
};

export default function Page() {
  return <NetworksPage />;
}

