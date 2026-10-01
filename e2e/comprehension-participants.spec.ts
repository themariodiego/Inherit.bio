import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import bindings from "../scripts/comprehension/bindings.json";
import { OWN_REPORT_PURPOSES, type OwnReportPurpose } from "../src/lib/uploads/own-report-purpose";
import { adminClient, createConfirmedUser, signIn } from "./helpers";
import { generateOwnFileWithChosenReports, ownRunCompletions, uploadOwnFilePrepared } from "./own-report-helpers";

/**
 * G3.2's named seed accounts, built the way a person builds them.
 *
 * `scripts/comprehension/bindings.json` binds each comprehension task to a
 * named account and the files that account holds. Until this file, nothing
 * created any of them: a facilitator had to build `participant-a` by hand,
 * and a hand-built account differs a little every round. This builds the two
 * that can be built today, reading every email, file, file type and report
 * choice out of the bindings so the seed and the protocol cannot drift.
 *
 * Only the product's own path is used: a confirmed account, a signed-in
 * browser, the real upload and preparation, and the report choices a person
 * makes on `/genome/me/reports`. The owner's decision of 18 September 2026
 * closes a fixture-only path that writes rows directly, and that is also why
 * `participant-c` is seeded separately by the real signed-parent embryo
 * journey in its own exact fresh native CI partition. This ordinary
 * own-file seed cannot create or adopt that isolated worker runtime.
 *
 * Run on its own against the local stack with `pnpm seed:participants`; the
 * full browser suite also runs it, so a seed that stops working fails CI
 * rather than a facilitator's morning. It never deletes. An account that
 * already holds exactly its seeded files and results passes as seeded; one
 * holding anything else is refused with the way to clear it, because T8
 * deletes everything and a half-deleted account must not pass as a fresh one.
 * On a stack that is already seeded both tests pass without an upload, so the
 * runner's own "No browser upload crossed the actual provider proxy" guard,
 * which exists for the full suite, then ends the standalone run non-zero.
 *
 * The password is a synthetic local fixture like every other in this suite.
 * These accounts exist only in the local Docker stack.
 */
const PASSWORD = "e2e-comprehension-participant-pw";

type SeedBinding = { email: string; fileTypes: string[]; purposes: string[] };
type SeededAccount = { id: string; files: string[]; seed: SeedBinding };

function seededAccount(id: "participant-a" | "participant-b"): SeededAccount {
  const account = bindings.accounts.find(candidate => candidate.id === id) as
    { id: string; files: string[]; seed?: SeedBinding | null } | undefined;
  if (!account?.seed) throw new Error(`${id} carries no seed binding`);
  return { id: account.id, files: account.files, seed: account.seed };
}

function chosenPurposes(purposes: string[]): readonly [OwnReportPurpose, ...OwnReportPurpose[]] {
  const chosen = purposes.filter((purpose): purpose is OwnReportPurpose =>
    (OWN_REPORT_PURPOSES as readonly string[]).includes(purpose));
  if (!chosen.length || chosen.length !== purposes.length) throw new Error("Bound report choices must be supported purposes");
  return chosen as [OwnReportPurpose, ...OwnReportPurpose[]];
}

const sha256 = (file: string) => createHash("sha256").update(readFileSync(path.resolve(file))).digest("hex");

async function heldFiles(accountId: string) {
  const held = await adminClient().from("genome_files").select("id,sha256,status,file_type").eq("user_id", accountId);
  expect(held.error).toBeNull();
  return held.data!;
}

function refusal(id: string) {
  return `${id} already holds files the seed did not put there. The seed never deletes: remove them `
    + "through Settings → Data, which is T8's own path, or reset the local stack, then seed again.";
}

async function signInAs(page: Page, account: SeededAccount) {
  await signIn(page, account.seed.email, PASSWORD);
}

test("the comprehension seed builds participant-b as an account holding no file", async ({ page }) => {
  const account = seededAccount("participant-b");
  expect(account.files, "T4's friend starts the round with nothing uploaded").toEqual([]);
  const accountId = await createConfirmedUser(account.seed.email, PASSWORD);
  expect(await heldFiles(accountId), refusal(account.id)).toEqual([]);
  // The facilitator hands over these exact credentials, so prove they work.
  await signInAs(page, account);
});

test("the comprehension seed builds participant-a with both bound files and every bound report choice", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const account = seededAccount("participant-a");
  const purposes = chosenPurposes(account.seed.purposes);
  const accountId = await createConfirmedUser(account.seed.email, PASSWORD);
  await signInAs(page, account);

  let held = await heldFiles(accountId);
  if (held.length === 0) {
    // In the bound order: the ancestry page shows the most recently completed
    // estimate, so the file T2 reads is uploaded, and finishes, last.
    for (const [index, file] of account.files.entries()) {
      const fileId = await uploadOwnFilePrepared(page, path.resolve(file), { fileType: account.seed.fileTypes[index] });
      await generateOwnFileWithChosenReports(page, fileId, purposes);
    }
    held = await heldFiles(accountId);
  }

  const bound = account.files.map(file => ({ file, sha256: sha256(file) }));
  expect(held.map(file => file.sha256).sort(), refusal(account.id)).toEqual(bound.map(file => file.sha256).sort());
  const ancestryCompletedAt: string[] = [];
  for (const [index, { file, sha256: digest }] of bound.entries()) {
    const source = held.find(candidate => candidate.sha256 === digest)!;
    expect(source, file).toMatchObject({ status: "stored", file_type: account.seed.fileTypes[index] });
    const runs = await ownRunCompletions(source.id);
    expect(runs.map(run => run.purpose), `${file} carries every bound report choice`).toEqual([...purposes].sort());
    expect(runs.filter(run => !run.complete).map(run => run.purpose), `${file} results are complete and current`).toEqual([]);
    const ancestry = runs.find(run => run.purpose === "ancestry");
    if (ancestry?.completed_at) ancestryCompletedAt.push(ancestry.completed_at);
  }
  if (purposes.includes("ancestry")) {
    expect(ancestryCompletedAt).toHaveLength(bound.length);
    expect(Date.parse(ancestryCompletedAt.at(-1)!), "the file T2 reads holds the newest ancestry estimate")
      .toBeGreaterThan(Math.max(...ancestryCompletedAt.slice(0, -1).map(Date.parse)));
  }

  // What each bound task finds when a participant opens it, read from the
  // same bindings the protocol grades against.
  const task = (id: string) => bindings.tasks.find(candidate => candidate.id === id)!;
  for (const slug of task("T1").templateSlugs) {
    await page.goto(`/genome/me/reports/${slug}`);
    await expect(page.locator('[data-figure-kind="genotype"][data-figure-basis="observed"]').first(), `T1 ${slug}`)
      .toBeVisible();
  }
  for (const slug of task("T3").templateSlugs) {
    await page.goto(`/genome/me/reports/${slug}`);
    await expect(page.locator('[data-outcome="not-covered"]'), `T3 ${slug}`).toHaveCount(1);
    await expect(page.locator('[data-figure-kind="genotype"]'), `T3 ${slug}`).toHaveCount(0);
  }
  const t2 = task("T2") as { regionLabels?: string[] };
  await page.goto("/genome/me/ancestry");
  const named = page.locator('[data-slot="region-row"]:not([hidden]) [data-slot="region-name"]');
  await expect(named.first(), "T2 has a region to name").toBeVisible();
  const shown = (await named.allInnerTexts()).map(label => label.trim());
  expect(shown.filter(label => !(t2.regionLabels ?? []).includes(label)), "every region T2 can name is a bound label").toEqual([]);
});
