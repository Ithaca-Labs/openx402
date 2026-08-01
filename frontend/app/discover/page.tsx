import type { Metadata } from "next";

import DiscoverPage from "@/components/home-page";

export const metadata: Metadata = {
  title: "Discover — openx402",
  description: "Overall statistics and featured services across the openx402 payment ecosystem.",
};

export default function Page() {
  return <DiscoverPage />;
}
