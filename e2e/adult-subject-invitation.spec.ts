import { expect, test } from "@playwright/test";
import crypto from "node:crypto";
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

/** The fragment form every mailed token now uses (D-081). */
const FRAGMENT_LINK = /http:\/\/localhost:3100\/withdraw\/request#[A-Za-z0-9_-]{43}/;
/** The path form no mail may ever carry again. */
const PATH_LINK = /\/withdraw\/[A-Za-z0-9_-]{43}/;

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

/** Send one invitation from the signed-in inviter and return its mailed link. */
async function inviteAndRead(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  address: string,
  label: string,
) {
  await page.goto("/family/invite");
  await page.getByLabel("Their email address").fill(address);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation requested");
  const message = await drainMailUntil(request, () => captured.find((email) =>
    (Array.isArray(email.to) ? email.to : [email.to]).includes(address),
  ), label);
  const link = message.html?.match(FRAGMENT_LINK)?.[0];
  expect(link, "the mail must carry one fragment-form review URL").toBeTruthy();
  // D-081: the token is behind the '#', so it never reaches the server, an
  // access log, a referrer header or browser history as part of a path.
  expect(message.html, "no mail may carry a token in a URL path").not.toMatch(PATH_LINK);
  return { message, link: link!, token: link!.split("#")[1] };
}

async function latestPendingInvitation() {
  const { data } = await adminClient()
    .from("subject_invitations")
    .select("id, target_id, status")
    .eq("invitation_kind", "adult_subject")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  expect(data).toBeTruthy();
  return data!;
}

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

  // One drain is not enough on a shared queue: see drainMailUntil. The
  // `failed: 0` this used to assert went with it, because the worker's failure
  // count covers every row it claimed, including rows other journeys left
  // behind - it was a claim about the whole queue standing in for a claim
  // about this invitation. The check that matters is unchanged and stronger:
  // this exact message must arrive, and if it does not the drain receipts come
  // with the failure.
  const { message, link, token } = await inviteAndRead(page, request, RECIPIENT.email, "the invitation");
  expect(message.subject).toBe("You were invited to Inherit");

  const admin = adminClient();
  const invitation = await latestPendingInvitation();
  const { data: outbox } = await admin
    .from("mail_outbox")
    .select("template_payload")
    .eq("target_id", invitation.id)
    .single();
  expect(JSON.stringify(outbox?.template_payload)).not.toContain(token);

  // A mail scanner following the link must not spend the invitation.
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const before = await admin.from("token_hashes").select("status").eq("token_hash", tokenHash).single();
  expect(before.data?.status).toBe("current");
  expect((await request.get(link)).status()).toBe(200);
  expect((await request.head(link)).headers()["set-cookie"]).toBeUndefined();
  const afterScanner = await admin.from("token_hashes").select("status").eq("token_hash", tokenHash).single();
  expect(afterScanner.data?.status, "a scanner GET must not activate the token").toBe("current");

  await page.request.post("/auth/sign-out");
  const outgoing: { url: string; method: string; body: string | null }[] = [];
  page.on("request", request => outgoing.push({ url: request.url(), method: request.method(), body: request.postData() }));
  await page.goto(link);
  await expect(page).toHaveURL("http://localhost:3100/withdraw/request");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  expect(outgoing.some(entry => entry.method === "POST"), "opening the link posts nothing").toBe(false);
  expect(await page.content()).not.toContain(token);

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3100/withdraw/session");
  await expect(page.getByText("No genetic data has been shared")).toBeVisible();
  // The token travelled once, in one request body, and in no URL.
  expect(outgoing.every(entry => !entry.url.includes(token))).toBe(true);
  expect(outgoing.filter(entry => entry.body?.includes(token))).toHaveLength(1);

  await page.getByRole("link", { name: "Sign in to accept" }).click();
  await page.getByLabel("Email").fill(RECIPIENT.email);
  await page.getByLabel("Password").fill(RECIPIENT.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3100/withdraw/session");
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
    .eq("id", invitation.target_id)
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
    .eq("subject_id", invitation.target_id);
  expect(files).toBe(0);
});

/**
 * `/withdraw/session complete`: the outcome render, reached by REFUSING.
 *
 * The accept above is a different pair's proof, and this pair is the one a
 * surface built for saying no should hold: refusing gives it its own proof AND
 * covers a rights control nothing else exercises.
 *
 * `complete` is unambiguous here under every reading in corrections item 11:
 * the flow reached an end and the page names which end. There is nothing
 * partial about it and nothing further the page could show.
 *
 * SIGNED OUT ON PURPOSE. Accepting needs an account, because it creates a
 * reserved subject under one; refusing must not, or the product would require
 * a stranger to register before they could decline. The page renders the
 * refuse control whether or not anyone is signed in, and this test holds that
 * open by never signing in.
 */
test("/withdraw/session complete: refusing closes the reserved subject and the page says so, with no account", async ({
  page,
  request,
}) => {
  const refuser = `adult-refuser-${Date.now()}@e2e.local`;
  await signIn(page, INVITER.email, INVITER.password);
  const { link } = await inviteAndRead(page, request, refuser, "the second invitation");
  const admin = adminClient();
  const invitation = await latestPendingInvitation();

  // No account, and prove it rather than assume it: refusing must not require
  // a stranger to register first.
  await page.request.post("/auth/sign-out");
  await page.context().clearCookies();
  await page.goto(link);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3100/withdraw/session");
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
  // beside it, so the same session cannot be refused twice or accepted after.
  await expect(page.getByRole("button", { name: "Refuse", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in to accept" })).toHaveCount(0);

  // And the sentence is true: the invitation is no longer pending and the
  // reserved subject is not active.
  const { data: after } = await admin
    .from("subject_invitations").select("status").eq("id", invitation.id).single();
  expect(after?.status, "the refusal was recorded, not merely rendered").not.toBe("pending");
  const { data: target } = await admin
    .from("subjects").select("lifecycle").eq("id", invitation.target_id).maybeSingle();
  expect(target?.lifecycle ?? "gone", "the reserved subject was closed").not.toBe("active");
});

/**
 * `/withdraw/[token] complete`: the surface D-081 is retiring, held open for
 * the tokens already in people's mailboxes.
 *
 * The mail no longer links here, so nothing arrives at this path by itself
 * any more. Someone who was invited before the change still has a link that
 * does, and it has to keep working until those tokens expire. This test is
 * that guarantee: it takes the same token out of the fragment the mail now
 * sends and opens the old path with it, exactly as an older mail would.
 *
 * When the last pre-change token has expired, this test and the directory it
 * drives go together.
 */
test("/withdraw/[token] complete: a token mailed before the change still answers on the old path", async ({
  page,
  request,
}) => {
  const holdover = `adult-holdover-${Date.now()}@e2e.local`;
  await signIn(page, INVITER.email, INVITER.password);
  const { token } = await inviteAndRead(page, request, holdover, "the holdover invitation");
  const admin = adminClient();
  const invitation = await latestPendingInvitation();

  await page.request.post("/auth/sign-out");
  await page.context().clearCookies();
  await page.goto(`/withdraw/${token}`);
  await expect(page.getByText("No genetic data has been shared")).toBeVisible();
  await page.getByRole("button", { name: "Refuse", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Invitation refused" })).toBeVisible();
  await expect(page.getByText(
    "The reserved subject was closed. This address will not receive another invitation for this target.",
    { exact: true },
  )).toBeVisible();

  const { data: after } = await admin
    .from("subject_invitations").select("status").eq("id", invitation.id).single();
  expect(after?.status, "the old path still records, not merely renders").not.toBe("pending");
});
