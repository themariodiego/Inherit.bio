import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { NAV_LABELS, NAV_LANDMARK_LABEL } from "@/copy/navigation";
import { ADD_ANOTHER_ADULT_BUTTON } from "@/copy/family";
import { REGIONAL_COMBINED_NAME } from "@/lib/ancestry/regional-regions";
import { LAYER_LABELS } from "@/copy/reports/strings";
import {
  ATTESTATION_LABEL,
  INVITE_H1,
  INVITE_THEM_BODY,
  PATH_B_AVAILABLE,
  PATH_B_LINK,
} from "@/copy/family/invite";
import { createConfirmedUser, signIn } from "./helpers";
import { generateOwnFileWithChosenReports, uploadOwnFilePrepared } from "./own-report-helpers";

/**
 * Task depth, measured rather than asserted.
 *
 * `docs/route-register.json` → `navigationContract.taskDepthActions` carries
 * the brief's rule: a user action is a pointer activation or a keystroke
 * submission, counted by instrumenting `click` and `submit`; T8 — delete
 * everything — has a ceiling of 6 and a **floor of 3** including one typed
 * confirmation, because a three-click path to irreversible destruction is
 * itself a defect.
 *
 * `pnpm gate:routes` holds that contract to the tasks it names and counts the
 * ceilings nothing measures. This is the measurement for T8, and it is the
 * safety-critical one: the floor is the only place in the register where a
 * number exists to stop a journey being made *too* easy.
 *
 * Three things make this a measurement and not a re-statement:
 *
 *  1. The numbers are read out of the register at run time. Transcribing them
 *     would mean this test and the contract could drift apart silently, which
 *     is the failure the gate above exists to catch.
 *  2. The count comes from DOM events the browser really dispatched, not from
 *     counting this file's own calls. A listener installed in the page bumps a
 *     `sessionStorage` counter on every `click` and `submit` in the capture
 *     phase, so anything the product triggers for itself is counted too.
 *     `sessionStorage` survives a same-origin navigation, and `addInitScript`
 *     re-installs the listener on every new document, so both a client-side
 *     transition and a hard navigation are covered.
 *  3. The journey starts at `/overview` and clicks, the way a person arrives.
 *     Every existing spec reaches `/settings/data` with `page.goto`, which is
 *     why the click path had never been counted.
 *
 * A storage failure reads back as zero, which fails the floor rather than
 * passing it — the safe direction for an assertion about a destructive path.
 */
const REGISTER = JSON.parse(fs.readFileSync("docs/route-register.json", "utf8")) as {
  navigationContract: {
    taskDepthActions: {
      countedEvents: string[];
      ceilings: Record<string, number>;
      floors: Record<string, number>;
      requirements: Record<string, string[]>;
    };
    settingsDataReachability: { fromAnyAuthenticatedPageMaxActions: number };
  };
};
const CONTRACT = REGISTER.navigationContract.taskDepthActions;
const REACHABILITY = REGISTER.navigationContract.settingsDataReachability;
const COUNTER_KEY = "__inheritCountedActions";

const USER = { email: `task-depth-${randomUUID()}@e2e.local`, password: "e2e-task-depth-pw" };
/**
 * T4 gets its own account. The T8 journey below ends by deleting one, and
 * Playwright runs a file's tests in declaration order, so sharing would make
 * T4 depend on staying first forever.
 */
const INVITER = { email: `task-depth-t4-${randomUUID()}@e2e.local`, password: "e2e-task-depth-pw" };
const READER = { email: `task-depth-t2-${randomUUID()}@e2e.local`, password: "e2e-task-depth-pw" };
const ESTIMATES = { email: `task-depth-t1-${randomUUID()}@e2e.local`, password: "e2e-task-depth-pw" };
const VARIANTS = { email: `task-depth-t3-${randomUUID()}@e2e.local`, password: "e2e-task-depth-pw" };

/**
 * Both report journeys upload a GRCh38 VCF carrying the exact bound position,
 * and the first attempt did not.
 *
 * It used `data/samples/synthetic_23andme.txt`, which looks like the obvious
 * array fixture and cannot be prepared. Measured after CI refused it: the file
 * parses perfectly — 2135 records, 0 skipped, build read as GRCh37 from its own
 * header — and then **850 of those 2135 positions fail to lift to GRCh38, a
 * 39.8% loss** against the 0.05 `maximumUnmappedFraction` that
 * `policyContracts.genome-liftover-v1` sets. So normalization refuses with
 * `liftover_loss` and `/api/files/[id]/process` answers 422. That is the
 * contract working, not a fault: the generator invents most of its GRCh37
 * coordinates, and the chain has nothing to map them onto. Every array upload
 * that does pass in this suite declares build 38 and is never lifted.
 *
 * Recorded here rather than silently swapped, so the next reading does not
 * spend a session on an array fixture that the prepared path is right to
 * reject.
 */
/** Covers rs7903146, the TCF7L2 position T1's report is about. */
const ESTIMATES_FIXTURE = "e2e/fixtures/density-source-grch38.vcf";
/** The 168-marker synthetic panel, describing no real person. */
const AIMS_FIXTURE = "e2e/fixtures/aims-mixed-grch38.vcf";

/**
 * T3's file, and the second correction of it.
 *
 * The first correction reached for `medicines-grch38.vcf` on the strength of
 * its name. Measured afterwards, before CI had to say so: that file carries
 * all ELEVEN bound positions, one line each, and so does
 * `density-source-grch38.vcf` — they are this suite's two "everything is
 * covered" panels. Either would have inverted T3, whose entire subject is a
 * position the file does NOT carry, and the test would have gone green while
 * measuring the opposite task.
 *
 * The binding already held the answer and was not read.
 * `scripts/comprehension/bindings.json` names two fixtures for T3 and records
 * all eleven rsIDs `covered: false` against both; one of them is the AIMS
 * panel above, which prepares. So T3 now reads the bound fixture instead of a
 * guessed one, checked two ways — by rsID and by (chromosome, GRCh38
 * position), because an rsID-less line at the right coordinate would cover
 * the report just the same. Zero of eleven on either reading.
 */
const VARIANTS_FIXTURE = AIMS_FIXTURE;

/**
 * The labels this surface is allowed to print, from the release itself.
 *
 * The first attempt read `data/ref/regions/regions.json` and CI named the
 * mistake: that file is the FIVE-region panel, and the ancestry surface ships
 * the seven-region one. The three labels it rejected — `Africa`, `East Asia`
 * and `Europe, Middle East / North Africa, and Central–South Asia` — were all
 * legitimate, the first two from `regions-v3.json` and the third the combined
 * label the ancestry decision requires when the Europe, Middle East / North
 * Africa and Central–South Asia shares are too close to separate.
 *
 * So the allowed set is the seven shipped `display_name`s PLUS that one
 * combined name, read from the product's own constant rather than retyped.
 * This is a wider set than the first attempt asserted and a strictly correct
 * one: a label from neither source still fails.
 */
const REGION_LABELS: string[] = [
  ...(
    JSON.parse(fs.readFileSync("data/ref/regions/regions-v3.json", "utf8")) as {
      regions: { display_name: string }[];
    }
  ).regions.map((region) => region.display_name),
  REGIONAL_COMBINED_NAME,
];

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
  await createConfirmedUser(INVITER.email, INVITER.password);
  await createConfirmedUser(READER.email, READER.password);
  await createConfirmedUser(ESTIMATES.email, ESTIMATES.password);
  await createConfirmedUser(VARIANTS.email, VARIANTS.password);
});

/** Installs the counter on this document and on every one that follows it. */
async function startCounting(page: Page): Promise<void> {
  const install = (args: { events: string[]; key: string }) => {
    const bump = () => {
      try {
        const seen = Number(window.sessionStorage.getItem(args.key) ?? "0");
        window.sessionStorage.setItem(args.key, String(seen + 1));
      } catch {
        // A browser refusing storage leaves the count at zero, which fails the
        // floor below rather than passing it.
      }
    };
    for (const name of args.events) window.addEventListener(name, bump, true);
  };
  const args = { events: [...CONTRACT.countedEvents], key: COUNTER_KEY };
  await page.evaluate((one) => window.sessionStorage.setItem(one.key, "0"), args);
  await page.addInitScript(install, args);
  await page.evaluate(install, args);
}

async function countedActions(page: Page): Promise<number> {
  const raw = await page.evaluate((key) => window.sessionStorage.getItem(key), COUNTER_KEY);
  return Number(raw ?? "0");
}

/**
 * T1 — "find what your DNA file says about your chance of type 2 diabetes."
 *
 * Ceiling 3, path 2: the Overview entry box straight to the report library,
 * then the report. Going by the primary navigation instead would cost three
 * and sit exactly on the ceiling, which is worth knowing and is not what a
 * participant starting at Overview would do.
 *
 * WHICH PURPOSE, read rather than guessed. The three bound slugs live in
 * `data/templates/metabolic-obesity.json` and carry no `layer`, and a template
 * without one is an `estimate` (`scripts/seed.ts`). The reports page maps layer
 * to purpose in one line — `variant_call` to `reports.monogenic`, everything
 * else to `reports.polygenic` — so this account grants the polygenic purpose
 * and nothing else.
 *
 * WHAT KEEPS THE PATH AT TWO, and it is not that grant — the first attempt
 * said it was, and CI disproved it. Measured from the page itself: on your
 * OWN record the report list sets `allowedLayers` to every layer
 * unconditionally, because `grantedLayers()` is consulted only for a
 * relative's record. So the group tabs render whenever the published library
 * holds templates in both layers, which it always does (eleven
 * `variant_call`, every other template an `estimate`), and they are on this
 * page for every account that ever opens it. A purpose you have not granted
 * withholds the RESULTS inside a layer; it does not remove the layer.
 *
 * T1 crosses no tab for a different and weaker reason: with no `?layer=` in
 * the URL, `activeLayer` resolves to `estimate` ahead of the taxonomy order,
 * and all three bound slugs are estimates. That is a default, not a
 * structural guarantee, which is why the assertion below pins the current
 * group rather than the absence of the tabs.
 *
 * The binding names three type 2 diabetes slugs rather than one, on purpose:
 * all three are covered by this fixture, and grading on which one a
 * participant happened to open would grade navigation luck. Reaching any of
 * them is the success condition, so this reaches the first.
 */
test("task depth T1 costs two counted actions, inside its registered ceiling", async ({
  page,
}) => {
  expect(CONTRACT.countedEvents, "the events this instrument listens for").toEqual(["click", "submit"]);
  const ceiling = CONTRACT.ceilings.T1;
  expect(ceiling, "T1 carries a ceiling").toBeGreaterThan(0);
  expect(CONTRACT.floors.T1, "T1 carries no floor").toBeUndefined();

  await signIn(page, ESTIMATES.email, ESTIMATES.password);
  const fileId = await uploadOwnFilePrepared(page, path.join(process.cwd(), ESTIMATES_FIXTURE), {
    fileType: "vcf",
  });
  await generateOwnFileWithChosenReports(page, fileId, ["reports.polygenic"]);

  await page.goto("/overview");
  await expect(page.locator("main h1")).toBeVisible();

  // None of the setup above is the task, so counting starts here.
  await startCounting(page);

  // 1. The Overview entry box. Its accessible name is the box label, through
  // aria-labelledby, and its href is the report library.
  await page.getByRole("link", { name: "Reports", exact: true }).first().click();
  await page.waitForURL((url) => url.pathname === "/genome/me/reports");

  // The group tabs ARE here, for the reason the note above gives, and T1
  // crosses none of them because the library opens on the group its three
  // bound slugs live in. Pinning which group is current — rather than
  // asserting that no tabs exist — is what keeps the 2 below a measurement:
  // if that default ever moves, this fails first and names why.
  const groups = page.getByRole("navigation", { name: "Report groups" });
  await expect(groups, "both layers are published, so the tabs render").toHaveCount(1);
  await expect(
    groups.getByRole("link", { name: LAYER_LABELS.estimate, exact: true }),
    "the library opens on the estimate group, so T1 crosses no tab",
  ).toHaveAttribute("aria-current", "page");

  // 2. The report itself. A card link's accessible name is its title and its
  // evidence label, so the title is matched at the start.
  await page.getByRole("link", { name: /^Type 2 diabetes · TCF7L2,/ }).click();
  await page.waitForURL((url) => /^\/genome\/me\/reports\/type-2-diabetes-/.test(url.pathname));
  await expect(page.locator("main h1")).toBeVisible();

  const spent = await countedActions(page);
  expect(spent, `T1 must not cost more than ${ceiling} actions`).toBeLessThanOrEqual(ceiling);
  expect(spent, "the measured depth of the shipped path").toBe(2);
});

/**
 * T3 — "find something Inherit could not check in your file, and say what that
 * means."
 *
 * Ceiling 3, and the shipped path costs **3**: the Overview entry box, the
 * group tab, then the report. That is ON the ceiling, not inside it, and
 * recording it is the point of measuring at all. The first attempt asserted 2
 * on reasoning that turned out to be wrong; CI measured the product instead,
 * and the product's number is what stands here.
 *
 * The fixture is half the task: the eleven bound slugs are one-position
 * pharmacogenomic reports and NONE of their positions is in this file — see
 * `VARIANTS_FIXTURE` above for how that was established, and for the fixture
 * this test reached for first, which covered all eleven. The task is not to
 * find a result, it is to find the absence of one and understand it, so a
 * fixture that covered them would destroy it.
 *
 * `vkorc1-rs9923231-one-position` carries `layer: "variant_call"` explicitly,
 * which by the same one-line mapping is the `reports.monogenic` purpose — the
 * mirror of T1 and the reason these two are measured together. It is also
 * exactly why T3 costs one action more than T1: the library opens on the
 * `estimate` group for every account, a `variant_call` report is not in that
 * group, and the tab has to be crossed to reach one.
 *
 * THERE IS NO CHEAPER PATH, and that was checked rather than assumed. The
 * grant does not remove the tabs (T1's note says why). None of Overview's
 * nine entry boxes carries a `?layer=`, so none lands in the right group.
 * And the starter reading list cannot short-cut it from Overview either, on
 * two independent grounds: it takes only COVERED reports, and a not-covered
 * report is the whole premise here; and ADR 0021 bars the Medicines category
 * from that list outright, so no one-position report can appear in it even
 * when a file does cover one.
 *
 * So every one-position report on this surface sits three actions deep
 * against a ceiling of three. It passes, with no margin at all: one more
 * step anywhere on that path — a consent interstitial, a reveal gate if any
 * of these templates ever earns one, a "Show all" boundary if Medicines ever
 * exceeds twelve cards — puts the shipped product over its own registered
 * ceiling. Neither of the two gates that could already do that is armed
 * today: `isGatedTemplate` is false for all eleven (the category is not one
 * of the three gated ones and no interpretation text asks for clinical
 * confirmation), and eleven cards is under the twelve-card boundary.
 */
test("task depth T3 costs three counted actions, exactly its registered ceiling", async ({
  page,
}) => {
  const ceiling = CONTRACT.ceilings.T3;
  expect(ceiling, "T3 carries a ceiling").toBeGreaterThan(0);
  expect(CONTRACT.floors.T3, "T3 carries no floor").toBeUndefined();

  await signIn(page, VARIANTS.email, VARIANTS.password);
  const fileId = await uploadOwnFilePrepared(page, path.join(process.cwd(), VARIANTS_FIXTURE), {
    fileType: "vcf",
  });
  await generateOwnFileWithChosenReports(page, fileId, ["reports.monogenic"]);

  await page.goto("/overview");
  await expect(page.locator("main h1")).toBeVisible();

  await startCounting(page);

  // 1. The same Overview entry box.
  await page.getByRole("link", { name: "Reports", exact: true }).first().click();
  await page.waitForURL((url) => url.pathname === "/genome/me/reports");

  // 2. The group tab, and the reason T3 is not T1. The library opened on the
  // estimate group — asserted, not assumed — and no one-position report is in
  // it, so this action cannot be avoided from here.
  const groups = page.getByRole("navigation", { name: "Report groups" });
  await expect(
    groups.getByRole("link", { name: LAYER_LABELS.estimate, exact: true }),
    "the library opens on the estimate group, which holds no one-position report",
  ).toHaveAttribute("aria-current", "page");
  await groups.getByRole("link", { name: LAYER_LABELS.variant_call, exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/genome/me/reports"
    && url.searchParams.get("layer") === "variant_call");

  // 3. A one-position report whose position this file does not carry.
  await page.getByRole("link", { name: /^Warfarin, one position · VKORC1,/ }).click();
  await page.waitForURL((url) => url.pathname === "/genome/me/reports/vkorc1-rs9923231-one-position");
  await expect(page.locator("main h1")).toBeVisible();

  // The task's success condition, and the guard on the fixture mistake this
  // test already made once: T3 is supposed to arrive at an ABSENCE. A file
  // that covered this position would leave the journey three actions long
  // and measuring a different task entirely, so the state is asserted here
  // rather than inferred from the fixture's name.
  await expect(
    page.locator('[data-outcome="not-covered"]').first(),
    "T3 is a not-covered task and this is the state it must land in",
  ).toBeVisible();

  const spent = await countedActions(page);
  expect(spent, `T3 must not cost more than ${ceiling} actions`).toBeLessThanOrEqual(ceiling);
  // Three: on the ceiling, not inside it. The measurement, not a target.
  expect(spent, "the measured depth of the shipped path").toBe(3);
});

/**
 * T2 — "find where your ancestors came from and name one specific region."
 *
 * Ceiling 3, and the shipped path costs 2: the primary navigation to My
 * Genome, then the Ancestry card. No floor, and none is wanted — nothing about
 * reading your own result should be made deliberately hard.
 *
 * What the participant has to be able to say is a REGION LABEL, and which
 * labels exist is not this file's opinion. `data/ref/regions/regions.json` is
 * the release, and the five `display_name`s are read out of it at run time.
 * That matters more here than anywhere else on this surface: four of the five
 * 1000 Genomes superpopulation names a reader might expect — African, Admixed
 * American, East Asian, South Asian — are on
 * `data/ref/regions/label-denylist.json`, which the product enforces precisely
 * so it never prints a demonym. A test that asserted one of those would be
 * demanding the product fail its own rule.
 *
 * Setting the account up is three real steps and none of them is the task:
 * a consented upload, the preparation that follows it, and the SEPARATE
 * explicit ancestry choice, because a prepared file does not by itself produce
 * an ancestry result and no annotated flag may stand in for that journal.
 * Counting starts after all of it, back at /overview, where a participant
 * would begin.
 */
test("task depth T2 costs two counted actions, inside its registered ceiling", async ({
  page,
}) => {
  expect(CONTRACT.countedEvents, "the events this instrument listens for").toEqual(["click", "submit"]);
  const ceiling = CONTRACT.ceilings.T2;
  expect(ceiling, "T2 carries a ceiling").toBeGreaterThan(0);
  expect(CONTRACT.floors.T2, "T2 carries no floor").toBeUndefined();
  expect(REGION_LABELS, "the seven shipped regions plus the combined label").toHaveLength(8);

  await signIn(page, READER.email, READER.password);
  const fileId = await uploadOwnFilePrepared(page, path.join(process.cwd(), AIMS_FIXTURE), {
    fileType: "vcf",
  });
  await generateOwnFileWithChosenReports(page, fileId, ["ancestry"]);

  await page.goto("/overview");
  await expect(page.locator("main h1")).toBeVisible();

  // None of the setup above is the task, so counting starts here.
  await startCounting(page);

  // 1. My Genome, from the primary navigation.
  await page
    .getByRole("navigation", { name: NAV_LANDMARK_LABEL })
    .getByRole("link", { name: NAV_LABELS["my-genome"], exact: true })
    .click();
  await page.waitForURL((url) => url.pathname === "/genome/me");

  // 2. The ancestry card. Its link text is "Open " plus the card title, which
  // is how every card on that page is built.
  await page.getByRole("link", { name: "Open Ancestry", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/genome/me/ancestry");

  // The answer is on the page, and it is one of the release's own five labels.
  const named = page.locator('[data-slot="region-row"]:not([hidden]) [data-slot="region-name"]');
  await expect(named.first()).toBeVisible();
  const shown = await named.allInnerTexts();
  expect(shown.length, "a region the participant could name").toBeGreaterThan(0);
  expect(
    shown.filter((label) => !REGION_LABELS.includes(label.trim())),
    "every rendered region label comes from regions-v3.json or the combined name",
  ).toEqual([]);

  const spent = await countedActions(page);
  expect(spent, `T2 must not cost more than ${ceiling} actions`).toBeLessThanOrEqual(ceiling);
  // Recorded because the measurement is the point: one action of headroom.
  expect(spent, "the measured depth of the shipped path").toBe(2);
});

/**
 * T4 — "you have a friend's DNA file and their written permission; may you
 * upload it, and what does Inherit ask you to do first?"
 *
 * The opposite shape to T8 below. T8's number matters because it must not get
 * smaller; this one matters because a person asking whether they may use
 * someone else's genome must not have to hunt for the answer. Its ceiling is
 * 6 and it carries no floor, which is the register saying the same thing.
 *
 * The answer is not a paragraph this test paraphrases. It is two strings the
 * product already renders, imported rather than transcribed so a copy change
 * moves the assertion with it: the Path A body ("You never touch their file")
 * and the attestation the inviter must tick, which says in the first person
 * that the invitation gives them no right to upload, analyse or read the other
 * person's genetic data. Together those are exactly T4's success condition.
 *
 * The prompt's premise is also refused, and that is worth measuring rather
 * than assuming: "upload it with their written permission" is Path B, and
 * `PATH_B_AVAILABLE` is false, so its link is not rendered at all. A
 * participant cannot find a way to do the thing the prompt describes, because
 * the product does not have one.
 *
 * Like T8, this walks the click path. Every existing spec reaches
 * `/family/invite` with `page.goto`, so the cost of arriving had never been
 * counted for this task either.
 */
test("task depth T4 costs two counted actions, well inside its registered ceiling", async ({
  page,
}) => {
  expect(CONTRACT.countedEvents, "the events this instrument listens for").toEqual(["click", "submit"]);
  const ceiling = CONTRACT.ceilings.T4;
  expect(ceiling, "T4 carries a ceiling").toBeGreaterThan(0);
  // Stated rather than assumed: a floor here would mean the register wanted
  // this answer to be hard to reach, and it does not.
  expect(CONTRACT.floors.T4, "T4 carries no floor").toBeUndefined();

  await signIn(page, INVITER.email, INVITER.password);
  await page.goto("/overview");
  await expect(page.locator("main h1")).toBeVisible();

  // Signing in is not part of the task, so counting starts here.
  await startCounting(page);

  // 1. Family, from the primary navigation.
  await page
    .getByRole("navigation", { name: NAV_LANDMARK_LABEL })
    .getByRole("link", { name: NAV_LABELS.family, exact: true })
    .click();
  await page.waitForURL((url) => url.pathname === "/family");

  // 2. The invitation, from the hub. That control renders whether or not the
  // account has anyone yet — it sits outside the people-list branch — which is
  // what keeps this two actions for a participant who has just arrived.
  await page.getByRole("link", { name: ADD_ANOTHER_ADULT_BUTTON }).click();
  await page.waitForURL((url) => url.pathname === "/family/invite");
  await expect(page.getByRole("heading", { level: 1, name: INVITE_H1 })).toBeVisible();

  // The answer, in the product's own words rather than this file's.
  await expect(page.getByText(INVITE_THEM_BODY)).toBeVisible();
  await expect(page.getByText(ATTESTATION_LABEL)).toBeVisible();

  // The premise refused: there is no "upload it yourself" path to find.
  expect(PATH_B_AVAILABLE, "Path B is not built, so its link must not render").toBe(false);
  await expect(page.getByText(PATH_B_LINK)).toHaveCount(0);

  const spent = await countedActions(page);
  expect(spent, `T4 must not cost more than ${ceiling} actions`).toBeLessThanOrEqual(ceiling);
  // Recorded because the measurement is the point: four actions of headroom
  // against the ceiling, and the answer is two clicks from Overview.
  expect(spent, "the measured depth of the shipped path").toBe(2);
});

test("task depth T8 costs three counted actions, which is exactly its registered floor", async ({
  page,
}) => {
  // The contract must be the one this test thinks it is. A register edit that
  // removed the floor would otherwise leave this test passing vacuously.
  expect(CONTRACT.countedEvents, "the events this instrument listens for").toEqual(["click", "submit"]);
  expect(CONTRACT.requirements.T8).toContain("typed-confirmation");
  const floor = CONTRACT.floors.T8;
  const ceiling = CONTRACT.ceilings.T8;
  expect(floor).toBeGreaterThan(0);
  expect(ceiling).toBeGreaterThanOrEqual(floor);

  await signIn(page, USER.email, USER.password);
  await page.goto("/overview");
  await expect(page.locator("main h1")).toBeVisible();

  // Setting the account up is not part of the task, so counting starts here.
  await startCounting(page);

  // 1. Settings, from the primary navigation.
  await page.getByRole("navigation", { name: "App" }).getByRole("link", { name: "Settings" }).click();
  await page.waitForURL((url) => url.pathname === "/settings");

  // 2. Data, from the settings section navigation. Scoped to that landmark
  // because the same page also carries a "Data and methods" expert-path link.
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: /^Data\b/ })
    .click();
  await page.waitForURL((url) => url.pathname === "/settings/data");

  // The register's other unread reachability clause, measured on the way past:
  // `/settings/data` must be two actions from any authenticated page.
  expect(
    await countedActions(page),
    "actions spent reaching /settings/data from /overview",
  ).toBeLessThanOrEqual(REACHABILITY.fromAnyAuthenticatedPageMaxActions);

  // The floor is only real if the short path is refused, so this asserts that
  // the typed confirmation is what refuses it.
  //
  // Asserting `toBeDisabled()` first would prove nothing: `danger-zone.tsx`
  // also disables the control while its deletion state is still loading
  // (`disabled={confirm !== "delete my genome" || busy || !state}`, and
  // `state` starts null behind a fetch), so a disabled control early in the
  // page's life says only that the fetch had not landed. Typing first and
  // waiting for `toBeEnabled()` establishes that the state HAS arrived; only
  // then does clearing the field and watching it refuse again attribute the
  // refusal to the missing phrase and nothing else.
  //
  // None of this moves the count: a fill dispatches neither `click` nor
  // `submit`, which is why the typed confirmation is a requirement in the
  // register rather than one of the actions it counts.
  const destroy = page.getByTestId("delete-account");
  const confirmation = page.getByLabel(/Type/);
  await confirmation.fill("delete my genome");
  await expect(destroy, "with the typed confirmation, once the state has loaded").toBeEnabled();
  await confirmation.fill("");
  await expect(destroy, "the same control with the confirmation cleared").toBeDisabled();
  await confirmation.fill("delete my genome");
  await expect(destroy, "the destructive control after the typed confirmation").toBeEnabled();

  // 3. The destructive action itself.
  await destroy.click();
  await expect(page.getByRole("heading", { name: "Account deletion scheduled" })).toBeVisible();

  const spent = await countedActions(page);
  expect(spent, `T8 must not be reachable in fewer than ${floor} actions`).toBeGreaterThanOrEqual(floor);
  expect(spent, `T8 must not cost more than ${ceiling} actions`).toBeLessThanOrEqual(ceiling);
  // Recorded because the measurement is the point: the shipped path sits on
  // the floor with no margin, so removing one step would breach it.
  expect(spent, "the measured depth of the shipped path").toBe(3);
});
