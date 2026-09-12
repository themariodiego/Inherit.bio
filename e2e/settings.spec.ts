import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createConfirmedUser, signIn } from "./helpers";

/**
 * Three account-management route states, driven on a fresh confirmed account
 * with nothing uploaded — which is what makes them cheap and what makes them
 * honest: none of the three depends on genetic data existing.
 *
 * Each was read before it was named, because the register applies the
 * `account-management` profile wholesale and declares six states on all five
 * settings routes. Most of those six are not reachable on most of those pages,
 * and claiming one that the page cannot occupy is precisely how this ratchet
 * gets faked. The three below are the ones the pages genuinely render.
 */
const USER = { email: `settings-${randomUUID()}@e2e.local`, password: "e2e-settings-pw" };

const SECTIONS = [
  { href: "/settings/data", title: "Data" },
  { href: "/settings/copilot", title: "Copilot" },
  { href: "/settings/people", title: "People" },
  { href: "/settings/consents", title: "Consents" },
] as const;

/**
 * The synthetic cloud endpoint. 203.0.114.10 is the address the browser
 * runtime already reserves for the synthetic model (`ci-browser-runtime.ts:70`)
 * — chosen there because `allowedModelAddress` blocks every documentation
 * range (192.0.2/24, 198.51.100/24, 203.0.113/24) and this one sits just
 * outside the last of them, so it classifies as a remote cloud recipient.
 * Nothing here connects to it; the consent gate refuses before any model step.
 */
const SYNTHETIC_CLOUD_ENDPOINT = "https://203.0.114.10:8123/v1";
/** The provider key `providerKeyFor` derives from that endpoint. */
const SYNTHETIC_PROVIDER_KEY = "203.0.114.10:8123";

/**
 * Saves a CLOUD provider through the real form. Extracted because three tests
 * need it and none of them is about the saving.
 */
async function saveSyntheticCloudProvider(page: Page) {
  await page.goto("/settings/copilot");
  await page.getByLabel("Provider", { exact: true }).click();
  await page.getByRole("option", { name: /OpenAI-compatible/ }).click();
  await page.getByLabel("Base URL").fill(SYNTHETIC_CLOUD_ENDPOINT);
  await page.getByLabel("Model", { exact: true }).fill("synthetic-model");
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect(page.getByText("Provider saved. Review the separate Copilot permission below.", { exact: true }))
    .toBeVisible();
}

/**
 * Walks the only path that writes a `consent_grants` row: ask one question,
 * meet the cloud consent gate, consent in the dialog it offers. See the header
 * above the processing test for why no shorter path exists.
 */
async function grantCloudModelConsent(page: Page) {
  await page.goto("/copilot/me");
  await page.getByLabel("Message the copilot").fill("What is my caffeine genotype?");
  const refused = page.waitForResponse(r => new URL(r.url()).pathname === "/api/chat");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const refusal = await refused;
  expect(refusal.status()).toBe(403);
  expect(await refusal.json()).toEqual({ error: "consent_required", provider_key: SYNTHETIC_PROVIDER_KEY });
  const review = page.getByRole("button", { name: "Review what would be shared", exact: true });
  await expect(review, "the cloud consent gate refused before any model step").toBeVisible();
  await review.click();
  const granted = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/consents" && response.request().method() === "POST");
  await page.getByTestId("consent-grant").click();
  expect((await granted).status()).toBe(200);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

/**
 * `/settings` has no data-dependent states: it renders the account's own
 * address, all four section tiles and the digest control on every visit. So
 * `complete` here means the router showing everything it has, and the
 * assertion is worth making because a section silently disappearing would
 * strand whatever it leads to — including the two rights surfaces.
 */
test("/settings complete: the account address, all four sections and the digest control", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/settings");

  await expect(page.locator("main h1")).toHaveText("Settings");
  // Scoped to `main`: the app shell also shows the address in its account
  // control, and this is an assertion about the page, not the chrome.
  await expect(page.locator("main").getByText(USER.email, { exact: true }),
    "the account's own address").toBeVisible();

  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await expect(nav.getByRole("link")).toHaveCount(SECTIONS.length);
  for (const section of SECTIONS) {
    await expect(nav.getByRole("link", { name: new RegExp(`^${section.title}\\b`) }))
      .toHaveAttribute("href", section.href);
  }
  // The expert-path entry point this page is one of three for (brief §7.3).
  await expect(page.getByRole("link", { name: "Data and methods" })).toBeVisible();
});

/**
 * `/settings processing`, and the state exists because this run built it.
 *
 * The digest switch awaited a `profiles` write and stayed live throughout, so
 * a reader flipping it had no sign anything was happening and could flip it
 * again mid-request. `digest-toggle.tsx` now holds a `busy` flag and disables
 * the control, which is what every comparable control in the product already
 * did and what the register already said this route had.
 *
 * Held open the same way `e2e/auth-processing.spec.ts` holds its four: the
 * write is intercepted and not released until the assertion has run, so the
 * product sits in a state it defines rather than a simulated one.
 */
test("/settings processing: the digest switch is held while its write is in flight", async ({ page }) => {
  await signIn(page, USER.email, USER.password);

  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let intercepted = 0;
  await page.route("**/rest/v1/profiles*", async (route) => {
    if (route.request().method() === "GET") { await route.continue(); return; }
    intercepted += 1;
    await held;
    await route.continue();
  });

  try {
    await page.goto("/settings");
    const digest = page.getByRole("switch");
    await expect(digest).toBeEnabled();
    await digest.click();
    await expect(digest).toBeDisabled();
    expect(intercepted, "the state is held by a real in-flight write").toBeGreaterThan(0);
  } finally {
    release();
  }
});

/**
 * `/settings/copilot processing`. `LlmSettingsForm` holds a `busy` flag
 * (`llm-settings-form.tsx:41`) and disables its submit while the POST to
 * `/api/llm/settings` is in flight. The label does NOT change here — unlike
 * the auth forms and the revoke control, this one only disables — so the
 * assertion is the disabled state alone, which is what stops a second save of
 * the same configuration.
 *
 * Held the same way as everywhere else in this suite: the request is
 * intercepted and released only after the assertion, so the product sits in a
 * state it defines. Only the POST is held; the page's own reads must complete
 * or the form never renders.
 */
test("/settings/copilot processing: the save control is held while the provider write is in flight", async ({ page }) => {
  await signIn(page, USER.email, USER.password);

  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let intercepted = 0;
  await page.route("**/api/llm/settings", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    intercepted += 1;
    await held;
    await route.continue();
  });

  try {
    await page.goto("/settings/copilot");
    const save = page.getByRole("button", { name: "Save provider", exact: true });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(save).toBeDisabled();
    expect(intercepted, "the state is held by a real in-flight write").toBeGreaterThan(0);
  } finally {
    release();
  }
});

/**
 * `/settings/data processing`, and this one schedules a real account deletion
 * — which is why it uses an account of its own rather than the shared USER
 * above, and why it is worth saying so plainly.
 *
 * The pending control is on the deletion request: `danger-zone.tsx:56` holds
 * `busy` and the button reads "Scheduling…" while the POST is in flight. There
 * is no non-destructive control on this page carrying that state, so the test
 * drives the destructive one on a throwaway account. That is the same thing
 * `e2e/account-deletion-purge.spec.ts:84` already does, and the product's own
 * answer is a seven-day notice period with a cancel path, not an immediate
 * purge.
 *
 * Only the POST is held. The page's GET must complete first or `requestDeletion`
 * returns early — it refuses to run while `state` is null.
 */
test("/settings/data processing: the deletion control says Scheduling while its request is in flight", async ({ page }) => {
  const email = `settings-data-processing-${randomUUID()}@e2e.local`;
  const password = "e2e-settings-data-processing-pw";
  await createConfirmedUser(email, password);
  await signIn(page, email, password);

  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let intercepted = 0;
  await page.route("**/api/account/delete", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    intercepted += 1;
    await held;
    await route.continue();
  });

  try {
    await page.goto("/settings/data");
    const schedule = page.getByTestId("delete-account");
    await expect(schedule).toBeDisabled();
    await page.getByLabel(/Type/).fill("delete my genome");
    await expect(schedule).toBeEnabled();
    await schedule.click();

    await expect(schedule).toBeDisabled();
    await expect(schedule).toHaveText("Scheduling…");
    expect(intercepted, "the state is held by a real in-flight request").toBeGreaterThan(0);
  } finally {
    release();
  }

  // Released, so the deletion really is scheduled. Asserted rather than left
  // implicit: this test performs a consequential action and should say what
  // the account was left in.
  await expect(page.getByRole("heading", { name: "Account deletion scheduled" })).toBeVisible();
});

/**
 * `/settings/consents` is a header, the grant list and a back link, so the
 * list is the page's whole substance and an empty list is the page's `empty`
 * state rather than one region of it having nothing to show. That distinction
 * is the one this repository keeps warning about, so it is stated here rather
 * than assumed: a page whose single panel is empty is only `empty` when that
 * panel is what the page is for.
 */
test("/settings/consents empty: a new account holds no grants, and the page says so", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/settings/consents");

  await expect(page.locator("main h1")).toHaveText("Consents");
  await expect(page.getByText("No cloud-LLM consent grants. None are needed for local models."))
    .toBeVisible();
  // Absence stated, not merely rendered as nothing.
  await expect(page.getByRole("button", { name: /revoke/i }), "no grant rows").toHaveCount(0);
});

/**
 * THIS TEST USED TO PROVE A LIE, and the way it did it is worth keeping.
 *
 * It was titled "/settings/people jurisdiction-unavailable: its only render
 * refuses on jurisdiction", which `scripts/route-gate.ts` counted as one of
 * the proven (route, state) pairs. The assertions all passed. The page really
 * did render "Not available in this jurisdiction yet" — because it returned
 * `<CapabilityUnavailable>` unconditionally, with no jurisdiction guard on the
 * route at all. The feature had simply never been built, and every visitor was
 * told a legal review was missing.
 *
 * The old comment here reasoned that naming the state was fair because this is
 * the page's only render and there was "no other state for it to stand in
 * for". That is true and beside the point: a route with no jurisdiction guard
 * cannot be in the jurisdiction-unavailable state, however few other states it
 * has. What the title certified was that a false sentence renders.
 *
 * So the pair is gone from `docs/route-divergence.json` (74 proven -> 73) and
 * `jurisdiction-unavailable` is gone from the `account-management` profile.
 * This title deliberately names NO (route, state) pair: the page's real state
 * is "not written yet", the register has no such state, and inventing a proof
 * for one is what got us here.
 */
test("the People settings page says it is not built, and blames no jurisdiction", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/settings/people");

  await expect(page.locator("main h1")).toHaveText("People and relationships");
  const notice = page.getByRole("status");
  await expect(notice).toContainText("Not built yet");
  await expect(notice, "it says what the page will do once it exists")
    .toContainText("list the people you share with");
  await expect(notice, "and names what is NOT the reason")
    .toContainText("No law and nothing about you is holding it back");
  // The regression this guards: the jurisdiction sentence must not come back
  // on a route that has no jurisdiction guard to justify it.
  await expect(page.getByText("Not available in this jurisdiction yet")).toHaveCount(0);
  await expect(notice.getByRole("link", { name: "Go back" })).toHaveAttribute("href", "/settings");
});

/**
 * `/settings/consents processing`, and the fixture is the whole story.
 *
 * A NOTE RECORDED EARLIER IN THIS RUN WAS WRONG and is corrected here rather
 * than quietly dropped. It said the row to revoke could be produced by
 * granting Copilot permission on `/settings/copilot`. It cannot: that control
 * writes `purpose_grants` (`grant_own_copilot_v1`), while this page lists
 * `consent_grants` (`consents/page.tsx:10`). They are different tables, and a
 * canonical Copilot grant never appears here.
 *
 * The one writer of `consent_grants` is `grant_cloud_model_consent`, reached
 * only through the legacy provider-key body of `POST /api/consents`, which
 * only `ConsentDialog` sends. So the fixture has to walk the path a reader
 * would:
 *
 *   1. save a CLOUD provider on `/settings/copilot`. The endpoint is an
 *      ADDRESS, not a name, and that is deliberate: `resolveModelEndpoint`
 *      skips DNS entirely for an IP literal, which is the only form that
 *      resolves in both environments this suite runs in. Locally the app
 *      server runs on the host, where `model.copilot.test` is unknown; in CI
 *      it runs inside a namespace whose OUTPUT policy DROPS all DNS
 *      (`scripts/ci-browser/namespace.sh`), where a public name is unknown.
 *      An OpenAI-compatible provider needs no key, and no model request is
 *      ever made: saving resolves the endpoint and stops there.
 *   2. ask one question on `/copilot/me`. The account has uploaded nothing, so
 *      `hasCanonicalCopilotScope` is false and the route serves the legacy
 *      panel; the cloud consent gate answers 403 `consent_required` before any
 *      provider, key or model step.
 *   3. consent in the dialog it offers. THAT is what writes the row.
 *
 * WHICH ALSO SETTLES A QUESTION LEFT OPEN. The empty-state copy above says
 * "No cloud-LLM consent grants. None are needed for local models", and it was
 * unclear whether a local grant could land in a list captioned that way. It
 * cannot: `api/chat/route.ts` consults and requires `consent_grants` only
 * inside its `if (!local)` branch, and nothing else inserts into that table.
 * The copy is accurate.
 *
 * AND STEP 2 DID NOT WORK, which is the more valuable half of this. Every
 * question the compatibility panel sent came back 400 `invalid_request`, and
 * the panel rendered "The copilot request failed. Check your provider
 * settings" — blaming the reader's configuration for a client/server contract
 * mismatch. `DefaultChatTransport` posts `{ id, messages, trigger }`; the
 * route's body schema was `z.object({ messages }).strict()`, so the two
 * envelope keys the SDK adds made every request unparseable. Nothing tested
 * that path, so nothing said. The schema now names the transport's own keys
 * and stays strict, and the assertion below is on the RESPONSE, not only on
 * the rendered button: a 400 produced the same generic failure, so asserting
 * the button alone would have re-proven the bug instead of catching it.
 *
 * The pending state itself was built earlier today — `consent-list.tsx:32`
 * holds the revoking row's id and the button reads "Working…" — and this is
 * the first time anything has driven it.
 */
test("/settings/consents processing: the revoke control says Working while its request is in flight", async ({ page }) => {
  const email = `settings-consents-processing-${randomUUID()}@e2e.local`;
  const password = "e2e-settings-consents-processing-pw";
  await createConfirmedUser(email, password);
  await signIn(page, email, password);

  // The grant this page needs a row for. Both steps assert the RESPONSE, not
  // only the rendered control: a 400 from the chat route produced the same
  // generic failure the panel shows for anything, so asserting the button
  // alone would have re-proven the bug this fixture found.
  await saveSyntheticCloudProvider(page);
  await grantCloudModelConsent(page);

  // Now the state under test: one revocable row, and its control held open.
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let intercepted = 0;
  await page.route("**/api/consents/*/revoke", async (route) => {
    intercepted += 1;
    await held;
    await route.continue();
  });

  try {
    await page.goto("/settings/consents");
    const revoke = page.getByRole("button", { name: "Revoke", exact: true });
    await expect(revoke).toHaveCount(1);
    await revoke.click();

    const working = page.getByRole("button", { name: "Working…", exact: true });
    await expect(working).toBeVisible();
    await expect(working).toBeDisabled();
    // Withdrawal is the one action on this page. Nothing may claim it is done
    // while the request that would do it is still in flight.
    await expect(page.getByRole("button", { name: "Revoke", exact: true })).toHaveCount(0);
    expect(intercepted, "the state is held by a real in-flight revocation").toBeGreaterThan(0);
  } finally {
    release();
  }

  // Released, so the withdrawal really happened. Stated rather than assumed:
  // this test's last act is a revocation and it should say what it left.
  await expect(page.getByText(/^revoked /)).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke", exact: true })).toHaveCount(0);
});

/**
 * `/settings/data complete`, on the reading already recorded for `/settings`:
 * this page has no data-dependent shape. It renders the export section and
 * the danger zone on every visit, for every account, so `complete` here means
 * the page showing everything it has.
 *
 * The assertion is worth making for one reason: this page is where both of
 * the reader's exit rights live. An export control or a deletion control
 * silently disappearing would strand a right, and nothing else would notice.
 * So the test names both, and names what the export claims to contain —
 * because that sentence is a promise about scope, and D-097 was about the two
 * export halves disagreeing.
 */
test("/settings/data complete: both exit rights render, and the export names what it contains", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/settings/data");

  await expect(page.locator("main h1")).toHaveText("Your data");

  const exportSection = page.locator("section").filter({ hasText: "Export everything" });
  await expect(exportSection.getByRole("link", { name: "Download export" }))
    .toHaveAttribute("href", "/api/export");
  // Each named class is a promise about the archive's scope, not decoration.
  for (const claimed of ["your uploads", "DNA variants we found", "results",
    "consent records", "legal audit records", "saved chats"]) {
    await expect(exportSection, `the export names ${claimed}`).toContainText(claimed);
  }

  // The second right. Held here rather than driven: e2e/settings.spec.ts
  // already schedules one real deletion above, and once is enough.
  await expect(page.getByTestId("delete-account")).toBeVisible();
  await expect(page.getByRole("link", { name: "← Settings" })).toHaveAttribute("href", "/settings");
});

/**
 * `/settings/consents complete`: the grant list with something in it, which
 * is this page's whole substance the way its empty list is its `empty` state.
 *
 * The fixture is the one described above the processing test — the only path
 * that writes a `consent_grants` row. What is asserted is every fact the row
 * carries, because each is a claim about a permission the reader gave: which
 * recipient, when, how many classes of data, and that it can still be taken
 * back.
 */
test("/settings/consents complete: the grant names its recipient, its date, its scope and its way out", async ({ page }) => {
  const email = `settings-consents-complete-${randomUUID()}@e2e.local`;
  const password = "e2e-settings-consents-complete-pw";
  await createConfirmedUser(email, password);
  await signIn(page, email, password);
  await saveSyntheticCloudProvider(page);
  await grantCloudModelConsent(page);

  await page.goto("/settings/consents");
  await expect(page.locator("main h1")).toHaveText("Consents");
  await expect(page.getByText("No cloud-LLM consent grants. None are needed for local models."))
    .toHaveCount(0);

  const row = page.getByRole("listitem");
  await expect(row).toHaveCount(1);
  await expect(row, "the recipient this permission names").toContainText(SYNTHETIC_PROVIDER_KEY);
  // A date, not THE date: the row formats it in the browser's locale and this
  // process need not share it. What matters is that a granted date is stated.
  await expect(row, "when it was given").toContainText(/Granted \d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}/);
  // Five is `LLM_DATA_CLASSES`, pinned as a number rather than a floor: a
  // class appearing or vanishing changes what the reader agreed to send.
  await expect(row, "how much it covers").toContainText("5 data classes");
  // Not yet withdrawn, and withdrawable: the row carries no revoked date and
  // does carry the control. Both halves, because a row that said "revoked"
  // and still offered the button would be lying one way or the other.
  await expect(row, "not already withdrawn").not.toContainText("revoked");
  await expect(row.getByRole("button", { name: "Revoke", exact: true })).toBeVisible();
});
