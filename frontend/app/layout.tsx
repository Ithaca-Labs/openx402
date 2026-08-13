import type { Metadata } from "next";
import localFont from "next/font/local";

import "./globals.css";

const archivo = localFont({
  src: [
    {
      path: "../public/brand/fonts/Archivo-Variable.ttf",
      style: "normal",
      weight: "100 900",
    },
  ],
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
  display: "swap",
  preload: true,
  variable: "--font-archivo",
});

const plexMono = localFont({
  src: [
    {
      path: "../public/brand/fonts/IBMPlexMono-Regular.ttf",
      style: "normal",
      weight: "400",
    },
    {
      path: "../public/brand/fonts/IBMPlexMono-Medium.ttf",
      style: "normal",
      weight: "500",
    },
  ],
  display: "swap",
  preload: true,
  variable: "--font-plex-mono",
});

const SITE_TITLE = "openx402 — Stellar payment discovery";
const SITE_DESCRIPTION =
  "Explore Bazaar resources and Stellar x402 settlement activity observed by openx402.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://www.stellarx402.xyz"),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "openx402",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    images: [
      {
        url: "/open-graph-1200x627.png",
        width: 1200,
        height: 627,
        alt: "openx402",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/open-graph-1200x627.png"],
  },
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/brand/favicon/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className={`${archivo.variable} ${plexMono.variable}`} data-theme="dark" lang="en">
      <body>{children}</body>
    </html>
  );
}
