import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * G5.1: jurisdiction is server-enforced for every restricted capability.
 *
 * Enforcement here is real but plural. Three different mechanisms are in use —
 * `@/lib/embryos/guards`, `personCapability` from `@/lib/family/access`, and
 * `resolveCapability` directly — and one route is a bare re-export that
 * inherits another's guard. There is no chokepoint, so nothing catches a new
 * route under these areas that uses none of them.
 *
 * That plurality is also a trap for the gate itself. A first pass here matched
 * only two of the three mechanisms and reported three of seven routes as
 * unguarded; all three were false positives — an alias, a route importing the
 * family module, and an acknowledgement route. The mechanisms are therefore
 * listed explicitly rather than guessed at, and every route in scope must be
 * classified, so a new one cannot pass by being unrecognised.
 */
const AREA = /(family|embryo|cohort|portrait|carrier)/i;
const MECHANISMS: [RegExp, string][] = [
  [/@\/lib\/embryos\/guards/, "embryos/guards"],
  [/@\/lib\/embryos\/access/, "embryos/access"],
  [/personCapability|@\/lib\/family\/access/, "family/access"],
  [/resolveCapability|@\/lib\/legal\/jurisdictions/, "legal/jurisdictions"],
];
/** A file whose whole body re-exports another route inherits its enforcement. */
const ALIAS = /^\s*(?:\/\/[^\n]*\n|\s)*export\s*\{\s*[A-Z,\s]+\}\s*from\s*"([^"]+)"\s*;?\s*$/;

/**
 * Routes in scope that carry no capability check of their own, each with the
 * reason. Listed rather than pattern-matched away, so the reason is reviewable
 * and a new one cannot join them silently.
 */
const WITHOUT_CHECK: Record<string, string> = {
  "src/app/api/family/acknowledge/route.ts":
    "Records an acknowledgement — a Tier-2 result-gate cookie and a one-time portrait acknowledgement stamp. It returns no genetic result and opens no capability; the surfaces it precedes are themselves gated.",
};

function routeFiles(): string[] {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name === "route.ts" ? [full] : [];
    });
  return walk(path.join("src", "app", "api")).filter(file => AREA.test(file)).sort();
}

function mechanismFor(file: string, seen = new Set<string>()): string | null {
  if (seen.has(file)) return null;
  seen.add(file);
  const source = readFileSync(file, "utf8");
  for (const [pattern, name] of MECHANISMS) if (pattern.test(source)) return name;
  const alias = ALIAS.exec(source);
  if (alias) {
    const target = alias[1]!.replace(/^@\//, `src${path.sep}`);
    const resolved = target.endsWith(".ts") ? target : `${target}.ts`;
    try { return mechanismFor(resolved, seen) ? `alias → ${resolved}` : null; } catch { return null; }
  }
  return null;
}

describe("every restricted-capability route enforces or is classified", () => {
  const routes = routeFiles();

  it("finds the routes at all, so a passing run is not an empty scan", () => {
    expect(routes.length).toBeGreaterThanOrEqual(7);
    expect(routes).toContain(path.join("src", "app", "api", "family", "[person]", "sharing", "route.ts"));
    expect(routes).toContain(path.join("src", "app", "api", "embryo-cohort-drafts", "route.ts"));
  });

  it("leaves no route in scope both unguarded and unexplained", () => {
    const unexplained = routes
      .filter(file => !mechanismFor(file))
      .filter(file => !(file.split(path.sep).join("/") in WITHOUT_CHECK));
    expect(unexplained).toEqual([]);
  });

  it("keeps the exception list honest: a listed route must still lack a check", () => {
    const stale = Object.keys(WITHOUT_CHECK)
      .filter(file => mechanismFor(file.split("/").join(path.sep)));
    expect(stale).toEqual([]);
  });
});
