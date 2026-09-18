import { expect, test, type Page } from "@playwright/test";
import http from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  acceptAdultInvitation,
  adminClient,
  adultInvitationToken,
  adultInvitationUrl,
  createConfirmedUser,
  drainMailUntil,
  signIn,
} from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import receipt from "./fixtures/synthetic-browser-grch38.receipt.json";
import { CARD_AWAITING_RESULTS_STATUS, CARD_READY_STATUS } from "../src/copy/family";
import { PERMISSION_ROWS } from "../src/copy/family/permissions";
import {
  BASELINE_ABSENT,
  GATE_BUTTON,
  GATE_CHECKBOX_LABEL,
  PERSON_H1,
  noFileYet,
  noneCovered,
  notShared,
  reportsLede,
} from "../src/copy/family/person";
import { OWN_UPLOAD_COPY } from "../src/copy/upload/consent";

/**
 * `/family/[person] not-covered`: another adult has shared both report layers
 * from their own session, their file is prepared and both layers were
 * generated, and the file covers none of the reports in either layer.
 *
 * The journey is the real one, as `e2e/family.spec.ts` drives it: A invites
 * B through the invite screen and the mail worker, B accepts in their own
 * account, B prepares their own file and chooses both report layers, and B
 * turns both layers on for A from the permissions page. The file is the one
 * `e2e/genome-coverage-states.spec.ts` uses for the same state on the
 * owner's own surfaces: 144 invented chr20 positions with no rsID and no
 * report locus (`e2e/fixtures/PROVENANCE.md`), so what A is shown is a
 * prepared, fully shared record that supports no result — which is what the
 * register's `not-covered` means, and exactly what its sentence says:
 * "{name}'s file covers none of the {layer} reports."
 *
 * The cause is established from the database before the page is read: B's
 * file is prepared, and the polygenic layer read zero of every panel's
 * positions. On the page, both granted layers carry the none-covered
 * sentence and no report link; nothing reads as withheld, as missing a
 * source, or as still to come, which is what separates this from
 * `partial-coverage` (a layer not shared), `empty` (nothing shared) and
 * `processing` (a result not yet completed).
 *
 * Execution needs the isolated disposable mail queue and the local Resend
 * capture on port 8124, as the other Family specs do.
 */

const RUN_ID = randomUUID();
const A = { email: `family-cov-a-${RUN_ID}@e2e.local`, password: "e2e-family-cov-pw" };
const B = { email: `family-cov-b-${RUN_ID}@e2e.local`, password: "e2e-family-cov-pw" };
const NOTHING_FIXTURE = path.join(process.cwd(), receipt.fixture.path);
/** The two report layers B turns on for A, by their permission row ids. */
const REPORT_LAYERS = ["reports.monogenic", "reports.polygenic"] as const;

interface CapturedEmail {
  to: string[] | string;
  subject: string;
  html?: string;
}

const captured: CapturedEmail[] = [];
let resendMock: http.Server;
let accountA = "";
let accountB = "";
let selfSubjectA = "";
let invitedSubjectId = "";
let sourceFileId = "";

test.use({ trace: "off" }); // Restricted upload, invitation and permission bearers stay out of traces.
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
          .end(JSON.stringify({ id: `family-cov-${captured.length}` }));
        return;
      }
      response.writeHead(200).end("{}");
    });
  });
  await new Promise<void>((resolve, reject) => {
    resendMock.once("error", reject);
    resendMock.listen(8124, "127.0.0.1", resolve);
  });
  accountA = await createConfirmedUser(A.email, A.password);
  accountB = await createConfirmedUser(B.email, B.password);
});

test.afterAll(async () => {
  if (resendMock) await new Promise<void>((resolve) => resendMock.close(() => resolve()));
});

async function selfSubjectOf(accountId: string): Promise<string> {
  const { data, error } = await adminClient().from("subjects").select("id")
    .eq("subject_account_id", accountId).eq("subject_class", "self").eq("lifecycle", "active").single();
  expect(error).toBeNull();
  return data!.id;
}

/**
 * The inviter's own adulthood, declared on the account screen the upload
 * entry hosts, as `e2e/family.spec.ts` does before inviting: a real account
 * declaration, separate from any DNA upload, and the flow stops at the next
 * disclosure without signing it.
 */
async function declareAdulthood(page: Page) {
  await page.goto("/files/upload");
  const account = page.getByRole("heading", { name: OWN_UPLOAD_COPY.accountHeading, exact: true });
  const insurance = page.getByRole("heading", { name: OWN_UPLOAD_COPY.insuranceHeading, exact: true });
  await expect(account.or(insurance).first()).toBeVisible();
  if (!(await account.isVisible())) return;
  await page.getByLabel(OWN_UPLOAD_COPY.birthDateLabel).fill("1990-01-01");
  const completed = page.waitForResponse((response) => response.url().endsWith("/api/account/completion")
    && response.request().method() === "POST");
  await page.getByRole("button", { name: OWN_UPLOAD_COPY.accountContinue, exact: true }).click();
  expect((await completed).status()).toBe(200);
  await expect(insurance).toBeVisible();
}

/** One permission row turned on from the signer's own session, through the real route. */
async function turnOn(page: Page, recipientHandle: string, purpose: (typeof REPORT_LAYERS)[number]) {
  await page.goto(`/family/s-${recipientHandle}/permissions`);
  const label = PERMISSION_ROWS.find((row) => row.id === purpose)!.label;
  const row = page.locator('[data-slot="permission-column"][data-settable="true"] [data-slot="permission-row"]')
    .filter({ has: page.locator('[data-slot="permission-label"]', { hasText: new RegExp(`^${label}$`) }) });
  await expect(row.locator('[data-slot="permission-state"]')).toHaveText("Off");
  const signed = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith("/api/consents"));
  await row.getByRole("button", { name: /^Turn on / }).click();
  const result = await signed;
  expect(result.status()).toBe(201);
  expect(await result.json()).toMatchObject({ recordKind: "purpose_grant", purposeKey: purpose });
  await expect(row.locator('[data-slot="permission-state"]')).toHaveText("On");
}

test("A invites B, B accepts, prepares a file that covers nothing the product reads and turns on both report layers", async ({
  page,
  request,
}) => {
  test.setTimeout(600_000);
  await signIn(page, A.email, A.password);
  await declareAdulthood(page);
  await page.goto("/family/invite");
  await page.getByLabel("Their email address").fill(B.email);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation requested");

  const message = await drainMailUntil(request, () => captured.find((email) =>
    (Array.isArray(email.to) ? email.to : [email.to]).includes(B.email),
  ), "the invitation");
  const token = adultInvitationToken(message.html);
  expect(token, "the invitation mail carries one fragment-form review link").toBeTruthy();

  await page.request.post("/auth/sign-out");
  await acceptAdultInvitation({
    page, invitationUrl: adultInvitationUrl(token!), email: B.email, password: B.password,
  });

  const admin = adminClient();
  selfSubjectA = await selfSubjectOf(accountA);
  const selfSubjectB = await selfSubjectOf(accountB);
  const principal = await admin.from("subject_principals").select("id")
    .eq("account_id", accountA).eq("subject_id", selfSubjectA).eq("principal_kind", "account_subject")
    .eq("status", "active").single();
  expect(principal.error).toBeNull();
  const invitation = await admin.from("subject_invitations").select("target_id")
    .eq("invitation_kind", "adult_subject").eq("inviter_principal_id", principal.data!.id)
    .eq("status", "accepted").single();
  expect(invitation.error).toBeNull();
  invitedSubjectId = invitation.data!.target_id;
  expect(invitedSubjectId).not.toBe(selfSubjectB);

  // Still B's own session: the file is B's, prepared through the real
  // journey, and both report layers are B's own explicit choice.
  sourceFileId = await uploadOwnFileWithChosenReports(page, NOTHING_FIXTURE, {
    fileType: "vcf", purposes: [...REPORT_LAYERS],
  });
  const source = await admin.from("genome_files")
    .select("subject_id, user_id, single_logical_sample_verified_at").eq("id", sourceFileId).single();
  expect(source.error).toBeNull();
  expect(source.data).toMatchObject({ subject_id: selfSubjectB, user_id: accountB });
  expect(source.data!.single_logical_sample_verified_at, "prepared, not in flight").not.toBeNull();
  // The polygenic layer read zero of every panel's positions: the file
  // supports no result, from the database rather than from the page.
  const panels = await admin.from("user_prs").select("pgs_id, matched").eq("file_id", sourceFileId);
  expect(panels.error).toBeNull();
  expect(panels.data!.length).toBeGreaterThan(0);
  for (const panel of panels.data!) expect(panel.matched, `${panel.pgs_id} read no position`).toBe(0);

  // B turns both layers on for A, from B's own session and nowhere else.
  for (const purpose of REPORT_LAYERS) await turnOn(page, selfSubjectA, purpose);
});

test("/family/[person] not-covered: with both report layers shared and a prepared file that reaches no report, each layer says the file covers none of its reports and lists nothing", async ({
  page,
}) => {
  expect(invitedSubjectId && sourceFileId, "the journey above ran").toBeTruthy();
  await page.request.post("/auth/sign-out");
  await signIn(page, A.email, A.password);
  await page.goto(`/family/s-${invitedSubjectId}`);
  await expect(page.getByRole("heading", { level: 1, name: PERSON_H1 })).toBeVisible();

  // The domain's one Tier-2 gate stands in front of the record; nothing
  // derived reaches the browser before it is passed here, in this session.
  await expect(page.getByText(GATE_CHECKBOX_LABEL, { exact: true })).toBeVisible();
  expect(await page.content()).not.toContain("data-figure-kind");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: GATE_BUTTON }).click();
  await expect(page.locator('[data-layer="estimate"]')).toBeVisible();

  const name = (await page.locator('[data-subject-bar] [data-slot="subject-name"]').textContent())?.trim();
  expect(name).toBeTruthy();
  await expect(page.getByText(reportsLede(name!), { exact: true })).toBeVisible();

  // Both granted layers are on the page, and each says in words that B's
  // file covers none of its reports, with no report listed under it.
  for (const layer of ["estimate", "variant_call"] as const) {
    const section = page.locator(`[data-layer="${layer}"]`);
    await expect(section).toHaveCount(1);
    await expect(section.getByText(noneCovered(name!, layer), { exact: true })).toBeVisible();
    await expect(section.locator("a[href]")).toHaveCount(0);
    await expect(page.getByText(notShared(name!, layer), { exact: true })).toHaveCount(0);
  }
  await expect(page.locator(`a[href^="/genome/s-${invitedSubjectId}/reports/"]`)).toHaveCount(0);

  // Not a withheld permission, not a missing source, not a result still to come.
  await expect(page.locator('[data-slot="person-blocking"]')).toHaveCount(0);
  await expect(page.getByText(noFileYet(name!), { exact: true })).toHaveCount(0);
  await expect(page.getByText("No completed result is shared yet.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No completed result is shared for this result type yet.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("A saved result is missing the source details needed to show it.", { exact: true })).toHaveCount(0);
  await expect(page.getByText(BASELINE_ABSENT, { exact: true })).toHaveCount(1);
  await expect(page.locator("[data-figure-kind], [data-claim-block]")).toHaveCount(0);

  // Measured, not endorsed: the hub's card for B reads "No shared results
  // yet" on this same record — the line that means a result is still to
  // come. B's results exist and cover nothing; the card cannot tell the two
  // apart because its readiness asks whether any COVERED report exists
  // (`hasReports` in the shared-report capture), so a completed run that
  // reaches no report is reported to A as not having happened. Recorded as
  // D-129 and as the reason `/family not-covered` is a finding rather than a
  // proof (docs/protocol/brief-corrections-proposed.md, 2026-09-18). This
  // assertion pins the misreading so the fix has to come through here.
  await page.goto("/family");
  const card = page.locator('[data-slot="person-card"]');
  await expect(card).toHaveCount(1);
  await expect(card.locator('[data-slot="person-state"]')).toHaveText(CARD_AWAITING_RESULTS_STATUS);
  await expect(card.locator('[data-slot="person-state"]')).not.toHaveText(CARD_READY_STATUS);
});
