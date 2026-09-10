import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFilePrepared, generateOwnFileWithChosenReports } from "./own-report-helpers";
import { collectFigures, keyed, type CollectedFigure } from "./figure-collector";
import type { OwnReportPurpose } from "../src/lib/uploads/own-report-purpose";

/**
 * G8.3: every number is seeded, proved by differencing.
 *
 * The brief calls this the detection for its first anti-pattern — a beautiful
 * surface over an unimplemented pipeline — and says plainly that one pinned
 * value per surface does not satisfy it. A surface rendering constants or
 * placeholders passes any single-seed assertion and fails here.
 *
 * Each surface is rendered from two synthetic genomes that describe different
 * people, and every figure must move. Figures are paired by what they are —
 * kind, class, basis, provenance and the nearest identifying ancestor — never
 * by their value, so a figure that failed to move is caught rather than
 * quietly matched to a different one.
 */
const RUN_ID = randomUUID();
const ANCESTRY = "/genome/me/ancestry";
const CAFFEINE = "/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551";
const REPORTS = "/genome/me/reports";
const DATA = "/genome/me/data";
/** The browser answers nothing without a search, so this one names a position
 * both seeds carry and call differently. */
const BROWSER = "/genome/me/data/browser?q=rs762551";

type Register = {
  seedInvariant: { surface: string; key: string; reason: string }[];
};
const REGISTER: Register = JSON.parse(fs.readFileSync("docs/figures-register.json", "utf8"));

function invariant(surface: string, key: string): string | null {
  const entry = REGISTER.seedInvariant.find(row => row.surface === surface && row.key === key);
  return entry ? entry.reason : null;
}

/**
 * Sign a fresh account in, prepare its genome, choose its reports, and read
 * every named surface. One upload serves several surfaces: a seed is a person
 * here, and that person's whole account is what the surfaces render.
 */
async function figuresFor(page: Page, label: string, fixture: string,
  purposes: [OwnReportPurpose, ...OwnReportPurpose[]], surfaces: readonly string[]) {
  const user = { email: `figures-${label}-${RUN_ID}@e2e.local`, password: `e2e-figures-${label}-pw` };
  await createConfirmedUser(user.email, user.password);
  await signIn(page, user.email, user.password);
  const fileId = await uploadOwnFilePrepared(page, path.join(process.cwd(), fixture), { fileType: "vcf" });
  await generateOwnFileWithChosenReports(page, fileId, purposes);
  const collected = new Map<string, Map<string, CollectedFigure>>();
  for (const surface of surfaces) {
    await page.goto(surface);
    collected.set(surface, keyed(await page.evaluate(collectFigures)));
  }
  return collected;
}

/** Two isolated accounts, because a seed is a person here and not a parameter. */
async function bothSeeds(browser: Browser, surfaces: readonly string[],
  purposes: [OwnReportPurpose, ...OwnReportPurpose[]],
  seedA: { label: string; fixture: string },
  seedB: { label: string; fixture: string }) {
  const contexts = [await browser.newContext(), await browser.newContext()];
  try {
    const a = await figuresFor(await contexts[0]!.newPage(), seedA.label, seedA.fixture, purposes, surfaces);
    const b = await figuresFor(await contexts[1]!.newPage(), seedB.label, seedB.fixture, purposes, surfaces);
    return { a, b };
  } finally {
    for (const context of contexts) await context.close();
  }
}

/**
 * The comparison itself, identical for every surface.
 *
 * Soft, so one run names every surface that carries a constant. A hard
 * assertion stops the loop at the first failing surface and reports the rest
 * as passing when they were never read — which is exactly how the first pass
 * over these four came to be described as three greens and one failure.
 */
function assertEveryFigureMoved(surface: string,
  a: Map<string, CollectedFigure>, b: Map<string, CollectedFigure>) {
  // The surface must actually carry figures, or "all of them differ" is vacuous.
  expect.soft(a.size, `${surface}: seed A renders figures at all`).toBeGreaterThan(0);
  expect.soft([...b.keys()].sort(), `${surface}: both seeds render the same figures, so pairing is by shape`)
    .toEqual([...a.keys()].sort());

  const unchanged: string[] = [];
  for (const [key, figureA] of a) {
    const figureB = b.get(key);
    // A figure only one seed renders is the assertion above, not this one.
    if (!figureB || figureA.value !== figureB.value) continue;
    if (invariant(surface, key)) continue;
    unchanged.push(`${key} = "${figureA.value}" under both seeds`);
  }
  expect.soft(unchanged,
    `${surface}: a figure identical under two different genomes is a constant, not a result; `
    + "register it in docs/figures-register.json with the reason it cannot move")
    .toEqual([]);

  // A register entry that has started moving is stale and must not stay.
  const stale = REGISTER.seedInvariant
    .filter(row => row.surface === surface)
    .filter(row => a.has(row.key) && b.has(row.key) && a.get(row.key)!.value !== b.get(row.key)!.value)
    .map(row => row.key);
  expect.soft(stale, `${surface}: registered seed-invariant but they do differ; remove them`).toEqual([]);
}

test("every figure on the ancestry surface moves between two seeds", async ({ browser }) => {
  test.setTimeout(300_000);
  const { a, b } = await bothSeeds(browser, [ANCESTRY], ["ancestry"],
    { label: "ancestry-a", fixture: "e2e/fixtures/aims-mixed-grch38.vcf" },
    { label: "ancestry-b", fixture: "e2e/fixtures/aims-mixed-b-grch38.vcf" });
  assertEveryFigureMoved(ANCESTRY, a.get(ANCESTRY)!, b.get(ANCESTRY)!);
});

/**
 * The My Genome surfaces, on the same rule.
 *
 * `tiny-b-grch38.vcf` carries the same four positions as `tiny-grch38.vcf`
 * with different calls, so the genotype each page reads out has to change:
 * rs762551 is 0/1 under seed A and 1/1 under seed B. It carries a fifth
 * position, rs182549, that seed A does not: that one row moves both the
 * file's own record count and the lactase report's coverage figure, which
 * reads 1 of the 2 positions it needs under seed A and 2 of the 2 here.
 *
 * Seed B also carries twelve positions drawn from the three shipped PGS
 * panels, which seed A carries none of, so each panel's coverage figure on
 * `/genome/me/data` moves. Without them all three read "read 0 of the N
 * positions this needs" under either genome, and no honest register entry
 * covers that: the number can move, these two files just never made it.
 *
 * rs671 stays 0/0 in both. The position is read rather than dropped — these
 * surfaces read the canonical prepared source, which keeps reference calls,
 * so both seeds read G/G — and it renders the one figure here that cannot
 * move: a one-position report's coverage is "read 1 of the 1 positions this
 * needs" whenever it renders at all, because an unread position removes that
 * preview and its figure rather than lowering the number. It is registered
 * with that reason rather than papered over by calling rs671 under one seed
 * only, which would change the preview's prose and move no figure.
 */
test("every figure on the My Genome surfaces moves between two seeds", async ({ browser }) => {
  test.setTimeout(300_000);
  const surfaces = [CAFFEINE, REPORTS, DATA, BROWSER];
  const { a, b } = await bothSeeds(browser, surfaces, ["reports.polygenic"],
    { label: "report-a", fixture: "e2e/fixtures/tiny-grch38.vcf" },
    { label: "report-b", fixture: "e2e/fixtures/tiny-b-grch38.vcf" });
  // Reported together rather than one surface per test: the assertions are
  // soft, so a run names every surface that carries a constant instead of
  // stopping at the first.
  for (const surface of surfaces) assertEveryFigureMoved(surface, a.get(surface)!, b.get(surface)!);
});
