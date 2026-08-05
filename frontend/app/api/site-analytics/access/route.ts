import { NextResponse } from "next/server";

import {
  ALLOWED_ANALYTICS_EMAIL,
  ANALYTICS_ACCESS_COOKIE,
  analyticsAccessCookieOptions,
  createAnalyticsAccessToken,
  hasAnalyticsAccess,
} from "@/lib/analytics-auth";

export async function GET() {
  return NextResponse.json({ authorized: await hasAnalyticsAccess() });
}

export async function POST(request: Request) {
  let email = "";
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && "email" in body && typeof body.email === "string") {
      email = body.email.trim().toLowerCase();
    }
  } catch {
    return NextResponse.json({ message: "Enter the approved email address to continue." }, { status: 400 });
  }

  if (email !== ALLOWED_ANALYTICS_EMAIL) {
    return NextResponse.json({ message: "This analytics area is only available to the approved operator email." }, { status: 403 });
  }

  const token = createAnalyticsAccessToken();
  if (!token) {
    return NextResponse.json({ message: "Analytics access is not configured for this deployment." }, { status: 503 });
  }

  const response = NextResponse.json({ authorized: true });
  response.cookies.set(ANALYTICS_ACCESS_COOKIE, token, analyticsAccessCookieOptions);
  return response;
}

export function DELETE() {
  const response = NextResponse.json({ authorized: false });
  response.cookies.set(ANALYTICS_ACCESS_COOKIE, "", { ...analyticsAccessCookieOptions, maxAge: 0 });
  return response;
}
