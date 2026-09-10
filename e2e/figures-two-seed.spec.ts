import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFilePrepared, generateOwnFileWithChosenReports } from "./own-report-helpers";
import { collectFigures, keyed, type CollectedFigure } from "./figure-collector";

/**
 * G8.3: every number is seeded, proved by differencing.
 *
 * The brief calls this the detection for its first anti-pattern — a beautiful
 * surface over an unimplemented pipeline — and says plainly that one pinned
 * value per surface does not satisfy it. A surface rendering constants or
 * placeholders passes any single-seed assertion and fails here.
 *
 * Seed A and seed B are the same generator at different seeds AND different
 * mixing weights (`e2e/fixtures/generate-aims-vcf.ts`). Both were needed: the
 * seed alone redraws the same mixture and lands near the same proportions, and
 * two seeds that agree to the rendered decimal would make this gate look
 * green while proving nothing.
 *
 * Figures are paired by what they are — kind, class, basis, provenance and
 * their ordinal among figures of that shape — never by their value, so a
 * figure that failed to move is caught rather than quietly matched to a
 * different one.
 */
const RUN_ID = randomUUID();
const USER_A = { email: `figures-a-${RUN_ID}@e2e.local`, password: "e2e-figures-a-pw" };
const USER_B = { email: `figures-b-${RUN_ID}@e2e.local`, password: "e2e-figures-b-pw" };
const ANCESTRY = "/genome/me/ancestry";

type Register = {
  seedInvariant: { surface: string; key: string; reason: string }[];
};
const REGISTER: Register = JSON.parse(fs.readFileSync("docs/figures-register.json", "utf8"));

function invariant(surface: string, key: string): string | null {
  const entry = REGISTER.seedInvariant.find(row => row.surface === surface && row.key === key);
  return entry ? entry.reason : null;
}

async function figuresFor(page: Page, user: { email: string; password: string }, fixture: string) {
  await createConfirmedUser(user.email, user.password);
  await signIn(page, user.email, user.password);
  const fileId = await uploadOwnFilePrepared(page, path.join(process.cwd(), fixture), { fileType: "vcf" });
  await generateOwnFileWithChosenReports(page, fileId, ["ancestry"]);
  await page.goto(ANCESTRY);
  await expect(page.locator('[data-slot="ancestry-map"]')).toHaveAttribute("data-mode", "shown");
  return keyed(await page.evaluate(collectFigures));
}

test("every figure on the ancestry surface moves between two seeds", async ({ browser }) => {
  test.setTimeout(300_000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  let a: Map<string, CollectedFigure>;
  let b: Map<string, CollectedFigure>;
  try {
    a = await figuresFor(await contextA.newPage(), USER_A, "e2e/fixtures/aims-mixed-grch38.vcf");
    b = await figuresFor(await contextB.newPage(), USER_B, "e2e/fixtures/aims-mixed-b-grch38.vcf");
  } finally {
    await contextA.close();
    await contextB.close();
  }

  // The surface must actually carry figures, or "all of them differ" is vacuous.
  expect(a.size, "seed A renders figures at all").toBeGreaterThan(0);
  expect([...b.keys()].sort(), "both seeds render the same figures, so pairing is by shape")
    .toEqual([...a.keys()].sort());

  const unchanged: string[] = [];
  for (const [key, figureA] of a) {
    const figureB = b.get(key)!;
    if (figureA.value !== figureB.value) continue;
    const reason = invariant(ANCESTRY, key);
    if (reason) continue;
    unchanged.push(`${key} = "${figureA.value}" under both seeds`);
  }
  expect(unchanged,
    "a figure identical under two different genomes is a constant, not a result; "
    + "register it in docs/figures-register.json with the reason it cannot move")
    .toEqual([]);

  // A register entry that has started moving is stale and must not stay.
  const stale = REGISTER.seedInvariant
    .filter(row => row.surface === ANCESTRY)
    .filter(row => a.has(row.key) && a.get(row.key)!.value !== b.get(row.key)!.value)
    .map(row => row.key);
  expect(stale, "these are registered seed-invariant but do differ; remove them").toEqual([]);
});
