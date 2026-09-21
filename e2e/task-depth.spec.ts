import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { NAV_LABELS, NAV_LANDMARK_LABEL } from "@/copy/navigation";
import { ADD_ANOTHER_ADULT_BUTTON } from "@/copy/family";
import {
  ATTESTATION_LABEL,
  INVITE_H1,
  INVITE_THEM_BODY,
  PATH_B_AVAILABLE,
  PATH_B_LINK,
} from "@/copy/family/invite";
import { createConfirmedUser, signIn } from "./helpers";

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

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
  await createConfirmedUser(INVITER.email, INVITER.password);
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
