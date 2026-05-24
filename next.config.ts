import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["postgres", "drizzle-orm"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb", // match MAX_FILE_SIZE in uploadDocAction
    },
    typedRoutes: false,
  },
};

export default nextConfig;
