import { expect, test } from "@playwright/test";
import http from "node:http";
import {
  JOBS_SECRET,
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

  const drain = await request.post("/api/jobs/mail", {
    headers: { authorization: `Bearer ${JOBS_SECRET}` },
  });
  expect(drain.status()).toBe(200);
  expect((await drain.json()) as { failed: number }).toMatchObject({ failed: 0 });

  const message = captured.find((email) =>
    (Array.isArray(email.to) ? email.to : [email.to]).includes(RECIPIENT.email),
  );
  expect(message, "the invitation must reach the configured mail provider").toBeTruthy();
  expect(message!.subject).toBe("You were invited to Inherit");
  const invitationUrl = message!.html?.match(
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

  const recipientId = (await admin.auth.admin.listUsers()).data.users.find(
    (user) => user.email === RECIPIENT.email,
  )!.id;
  const inviterId = (await admin.auth.admin.listUsers()).data.users.find(
    (user) => user.email === INVITER.email,
  )!.id;
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
