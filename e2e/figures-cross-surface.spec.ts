import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFilePrepared, generateOwnFileWithChosenReports } from "./own-report-helpers";
import { collectFigures, type CollectedFigure } from "./figure-collector";
import type { OwnReportPurpose } from "../src/lib/uploads/own-report-purpose";

/**
 * G8.6: repeated figures have one source of truth and cannot diverge.
 *
 * The brief states it as two obligations. `docs/figures-register.json` lists
 * every figure that appears on more than one surface with its single source
 * of truth, and a gate fails when the same figure key renders two different
 * values in one run. This is that gate, and it is deliberately the mirror of
 * `e2e/figures-two-seed.spec.ts`: that one renders one surface from two
 * genomes and requires every figure to move, this one renders one genome
 * across every surface and requires every repeated figure to hold still.
 *
 * A figure's key here is what it is rather than where it sits — kind, class,
 * basis, provenance and the nearest identifying ancestor — with no ordinal,
 * because the whole question is whether the same figure agrees with itself in
 * two places. Provenance is part of the key and is what makes "the same
 * figure" mean something: two numbers with different provenance are two
 * claims, and are allowed to differ.
 *
 * The register is checked in both directions. A figure that starts appearing
 * on a second surface without a declared source of truth fails, because that
 * is the moment a divergence becomes possible; a registered entry that has
 * stopped repeating fails too, so the file cannot accumulate stale claims.
 */
const RUN_ID = randomUUID();

type SurfaceRow = { surface: string; figures: number; note?: string };
type RepeatedRow = { key: string; name: string; surfaces: string[]; sourceOfTruth: string };
type Register = {
  crossSurface: {
    fixture: string;
    purposes: [OwnReportPurpose, ...OwnReportPurpose[]];
    surfaces: SurfaceRow[];
    repeated: RepeatedRow[];
  };
};
const REGISTER: Register = JSON.parse(fs.readFileSync("docs/figures-register.json", "utf8"));
const CROSS = REGISTER.crossSurface;

/** What it is, not where it sits: no ordinal, because agreement is the question. */
function shape(figure: CollectedFigure): string {
  return [figure.kind, figure.figureClass ?? "-", figure.basis ?? "-",
    figure.provenance ?? "-", figure.context ?? "-"].join("|");
}

test("every figure that appears on more than one surface shows one value, from one source", async ({ page }) => {
  test.setTimeout(300_000);
  const user = { email: `cross-surface-${RUN_ID}@e2e.local`, password: "e2e-cross-surface-pw" };
  await createConfirmedUser(user.email, user.password);
  await signIn(page, user.email, user.password);
  const fileId = await uploadOwnFilePrepared(page, path.join(process.cwd(), CROSS.fixture), { fileType: "vcf" });
  await generateOwnFileWithChosenReports(page, fileId, CROSS.purposes);

  const collected = new Map<string, CollectedFigure[]>();
  for (const { surface } of CROSS.surfaces) {
    await page.goto(surface);
    collected.set(surface, await page.evaluate(collectFigures));
  }

  // Every surface's figure count is registered, so a surface that gains a
  // figure has to be looked at rather than silently joining the comparison.
  // `/genome/me` is registered at zero because the brief makes it a three-tile
  // router rather than a result surface, so a figure appearing there is a
  // change worth seeing rather than a collector fault.
  expect.soft(CROSS.surfaces.map(({ surface }) => [surface, collected.get(surface)!.length]),
    "each surface renders the number of figures docs/figures-register.json records")
    .toEqual(CROSS.surfaces.map(({ surface, figures }) => [surface, figures]));

  // surface -> key -> the values that key rendered there.
  const values = new Map<string, Map<string, string[]>>();
  for (const [surface, figures] of collected) {
    for (const figure of figures) {
      const rows = values.get(shape(figure)) ?? new Map<string, string[]>();
      rows.set(surface, [...(rows.get(surface) ?? []), figure.value]);
      values.set(shape(figure), rows);
    }
  }
  const repeated = [...values].filter(([, rows]) => rows.size > 1).map(([key]) => key).sort();
  expect.soft(repeated,
    "a figure on two surfaces can diverge, so docs/figures-register.json must name its single source "
    + "of truth; an entry that no longer repeats must go")
    .toEqual(CROSS.repeated.map(row => row.key).sort());

  for (const row of CROSS.repeated) {
    const rows = values.get(row.key);
    if (!rows) continue; // Named by the set comparison above, not twice.
    expect.soft([...rows.keys()].sort(), `${row.name}: the surfaces it appears on`)
      .toEqual([...row.surfaces].sort());
    // The obligation itself: one value, however many times and wherever it renders.
    expect.soft([...new Set([...rows.values()].flat())],
      `${row.name}: one figure, one value — ${JSON.stringify([...rows])}`)
      .toHaveLength(1);
    expect.soft(fs.existsSync(row.sourceOfTruth),
      `${row.name}: its recorded source of truth ${row.sourceOfTruth} exists`).toBe(true);
  }
});
