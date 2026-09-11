import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { adminClient, createConfirmedUser, signIn, uploadOwnFileThroughUi } from "./helpers";
import { PREPARED_REPORTS, PRIMARY, STATE_B, START_HERE } from "../src/copy/overview";

/**
 * `/overview processing` - the product's State B (brief §2 §3.3).
 *
 * Reaching it deterministically took reading rather than guessing. The obvious
 * window, `status: "parsing"`, is opened and closed inside one server request
 * (`src/app/api/files/[id]/process/route.ts`), so it cannot be held from a
 * browser: a client-side hold lands before the server ever sets it. But
 * `STEP_FOR_STATUS` in the Overview page also maps `uploaded` to step 0, and
 * THAT state is real, server-side and durable - a file is finalized and stored
 * but preparation has not been asked for yet. Holding the preparation request
 * keeps the account genuinely in it for as long as the test needs, without
 * seeding a row or faking a status. Nothing here manufactures the state; it
 * waits inside one the product defines.
 *
 * The copy is imported rather than retyped so the page and the assertion
 * cannot drift apart.
 */

const PASSWORD = "synthetic-overview-processing-password";
const email = `overview-processing-${randomUUID()}@e2e.local`;
/** Below this many measured files the page must not state a duration. */
const MIN_TIMING_SAMPLE = 20;

test("/overview processing: the step list names the file in flight, and the timing sentence is measured or withheld", async ({
  page,
  context,
}) => {
  await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);

  let releasePreparation!: () => void;
  const preparationHeld = new Promise<void>(resolve => { releasePreparation = resolve; });
  await page.route("**/api/files/*/process", async route => {
    await preparationHeld;
    await route.continue();
  }, { times: 1 });

  const fileId = await uploadOwnFileThroughUi(page, path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"));
  const admin = adminClient();
  const held = await admin.from("genome_files").select("status,tier,original_name").eq("id", fileId).single();
  expect(held.error).toBeNull();
  expect(held.data!.status, "the state this test waits inside is the server's, not the test's").toBe("uploaded");

  // A second page in the same browser session: the first is still holding the
  // preparation request open, and must stay that way.
  const overview = await context.newPage();
  try {
    const response = await overview.goto("/overview");
    expect(response?.status()).toBe(200);
    const panel = overview.locator('section[aria-labelledby="processing-title"]');
    await expect(panel).toHaveCount(1);

    /**
     * The heading can only ever say `Genome file`. The canonical finalize RPC
     * stores that literal instead of the person's filename, so State B has no
     * way to name what they chose - a coherent consequence of that privacy
     * decision rather than a gap, and worth pinning where someone might
     * otherwise "fix" the heading by reaching for the real name.
     */
    await expect(overview.locator("#processing-title"))
      .toHaveText(STATE_B.processing(held.data!.original_name));
    await expect(overview.locator("#processing-title")).toHaveText("Processing Genome file");

    // Five steps, in the product's order, with exactly one marked current -
    // and it is the first, because preparation has not been asked for yet.
    const steps = panel.locator("ol li");
    await expect(steps).toHaveCount(STATE_B.steps.length);
    for (let index = 0; index < STATE_B.steps.length; index++) {
      await expect(steps.nth(index)).toHaveText(STATE_B.steps[index]);
    }
    await expect(panel.locator('ol li[aria-current="step"]')).toHaveCount(1);
    await expect(steps.first()).toHaveAttribute("aria-current", "step");

    /**
     * The timing sentence, against this deployment's real measurements. The
     * branch is not assumed: the same RPC the page reads is read here, and the
     * assertion follows the data. Below the sample floor the page must say it
     * cannot estimate; at or above it, it must state durations in the exact
     * registered shape. Those two are the only permitted outputs - a page that
     * invented a duration, or stayed silent when it had the evidence, fails.
     */
    const { data: stats } = await admin.rpc("processing_time_stats");
    const row = (stats ?? []).find((entry: { file_tier: number }) => entry.file_tier === held.data!.tier);
    const measured = Boolean(row && row.n >= MIN_TIMING_SAMPLE
      && row.p50_seconds != null && row.p95_seconds != null);
    const timingLine = panel.locator("p").last();
    if (measured) {
      await expect(timingLine, `tier ${held.data!.tier} has ${row!.n} measured files, so a duration is owed`)
        .toHaveText(/^Most files like this finish in about .+\. Nine in ten finish within .+\.$/);
    } else {
      await expect(timingLine, "below the sample floor the page must refuse to estimate")
        .toHaveText(STATE_B.notEnough);
    }

    // It is State B and not another state wearing its panel: State A's strip
    // and State C's counts are both absent.
    await expect(overview.getByText(START_HERE.heading, { exact: true })).toHaveCount(0);
    await expect(overview.locator("[data-metric-value]")).toHaveCount(0);
    await expect(panel.getByRole("link", { name: PRIMARY.addFile, exact: true })).toBeVisible();

    // The held request was real: releasing it prepares the file for real.
    releasePreparation();
    await expect(page.locator('[data-slot="upload-progress"]'))
      .toContainText("Your file is stored and prepared. Reports have not been generated yet.");

    /**
     * The panel's own promise, which nothing verified until now: it "re-fetches
     * every five seconds so the steps advance without a manual reload". So this
     * asserts the transition on the page that is ALREADY OPEN and never
     * reloaded - a fresh navigation would pass even if the polling were dead,
     * which is the weaker test this one replaced.
     */
    await expect(panel, "the panel re-fetches on its own and goes once the file is no longer in flight")
      .toHaveCount(0, { timeout: 30_000 });

    /**
     * And what the person is left looking at, which had no browser test at all.
     * `/overview` State A has TWO forms, and `e2e/overview.spec.ts` covers only
     * the first: the onboarding hub, and - when a prepared source exists but no
     * report or ancestry does - this panel instead. That second form is exactly
     * the point in the journey where the next act is a person's explicit choice
     * of analysis, so sending them back to "I have a DNA file" here would be
     * telling someone who has just uploaded their genome to upload it again.
     * It does not: the Start-here strip is replaced rather than kept.
     */
    const choose = overview.locator('section[aria-labelledby="prepared-reports-title"]');
    await expect(choose).toHaveCount(1);
    await expect(overview.locator("#prepared-reports-title")).toHaveText(PREPARED_REPORTS.title);
    await expect(choose).toContainText(PREPARED_REPORTS.description);
    await expect(choose.getByRole("link", { name: PREPARED_REPORTS.action, exact: true }))
      .toHaveAttribute("href", "/genome/me/reports");
    await expect(overview.getByText(START_HERE.heading, { exact: true })).toHaveCount(0);
    await expect(overview.getByRole("link", { name: PRIMARY.haveFile, exact: true })).toHaveCount(0);
  } finally {
    releasePreparation();
    await overview.close();
  }

  const prepared = await admin.from("genome_files").select("status,normalization_completed_at").eq("id", fileId).single();
  expect(prepared.error).toBeNull();
  expect(prepared.data!.status).toBe("stored");
  expect(prepared.data!.normalization_completed_at).not.toBeNull();
});
