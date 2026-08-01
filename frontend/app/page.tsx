import type { Metadata } from "next";

import HomePage from "@/components/home-page";

export const metadata: Metadata = {
  title: "Discover — openx402",
  description: "Discover, inspect, and understand activity across the openx402 payment ecosystem.",
};

export default function Home() {
  return <HomePage />;
}
