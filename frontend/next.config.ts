import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "api.dicebear.com",
        pathname: "/10.x/identicon/svg",
      },
    ],
  },
  output: "standalone",
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
