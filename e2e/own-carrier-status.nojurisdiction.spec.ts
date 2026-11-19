import { expect, test } from "./audited-test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { adminClient, createConfirmedUser, signIn } from "./helpers";
import { generateOwnFileWithChosenReports, uploadOwnFilePrepared } from "./own-report-helpers";
import {
  importSyntheticRelease,
  reviewSynthetic,
  ruleGenes,
  withdrawSynthetic,
  type SyntheticCondition,
} from "./synthetic-carrier-release";

/**
 * The production variant of `/genome/[subject]/carrier`: the same build with
 * the TEST-LOCAL flag unset (`jurisdiction-off`, port 3101), which is the
 * build production runs.
 *
 * The owner decision of 22 October 2026 ("Carrier status and carrier-pair
 * arithmetic (G7.4)") keeps production unchanged: until the owner approves
 * the starter list, the release is imported through the guarded apply and a
 * named reviewer activates each condition, production says the check is
 * unavailable and that this is not a negative carrier screen.
 *
 * This spec makes that the hardest case it can. A synthetic condition IS
 * active in the database, through the real review door, and the account
 * DOES have a prepared file whose reviewed position carries one changed copy
 * and whose Observed genetic variants choice is signed. On the production
 * build the page still says exactly the approved unavailable sentence and
 * renders no result, because a synthetic row never leaves the TEST-LOCAL
 * build (`rowsForBuild`). The control is the same account on the TEST-LOCAL
 * server, which shows the finding, so the difference is the build and not a
 * broken account, file or condition.
 */

const SPEC = "e2e/own-carrier-status.nojurisdiction.spec.ts";
const MAIN = "http://localhost:3100";
const OFF = "http://localhost:3101";
const RUN_ID = randomUUID();
const RELEASE_ID = `synthetic-e2e-own-production-${RUN_ID.slice(0, 8)}`;
const USER = { email: `own-carrier-production-${RUN_ID}@e2e.local`, password: "e2e-own-carrier-production-pw" };
const FIXTURE = path.join(process.cwd(), "e2e/fixtures/carrier-pair-grch38.vcf");
/** Retyped rather than imported, so the assertion checks that the approved sentence reaches the reader. */
const UNAVAILABLE =
  "This check is unavailable. Inherit cannot yet verify the evidence for each gene change. This is not a negative carrier screen.";

const ACTIVE: SyntheticCondition = {
  conditionId: "SYNTHETIC:8831", conditionName: "Synthetic recessive condition production", gene: "SYNOWNP",
  assertions: [
    { variationId: 883101, variantName: "Synthetic change production", reviewStatus: "practice guideline", reviewStars: 4,
      lastEvaluated: "2023-06-15", pos: 21_000_000, ref: "A", alt: "G" },
  ],
};

test.describe.configure({ mode: "serial" });
test.use({ trace: "off" }); // Upload and presentation bearers stay out of traces.

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
  await importSyntheticRelease(RELEASE_ID, [ACTIVE], SPEC);
  await reviewSynthetic(ACTIVE, "activate", SPEC);
  expect(await ruleGenes()).toEqual([ACTIVE.gene]);
});

test.afterAll(async () => {
  await withdrawSynthetic([ACTIVE], SPEC);
});

test("the production build says the own carrier check is unavailable and is not a negative screen, even with a synthetic condition active and a file that carries it", async ({ browser }) => {
  test.setTimeout(300_000);
  // The file is prepared and the choice signed on the TEST-LOCAL server, as
  // e2e/genome-family.nojurisdiction.spec.ts does its account steps; the same
  // session cookie reaches both servers on localhost.
  const context = await browser.newContext({ baseURL: MAIN });
  try {
    const page = await context.newPage();
    await signIn(page, USER.email, USER.password);
    const fileId = await uploadOwnFilePrepared(page, FIXTURE, { fileType: "vcf" });
    await generateOwnFileWithChosenReports(page, fileId, ["reports.monogenic"]);
    const { data: reviewed, error } = await adminClient().from("carrier_conditions").select("active")
      .eq("condition_id", ACTIVE.conditionId).single();
    expect(error).toBeNull();
    expect(reviewed!.active, "the condition is active in the database this build reads").toBe(true);

    const response = await page.goto(`${OFF}/genome/me/carrier`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A change you carry");
    await expect(page.locator('[data-slot="carrier-status"]')).toHaveAttribute("data-state", "unavailable");
    await expect(page.locator('[data-slot="carrier-status-state"]')).toHaveText(UNAVAILABLE);
    await expect(page.locator("main [data-claim-block], main [data-figure-kind]")).toHaveCount(0);
    await expect(page.locator('[data-slot="carrier-limits"], [data-slot="carrier-status-condition"]')).toHaveCount(0);
    const main = page.locator("main");
    await expect(main).not.toContainText("Synthetic");
    await expect(main).not.toContainText("one copy");
    await expect(main).not.toContainText("test release");
    expect(await page.content()).not.toContain(ACTIVE.gene);

    // The control: the same account, file and condition on the TEST-LOCAL build show the finding.
    await page.goto("/genome/me/carrier");
    const block = page.locator(`[data-slot="carrier-status-condition"][data-condition-id="${ACTIVE.conditionId}"]`);
    await expect(block.locator('[data-slot="carrier-status-reading"]')).toHaveText("You: one copy");
    await expect(page.getByText(UNAVAILABLE, { exact: true })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
