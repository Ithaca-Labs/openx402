import type { Metadata } from "next";

import { MarketplacePage } from "@/components/data-pages";

export const metadata: Metadata = {
  title: "Marketplace — openx402",
  description: "Browse discoverable paid services and merchants in the openx402 ecosystem.",
};

export default function Page() {
  return <MarketplacePage />;
}

