import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The token grep of G8.2(c), run with its explicit exclusion file.
 *
 * A blanket grep for demonstration, mock and fixture tokens fails against the
 * shipped tree and would ban live paths this work must keep: the fixture body
 * of the research-refresh job, the fixture-slug exclusion in the export route,
 * and a handful of comments. So the grep runs against
 * `scripts/mock-token-allowlist.json`, which names exactly those files with one
 * line of justification each, and the gate fails in both directions — an
 * unlisted hit is new fixture surface, and a listed file that no longer matches
 * is a stale entry someone must remove.
 *
 * Scope is production source. Test files, test configuration and the `e2e/`
 * tree are outside it by construction rather than by exclusion, so nothing has
 * to be justified for merely being a test.
 *
 * What this cannot do: prove a rendered value came from the authenticated
 * person's own rows. That is G8.2(a), and it needs the two-seed evidence of
 * G8.3.
 */
const ROOTS = ["src", "worker/src"];
const TOKEN = /\b(demo|demos|mock|mocks|mocked|mocking|fixture|fixtures|dummy)\b/i;
const allowlist = JSON.parse(readFileSync("scripts/mock-token-allowlist.json", "utf8")) as {
  contract: string; scope: string; rule: string;
  allowed: { path: string; reason: string }[];
};

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}
const production = ROOTS.flatMap(walk).filter(file => !/\.(test|spec)\.tsx?$/.test(file));
const matching = production.filter(file => TOKEN.test(readFileSync(file, "utf8")));
const listed = new Set(allowlist.allowed.map(entry => entry.path));

describe("mock and fixture tokens in production source", () => {
  it("scans the real tree, so a passing run means something", () => {
    expect(allowlist.contract).toBe("mock-token-allowlist-v1");
    expect(production.length).toBeGreaterThan(200);
    expect(matching.length).toBeGreaterThan(0);
  });
  it("lists every production file that carries one of the tokens", () => {
    expect(matching.filter(file => !listed.has(file))).toEqual([]);
  });
  it("keeps no stale entry, so the list cannot outlive what it justified", () => {
    const found = new Set(matching);
    expect(allowlist.allowed.map(entry => entry.path).filter(file => !found.has(file))).toEqual([]);
  });
  it("justifies each entry in one line, and names each file once", () => {
    for (const entry of allowlist.allowed) {
      expect(entry.reason.trim().length).toBeGreaterThan(20);
      expect(entry.reason).not.toContain("\n");
    }
    expect(new Set(listed).size).toBe(allowlist.allowed.length);
  });
  // The one production path that takes fixture input must stay authenticated,
  // and must stay described where an operator would look for it.
  it("keeps the fixture-input path authenticated and recorded", () => {
    const route = readFileSync("src/app/api/jobs/research-refresh/route.ts", "utf8");
    expect(route).toContain("process.env.JOBS_SECRET");
    expect(route).toMatch(/if \(!authorized\(request\)\) \{\s*return new Response\("Unauthorized", \{ status: 401 \}\);/);
    const record = readFileSync("docs/fixture-paths.md", "utf8");
    expect(record).toContain("src/app/api/jobs/research-refresh/route.ts");
    expect(record).toContain("JOBS_SECRET");
  });
});
