import type { Metadata } from "next";

import HomeSearchPage from "@/components/home-search";

export const metadata: Metadata = {
  title: "openx402 — Search the ecosystem",
  description: "Search services, facilitators, and networks across the openx402 payment ecosystem.",
};

export default function Home() {
  return <HomeSearchPage />;
}
