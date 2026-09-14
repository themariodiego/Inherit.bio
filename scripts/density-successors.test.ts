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
interface MeasurementRow {
  baselineRoute: string;
  baselineMeasurementPath: string;
  successorPath: string;
  measurementPath: string;
  surface: string;
  basis: string;
  parameters?: Record<string, string>;
}

const register = JSON.parse(
  readFileSync(path.join(ROOT, "docs/route-register.json"), "utf8"),
) as { routes: Route[] };
const density = JSON.parse(
  readFileSync(path.join(ROOT, "docs/density-baseline.json"), "utf8"),
) as {
  routes: { route: string; measurementPath: string; surface: string }[];
  relativeComparison: { rule: string; routes: SuccessorRow[] };
  postChange: { measurementPaths: MeasurementRow[] };
};

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

/**
 * The successor map above is the register's fact: which route replaced which.
 * It stops one step short of a capture, because five successors carry a
 * dynamic segment and a screenshot needs a URL. Choosing those values IS a
 * decision — which subject, which report — so it is declared in the contract
 * where a reader can disagree with it, and checked here rather than buried in
 * a capture script's string concatenation.
 *
 * The baseline was captured on 2026-08-31 and nothing measured its successors
 * for two weeks, because there was no post-change harness at all. These rows
 * are the first half of building one.
 */
describe("the post-change capture knows which URL replaces each baseline one", () => {
  const measurementPaths = density.postChange.measurementPaths;
  const bySuccessor = new Map(density.relativeComparison.routes.map((row) => [row.baselineRoute, row]));
  const baseline = new Map(density.routes.map((entry) => [entry.route, entry]));

  it("declares one measurement path per baseline route, in the successor map's order", () => {
    expect(measurementPaths.map((row) => row.baselineRoute))
      .toEqual(density.relativeComparison.routes.map((row) => row.baselineRoute));
  });

  it("names the successor the register named, never a second opinion", () => {
    for (const row of measurementPaths) {
      expect(row.successorPath, row.baselineRoute).toBe(bySuccessor.get(row.baselineRoute)?.successorPath);
    }
  });

  it("carries the baseline's own measurement path and surface", () => {
    // The surface decides whether the capture signs in before the shot. A row
    // that quietly changed it would compare a signed-in page against a signed
    // -out one and call the difference a density improvement.
    for (const row of measurementPaths) {
      const entry = baseline.get(row.baselineRoute);
      expect(row.baselineMeasurementPath, row.baselineRoute).toBe(entry?.measurementPath);
      expect(row.surface, row.baselineRoute).toBe(entry?.surface);
    }
  });

  it("resolves every dynamic segment, and only from declared parameters", () => {
    for (const row of measurementPaths) {
      let resolved = row.successorPath;
      for (const [name, value] of Object.entries(row.parameters ?? {})) {
        expect(resolved, `${row.baselineRoute} declares ${name}`).toContain(`[${name}]`);
        resolved = resolved.replaceAll(`[${name}]`, value);
      }
      // Substitution alone must produce the declared URL: no extra segment, no
      // query string, nothing the successor path does not already say.
      expect(resolved, row.baselineRoute).toBe(row.measurementPath);
      expect(row.measurementPath, `${row.baselineRoute} is a concrete URL`).not.toContain("[");
    }
  });

  it("keeps the one report the baseline measured", () => {
    // Comparing a different report would compare different content and read as
    // a density change. The slug is the baseline's own.
    const report = measurementPaths.find((row) => row.successorPath.endsWith("/reports/[slug]"));
    expect(report).toBeDefined();
    const slug = report!.baselineMeasurementPath.split("/").pop();
    expect(report!.parameters?.slug).toBe(slug);
    expect(report!.measurementPath.endsWith(`/${slug}`)).toBe(true);
  });
});
