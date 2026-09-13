import { expect, test } from "@playwright/test";
import http from "node:http";
import {
  drainMailUntil,
  findUserByEmail,
  adminClient,
  createConfirmedUser,
  signIn,
} from "./helpers";

const INVITER = { email: "adult-inviter@e2e.local", password: "invite-test-pw" };
/** Brief §5 §5.2: both invitation paths render this above the form, verbatim. */
const PRE_CONSENT_STATEMENT =
  "Comparing two people’s DNA can show that they are related, or not related, in ways neither expected. Inherit cannot un-see this.";
const RECIPIENT = { email: "adult-recipient@e2e.local", password: "invite-test-pw" };

interface CapturedEmail {
  to: string[] | string;
  subject: string;
  html?: string;
}

const captured: CapturedEmail[] = [];
let resendMock: http.Server;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  resendMock = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      if (request.method === "POST" && request.url?.includes("/emails")) {
        captured.push(JSON.parse(body) as CapturedEmail);
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ id: `adult-invite-${captured.length}` }));
        return;
      }
      response.writeHead(200).end("{}");
    });
  });
  await new Promise<void>((resolve) => resendMock.listen(8124, "127.0.0.1", resolve));
  await createConfirmedUser(INVITER.email, INVITER.password);
  await createConfirmedUser(RECIPIENT.email, RECIPIENT.password);
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => resendMock.close(() => resolve()));
});

test("/family/invite complete: invited adult accepts without granting inviter access", async ({
  page,
  request,
}) => {
  await signIn(page, INVITER.email, INVITER.password);
  await page.goto("/family/invite");
  await expect(page.getByRole("heading", { name: "Invite another adult" })).toBeVisible();
  // The pre-consent statement is in the DOM above the form, verbatim, and
  // inside no disclosure: it is read before anything is entered.
  const statement = page.locator('[data-slot="pre-consent-statement"]');
  await expect(statement).toHaveText(PRE_CONSENT_STATEMENT);
  await expect(page.locator("details", { hasText: PRE_CONSENT_STATEMENT })).toHaveCount(0);
  const statementBox = await statement.boundingBox();
  // The invite form, not the shell's sign-out form in the account landmark.
  const formBox = await page
    .locator("form")
    .filter({ has: page.getByLabel("Their email address") })
    .boundingBox();
  expect(statementBox!.y).toBeLessThan(formBox!.y);
  await page.getByLabel("Their email address").fill(RECIPIENT.email);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation requested");

  // One drain is not enough on a shared queue: see drainMailUntil. The
  // `failed: 0` this used to assert went with it, because the worker's failure
  // count covers every row it claimed, including rows other journeys left
  // behind - it was a claim about the whole queue standing in for a claim
  // about this invitation. The check that matters is unchanged and stronger:
  // this exact message must arrive, and if it does not the drain receipts come
  // with the failure.
  const message = await drainMailUntil(request, () => captured.find((email) =>
    (Array.isArray(email.to) ? email.to : [email.to]).includes(RECIPIENT.email),
  ), "the invitation");
  expect(message.subject).toBe("You were invited to Inherit");
  const invitationUrl = message.html?.match(
    /http:\/\/localhost:3100\/withdraw\/[A-Za-z0-9_-]{43}/,
  )?.[0];
  expect(invitationUrl, "the mail must carry one opaque invitation URL").toBeTruthy();

  const admin = adminClient();
  const { data: invitation } = await admin
    .from("subject_invitations")
    .select("id, target_id, status")
    .eq("invitation_kind", "adult_subject")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  expect(invitation).toBeTruthy();
  const { data: outbox } = await admin
    .from("mail_outbox")
    .select("template_payload")
    .eq("target_id", invitation!.id)
    .single();
  expect(JSON.stringify(outbox?.template_payload)).not.toContain(
    invitationUrl!.split("/").at(-1),
  );

  await page.request.post("/auth/sign-out");
  await page.goto(invitationUrl!);
  await expect(page.getByText("No genetic data has been shared")).toBeVisible();
  await page.getByRole("link", { name: "Sign in to accept" }).click();
  await page.getByLabel("Email").fill(RECIPIENT.email);
  await page.getByLabel("Password").fill(RECIPIENT.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(invitationUrl!);
  await page.getByRole("button", { name: "Accept through my account" }).click();
  await expect(page.getByRole("heading", { name: "Invitation accepted" })).toBeVisible();

  // Both fixture addresses are fixed, so they age: `listUsers` returns page
  // one, newest first, and after a few hundred accounts these two sit past it.
  // `findUserByEmail` pages, and its own comment records the last time this
  // exact assumption bit.
  const recipientId = (await findUserByEmail(admin, RECIPIENT.email))!.id;
  const inviterId = (await findUserByEmail(admin, INVITER.email))!.id;
  const { data: subject } = await admin
    .from("subjects")
    .select("subject_account_id, lifecycle")
    .eq("id", invitation!.target_id)
    .single();
  expect(subject).toEqual({ subject_account_id: recipientId, lifecycle: "active" });
  const { count: inviterGrants } = await admin
    .from("directional_grants")
    .select("grant_id", { count: "exact", head: true })
    .eq("recipient_account_id", inviterId);
  expect(inviterGrants).toBe(0);
  const { count: files } = await admin
    .from("genome_files")
    .select("id", { count: "exact", head: true })
    .eq("subject_id", invitation!.target_id);
  expect(files).toBe(0);
});

/**
 * `/withdraw/[token] complete`: the outcome render, reached by REFUSING.
 *
 * This is the first thing in the suite to drive the Refuse control. The test
 * above accepts, so the accepted outcome was already asserted inside a title
 * that claims a different pair; refusing gives this pair its own proof AND
 * covers a rights control nothing had exercised. On a surface whose whole
 * purpose is letting someone say no, that was the wrong control to leave
 * undriven.
 *
 * `complete` is unambiguous here under every reading in corrections item 11:
 * the flow reached an end and the page names which end. There is nothing
 * partial about it and nothing further the page could show.
 *
 * SIGNED OUT ON PURPOSE. Accepting needs an account, because it creates a
 * reserved subject under one; refusing must not, or the product would require
 * a stranger to register before they could decline. The page renders the
 * refuse form whether or not anyone is signed in, and this test holds that
 * open by never signing in.
 *
 * A second address rather than the one above: that invitation is spent, and a
 * used token renders the "cannot be used" outcome, which is a different
 * sentence about a different situation.
 */
test("/withdraw/[token] complete: refusing closes the reserved subject and the page says so, with no account", async ({
  page,
  request,
}) => {
  const refuser = `adult-refuser-${Date.now()}@e2e.local`;

  await signIn(page, INVITER.email, INVITER.password);
  await page.goto("/family/invite");
  await page.getByLabel("Their email address").fill(refuser);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation requested");

  const message = await drainMailUntil(request, () => captured.find((email) =>
    (Array.isArray(email.to) ? email.to : [email.to]).includes(refuser),
  ), "the second invitation");
  const invitationUrl = message.html?.match(
    /http:\/\/localhost:3100\/withdraw\/[A-Za-z0-9_-]{43}/,
  )?.[0];
  expect(invitationUrl, "the mail must carry one opaque invitation URL").toBeTruthy();

  const admin = adminClient();
  const { data: invitation } = await admin
    .from("subject_invitations")
    .select("id, target_id, status")
    .eq("invitation_kind", "adult_subject")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  expect(invitation?.status).toBe("pending");

  // No account, and prove it rather than assume it: refusing must not require
  // a stranger to register first.
  await page.request.post("/auth/sign-out");
  await page.context().clearCookies();
  await page.goto(invitationUrl!);
  await expect(page.getByText("No genetic data has been shared")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to accept" }),
    "accepting needs an account; refusing does not").toBeVisible();

  await page.getByRole("button", { name: "Refuse", exact: true }).click();

  // The outcome: this page's `complete`.
  await expect(page.getByRole("heading", { name: "Invitation refused" })).toBeVisible();
  await expect(page.getByText(
    "The reserved subject was closed. This address will not receive another invitation for this target.",
    { exact: true },
  )).toBeVisible();
  // The controls are gone: an outcome replaces the choice rather than sitting
  // beside it, so the same token cannot be refused twice or accepted after.
  await expect(page.getByRole("button", { name: "Refuse", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Accept through my account" })).toHaveCount(0);

  // And the sentence is true: the invitation is no longer pending and the
  // reserved subject is not active.
  const { data: after } = await admin
    .from("subject_invitations").select("status").eq("id", invitation!.id).single();
  expect(after?.status, "the refusal was recorded, not merely rendered").not.toBe("pending");
  const { data: target } = await admin
    .from("subjects").select("lifecycle").eq("id", invitation!.target_id).maybeSingle();
  expect(target?.lifecycle ?? "gone", "the reserved subject was closed").not.toBe("active");
});
