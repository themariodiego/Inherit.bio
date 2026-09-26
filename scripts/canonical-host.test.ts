import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse, stringify, type ParsedUrlQuery } from "node:querystring";
import { fileURLToPath, format } from "node:url";
import { getRedirectStatus, modifyRouteRegex } from "next/dist/lib/redirect-status.js";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match.js";
import { matchHas, prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination.js";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

/**
 * inherit.bio is the one canonical host (owner decision, 26 September 2026).
 * Supabase auth cookies are host-only, so each of the four hosts that served
 * the app held its own session: a person signed in on inherit.bio who followed
 * the report-ready mail's link to www was asked to sign in again. The register
 * names the canonical origin and the aliases that must redirect to it; this is
 * what holds `next.config.ts` to that list, in both directions.
 *
 * A host `value` is a regular expression, not a literal, so a string check on
 * the config cannot say which hosts an entry matches. The requests below are
 * resolved with the matchers Next.js itself uses to answer them, walked in
 * config order as the router walks them.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface OriginAlias {
  origin: string;
  disposition: string;
  destination: { originFrom: string };
  pathAndQuery: string;
  expectedStatus: number;
  exceptPathPrefixes: string[];
  exceptReason: string;
}

const register = JSON.parse(readFileSync(path.join(ROOT, "docs/route-register.json"), "utf8")) as {
  canonicalOrigin: string;
  originAliases: OriginAlias[];
};

type ConfiguredRedirect = Awaited<ReturnType<NonNullable<typeof nextConfig.redirects>>>[number];

async function configuredRedirects(): Promise<ConfiguredRedirect[]> {
  return (await nextConfig.redirects?.()) ?? [];
}

/** The status and Location a request gets from the configured redirects, or null when none applies. */
function resolve(redirects: ConfiguredRedirect[], host: string, pathAndQuery: string) {
  const [pathname, search = ""] = pathAndQuery.split("?", 2);
  const query = parse(search);
  const request = { headers: { host } } as unknown as Parameters<typeof matchHas>[0];
  for (const redirect of redirects) {
    const match = getPathMatch(redirect.source, {
      strict: true,
      removeUnnamedParams: true,
      regexModifier: (regex) => modifyRouteRegex(regex, ["/_next"]),
    });
    const params = match(pathname);
    if (!params) continue;
    const hasParams = matchHas(request, query, redirect.has, redirect.missing);
    if (!hasParams) continue;
    const { parsedDestination } = prepareDestination({
      appendParamsToQuery: false,
      destination: redirect.destination,
      params: { ...params, ...hasParams },
      query,
    });
    const destinationQuery = parsedDestination.query as ParsedUrlQuery;
    const location = format({
      ...parsedDestination,
      query: undefined,
      search: Object.keys(destinationQuery).length > 0 ? `?${stringify(destinationQuery)}` : "",
    });
    return { status: getRedirectStatus(redirect), location };
  }
  return null;
}

const aliasHosts = register.originAliases.map((alias) => new URL(alias.origin).host);

/**
 * Vercel calls these on a production URL its documentation does not name, and
 * a cron request that gets a redirect back stops there, so none may redirect.
 */
const cronPaths = (JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as {
  crons: { path: string }[];
}).crons.map((cron) => cron.path);

/** Every route under the exempt prefixes, read off the app directory. */
function jobRoutePaths(): string[] {
  return ["cron", "jobs"].flatMap((segment) =>
    readdirSync(path.join(ROOT, "src/app/api", segment), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `/api/${segment}/${entry.name}`),
  );
}

describe("the canonical host", () => {
  it("is inherit.bio, and every registered alias is a permanent redirect to it that keeps path and query", () => {
    expect(register.canonicalOrigin).toBe("https://inherit.bio");
    expect([...aliasHosts].sort()).toEqual(["sequence-murex.vercel.app", "sequence.plus.bio", "www.inherit.bio"]);
    for (const alias of register.originAliases) {
      expect(alias).toMatchObject({
        disposition: "permanent-redirect",
        destination: { originFrom: "canonicalOrigin" },
        pathAndQuery: "preserve-exactly",
        expectedStatus: 308,
        exceptPathPrefixes: ["/api/cron/", "/api/jobs/"],
      });
      expect(alias.exceptReason).toMatch(/cron-does-not-follow-redirects/);
    }
  });

  it("has exactly one exact-host 308 entry per registered alias, and no host entry the register does not name", async () => {
    const redirects = await configuredRedirects();
    const hostEntries = redirects.filter((redirect) => redirect.has?.some((item) => item.type === "host"));
    expect(hostEntries).toHaveLength(register.originAliases.length);
    for (const alias of register.originAliases) {
      const host = new URL(alias.origin).host;
      const entries = hostEntries.filter((redirect) =>
        redirect.has?.some((item) => item.type === "host" && item.value === host.replaceAll(".", "\\.")),
      );
      expect(entries, host).toHaveLength(1);
      expect(entries[0]).toEqual({
        source: "/:path((?!api/(?:cron|jobs)/).*)",
        has: [{ type: "host", value: host.replaceAll(".", "\\.") }],
        destination: `${register.canonicalOrigin}/:path`,
        permanent: true,
      });
      expect(getRedirectStatus(entries[0])).toBe(alias.expectedStatus);
    }
  });

  it("sends every path and query on an alias host to the same path and query on inherit.bio", async () => {
    const redirects = await configuredRedirects();
    for (const host of aliasHosts) {
      expect(resolve(redirects, host, "/genome/me/reports?from=mail&view=all"), host).toEqual({
        status: 308,
        location: "https://inherit.bio/genome/me/reports?from=mail&view=all",
      });
      expect(resolve(redirects, host, "/auth/callback?code=abc&next=%2Foverview"), host).toEqual({
        status: 308,
        location: "https://inherit.bio/auth/callback?code=abc&next=%2Foverview",
      });
      expect(resolve(redirects, host, "/.well-known/inherit-upload-jwks.json"), host).toEqual({
        status: 308,
        location: "https://inherit.bio/.well-known/inherit-upload-jwks.json",
      });
      const root = resolve(redirects, host, "/");
      expect(root?.status, host).toBe(308);
      expect(new URL(root!.location).href, host).toBe("https://inherit.bio/");
    }
    for (const host of aliasHosts) {
      // Deep paths keep every segment, and the query survives beside them.
      expect(resolve(redirects, host, "/genome/me/reports/abc/detail?tab=evidence"), host).toEqual({
        status: 308,
        location: "https://inherit.bio/genome/me/reports/abc/detail?tab=evidence",
      });
    }
    // The host is compared as the router sees it: lower-cased, port dropped.
    expect(resolve(redirects, "WWW.Inherit.Bio:443", "/overview")).toEqual({
      status: 308,
      location: "https://inherit.bio/overview",
    });
  });

  it("leaves the canonical host, every preview deployment and localhost where they are", async () => {
    const redirects = await configuredRedirects();
    const unredirected = [
      "inherit.bio",
      // Preview, branch and immutable deployment URLs, and the team alias.
      "sequence-git-main-mariodiego.vercel.app",
      "sequence-4f2k9x1ab-mariodiego.vercel.app",
      "sequence-mariodiego.vercel.app",
      "inherit-8i84xla1x-mariodiego.vercel.app",
      "inherit-env-own-upload-canary-mariodiego.vercel.app",
      "localhost",
      "localhost:3000",
      "127.0.0.1:3100",
      // A dot in a host value is a regex wildcard unless escaped.
      "wwwxinherit.bio",
      "www.inherit.bio.example.test",
      "preview.sequence.plus.bio",
      "sequence-murexxvercel.app",
    ];
    for (const host of unredirected) {
      expect(resolve(redirects, host, "/genome/me/reports?from=mail"), host).toBeNull();
      expect(resolve(redirects, host, "/"), host).toBeNull();
    }
  });

  it("never redirects a scheduled or operator job on any host, and exempts nothing else", async () => {
    const redirects = await configuredRedirects();
    const jobs = jobRoutePaths();
    expect(jobs).toEqual(expect.arrayContaining(cronPaths));
    for (const cronPath of cronPaths) {
      expect(register.originAliases[0].exceptPathPrefixes.some((prefix) => cronPath.startsWith(prefix)), cronPath).toBe(true);
    }
    for (const host of aliasHosts) {
      for (const jobPath of jobs) {
        expect(resolve(redirects, host, jobPath), `${host}${jobPath}`).toBeNull();
      }
      // Near misses on the prefix are ordinary paths, and redirect.
      for (const nearMiss of ["/api/jobs", "/api/cron", "/api/jobsx/mail", "/api/uploads/finalize", "/xapi/jobs/mail", "/genome/api/jobs/mail"]) {
        expect(resolve(redirects, host, nearMiss), `${host}${nearMiss}`).toEqual({
          status: 308,
          location: `https://inherit.bio${nearMiss}`,
        });
      }
    }
  });

  it("keeps the path aliases, which an alias host reaches only after its own hop to inherit.bio", async () => {
    const redirects = await configuredRedirects();
    expect(resolve(redirects, "inherit.bio", "/signup?ref=mail")).toEqual({ status: 308, location: "/auth/sign-up?ref=mail" });
    expect(resolve(redirects, "localhost:3000", "/login")).toEqual({ status: 308, location: "/auth/sign-in" });
    expect(resolve(redirects, "www.inherit.bio", "/signup?ref=mail")).toEqual({
      status: 308,
      location: "https://inherit.bio/signup?ref=mail",
    });
  });
});
