import { getFacilitatorHealth } from "@/lib/facilitator";

export async function GET() {
  const result = await getFacilitatorHealth(2_500);
  if (result.data?.status === "ready") {
    return Response.json({
      status: "ready",
      facilitator: "ready",
      ...(result.data.search ? { search: result.data.search } : {}),
    }, { status: 200 });
  }
  return Response.json({
    status: "degraded",
    facilitator: "unavailable",
  }, { status: 503 });
}
