import type { Metadata } from "next";

import { EcosystemPage } from "@/components/data-pages";

export const metadata: Metadata = {
  title: "Ecosystem — openx402",
  description: "Explore the wider ecosystem around open payment infrastructure.",
};

export default function Page() {
  return <EcosystemPage />;
}

