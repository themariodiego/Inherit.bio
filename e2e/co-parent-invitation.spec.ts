import { expect, test } from "@playwright/test";
import crypto from "node:crypto";
import http from "node:http";
import config from "../playwright.config";
import { encryptSecret, hmacSecret } from "../src/lib/crypto";
import { EMBRYO_ARTIFACT_STATEMENT_KEYS } from "../src/lib/embryos/basis";
import { JOBS_SECRET, adminClient, anonClient, createConfirmedUser, signIn } from "./helpers";

// Use exactly the local server's existing fixture key, never a hosted secret.
const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
const testKey = servers[0]?.env?.BYOK_ENCRYPTION_KEY;
if (!testKey) throw new Error("Local browser fixture key missing");
process.env.BYOK_ENCRYPTION_KEY = testKey;

const suffix = crypto.randomUUID();
const owner = { email: `rights-owner-${suffix}@e2e.local`, password: "synthetic-rights-test-password" };
const recipient = { email: `rights-parent-${suffix}@e2e.local`, password: "synthetic-rights-test-password" };
const stranger = { email: `rights-other-${suffix}@e2e.local`, password: "synthetic-rights-test-password" };
let ownerId: string;
let recipientId: string;
let strangerId: string;
let authSessionId: string;
let mailServer: http.Server;
const messages: { to: string | string[]; html?: string; subject: string }[] = [];
const nonce = () => crypto.randomBytes(24).toString("base64url");
const contactHash = (email: string) => hmacSecret(email, "contact-email-v1");
const encrypted = (text: string) => `\\x${encryptSecret(text).toString("hex")}`;

test.beforeAll(async () => {
  mailServer = http.createServer((request, response) => {
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      if (request.method === "POST" && request.url?.includes("/emails")) messages.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: crypto.randomUUID() }));
    });
  });
  await new Promise<void>(resolve => mailServer.listen(8124, "127.0.0.1", resolve));
  ownerId = await createConfirmedUser(owner.email, owner.password);
  recipientId = await createConfirmedUser(recipient.email, recipient.password);
  strangerId = await createConfirmedUser(stranger.email, stranger.password);
  const { data, error } = await anonClient().auth.signInWithPassword(owner);
  expect(error).toBeNull();
  authSessionId = JSON.parse(Buffer.from(data.session!.access_token.split(".")[1], "base64url").toString("utf8")).session_id;
});

test.afterAll(async () => {
  if (mailServer) await new Promise<void>(resolve => mailServer.close(() => resolve()));
});

async function reserveInvitation(contactEmail = recipient.email) {
  const admin = adminClient();
  const { data: drafts, error: draftError } = await admin.rpc("create_embryo_cohort_draft_v1", {
    p_account_id: ownerId, p_session_id: authSessionId,
    p_upload_situation: "own_embryos", p_basis_case: "true_two_parent", p_embryo_count: 3,
    p_owner_contact_ciphertext: encrypted(owner.email), p_owner_contact_hmac: contactHash(owner.email),
    p_contact_ciphertexts: [encryptSecret(contactEmail).toString("hex")], p_contact_hmacs: [contactHash(contactEmail)],
    p_token_nonce: nonce(), p_test_jurisdiction: true,
  });
  expect(draftError).toBeNull();
  const draftId: string = drafts[0].draft_id;
  const { error: signError } = await admin.rpc("sign_embryo_artifact_v1", {
    p_account_id: ownerId, p_session_id: authSessionId, p_target_kind: "cohort_draft", p_target_id: draftId,
    p_artifact_key: "consent.upload-embryo", p_artifact_version: 1,
    p_statement_keys: [...EMBRYO_ARTIFACT_STATEMENT_KEYS["consent.upload-embryo"]],
    p_signing_name_ciphertext: encrypted("Synthetic Inviter"), p_jurisdiction_code: "DK", p_token_nonce: nonce(),
  });
  expect(signError).toBeNull();
  const { data: invitations, error: inviteError } = await admin.rpc("create_embryo_draft_invitation_v1", {
    p_account_id: ownerId, p_session_id: authSessionId, p_draft_id: draftId,
    p_contact_hmac: contactHash(contactEmail), p_idempotency_key: crypto.randomBytes(32).toString("hex"),
    p_token_nonce: nonce(), p_test_jurisdiction: true,
  });
  expect(inviteError).toBeNull();
  expect(invitations[0].invitation_id).toBeTruthy();
  return { draftId, invitationId: invitations[0].invitation_id as string };
}

test("/withdraw/request → session: real co-parent email, explicit activation, correct-account review and acceptance", async ({ page, request }, testInfo) => {
  const { draftId, invitationId } = await reserveInvitation();
  // The shared local stack can have earlier synthetic mail. Exercise the
  // worker's normal bounded batches until this invitation reaches the mock.
  let message: (typeof messages)[number] | undefined;
  for (let batch = 0; batch < 8 && !message; batch++) {
    const drain = await request.post("/api/jobs/mail", { headers: { authorization: `Bearer ${JOBS_SECRET}` } });
    expect(drain.status()).toBe(200);
    const result = await drain.json();
    message = messages.find(mail => (Array.isArray(mail.to) ? mail.to : [mail.to]).includes(recipient.email));
    if (!message && result.pending === 0) break;
  }
  expect(message).toBeTruthy();
  const emailed = message!.html?.match(/http:\/\/localhost:3100\/withdraw\/request#[A-Za-z0-9_-]{43}/u)?.[0];
  expect(emailed).toBeTruthy();
  const token = new URL(emailed!).hash.slice(1);
  const admin = adminClient();
  const initial = await admin.from("token_hashes").select("status").eq("token_hash", crypto.createHash("sha256").update(token).digest("hex")).single();
  expect(initial.error).toBeNull();
  expect(initial.data?.status).toBe("current");

  // An email scanner's GET/HEAD must not activate or consume the invitation.
  expect((await request.get(emailed!)).status()).toBe(200);
  expect((await request.head(emailed!)).headers()["set-cookie"]).toBeUndefined();
  const afterScanner = await admin.from("token_hashes").select("status").eq("token_hash", crypto.createHash("sha256").update(token).digest("hex")).single();
  expect(afterScanner.data?.status).toBe("current");

  const requests: { url: string; method: string; body: string | null }[] = [];
  page.on("request", outgoing => requests.push({ url: outgoing.url(), method: outgoing.method(), body: outgoing.postData() }));
  const entry = await page.goto(emailed!);
  expect(entry!.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page).toHaveURL("http://localhost:3100/withdraw/request");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  expect(requests.some(outgoing => outgoing.method === "POST")).toBe(false);
  expect(await page.content()).not.toContain(token);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, state: history.state }))).not.toContain(token);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3100/withdraw/session");
  await expect(page.getByRole("heading", { name: "Sign in to review this invitation" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/auth/sign-in?next=%2Fwithdraw%2Fsession");
  expect(await page.content()).not.toContain("Synthetic Inviter");
  const activation = requests.filter(outgoing => outgoing.url.endsWith("/api/rights/activate"));
  expect(activation).toHaveLength(1);
  expect(JSON.parse(activation[0].body!).token).toBe(token);
  expect(requests.every(outgoing => !outgoing.url.includes(token))).toBe(true);
  expect(requests.filter(outgoing => outgoing.body?.includes(token))).toHaveLength(1);

  // A forwarded link/session does not let the wrong account read the draft.
  await signIn(page, stranger.email, stranger.password);
  await page.goto("/withdraw/session");
  expect(await page.content()).not.toContain("Synthetic Inviter");
  await expect(page.getByRole("button", { name: "Sign and accept invitation" })).toHaveCount(0);
  await page.request.post("/auth/sign-out");
  await page.goto("/withdraw/session");
  await page.getByRole("main").getByRole("link", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email").fill(recipient.email);
  await page.getByLabel("Password").fill(recipient.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3100/withdraw/session");
  await expect(page.getByRole("heading", { name: "Review this invitation before you sign" })).toBeVisible();
  await expect(page.getByText("Synthetic Inviter", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("co-parent-review.png"), fullPage: true });
  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
  await page.getByLabel("Country where you live").selectOption("DK");
  await page.getByLabel("Full legal name").fill("Synthetic");
  await page.getByRole("button", { name: "Sign and accept invitation" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("at least two name parts");
  await page.getByLabel("Full legal name").fill("Synthetic Parent");
  const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/invitations/accept") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign and accept invitation" }).click();
  const accepted = await responsePromise;
  expect(accepted.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "You have accepted the invitation" })).toBeVisible();
  const replay = await page.request.post("/api/invitations/accept", { headers: { origin: "http://localhost:3100", "sec-fetch-site": "same-origin" }, data: accepted.request().postDataJSON() });
  expect(replay.status()).toBe(404);

  const invitation = await admin.from("subject_invitations").select("status, email_encrypted").eq("id", invitationId).single();
  expect(invitation.data).toEqual({ status: "accepted", email_encrypted: null });
  const signatures = await admin.from("consent_signatures").select("artifact_key, signer_account_id, jurisdiction_code").eq("target_kind", "cohort_draft").eq("target_id", draftId).eq("signer_account_id", recipientId);
  expect(signatures.data).toHaveLength(2);
  expect(signatures.data?.every(row => row.jurisdiction_code === "DK")).toBe(true);
  const draft = await admin.from("embryo_cohort_drafts").select("state").eq("id", draftId).single();
  expect(draft.data?.state).toBe("draft");
  const grants = await admin.from("directional_grants").select("grant_id", { count: "exact", head: true }).eq("recipient_account_id", ownerId);
  expect(grants.count).toBe(0);
});

for (const mode of ["anonymous", "other-account", "other-account-deleting"] as const) {
  test(`/withdraw/session: ${mode} refusal → cleanup → notices → safe retry`, async ({ page, request }, testInfo) => {
    const email = `refuse-${crypto.randomUUID()}@e2e.local`;
    const { draftId, invitationId } = await reserveInvitation(email);
    const admin = adminClient();
    let emailed: string | undefined;
    for (let batch = 0; batch < 10 && !emailed; batch++) {
      const run = await request.post("/api/jobs/mail", { headers: { authorization: `Bearer ${JOBS_SECRET}` } });
      expect(run.status()).toBe(200);
      emailed = messages.find(m => [m.to].flat().includes(email))?.html?.match(/http:\/\/localhost:3100\/withdraw\/request#[A-Za-z0-9_-]{43}/u)?.[0];
    }
    expect(emailed).toBeTruthy();
    if (mode !== "anonymous") {
      await signIn(page, stranger.email, stranger.password);
      if (mode === "other-account-deleting") {
        // Seed only this synthetic account's proxy restriction boundary.
        // No account-deletion request or real account cleanup is performed.
        expect((await admin.from("profiles").update({ deletion_requested_at: new Date().toISOString() })
          .eq("id", strangerId)).error).toBeNull();
        const restricted = await page.request.post("/api/jobs/mail");
        expect(restricted.status()).toBe(423);
        expect(await restricted.json()).toEqual({ error: "account_deletion_notice_period" });
      }
    }
    else {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    }
    await page.goto(emailed!);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL("http://localhost:3100/withdraw/session");
    expect(await page.content()).not.toContain("Synthetic Inviter");
    await expect(page.getByRole("button", { name: "Sign and accept invitation" })).toHaveCount(0);
    const decline = page.getByRole("button", { name: "Decline invitation", exact: true });
    await expect(decline).toBeEnabled();
    await decline.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`refusal-${mode}.png`), fullPage: true });
    const responsePromise = page.waitForResponse(r => r.url().endsWith("/api/withdraw/session") && r.request().method() === "POST");
    await decline.click();
    const response = await responsePromise;
    expect(response.status()).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted", operation: "refuse" });
    const originalBody = response.request().postDataJSON();
    expect(Object.keys(originalBody).sort()).toEqual(["nonce", "operation"]);
    await expect(page.getByRole("heading", { name: "You have declined this invitation" })).toBeVisible();
    const invitation = await admin.from("subject_invitations").select("status").eq("id", invitationId).single();
    expect(invitation.data?.status).toBe("refused");
    const cleanup = await request.post("/api/jobs/retention", { headers: { authorization: `Bearer ${JOBS_SECRET}` } });
    expect(cleanup.status()).toBe(200);
    expect((await cleanup.json()).failed).toBe(0);
    expect((await admin.from("embryo_cohort_drafts").select("id").eq("id", draftId)).data).toEqual([]);
    const replay = await page.request.post("/api/withdraw/session", {
      headers: { origin: "http://localhost:3100", "sec-fetch-site": "same-origin" }, data: originalBody,
    });
    expect(replay.status()).toBe(202);
    expect(await replay.json()).toEqual({ status: "accepted", operation: "refuse" });
    await page.reload();
    await expect(page.getByRole("heading", { name: "You have declined this invitation" })).toBeVisible();
    const mail = await request.post("/api/jobs/mail", { headers: { authorization: `Bearer ${JOBS_SECRET}` } });
    expect(mail.status()).toBe(200);
    expect((await mail.json()).failed).toBe(0);
    const notices = await admin.from("mail_outbox").select("state").eq("target_kind", "subject_invitation")
      .eq("target_id", invitationId).not("invitation_terminal_notice_id", "is", null);
    expect(notices.data).toEqual([{ state: "submitted" }, { state: "submitted" }]);
    expect(messages.filter(m => [m.to].flat().includes(email))).toHaveLength(2);
  });
}

test("/withdraw/request missing or malformed fragment: generic page, no activation", async ({ page }) => {
  for (const fragment of ["", "#short", `#${"x".repeat(44)}`]) {
    const outgoing: string[] = [];
    const track = (request: import("@playwright/test").Request) => { if (request.method() === "POST") outgoing.push(request.url()); };
    page.on("request", track);
    await page.goto(`/withdraw/request${fragment}`);
    await expect(page).toHaveURL("http://localhost:3100/withdraw/request");
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
    await expect(page.getByRole("status")).toContainText("Open the full link");
    expect(outgoing).toEqual([]);
    page.off("request", track);
  }
});
