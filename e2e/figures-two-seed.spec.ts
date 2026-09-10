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

type Register = {
  seedInvariant: { surface: string; key: string; reason: string }[];
};
const REGISTER: Register = JSON.parse(fs.readFileSync("docs/figures-register.json", "utf8"));

function invariant(surface: string, key: string): string | null {
  const entry = REGISTER.seedInvariant.find(row => row.surface === surface && row.key === key);
  return entry ? entry.reason : null;
}

/** Sign a fresh account in, prepare its genome, choose its reports, and read a surface. */
async function figuresFor(page: Page, label: string, fixture: string,
  purposes: [OwnReportPurpose, ...OwnReportPurpose[]], surface: string) {
  const user = { email: `figures-${label}-${RUN_ID}@e2e.local`, password: `e2e-figures-${label}-pw` };
  await createConfirmedUser(user.email, user.password);
  await signIn(page, user.email, user.password);
  const fileId = await uploadOwnFilePrepared(page, path.join(process.cwd(), fixture), { fileType: "vcf" });
  await generateOwnFileWithChosenReports(page, fileId, purposes);
  await page.goto(surface);
  return keyed(await page.evaluate(collectFigures));
}

/** Two isolated accounts, because a seed is a person here and not a parameter. */
async function bothSeeds(browser: Browser, surface: string,
  purposes: [OwnReportPurpose, ...OwnReportPurpose[]],
  seedA: { label: string; fixture: string; ready?: (page: Page) => Promise<void> },
  seedB: { label: string; fixture: string; ready?: (page: Page) => Promise<void> }) {
  const contexts = [await browser.newContext(), await browser.newContext()];
  try {
    const pageA = await contexts[0]!.newPage();
    const a = await figuresFor(pageA, seedA.label, seedA.fixture, purposes, surface);
    await seedA.ready?.(pageA);
    const pageB = await contexts[1]!.newPage();
    const b = await figuresFor(pageB, seedB.label, seedB.fixture, purposes, surface);
    await seedB.ready?.(pageB);
    return { a, b };
  } finally {
    for (const context of contexts) await context.close();
  }
}

/** The comparison itself, identical for every surface. */
function assertEveryFigureMoved(surface: string,
  a: Map<string, CollectedFigure>, b: Map<string, CollectedFigure>) {
  // The surface must actually carry figures, or "all of them differ" is vacuous.
  expect(a.size, `${surface}: seed A renders figures at all`).toBeGreaterThan(0);
  expect([...b.keys()].sort(), `${surface}: both seeds render the same figures, so pairing is by shape`)
    .toEqual([...a.keys()].sort());

  const unchanged: string[] = [];
  for (const [key, figureA] of a) {
    const figureB = b.get(key)!;
    if (figureA.value !== figureB.value) continue;
    if (invariant(surface, key)) continue;
    unchanged.push(`${key} = "${figureA.value}" under both seeds`);
  }
  expect(unchanged,
    `${surface}: a figure identical under two different genomes is a constant, not a result; `
    + "register it in docs/figures-register.json with the reason it cannot move")
    .toEqual([]);

  // A register entry that has started moving is stale and must not stay.
  const stale = REGISTER.seedInvariant
    .filter(row => row.surface === surface)
    .filter(row => a.has(row.key) && a.get(row.key)!.value !== b.get(row.key)!.value)
    .map(row => row.key);
  expect(stale, `${surface}: registered seed-invariant but they do differ; remove them`).toEqual([]);
}

test("every figure on the ancestry surface moves between two seeds", async ({ browser }) => {
  test.setTimeout(300_000);
  const { a, b } = await bothSeeds(browser, ANCESTRY, ["ancestry"],
    { label: "ancestry-a", fixture: "e2e/fixtures/aims-mixed-grch38.vcf" },
    { label: "ancestry-b", fixture: "e2e/fixtures/aims-mixed-b-grch38.vcf" });
  assertEveryFigureMoved(ANCESTRY, a, b);
});

/**
 * The report surface, on the same rule.
 *
 * `tiny-b-grch38.vcf` carries the same four positions as `tiny-grch38.vcf`
 * with different calls, so the genotype the page reads out has to change:
 * rs762551 is 0/1 under seed A and 1/1 under seed B. Its rs671 stays 0/0 in
 * both on purpose — the parser drops homozygous-reference rows, so that
 * position is uncovered under either seed and contributes no figure to
 * compare. Making it callable under one seed only would change which figures
 * exist rather than what they say, and that is a different test.
 */
test("every figure on a report surface moves between two seeds", async ({ browser }) => {
  test.setTimeout(300_000);
  const { a, b } = await bothSeeds(browser, CAFFEINE, ["reports.polygenic"],
    { label: "report-a", fixture: "e2e/fixtures/tiny-grch38.vcf" },
    { label: "report-b", fixture: "e2e/fixtures/tiny-b-grch38.vcf" });
  assertEveryFigureMoved(CAFFEINE, a, b);
});
