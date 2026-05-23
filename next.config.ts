import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["postgres", "drizzle-orm"],
  experimental: {
    typedRoutes: false,
  },
};

export default nextConfig;
