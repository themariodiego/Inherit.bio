import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Runtime data files read with fs (not imported) must be traced into the
  // serverless bundle explicitly.
  outputFileTracingIncludes: {
    "/api/files/[id]/process": ["./data/ref/chain/**"],
  },
  async redirects() {
    return [
      { source: "/signup", destination: "/auth/sign-up", permanent: false },
      { source: "/login", destination: "/auth/sign-in", permanent: false },
      { source: "/copilot", destination: "/copilot/me", permanent: true },
    ];
  },
};

export default nextConfig;
