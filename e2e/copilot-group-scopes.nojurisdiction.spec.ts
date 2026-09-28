import { randomUUID } from "node:crypto";
import { expect, test } from "./audited-test";
import { adminClient, createConfirmedUser, signIn } from "./helpers";
import { COPY_IDS, FAMILY_EMPTY_NOTE, FAMILY_SCOPE_LABEL } from "../src/copy/copilot/group-scopes";
import { HUB_TILES } from "../src/copy/family/index";

/**
 * The Family Copilot scope as hosted production serves it, since the owner
 * turned the scope on everywhere on 2026-09-28 (PR #260). This project's app
 * is the closest local stand-in for that deployment: the same build, with the
 * TEST-LOCAL flag unset and no same-host model attested, and an account in a
 * real jurisdiction (GB) where no Family capability is permitted.
 *
 * What is proven:
 *   - Overview's Family Copilot box opens `/copilot/family`, as the
 *     register's box contract names it, in one navigation;
 *   - that page is the register's closed unavailable page
 *     (`copilot-transport-availability-v1`, `true-non-self`), decided before
 *     the jurisdiction, the model settings or the group are read: no
 *     composer, no context, no member list, no empty-group note, no
 *     jurisdiction sentence, and nothing minted or stored for the account;
 *   - the chat and history endpoints serve nothing for the scope;
 *   - the Family hub's gates are unchanged: its tiles still state the
 *     jurisdiction refusal and link nowhere.
 */

const USER = { email: `copilot-groups-hosted-${randomUUID()}@e2e.local`, password: "e2e-copilot-groups-off-pw" };
/** data/jurisdictions.json → defaultRealJurisdiction, as family-hub.nojurisdiction.spec.ts retypes it. */
const REGISTER_SENTENCE = "This part of Inherit is not available here because its legal review is not complete.";
let accountId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  accountId = await createConfirmedUser(USER.email, USER.password);
});

test("hosted: the Family Copilot box opens the Family scope, which is the registered unavailable page and reads nothing", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/overview");
  const box = page.locator('[data-overview-box] a[aria-labelledby="box-family-copilot-label"]');
  await expect(box).toHaveAttribute("href", "/copilot/family");
  // The cohort scope is not built anywhere: its box keeps landing on the hub.
  await expect(page.locator('[data-overview-box] a[aria-labelledby="box-embryos-copilot-label"]'))
    .toHaveAttribute("href", "/embryos");

  const navigation = page.waitForResponse(response => new URL(response.url()).pathname === "/copilot/family");
  await box.click();
  expect((await navigation).status()).toBe(200);
  await expect(page).toHaveURL(/\/copilot\/family$/);
  const unavailable = page.locator('[data-slot="copilot-local-unavailable"]');
  await expect(unavailable).toBeVisible();
  await expect(unavailable).toHaveAttribute("data-state", "not-covered");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(COPY_IDS["copilot.transport.local-unavailable.heading"]);
  await expect(unavailable.getByText(COPY_IDS["copilot.transport.local-unavailable.reason"], { exact: true })).toBeVisible();
  await expect(unavailable.getByText(COPY_IDS["copilot.transport.local-unavailable.requirement"], { exact: true })).toBeVisible();

  // Nothing past the transport decision rendered: not the jurisdiction
  // refusal, not the model settings, not the group, not a conversation.
  await expect(page.getByText(`Ask about ${FAMILY_SCOPE_LABEL}`)).toHaveCount(0);
  await expect(page.getByText(REGISTER_SENTENCE)).toHaveCount(0);
  await expect(page.getByText(FAMILY_EMPTY_NOTE)).toHaveCount(0);
  await expect(page.locator([
    '[data-slot="copilot-family-jurisdiction"]', '[data-slot="copilot-family-members"]',
    '[data-slot="copilot-family-empty"]', '[data-slot="copilot-local-only"]',
  ].join(", "))).toHaveCount(0);
  await expect(page.getByLabel("Message the copilot")).toHaveCount(0);
  await expect(page.getByTestId("data-flow-indicator")).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toMatch(/contextToken/);
  expect(html).not.toContain("family-context");

  // And nothing was minted or stored for this account by the visit.
  const admin = adminClient();
  const tokens = await admin.from("copilot_context_tokens").select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
  expect(tokens.error).toBeNull();
  expect(tokens.count).toBe(0);
  const chats = await admin.from("chats").select("id", { count: "exact", head: true }).eq("user_id", accountId);
  expect(chats.error).toBeNull();
  expect(chats.count).toBe(0);

  await unavailable.getByRole("link", { name: COPY_IDS["actions.back"], exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
});

test("hosted: the chat and history endpoints serve nothing for the Family scope", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/overview");
  const origin = new URL(page.url()).origin;
  const chat = await page.request.post("/api/chat", { headers: { origin },
    data: { contextToken: "forged-family-context-token-value", message: "What did they share?" } });
  expect([403, 404]).toContain(chat.status());
  expect(await chat.text()).not.toContain("What did they share?");
  expect((await page.request.get(`/api/chats/${randomUUID()}`)).status()).toBe(404);
});

test("hosted: the Family hub's gates are unchanged, so its Copilot tile states the refusal and links nowhere", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/family");
  const tile = page.locator('[data-tile="copilot"]');
  await expect(tile.locator('[data-slot="tile-blocked"]')).toHaveText(REGISTER_SENTENCE);
  await expect(tile.getByRole("link")).toHaveCount(0);
  await expect(page.getByText(HUB_TILES.find(entry => entry.id === "copilot")!.blocked, { exact: true })).toHaveCount(0);
});
