import type { MetadataRoute } from "next";

const publicRoutes = [
  "/",
  "/discover",
  "/all",
  "/marketplace",
  "/transactions",
  "/facilitators",
  "/networks",
  "/ecosystem",
] as const;

function siteUrl() {
  return new URL(process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://www.stellarx402.xyz");
}

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = siteUrl();

  return publicRoutes.map((route) => ({
    url: new URL(route, baseUrl).toString(),
  }));
}
