import type { Metadata } from "next";

import { FacilitatorsPage } from "@/components/data-pages";

export const metadata: Metadata = {
  title: "Facilitators — openx402",
  description: "Compare payment facilitators routing openx402 requests.",
};

export default function Page() {
  return <FacilitatorsPage />;
}

