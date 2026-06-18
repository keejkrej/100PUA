import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    reactCompiler: true,
  },
  serverExternalPackages: ["@cursor/sdk", "@100pua/domain", "@100pua/api"],
};

export default nextConfig;
