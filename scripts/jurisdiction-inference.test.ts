import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * G5.1a: jurisdiction is user-declared and server-enforced, and "no inference
 * from IP, locale, timezone or Accept-Language is permitted, asserted by a gate
 * that greps route handlers for those headers". This is that gate.
 *
 * It scans all production source rather than route handlers alone. A helper in
 * `src/lib` that reads `x-forwarded-for` and is called by a route infers just
 * as effectively as the route doing it itself, and scoping the scan to
 * `src/app/api` would miss it.
 *
 * Why this matters more than a normal lint: the brief rejects even a
 * *contradiction* check against a coarse geo signal, on two grounds — any geo
 * signal needs a third-party origin, forbidden by C8 and G1.7, and it creates a
 * failure state the average person can neither understand nor fix. So the rule
 * is not "prefer the declaration"; it is that the signal must never be read.
 *
 * What this cannot do. It matches the named ways of reading these signals, not
 * every conceivable one: `timeZone: someVariable` passed in from elsewhere
 * would not be caught, while `resolvedOptions()` — how the browser zone is
 * actually read — is. A fixed `timeZone: "UTC"` is deliberately not matched;
 * pinning a formatting zone is the opposite of inferring a person's.
 *
 * One read is permitted (owner decision, 26 September 2026, amending G5.1a
 * for sanctions law): the request proxy hands Vercel's country and region
 * headers straight to `isEmbargoedLocation`, to refuse connections from
 * places under a comprehensive US embargo. The host sets those headers
 * itself, so no third-party origin is involved; the read decides nothing
 * about a declared jurisdiction and stores nothing. The scan removes exactly
 * that call before looking, so any other use of the same headers, in the
 * proxy or anywhere else, still fails.
 *
 * A second read is permitted (owner decision, 28 September 2026, for the
 * register's per-network invitation limit): `sourceNetwork` in
 * `src/lib/source-network.ts` hands the two client-address headers to
 * `normalizedSourceNetwork` in one call, and only `src/lib/rate-limit-keys.ts`
 * may import it, where `networkBucketDigests` puts the result straight into a
 * keyed digest for a closed list of registered operations. The bucket is purged within 24 hours and decides
 * nothing about a jurisdiction. The same rules apply: that exact call is
 * removed before the scan, it must occur exactly once, a second read in the
 * same file still fails, and so does a new importer.
 */
const SIGNALS: [RegExp, string][] = [
  [/x-forwarded-for/i, "client IP header"],
  [/x-real-ip/i, "client IP header"],
  [/cf-ipcountry/i, "edge geo header"],
  [/x-vercel-ip-[a-z-]+/i, "edge geo header"],
  [/accept-language/i, "language header"],
  [/navigator\.language/i, "browser language"],
  [/resolvedOptions\(\)/, "browser timezone"],
  [/\bgeoip\b/i, "geo lookup"],
  [/\b(?:req|request)\.geo\b/, "edge geo object"],
];

const SANCTIONS_READ = {
  file: path.join("src", "proxy.ts"),
  call: /isEmbargoedLocation\(\s*request\.headers\.get\("x-vercel-ip-country"\),\s*request\.headers\.get\("x-vercel-ip-country-region"\),\s*\)/g,
};

const NETWORK_LIMIT_READ = {
  file: path.join("src", "lib", "source-network.ts"),
  call: /normalizedSourceNetwork\(headers\.get\("x-real-ip"\), headers\.get\("x-forwarded-for"\)\)/g,
  /** The only module allowed to import the reader, and the only call it may make. */
  importer: path.join("src", "lib", "rate-limit-keys.ts"),
  use: /keyedDigestSet\("rate-limit", `\$\{operation\}\|source-network\|\$\{sourceNetwork\(headers\)\}`\)/g,
};

const EXCEPTIONS = [SANCTIONS_READ, NETWORK_LIMIT_READ];

/** The source with its one permitted read removed, or the source unchanged. */
function withoutPermittedRead(file: string, source: string): string {
  const exception = EXCEPTIONS.find(entry => entry.file === file);
  return exception ? source.replace(exception.call, "") : source;
}

function productionSources(): { file: string; source: string }[] {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [full] : [];
    });
  return walk("src").map(file => ({ file, source: readFileSync(file, "utf8") }));
}

describe("jurisdiction is declared, never inferred", () => {
  const sources = productionSources();

  it("reads the production tree at all, so a passing run is not an empty scan", () => {
    expect(sources.length).toBeGreaterThan(200);
    expect(sources.some(entry => entry.file.includes(path.join("app", "api")))).toBe(true);
    // The middleware is production source too and is where an edge geo header
    // would most naturally be read.
    expect(sources.some(entry => entry.file.endsWith(`src${path.sep}proxy.ts`))).toBe(true);
  });

  it("reads no IP, geo, language or browser-timezone signal anywhere, but the two recorded reads", () => {
    const found = sources.flatMap(({ file, source }) => SIGNALS
      .filter(([pattern]) => pattern.test(withoutPermittedRead(file, source)))
      .map(([, label]) => `${file}: ${label}`));
    expect(found).toEqual([]);
  });

  it("finds the sanctions check exactly once, so the exception cannot outlive or outgrow it", () => {
    const proxy = sources.find(entry => entry.file === SANCTIONS_READ.file);
    expect(proxy?.source.match(SANCTIONS_READ.call)).toHaveLength(1);
  });

  it("finds the network-limit read exactly once, so the exception cannot outlive or outgrow it", () => {
    const reader = sources.find(entry => entry.file === NETWORK_LIMIT_READ.file);
    expect(reader?.source.match(NETWORK_LIMIT_READ.call)).toHaveLength(1);
  });

  it("would still catch a second read of the same headers in the proxy", () => {
    const proxy = sources.find(entry => entry.file === SANCTIONS_READ.file)!;
    const planted = `${proxy.source}\nconst c = request.headers.get("x-vercel-ip-country");\n`;
    expect(SIGNALS.some(([pattern]) => pattern.test(planted.replace(SANCTIONS_READ.call, "")))).toBe(true);
  });

  it("would still catch a second client-address read in the network-limit reader", () => {
    const reader = sources.find(entry => entry.file === NETWORK_LIMIT_READ.file)!;
    for (const header of ["x-real-ip", "x-forwarded-for"]) {
      const planted = `${reader.source}\nconst c = headers.get("${header}");\n`;
      expect(SIGNALS.some(([pattern]) => pattern.test(withoutPermittedRead(reader.file, planted)))).toBe(true);
    }
  });

  it("reads no signal in any file other than the two exception files, unchanged", () => {
    const exceptionFiles = new Set(EXCEPTIONS.map(entry => entry.file));
    const found = sources.filter(({ file }) => !exceptionFiles.has(file)).flatMap(({ file, source }) => SIGNALS
      .filter(([pattern]) => pattern.test(source))
      .map(([, label]) => `${file}: ${label}`));
    expect(found).toEqual([]);
  });

  it("lets only the rate-limit key module use the network reader, and only inside a keyed digest", () => {
    const importers = sources
      .filter(({ source }) => /from\s+["'](?:@\/lib\/source-network|\.{1,2}\/(?:[\w-]+\/)*source-network)["']/.test(source))
      .map(({ file }) => file);
    expect(importers).toEqual([NETWORK_LIMIT_READ.importer]);
    const quota = sources.find(entry => entry.file === NETWORK_LIMIT_READ.importer)!;
    expect(quota.source.match(/sourceNetwork\(/g)).toHaveLength(1);
    expect(quota.source.match(NETWORK_LIMIT_READ.use)).toHaveLength(1);
  });

  it("still permits a fixed formatting zone, which infers nothing", () => {
    const fixed = sources.filter(({ source }) => /timeZone:\s*"UTC"/.test(source));
    expect(fixed.length).toBeGreaterThan(0);
    const found = fixed.flatMap(({ file, source }) => SIGNALS
      .filter(([pattern]) => pattern.test(source)).map(([, label]) => `${file}: ${label}`));
    expect(found).toEqual([]);
  });
});
