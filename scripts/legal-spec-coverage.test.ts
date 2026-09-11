import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { titleProves } from "./route-gate";

/**
 * `e2e/legal.spec.ts` holds a `REQUIRED` list of documents and their required
 * content, and one statically titled test per entry. Nothing connected the two,
 * and that cost real coverage: converting an interpolated loop into explicit
 * tests, the extraction missed `/science` because a comment sat between its
 * `{` and its `route:` key. The entry stayed in `REQUIRED`, its test vanished,
 * and nothing failed — so four X15 declared-gap assertions ("does not match you
 * with relatives", "does not offer prenatal or newborn screening") silently
 * stopped running.
 *
 * This is the guard for that, and it is deliberately a unit test rather than a
 * browser one: it must hold regardless of `--grep`, and it costs milliseconds.
 */
const SPEC = "e2e/legal.spec.ts";
const source = readFileSync(SPEC, "utf8");

/**
 * Routes declared in the REQUIRED list — matched on the key alone, never on its
 * position. The first version of this guard anchored to the start of a line and
 * found 10 of 19, because entries short enough to fit on one line put `route:`
 * after the brace. That is the same shape of mistake this file exists to catch,
 * which is why it is spelled out rather than quietly fixed.
 */
const declared = [...source.matchAll(/\broute:\s*"([^"]+)"/g)].map(match => match[1]);
/** Routes an actual test drives. */
const driven = [...source.matchAll(/assertDocumentComplete\(page, "([^"]+)"\)/g)].map(match => match[1]);
/** Every `test("…")` title in the file. */
const titles = [...source.matchAll(/\btest\(\s*"((?:\\.|[^"\\])*)"/g)].map(match => match[1]);

describe(`${SPEC} document coverage`, () => {
  it("declares at least the documents this suite has always covered", () => {
    // A floor, so an empty or broken scan cannot read as full agreement.
    expect(declared.length).toBeGreaterThanOrEqual(23);
    expect(driven.length).toBeGreaterThanOrEqual(23);
  });

  it("drives every declared document, and declares every driven one", () => {
    expect([...new Set(driven)].sort(), "a REQUIRED entry with no test asserts nothing")
      .toEqual([...new Set(declared)].sort());
  });

  it("gives each document a title the route-state gate can read", () => {
    // The gate reads titles statically, so an interpolated one proves nothing.
    for (const route of declared) {
      const proving = titles.filter(title => titleProves(title, route, "complete"));
      expect(proving.length, `no static title proves ${route} complete`).toBe(1);
    }
  });
});
