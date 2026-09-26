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

  it("reads no IP, geo, language or browser-timezone signal anywhere, but the one sanctions check", () => {
    const found = sources.flatMap(({ file, source }) => SIGNALS
      .filter(([pattern]) => pattern.test(file === SANCTIONS_READ.file ? source.replace(SANCTIONS_READ.call, "") : source))
      .map(([, label]) => `${file}: ${label}`));
    expect(found).toEqual([]);
  });

  it("finds the sanctions check exactly once, so the exception cannot outlive or outgrow it", () => {
    const proxy = sources.find(entry => entry.file === SANCTIONS_READ.file);
    expect(proxy?.source.match(SANCTIONS_READ.call)).toHaveLength(1);
  });

  it("would still catch a second read of the same headers in the proxy", () => {
    const proxy = sources.find(entry => entry.file === SANCTIONS_READ.file)!;
    const planted = `${proxy.source}\nconst c = request.headers.get("x-vercel-ip-country");\n`;
    expect(SIGNALS.some(([pattern]) => pattern.test(planted.replace(SANCTIONS_READ.call, "")))).toBe(true);
  });

  it("reads no signal in any file other than the proxy, unchanged", () => {
    const found = sources.filter(({ file }) => file !== SANCTIONS_READ.file).flatMap(({ file, source }) => SIGNALS
      .filter(([pattern]) => pattern.test(source))
      .map(([, label]) => `${file}: ${label}`));
    expect(found).toEqual([]);
  });

  it("still permits a fixed formatting zone, which infers nothing", () => {
    const fixed = sources.filter(({ source }) => /timeZone:\s*"UTC"/.test(source));
    expect(fixed.length).toBeGreaterThan(0);
    const found = fixed.flatMap(({ file, source }) => SIGNALS
      .filter(([pattern]) => pattern.test(source)).map(([, label]) => `${file}: ${label}`));
    expect(found).toEqual([]);
  });
});
