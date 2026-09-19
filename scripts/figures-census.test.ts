import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  FIGURE_SOURCES,
  builtPages,
  figureCapablePages,
  importSpecifiers,
  reachesAny,
  resolveImport,
  surfaceMatchesRoute,
} from "./figures-census";

/**
 * G8.3's completeness (see `scripts/figures-census.ts`): every page that can
 * render a figure is either differenced under two seeds or recorded with the
 * reason no figure state of it can render today, and nothing else is listed.
 *
 * Both directions, as the route gate compares its ledgers: an unlisted
 * figure-capable page fails, and so does an entry for a page that can no
 * longer render a figure — a stale exemption is as wrong as a missing proof.
 * A `differenced` entry has to name surfaces the two-seed spec actually
 * renders, found by name in the spec's own text, and each surface has to be
 * an instance of the route it is listed under. A `no-reachable-figure-state`
 * entry has to say why, and name specs that assert zero figures on the route
 * and do contain such an assertion.
 */
const ROOT = process.cwd();
const REGISTER = "docs/figures-register.json";
const TWO_SEED_SPEC = "e2e/figures-two-seed.spec.ts";

interface Differenced { route: string; status: "differenced"; surfaces: string[] }
interface Unreachable { route: string; status: "no-reachable-figure-state"; reason: string; assertedBy: string[] }
type CensusEntry = Differenced | Unreachable;
interface Census { rule: string; figureSources: string[]; routes: CensusEntry[] }

const register = JSON.parse(readFileSync(path.join(ROOT, REGISTER), "utf8")) as { census?: Census };
const census = register.census;
const capable = figureCapablePages(ROOT);
const spec = readFileSync(path.join(ROOT, TWO_SEED_SPEC), "utf8");
/** A browser assertion that a page or region carries no figure element. */
const ZERO_FIGURES = /\[data-figure-kind\]"?\)\)\s*\.toHaveCount\(0\)|not\.toContain\("data-figure-kind"\)/;

describe("figures census: which built pages can render a figure", () => {
  it("scans the real application, so a passing run means something", () => {
    expect(builtPages(ROOT).length).toBeGreaterThan(60);
    for (const source of FIGURE_SOURCES) expect(existsSync(path.join(ROOT, source)), source).toBe(true);
    expect(capable.length).toBeGreaterThanOrEqual(6);
  });

  it("the register names the figure sources this census walks to", () => {
    expect(census, `${REGISTER} has no census section`).toBeDefined();
    expect(census!.figureSources).toEqual([...FIGURE_SOURCES]);
    expect(census!.rule).toMatch(/G8\.3/);
  });

  it("every figure-capable route has exactly one census entry, and every entry is a figure-capable route", () => {
    const measured = capable.map(page => page.route).sort();
    const recorded = census!.routes.map(entry => entry.route).sort();
    expect(new Set(recorded).size, "one entry per route").toBe(recorded.length);
    expect(recorded, "the census must list exactly the routes whose pages reach a figure component").toEqual(measured);
  });

  it("a differenced route names surfaces the two-seed spec renders, each an instance of the route", () => {
    const entries = census!.routes.filter((entry): entry is Differenced => entry.status === "differenced");
    expect(entries.length).toBeGreaterThanOrEqual(6);
    for (const entry of entries) {
      expect(entry.surfaces.length, entry.route).toBeGreaterThan(0);
      for (const surface of entry.surfaces) {
        expect(spec.includes(`"${surface}"`), `${TWO_SEED_SPEC} does not render ${surface}`).toBe(true);
        expect(surfaceMatchesRoute(surface, entry.route), `${surface} is not an instance of ${entry.route}`).toBe(true);
      }
    }
  });

  it("a route with no reachable figure state says why and names specs that assert zero figures on it", () => {
    const entries = census!.routes.filter((entry): entry is Unreachable => entry.status === "no-reachable-figure-state");
    for (const entry of entries) {
      expect(entry.reason.length, entry.route).toBeGreaterThan(120);
      expect(entry.assertedBy.length, entry.route).toBeGreaterThan(0);
      for (const file of entry.assertedBy) {
        expect(existsSync(path.join(ROOT, file)), `${entry.route}: ${file} does not exist`).toBe(true);
        expect(readFileSync(path.join(ROOT, file), "utf8"), `${entry.route}: ${file} asserts no zero-figure state`).toMatch(ZERO_FIGURES);
      }
    }
    const statuses = new Set(census!.routes.map(entry => entry.status));
    for (const status of statuses) expect(["differenced", "no-reachable-figure-state"]).toContain(status);
  });
});

describe("figures census: the walker, on planted trees", () => {
  const temporary: string[] = [];
  afterAll(() => { for (const directory of temporary) rmSync(directory, { recursive: true, force: true }); });

  function plant(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(os.tmpdir(), "figures-census-"));
    temporary.push(root);
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), source);
    }
    return root;
  }

  it("derives routes as the register spells them: groups erased, dynamic segments kept, slots and private folders skipped", () => {
    const root = plant({
      "src/app/(marketing)/page.tsx": "export default function P() { return null; }",
      "src/app/(app)/genome/[subject]/data/page.tsx": "export default function P() { return null; }",
      "src/app/@modal/page.tsx": "export default function P() { return null; }",
      "src/app/_private/page.tsx": "export default function P() { return null; }",
      "src/app/legal/route.ts": "export function GET() {}",
    });
    expect(builtPages(root).map(page => page.route).sort()).toEqual(["/", "/genome/[subject]/data"]);
  });

  it("finds a figure through an alias import, a relative import, a re-export and a dynamic import, and not where none leads", () => {
    const root = plant({
      "src/components/figures/figure.tsx": "export function Figure() { return null; }",
      "src/components/figures/relative-figure.tsx": "export function RelativeFigure() { return null; }",
      "src/components/panel.tsx": 'import { Figure } from "@/components/figures/figure";\nexport const Panel = () => Figure();',
      "src/components/index.ts": 'export { Panel } from "./panel";',
      "src/components/lazy.tsx": 'export const load = () => import("@/components/figures/relative-figure");',
      "src/components/plain.tsx": 'import { note } from "./text";\nexport const Plain = () => note;',
      "src/components/text.ts": 'import { Plain } from "./plain";\nexport const note = String(Plain);',
      "src/app/a/page.tsx": 'import { Panel } from "../../components";\nexport default Panel;',
      "src/app/b/[id]/page.tsx": 'import { load } from "@/components/lazy";\nexport default load;',
      "src/app/c/page.tsx": 'import { Plain } from "@/components/plain";\nimport "server-only";\nexport default Plain;',
    });
    expect(figureCapablePages(root).map(page => page.route)).toEqual(["/a", "/b/[id]"]);
    // The cycle between plain and text terminates and reaches nothing.
    expect(reachesAny(root, "src/app/c/page.tsx", new Set(FIGURE_SOURCES))).toBe(false);
  });

  it("reads the three import forms and resolves only what exists on disk", () => {
    const root = plant({ "src/x.ts": "export const x = 1;", "src/y/index.tsx": "export const y = 2;", "src/app/page.tsx": "" });
    expect(importSpecifiers('import a from "@/x";\nimport "side";\nconst b = import("./y");\nexport { c } from "../z";'))
      .toEqual(["@/x", "side", "./y", "../z"]);
    expect(resolveImport(root, "src/app/page.tsx", "@/x")).toBe("src/x.ts");
    expect(resolveImport(root, "src/app/page.tsx", "../y")).toBe("src/y/index.tsx");
    expect(resolveImport(root, "src/app/page.tsx", "@/missing")).toBeNull();
    expect(resolveImport(root, "src/app/page.tsx", "react")).toBeNull();
  });

  it("matches a concrete surface to its route and to no other", () => {
    expect(surfaceMatchesRoute("/genome/me/data/browser?q=rs762551", "/genome/[subject]/data/browser")).toBe(true);
    expect(surfaceMatchesRoute("/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551", "/genome/[subject]/reports/[slug]")).toBe(true);
    expect(surfaceMatchesRoute("/genome/me/reports", "/genome/[subject]/reports/[slug]")).toBe(false);
    expect(surfaceMatchesRoute("/genome/me/ancestry", "/genome/[subject]")).toBe(false);
    expect(surfaceMatchesRoute("/overview", "/genome/[subject]")).toBe(false);
  });
});
