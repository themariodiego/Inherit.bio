import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ADR-0029's relative rule is "a successor surface may not be denser than what
 * it replaces", and it is only as good as the map saying which surface
 * replaced which. That map was empty until 2026-09-11, so the relative half of
 * the density contract compared nothing against nothing while reading as
 * though it were enforced.
 *
 * It is not authored: `docs/route-register.json` already records, for every
 * pre-rename route it kept as a redirect, exactly which route id that redirect
 * targets. This test rebuilds the map from that and compares, so a rename that
 * moves a successor fails here rather than leaving a comparison pointed at the
 * wrong page - the same both-directions discipline the accessibility and
 * claims ledgers use.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Route {
  id: string;
  path: string;
  kind: string;
  disposition?: unknown;
}
interface SuccessorRow {
  baselineRoute: string;
  successorRouteId: string;
  successorPath: string;
  basis: string;
}

const register = JSON.parse(
  readFileSync(path.join(ROOT, "docs/route-register.json"), "utf8"),
) as { routes: Route[] };
const density = JSON.parse(
  readFileSync(path.join(ROOT, "docs/density-baseline.json"), "utf8"),
) as { routes: { route: string }[]; relativeComparison: { rule: string; routes: SuccessorRow[] } };

function derived(): SuccessorRow[] {
  const byId = new Map(register.routes.map((route) => [route.id, route]));
  const order = new Map(density.routes.map((entry, index) => [entry.route, index]));
  const rows: SuccessorRow[] = [];
  for (const route of register.routes) {
    if (!order.has(route.path)) continue;
    const disposition = route.disposition;
    const target = typeof disposition === "object" && disposition !== null
      && "redirectToRoute" in disposition
      ? byId.get((disposition as { redirectToRoute: string }).redirectToRoute)
      : undefined;
    rows.push(target
      ? { baselineRoute: route.path, successorRouteId: target.id, successorPath: target.path,
          basis: "the register's own redirect disposition" }
      : { baselineRoute: route.path, successorRouteId: route.id, successorPath: route.path,
          basis: "kept at the same path" });
  }
  rows.sort((a, b) => (order.get(a.baselineRoute) ?? 0) - (order.get(b.baselineRoute) ?? 0));
  return rows;
}

describe("the density contract's successor map is the register's, not a second opinion", () => {
  it("maps every baseline route, and only baseline routes", () => {
    const mapped = density.relativeComparison.routes.map((row) => row.baselineRoute);
    expect([...mapped].sort()).toEqual(density.routes.map((entry) => entry.route).sort());
  });

  it("matches what the route register says replaced each baseline route", () => {
    expect(density.relativeComparison.routes).toEqual(derived());
  });

  it("names a successor that the register still declares", () => {
    const ids = new Set(register.routes.map((route) => route.id));
    const paths = new Set(register.routes.map((route) => route.path));
    for (const row of density.relativeComparison.routes) {
      expect(ids, row.baselineRoute).toContain(row.successorRouteId);
      expect(paths, row.baselineRoute).toContain(row.successorPath);
    }
  });

  /**
   * A floor, so an emptied map cannot pass by agreeing with an emptied
   * derivation. The baseline is a frozen artifact of 22 routes; it does not
   * shrink, and if it ever does that is a fact someone has to write down.
   */
  it("still carries the twenty-two routes the frozen baseline captured", () => {
    expect(density.routes.length).toBe(22);
    expect(density.relativeComparison.routes.length).toBe(22);
    const redirected = density.relativeComparison.routes
      .filter((row) => row.successorPath !== row.baselineRoute);
    expect(redirected.length).toBe(7);
  });
});
