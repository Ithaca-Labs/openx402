import type { Metadata } from "next";

import InitiaLanding from "@/components/initia-landing";

export const metadata: Metadata = {
  title: "openx402 — x402 for everyone",
  description: "openx402 makes x402 on Stellar yours to run, yours to discover through, and yours to build on.",
};

export default function Home() {
  return <InitiaLanding />;
}
