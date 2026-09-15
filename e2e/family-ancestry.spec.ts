import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { acceptAdultInvitation, adminClient, adultInvitationToken, adultInvitationUrl, createConfirmedUser, drainMailUntil, signIn } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { OWN_UPLOAD_COPY } from "../src/copy/upload/consent";
import { REGIONAL_CAVEAT } from "../src/lib/genome/regional-admixture";

/** Synthetic disposable-CI journey. Invitation delivery is captured locally on
 * the established mock provider. Never run this against a retained mail queue.
 * Only the historical directional grant uses its old RPC as a historical
 * fixture; preparation, analysis choice, fresh confirmation and withdrawal use UI. */
test.use({ trace: "off" });
let provider: http.Server;
const captured: { to: string | string[]; html: string }[] = [];
test.beforeAll(async () => {
  provider = http.createServer((request, response) => {
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      if (request.method === "POST" && request.url?.includes("/emails")) captured.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: `ancestry-${captured.length}` }));
    });
  });
  await new Promise<void>(resolve => provider.listen(8124, "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise<void>(resolve => provider.close(() => resolve())); });

test("ancestry-only sharing: historical grant, fresh confirmation, exact saved regions and both withdrawals", async ({ browser, page, request }) => {
  test.setTimeout(240_000);
  const a = { email: `family-ancestry-a-${randomUUID()}@e2e.local`, password: "e2e-family-ancestry-pw" };
  const b = { email: `family-ancestry-b-${randomUUID()}@e2e.local`, password: "e2e-family-ancestry-pw" };
  const accountA = await createConfirmedUser(a.email, a.password), accountB = await createConfirmedUser(b.email, b.password);
  const admin = adminClient();
  const self = async (account: string) => {
    const result = await admin.from("subjects").select("id").eq("subject_account_id", account).eq("subject_class", "self").eq("lifecycle", "active").single();
    expect(result.error).toBeNull(); return result.data!.id;
  };
  await signIn(page, a.email, a.password);
  await page.goto("/files/upload");
  await page.getByLabel(OWN_UPLOAD_COPY.birthDateLabel).fill("1990-01-01");
  const declaration = page.waitForResponse(response => response.url().endsWith("/api/account/completion") && response.request().method() === "POST");
  await page.getByRole("button", { name: OWN_UPLOAD_COPY.accountContinue, exact: true }).click();
  expect((await declaration).status()).toBe(200);
  await page.goto("/family/invite"); await page.getByLabel("Their email address").fill(b.email);
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation requested");
  const mail = await drainMailUntil(request, () => captured.find(message => [message.to].flat().includes(b.email)), "synthetic Family ancestry invitation");
  const token = adultInvitationToken(mail.html); expect(token).toBeTruthy();
  await page.request.post("/auth/sign-out");
  await acceptAdultInvitation({ page, invitationUrl: adultInvitationUrl(token!), email: b.email, password: b.password });
  const fileId = await uploadOwnFileWithChosenReports(page, path.join(process.cwd(), "e2e/fixtures/aims-regional-merged-grch38.vcf"), { fileType: "vcf", purposes: ["ancestry"] });
  const subjectA = await self(accountA), subjectB = await self(accountB);
  const principalA = await admin.from("subject_principals").select("id").eq("subject_id", subjectA).eq("account_id", accountA).eq("principal_kind", "account_subject").eq("status", "active").single();
  expect(principalA.error).toBeNull();
  const invitation = await admin.from("subject_invitations").select("target_id").eq("inviter_principal_id", principalA.data!.id).eq("invitation_kind", "adult_subject").eq("status", "accepted").single();
  expect(invitation.error).toBeNull();
  const segment = `s-${invitation.data!.target_id}`;
  const receipt = async () => {
    const result = await admin.from("genome_files").select("id,user_id,subject_id,status,sha256,upload_revision,normalization_completed_at").eq("id", fileId).single();
    expect(result.error).toBeNull(); return result.data;
  };
  const before = await receipt();
  await page.goto("/genome/me/ancestry");
  const ownSurface = page.locator('[data-slot="regional-ancestry"]');
  await expect(ownSurface.locator('[data-slot="region-row"]')).toHaveCount(5);
  await expect(ownSurface.locator('[data-slot="region-row"][data-region="EUR-MID-CSA"]')).toHaveCount(1);
  const ownShares = await ownSurface.locator('[data-slot="region-row"] [data-slot="figure-value"]').allTextContents();
  expect(ownShares).toHaveLength(5);
  for (const value of ownShares) expect(Number.isFinite(Number.parseFloat(value))).toBe(true);
  const historical = await admin.rpc("grant_directional_purpose_v1", { p_account_id: accountB, p_data_subject_id: subjectB,
    p_recipient_principal_id: principalA.data!.id, p_purpose: "ancestry", p_artifact_key: "consent.share-with-adult", p_artifact_version: 1,
    p_token_nonce: `historical-ancestry-${randomUUID()}` });
  expect(historical.error).toBeNull();
  const viewerContext = await browser.newContext(); const viewer = await viewerContext.newPage();
  try {
    await signIn(viewer, a.email, a.password);
    await viewer.goto(`/family/${segment}`);
    await viewer.getByRole("checkbox", { name: "I understand this can tell me something I can’t un-know.", exact: true }).check();
    await viewer.getByRole("button", { name: "Show what’s shared", exact: true }).click();
    const ancestryLink = viewer.locator(`a[href='/genome/${segment}/ancestry']`);
    await expect(ancestryLink).toBeVisible();
    await expect(viewer.locator("a[href*='/reports/']")).toHaveCount(0);
    await expect(viewer.locator("#family-reports-heading")).toHaveCount(0);
    await ancestryLink.click();
    await expect(viewer.locator('[data-slot="ancestry-sharing-confirmation"]')).toBeVisible();
    await expect(viewer.locator('[data-figure-kind="ancestry-share"]')).toHaveCount(0);

    await page.goto(`/family/s-${subjectA}/permissions`);
    const confirmation = page.getByRole("region", { name: "Confirm ancestry sharing", exact: true });
    await expect(confirmation).toBeVisible();
    const grant = page.waitForResponse(response => response.url().endsWith("/api/consents") && response.request().method() === "POST");
    await confirmation.getByRole("button", { name: "Confirm ancestry sharing", exact: true }).click();
    expect((await grant).status()).toBe(201); await expect(confirmation).toHaveCount(0);
    const old = await admin.from("purpose_grants").select("revoked_at").eq("grant_id", historical.data!).single();
    expect(old.error).toBeNull(); expect(old.data?.revoked_at).not.toBeNull();
    await viewer.reload();
    const surface = viewer.locator('[data-slot="regional-ancestry"]');
    await expect(surface).toBeVisible(); await expect(surface).toContainText("hgdp-1kg-v3.1.2-cap30-168-v1");
    await expect(surface.locator('[data-slot="regional-caveat"]')).toHaveText(REGIONAL_CAVEAT);
    await surface.locator('details[data-slot="regional-split"] summary').click();
    await expect(surface.locator('[data-slot="regional-split-caveat"]')).toHaveText(REGIONAL_CAVEAT);
    await expect(surface.locator('[data-slot="region-row"]')).toHaveCount(5);
    await expect(surface.locator('[data-slot="region-row"][data-region="EUR-MID-CSA"]')).toHaveCount(1);
    const shares = await surface.locator('[data-slot="region-row"] [data-slot="figure-value"]').allTextContents();
    expect(shares).toHaveLength(5); expect(shares).toEqual(ownShares);
    await expect(viewer.locator('[data-slot="ancestry-sharing-confirmation"]')).toHaveCount(0);

    const row = page.locator('[data-slot="permission-column"][data-settable="true"] [data-slot="permission-row"]').filter({
      has: page.locator('[data-slot="permission-label"]', { hasText: /^Ancestry$/ }) });
    await row.getByRole("button", { name: "Turn off" }).click(); await expect(row.locator('[data-slot="permission-state"]')).toHaveText("Off");
    await viewer.goto(`/family/${segment}`); await expect(viewer.locator(`a[href='/genome/${segment}/ancestry']`)).toHaveCount(0);
    await viewer.goto(`/genome/${segment}/ancestry`); await expect(viewer.locator('[data-figure-kind="ancestry-share"]')).toHaveCount(0);
    expect(await receipt()).toEqual(before);

    await row.getByRole("button", { name: "Turn on" }).click(); await expect(row.locator('[data-slot="permission-state"]')).toHaveText("On");
    await viewer.goto(`/genome/${segment}/ancestry`); await expect(surface).toBeVisible();
    expect(await surface.locator('[data-slot="region-row"] [data-slot="figure-value"]').allTextContents()).toEqual(shares);
    await page.goto("/genome/me/reports");
    const ownerRevoked = page.waitForResponse(response => /\/api\/consents\/[0-9a-f-]{36}\/revoke$/.test(response.url())
      && response.request().method() === "POST");
    await page.getByRole("region", { name: "Choose your reports", exact: true }).getByRole("button", { name: "Turn off Ancestry", exact: true }).click();
    const ownerRevocation = await ownerRevoked;
    expect(ownerRevocation.status()).toBe(200); expect(await ownerRevocation.json()).toMatchObject({ revoked: true });
    await viewer.reload(); await expect(viewer.locator('[data-figure-kind="ancestry-share"]')).toHaveCount(0);
    await expect(viewer.getByText("No ancestry result is shared yet.", { exact: true })).toBeVisible();
    expect(await receipt()).toEqual(before);
  } finally { await viewerContext.close(); }
});
