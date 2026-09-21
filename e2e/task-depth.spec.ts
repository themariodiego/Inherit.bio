import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
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

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
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

  // The floor is only real if the short path is refused. `danger-zone.tsx`
  // disables the control until the exact phrase is present, so two actions
  // cannot destroy anything — this asserts that rather than assuming it.
  const destroy = page.getByTestId("delete-account");
  await expect(destroy, "the destructive control before the typed confirmation").toBeDisabled();

  // The typed confirmation. It is a requirement, not a counted action: a fill
  // dispatches neither `click` nor `submit`.
  await page.getByLabel(/Type/).fill("delete my genome");
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
