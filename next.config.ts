import type { NextConfig } from "next";

if (
  process.env.VERCEL_ENV === "production" &&
  process.env.INHERIT_TEST_JURISDICTION === "1"
) {
  throw new Error(
    "INHERIT_TEST_JURISDICTION cannot be enabled in a production deployment.",
  );
}

/** Every path except the scheduled and operator job endpoints; see redirects(). */
const ALIAS_HOST_SOURCE = "/:path((?!api/(?:cron|jobs)/).*)";

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
  //
  // The first three entries are host aliases, not path aliases: the register
  // lists them under `originAliases`, beside the `canonicalOrigin` they point
  // at, and scripts/canonical-host.test.ts holds these entries to that list.
  // inherit.bio is the one canonical host (owner decision, 26 September 2026).
  // Supabase auth cookies are host-only, so every other host that served the
  // app held a separate session, and a person signed in on inherit.bio who
  // followed a mail link to www was asked to sign in again. Every path and its
  // query string go to the same path on inherit.bio, permanently, for the
  // same reason the path aliases are 308. They come first, so an alias host
  // answers with this hop before any other entry's. Next.js and Vercel both
  // read a host `value` as a regular expression, so the dots are escaped and
  // each entry matches its one host: preview deployments and localhost never
  // match and are never redirected.
  //
  // Paths under /api/cron/ and /api/jobs/ are the one exception, and answer on
  // every host. Vercel calls the scheduled jobs in vercel.json on a production
  // URL its documentation does not name, and does not follow a redirect it
  // gets back, so a 308 there would stop mail delivery and retention without
  // an error. Every route under both prefixes answers only a bearer secret, so
  // no session or page is served on an alias host by leaving them.
  async redirects() {
    return [
      {
        source: ALIAS_HOST_SOURCE,
        has: [{ type: "host", value: "www\\.inherit\\.bio" }],
        destination: "https://inherit.bio/:path",
        permanent: true,
      },
      {
        source: ALIAS_HOST_SOURCE,
        has: [{ type: "host", value: "sequence\\.plus\\.bio" }],
        destination: "https://inherit.bio/:path",
        permanent: true,
      },
      {
        source: ALIAS_HOST_SOURCE,
        has: [{ type: "host", value: "sequence-murex\\.vercel\\.app" }],
        destination: "https://inherit.bio/:path",
        permanent: true,
      },
      { source: "/signup", destination: "/auth/sign-up", permanent: true },
      { source: "/login", destination: "/auth/sign-in", permanent: true },
      { source: "/copilot", destination: "/copilot/me", permanent: true },
    ];
  },
};

export default nextConfig;
