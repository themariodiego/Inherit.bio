import type { NextConfig } from "next";

if (
  process.env.VERCEL_ENV === "production" &&
  process.env.INHERIT_TEST_JURISDICTION === "1"
) {
  throw new Error(
    "INHERIT_TEST_JURISDICTION cannot be enabled in a production deployment.",
  );
}

const nextConfig: NextConfig = {
  // Runtime data files read with fs (not imported) must be traced into the
  // serverless bundle explicitly.
  outputFileTracingIncludes: {
    "/api/files/[id]/process": ["./data/ref/chain/**"],
  },
  // docs/route-register.json pins every legacy alias to expectedStatus 308,
  // which `permanent: true` emits and `permanent: false` does not: a 307 asks
  // the browser to come back to the old path next time, so the alias never
  // retires and search engines keep the dead URL indexed. The eight aliases
  // built as pages already call permanentRedirect. scripts/route-gate.ts holds
  // all ten to the registered status.
  async redirects() {
    return [
      { source: "/signup", destination: "/auth/sign-up", permanent: true },
      { source: "/login", destination: "/auth/sign-in", permanent: true },
      { source: "/copilot", destination: "/copilot/me", permanent: true },
    ];
  },
};

export default nextConfig;
