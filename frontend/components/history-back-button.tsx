"use client";

import { useRouter } from "next/navigation";

export function HistoryBackButton() {
  const router = useRouter();
  return <button className="pagination__text-button" onClick={() => router.back()} type="button">Previous</button>;
}
