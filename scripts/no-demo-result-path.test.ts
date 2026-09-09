import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No production demonstration-result journey (G8.2, and the standing decision
 * against `/demo`, `/example/*` and fixture-derived results shown to ordinary
 * people). A screen that fills an unfinished journey with invented results is
 * worse than a screen that says the journey is unfinished, because only one of
 * them tells the truth.
 *
 * This checks the two things that are checkable by construction: no route
 * segment offers a demonstration, and no page or component reaches a fixture
 * module. It does not, and cannot, prove that every rendered number came from a
 * real source — the figure contract and the claim registry own that.
 */
const SURFACES = ["src/app", "src/components"];
const DEMONSTRATION_SEGMENT = /^(demo|demos|example|examples|sample|samples|mock|mocks|dummy)$/i;
const FIXTURE_SPECIFIER = /(^|\/)__fixtures__(\/|$)|fixtures(\.[a-z-]+)?$|\/fixtures\//i;

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}
const routeFiles = walk("src/app");
const productionFiles = SURFACES.flatMap(walk).filter(file => !/\.(test|spec)\.tsx?$/.test(file));

function importSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g)]
    .map(match => match[1] ?? match[2]!)
    .filter(Boolean);
}

describe("no production demonstration-result path", () => {
  it("scans the real surfaces, so a passing run means something", () => {
    expect(productionFiles.length).toBeGreaterThan(100);
  });

  it("offers no route segment that presents a demonstration", () => {
    const offending = new Set<string>();
    for (const file of routeFiles) {
      for (const segment of path.relative("src/app", file).split(path.sep)) {
        // A route group like `(app)` is not a segment a person can visit.
        if (DEMONSTRATION_SEGMENT.test(segment.replace(/^\(|\)$/g, ""))) offending.add(file);
      }
    }
    expect([...offending]).toEqual([]);
  });

  it("lets no page or component import a fixture module", () => {
    const offending = productionFiles.flatMap(file =>
      importSpecifiers(file).filter(specifier => FIXTURE_SPECIFIER.test(specifier))
        .map(specifier => `${file} imports ${specifier}`));
    expect(offending).toEqual([]);
  });

  it("would catch a fixture import if one appeared", () => {
    // The guard is only worth having if its matcher actually fires.
    for (const specifier of ["@/lib/genome/prepared-source/fixtures",
      "./materialize-canonical.fixtures", "../__fixtures__/genome", "@/lib/claims/email-fixtures"]) {
      expect(FIXTURE_SPECIFIER.test(specifier), specifier).toBe(true);
    }
    for (const specifier of ["@/lib/uploads/subject-upload-contract", "react", "node:fs"]) {
      expect(FIXTURE_SPECIFIER.test(specifier), specifier).toBe(false);
    }
  });
});
