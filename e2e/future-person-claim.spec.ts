import { type BrowserContext, type Page } from "@playwright/test";
import { randomBytes, randomInt } from "node:crypto";
import { expect, test } from "./audited-test";

/**
 * `/future-person/claim` where claims are open: the TEST-LOCAL deployment,
 * the only one on which an embryo record, and so a claim, can exist. The
 * closed page every other deployment serves is proven in
 * `e2e/future-person-claim.nojurisdiction.spec.ts`.
 *
 * WHAT IS PINNED. The register's pre-form content (the refusal standard and
 * the keyless no-guess rule) renders before the first control; the form asks
 * for what `closed-future-person-claim-intake-v1` lists and nothing else, with
 * no document upload, because that step is not built; and every kind of
 * claim gets one answer, so the page cannot tell anyone whether a record
 * exists.
 *
 * WHY EACH TEST HAS ITS OWN NETWORK AND ITS OWN KEY. The start is limited in
 * the database per source network (three live starts, ten in 15 minutes) and
 * per key or contact (one live start). Every browser test comes from the same
 * machine, so each context sends its own address from the IPv6 documentation
 * range, a /64 of its own, and types a key and contact made for this run.
 * `next start` takes the client address from that header exactly as a
 * self-hosted reverse proxy must set it. Nothing here resets a limit.
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function freshKey(): string {
  return Array.from({ length: 20 }, () => CROCKFORD[randomInt(CROCKFORD.length)]).join("");
}

async function ownNetwork(context: BrowserContext): Promise<void> {
  const block = randomBytes(4).toString("hex");
  await context.setExtraHTTPHeaders({ "x-real-ip": `2001:db8:${block.slice(0, 4)}:${block.slice(4)}::1` });
}

type Mode = "record-key" | "claimant-recovery-key" | "keyless-start";
const MODE_LABELS: Record<Mode, string> = {
  "record-key": "I have a Record Key",
  "claimant-recovery-key": "I have a Recovery Key",
  "keyless-start": "I have no key",
};

async function fillClaim(page: Page, mode: Mode): Promise<void> {
  const form = page.locator("main form");
  await form.getByRole("radio", { name: MODE_LABELS[mode], exact: true }).check();
  if (mode === "record-key") await form.getByLabel("Record Key", { exact: true }).fill(freshKey());
  if (mode === "claimant-recovery-key") await form.getByLabel("Recovery Key", { exact: true }).fill(freshKey());
  await form.getByLabel("Your full name").fill("Synthetic Claimant");
  await form.getByLabel("Your date of birth").fill("2000-01-31");
  if (mode === "keyless-start") {
    await form.getByLabel("Where you were born").fill("Synthetic Town");
    await form.getByLabel("The name of each parent").fill("Parent One\nParent Two");
  }
  await form.getByLabel("Your email address").fill(`claim-${randomBytes(6).toString("hex")}@e2e.local`);
  await form.getByRole("checkbox").check();
}

test("/future-person/claim complete: the refusal standard comes before the first control, and the form asks only for what the register lists", async ({ page, context }) => {
  await context.clearCookies();
  const response = await page.goto("/future-person/claim");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toBe("private, no-store");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");

  const main = page.locator("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Claim a record created before you were born");
  await expect(main.getByRole("heading", { name: "When we refuse a claim" })).toBeVisible();
  await expect(main.getByText("We release a record only to the adult it was made from.", { exact: false })).toBeVisible();
  await expect(main.getByText("If no parent did, a claim without the Record Key Card cannot be matched to a record.", { exact: false })).toBeVisible();
  await expect(main.getByText("we cannot tell which record is yours, and we will not guess", { exact: false })).toBeVisible();
  await expect(main.getByText("we delete what you sent within 24 hours", { exact: false })).toBeVisible();

  // policy.preFormContent.ordering: every one of the four strings precedes
  // the first control in document order, not merely on screen.
  const ordered = await page.evaluate(() => {
    const first = document.querySelector("main input, main select, main textarea, main button");
    const section = document.querySelector("main section[aria-labelledby='refusal-standard']");
    if (!first || !section) return false;
    return Boolean(section.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING)
      && !section.contains(first);
  });
  expect(ordered, "the refusal standard renders before the first form control").toBe(true);

  // The form pair, and nothing that names a claim yet.
  const cookies = await context.cookies();
  expect(cookies.map((cookie) => cookie.name)).toEqual([expect.stringMatching(/^(__Host-)?inherit-claim-form$/)]);
  expect(cookies[0]).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });

  // What the form collects, mode by mode, and never a file.
  const form = main.locator("form");
  await expect(form.getByRole("radio")).toHaveCount(3);
  await expect(main.locator("input[type=file]"), "the document step is not built, so nothing uploads").toHaveCount(0);
  const fieldNames = () => form.locator("input:not([type=radio]), textarea, select")
    .evaluateAll((fields) => fields.map((field) => (field as HTMLInputElement).name).sort());
  expect(await fieldNames()).toEqual(["affirmed", "claimantName", "contactEmail", "dateOfBirth", "recordKey"]);
  await form.getByRole("radio", { name: MODE_LABELS["claimant-recovery-key"], exact: true }).check();
  expect(await fieldNames()).toEqual(["affirmed", "claimantName", "contactEmail", "dateOfBirth", "recoveryKey"]);
  await form.getByRole("radio", { name: MODE_LABELS["keyless-start"], exact: true }).check();
  expect(await fieldNames()).toEqual(["affirmed", "childPlaceOfBirth", "claimantName", "contactEmail", "dateOfBirth", "parentNames"]);
  await expect(form.getByRole("button", { name: "Start my claim", exact: true })).toBeEnabled();
});

test("/future-person/claim processing: the start control says it is sending while the claim is in flight, and cannot be pressed twice", async ({ page, context }) => {
  await ownNetwork(context);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let intercepted = 0;
  await page.route("**/api/future-person/claim", async (route) => {
    intercepted += 1;
    await held;
    await route.continue();
  });

  await page.goto("/future-person/claim");
  // Next.js prefetches the page it is showing, and that render passes through
  // the proxy too. It must keep the form cookie the served token is bound to,
  // or the claim fails as an expired page (found by this test, 2026-09-28).
  const formCookie = async () => (await context.cookies()).find((cookie) => /^(__Host-)?inherit-claim-form$/.test(cookie.name))?.value;
  const served = await formCookie();
  await page.evaluate(() => fetch("/future-person/claim", { headers: { rsc: "1", "next-router-prefetch": "1" } }));
  expect(await formCookie(), "a prefetch keeps the form cookie").toBe(served);
  await fillClaim(page, "record-key");
  const form = page.locator("main form");
  await form.getByRole("button", { name: "Start my claim", exact: true }).click();

  const sending = form.getByRole("button", { name: "Working…", exact: true });
  await expect(sending).toBeVisible();
  await expect(sending).toBeDisabled();
  await expect(form.getByRole("button", { name: "Start my claim", exact: true })).toHaveCount(0);
  // Nothing has been decided, so nothing is said yet. Scoped to the page's
  // own content: Next.js keeps a route announcer with role="alert" outside it.
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "We have your request" })).toHaveCount(0);
  expect(intercepted).toBe(1);

  const answered = page.waitForResponse("**/api/future-person/claim");
  release();
  expect((await answered).status()).toBe(202);
  await expect(page.getByRole("heading", { name: "We have your request" })).toBeVisible();
  expect(intercepted, "one press, one request").toBe(1);
});

test("/future-person/claim complete: a Record Key, a Recovery Key and a keyless claim all get the same answer", async ({ browser }) => {
  const answers: { status: number; body: string; cookieNames: string[]; panel: string }[] = [];
  for (const mode of ["record-key", "claimant-recovery-key", "keyless-start"] as const) {
    const context = await browser.newContext();
    try {
      await ownNetwork(context);
      const page = await context.newPage();
      await page.goto("/future-person/claim");
      await fillClaim(page, mode);
      const answered = page.waitForResponse("**/api/future-person/claim");
      await page.locator("main form").getByRole("button", { name: "Start my claim", exact: true }).click();
      const response = await answered;
      const panel = page.getByRole("status");
      await expect(panel.getByRole("heading", { name: "We have your request" })).toBeVisible();
      const setCookies = (await response.headersArray()).filter((header) => header.name.toLowerCase() === "set-cookie");
      answers.push({
        status: response.status(),
        body: await response.text(),
        cookieNames: setCookies.map((header) => header.value.slice(0, header.value.indexOf("="))),
        panel: (await panel.innerText()).trim(),
      });
      // The claim session is HttpOnly: no script on the page can read it.
      const session = (await context.cookies()).find((cookie) => /^(__Host-)?inherit-claim$/.test(cookie.name));
      expect(session).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });
      expect(await page.evaluate(() => document.cookie)).toBe("");
    } finally {
      await context.close();
    }
  }
  expect(answers[0]).toMatchObject({ status: 202, body: '{"status":"received"}' });
  expect(answers[1]).toEqual(answers[0]);
  expect(answers[2]).toEqual(answers[0]);
});
