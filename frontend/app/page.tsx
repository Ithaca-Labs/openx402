import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { navItems } from "@/components/data";

export const metadata: Metadata = {
  title: "openx402 — x402 for the Stellar ecosystem",
  description: "Discover the x402 ecosystem built on Stellar.",
};

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260714_113715_c7e0daa0-8bdd-4486-a2da-040901f8f0ea.mp4";

export default function Home() {
  return (
    <main className="brand-page relative flex h-screen w-full flex-col overflow-hidden bg-[#F4F0E6] text-[#111111]">
      <video
        aria-hidden="true"
        autoPlay
        className="brand-video absolute inset-0 z-0 h-[130%] w-full object-cover object-top"
        loop
        muted
        playsInline
        preload="auto"
        src={VIDEO_URL}
        tabIndex={-1}
      >
        <span className="sr-only">A meadow in soft morning light.</span>
      </video>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(180deg,rgba(244,240,230,0.78)_0%,rgba(244,240,230,0.34)_34%,rgba(255,210,28,0.12)_68%,rgba(17,17,17,0.32)_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(ellipse_at_50%_43%,rgba(244,240,230,0.78)_0%,rgba(244,240,230,0.28)_38%,transparent_72%),linear-gradient(112deg,rgba(17,17,17,0.2)_0%,transparent_45%,rgba(255,210,28,0.24)_100%)]"
      />

      <nav
        aria-label="Primary navigation"
        className="relative z-10 flex w-full justify-center px-4 pt-4 md:pt-6"
      >
        <div className="flex items-center gap-5 rounded-md border border-[#111111]/10 bg-[#F4F0E6]/85 px-4 py-3 shadow-sm backdrop-blur-md md:gap-8 md:px-6">
          <Link
            aria-label="openx402 home"
            className="group flex items-center text-[#111111] transition-opacity duration-200 hover:opacity-80"
            href="/"
          >
            <Image
              alt="openx402"
              height={24}
              priority
              src="/brand/logo/lockup-primary-light.svg"
              width={120}
            />
          </Link>

          <div className="hidden items-center gap-5 sm:flex md:gap-7">
            {navItems.map((item) => (
              <Link
                className="text-sm font-medium text-[#111111]/75 transition-colors duration-200 hover:text-[#111111]"
                href={item.href}
                key={item.href}
                rel={item.external ? "noreferrer noopener" : undefined}
                target={item.external ? "_blank" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>

      <section
        aria-labelledby="openx402-hero-title"
        className="relative z-10 mt-8 flex flex-1 flex-col items-center px-5 pb-8 text-center md:mt-16"
      >
        <h1
          className="font-display max-w-4xl text-5xl font-bold leading-[0.9] tracking-[-0.055em] text-[#111111] sm:text-6xl md:text-8xl lg:text-9xl"
          id="openx402-hero-title"
        >
          <span className="block">x402 for</span>
          <span className="block">Stellar ecosystem</span>
        </h1>

        <p className="mt-5 max-w-3xl text-xs leading-relaxed text-[#111111]/70 sm:mt-6 sm:text-sm md:text-base">
          Discover services, facilitators, and payment activity across the open
          x402 ecosystem, built for Stellar.
        </p>

        <Link
          className="mt-7 inline-flex items-center justify-center rounded-md bg-[#FFD21C] px-6 py-3 text-sm font-semibold text-[#111111] shadow-[0px_4px_12px_rgba(17,17,17,0.2)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#FFD21C]/85 hover:shadow-[0px_6px_16px_rgba(17,17,17,0.28)] sm:mt-8 sm:px-8 sm:py-3.5"
          href="/discover"
        >
          Discover openx402
        </Link>
      </section>
    </main>
  );
}
