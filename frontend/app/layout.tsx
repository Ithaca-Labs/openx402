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

export const metadata: Metadata = {
  title: "openx402 — Stellar payment discovery",
  description: "Explore Bazaar resources and Stellar x402 settlement activity observed by openx402.",
  icons: {
    icon: "/brand/favicon/favicon.svg",
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
