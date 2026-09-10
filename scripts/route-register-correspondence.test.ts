import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `docs/route-register.json` is the binding response-contract authority: a
 * route's auth mode, request shape, policy and success contract are what the
 * register says they are. That only means something if the register and the
 * App Router agree about which routes exist, and nothing checked that.
 *
 * This gate walks `src/app` for the files that actually create URLs and
 * compares them with the register. Two disagreements matter and are checked
 * separately, because they fail in opposite ways:
 *
 *  - A built route the register does not describe is live surface with no
 *    declared contract at all.
 *  - A segment the register pins to fixed literals, implemented as an open
 *    dynamic segment, accepts values the contract forbids. That is how a raw
 *    bearer token ends up in a URL path.
 *
 * Registered-but-unbuilt is deliberately not failed here. The register is
 * written from the brief and describes routes the product has not reached
 * yet; 56 of them are unbuilt today and that is a backlog, not a defect. The
 * count is asserted loosely below only so a broken walker cannot pass.
 *
 * Known divergences live in `docs/route-divergence.json` and are checked in
 * both directions: an unlisted one fails, and a listed one that no longer
 * exists fails too, so fixing a divergence forces the ledger to be updated
 * rather than leaving a stale entry behind.
 */
const APP = "src/app";
const REGISTER = "docs/route-register.json";
const LEDGER = "docs/route-divergence.json";

type Entry = { id: string; path: string; kind?: string; parameterContract?: unknown };
type Built = { url: string; kind: "page" | "endpoint"; file: string };

/** Only `page` and `route` files create a URL; everything else is scaffolding. */
function builtRoutes(): Built[] {
  const found: Built[] = [];
  const walk = (directory: string, segments: string[]) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        // Route groups are erased from the URL; parallel slots and private
        // folders never produce one.
        if (entry.name.startsWith("@") || entry.name.startsWith("_")) continue;
        const grouped = entry.name.startsWith("(") && entry.name.endsWith(")");
        walk(full, grouped ? segments : [...segments, entry.name]);
        continue;
      }
      const kind = /^page\.(tsx|ts|jsx|js)$/.test(entry.name) ? "page"
        : /^route\.(ts|js)$/.test(entry.name) ? "endpoint" : null;
      if (kind) found.push({ url: `/${segments.join("/")}`.replace(/^\/$/, "/"), kind, file: full });
    }
  };
  walk(APP, []);
  return found;
}

function register(): Entry[] {
  return JSON.parse(readFileSync(REGISTER, "utf8")).routes as Entry[];
}

/**
 * A registered path, plus every concrete path its `parameterContract` pins.
 * `/withdraw/[token]` with token in {request, session} is also, and only,
 * `/withdraw/request` and `/withdraw/session`.
 */
function concretePaths(entry: Entry): string[] {
  const contract = entry.parameterContract;
  let forms = [entry.path];
  if (contract && typeof contract === "object") {
    for (const [segment, rule] of Object.entries(contract as Record<string, unknown>)) {
      if (!rule || typeof rule !== "object") continue;
      const spec = rule as { enum?: unknown; const?: unknown };
      const values = Array.isArray(spec.enum) ? spec.enum
        : spec.const !== undefined ? [spec.const] : null;
      if (!values) continue;
      const literals = values.filter((value): value is string => typeof value === "string");
      if (!literals.length) continue;
      forms = forms.flatMap(form => literals.map(value => form.replace(`[${segment}]`, value)));
    }
  }
  return [...new Set([entry.path, ...forms])];
}

function pinnedSegments(entry: Entry): string[] {
  const contract = entry.parameterContract;
  if (!contract || typeof contract !== "object") return [];
  return Object.entries(contract as Record<string, unknown>)
    .filter(([, rule]) => rule && typeof rule === "object"
      && (Array.isArray((rule as { enum?: unknown }).enum) || (rule as { const?: unknown }).const !== undefined))
    .map(([segment]) => segment);
}

const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as {
  builtButNotRegistered: { path: string; file: string }[];
  permissiveDynamicSegment: { routeId: string; path: string; file: string }[];
};

describe("the route register and the App Router describe the same surface", () => {
  const built = builtRoutes();
  const entries = register();
  const registered = new Set(entries.flatMap(concretePaths));

  it("walks the app directory at all, so a passing run is not an empty scan", () => {
    expect(built.length).toBeGreaterThan(100);
    // Route groups erased, dynamic segments kept verbatim, endpoints found.
    const urls = built.map(route => route.url);
    expect(urls).toContain("/");
    expect(urls).toContain("/withdraw/session");          // inside (marketing)
    expect(urls).toContain("/api/files/[id]/finalize");
    expect(built.some(route => route.kind === "page")).toBe(true);
    expect(built.some(route => route.kind === "endpoint")).toBe(true);
  });

  it("expands a pinned parameter into the literals it allows", () => {
    const rights = entries.find(entry => entry.id === "rights.withdraw")!;
    expect(concretePaths(rights)).toEqual(
      expect.arrayContaining(["/withdraw/[token]", "/withdraw/request", "/withdraw/session"]));
    const withdraw = entries.find(entry => entry.id === "api.withdraw")!;
    expect(concretePaths(withdraw)).toContain("/api/withdraw/session");
  });

  it("registers every built route, except the ones the ledger records", () => {
    const unregistered = built.filter(route => !registered.has(route.url));
    expect(unregistered.map(route => route.url).sort())
      .toEqual(ledger.builtButNotRegistered.map(known => known.path).sort());
    // The ledger names the file too, so an entry cannot survive the route
    // moving somewhere else.
    for (const known of ledger.builtButNotRegistered) {
      expect(unregistered.find(route => route.url === known.path)?.file).toBe(known.file);
    }
  });

  it("implements a pinned segment as its literals, never as an open segment", () => {
    const open = entries.flatMap(entry => pinnedSegments(entry)
      .filter(segment => built.some(route => route.url === entry.path && entry.path.includes(`[${segment}]`)))
      .map(segment => ({ routeId: entry.id, path: entry.path, segment })));
    expect(open.map(found => `${found.routeId} ${found.path}`).sort())
      .toEqual(ledger.permissiveDynamicSegment.map(known => `${known.routeId} ${known.path}`).sort());
  });

  it("leaves the unbuilt half of the register alone, but still measures it", () => {
    const builtUrls = new Set(built.map(route => route.url));
    const unbuilt = entries.filter(entry => !concretePaths(entry).some(candidate => builtUrls.has(candidate)));
    // A backlog, not a failure. The bound only catches a matcher that broke.
    expect(unbuilt.length).toBeGreaterThan(30);
    expect(unbuilt.length).toBeLessThan(entries.length);
  });
});
