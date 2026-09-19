import { expect, test, type BrowserContext, type Page } from "@playwright/test";
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
  uploadOwnFileThroughUi,
} from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { PERMISSION_ROWS } from "../src/copy/family/permissions";
import { CELL_FILE_PREPARING, CELL_NO_PREPARED_FILE } from "../src/copy/family/health-picture";
import { GATE_BUTTON, GATE_CHECKBOX_LABEL } from "../src/copy/family/person";
import { ACKNOWLEDGE_BUTTON, PORTRAIT_H1, VIEWER_FILE_PREPARING, VIEWER_NO_FILE_YET } from "../src/copy/family/portrait";
import { OWN_UPLOAD_COPY } from "../src/copy/upload/consent";

/**
 * `processing` on the two Family surfaces that read another adult's record:
 * `/family/health-picture` and `/family/portrait/[pairId]`.
 *
 * WHAT THE STATE IS. One adult has granted the other everything the surface
 * asks for, and has a file in preparation right now: finalized and stored,
 * preparation not yet asked for (`uploaded`), which `hasFileInPreparation`
 * in `@/lib/genome/load` counts as in flight. Until 19 September both pages
 * reported that person's file as absent — the health picture as "No prepared
 * file yet", the Portrait as "hasn't added a file yet" — which told the other
 * adult something false. The owner decided on 18 September (evening,
 * corrections item 17) that one sentence may say the file is still being
 * prepared, on both pages, because both adults have already granted the
 * surface and a file in flight discloses less than the result it will
 * produce. This spec is the proof the sentence renders, and that it renders
 * only in its own state: the file-absent sentences are asserted absent.
 *
 * HOW THE STATE IS HELD, as `e2e/genome-data-processing.spec.ts` holds it:
 * the preparation request is intercepted in A's own browser context and kept
 * open, so A's account stands in a state the server defines, and nothing here
 * seeds a row or writes a status. B reads both pages in a separate session
 * while the hold stands; A reads the Portrait's mirror in the held context.
 *
 * THE JOURNEY is the real one, as `e2e/family-coverage-states.spec.ts` drives
 * it: A declares adulthood and invites B through the invite screen and the
 * mail worker; B accepts in their own account and prepares a file with the
 * estimates layer chosen; every permission the two pages need is signed in
 * the permission UI from the signer's own session, in both directions; each
 * adult acknowledges the Portrait in their own session; and only then does A
 * add a file whose preparation is held.
 *
 * Execution needs the isolated disposable mail queue and the local Resend
 * capture on port 8124, as the other Family specs do.
 */

const RUN_ID = randomUUID();
const A = { email: `family-proc-a-${RUN_ID}@e2e.local`, password: "e2e-family-proc-pw" };
const B = { email: `family-proc-b-${RUN_ID}@e2e.local`, password: "e2e-family-proc-pw" };
const TINY_FIXTURE = path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf");
/** The joint grant that opens a column, the two layer grants, and the Portrait grant, signed in both directions. */
const GRANTED_PURPOSES = ["family.heritability", "reports.monogenic", "reports.polygenic", "family.portrait"] as const;
type GrantedPurpose = (typeof GRANTED_PURPOSES)[number];
const PORTRAIT_GATE_CHECKBOX = "I understand this can tell me something I can’t un-know.";

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
let selfSubjectB = "";
/** B's record as A's invitation created it: the handle A's grants toward B are signed against. */
let representativeB = "";
let pairId = "";
let heldFileId = "";
/** A's own browser context, kept open with the preparation request held. */
let heldContext: BrowserContext;
let release: () => void = () => {};

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
          .end(JSON.stringify({ id: `family-proc-${captured.length}` }));
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
  release();
  await heldContext?.close();
  if (resendMock) await new Promise<void>((resolve) => resendMock.close(() => resolve()));
});

async function selfSubjectOf(accountId: string): Promise<string> {
  const { data, error } = await adminClient().from("subjects").select("id")
    .eq("subject_account_id", accountId).eq("subject_class", "self").eq("lifecycle", "active").single();
  expect(error).toBeNull();
  return data!.id;
}

/** The open pair between two self records, created by the accepted invitation; the Portrait route is keyed on it. */
async function pairBetween(selfA: string, selfB: string): Promise<string> {
  const { data, error } = await adminClient().from("family_pairs").select("id, subject_a_id, subject_b_id, status")
    .in("status", ["pending", "current"])
    .or(`subject_a_id.eq.${selfA},subject_b_id.eq.${selfA}`);
  expect(error).toBeNull();
  const pair = (data as { id: string; subject_a_id: string; subject_b_id: string }[])
    .find((row) => row.subject_a_id === selfB || row.subject_b_id === selfB);
  expect(pair, "the accepted invitation created the pair the Portrait route is keyed on").toBeTruthy();
  return pair!.id;
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

/** One signed purpose grant toward one person, through the real permission UI, from the signer's own session. */
async function grantPurpose(page: Page, recipientSubjectId: string, purpose: GrantedPurpose) {
  await page.goto(`/family/s-${recipientSubjectId}/permissions`);
  const label = PERMISSION_ROWS.find((row) => row.id === purpose)!.label;
  const row = page.locator('[data-slot="permission-column"][data-settable="true"] [data-slot="permission-row"]')
    .filter({ has: page.locator('[data-slot="permission-label"]', { hasText: new RegExp(`^${label}$`) }) });
  await expect(row.locator('[data-slot="permission-state"]')).toHaveText("Off");
  const control = row.getByRole("button", { name: /^Turn on / });
  await expect(control, `${purpose}: this row offers no control in this session`).toBeVisible({ timeout: 30_000 });
  const signed = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith("/api/consents"));
  await control.click();
  expect((await signed).status()).toBe(201);
  await expect(row.locator('[data-slot="permission-state"]')).toHaveText("On");
}

/** One person's own Portrait acknowledgement, through the real checkbox in their own session. */
async function acknowledgePortrait(page: Page) {
  await page.goto(`/family/portrait/${pairId}`);
  const form = page.locator('[data-slot="portrait-acknowledge"]');
  await expect(form.getByRole("checkbox")).not.toBeChecked();
  await form.getByRole("checkbox").check();
  const stamped = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith("/api/family/acknowledge"));
  await form.getByRole("button", { name: ACKNOWLEDGE_BUTTON }).click();
  expect((await stamped).ok()).toBe(true);
  await expect(form).toHaveCount(0);
}

/** Past the Portrait's Tier-2 gate, with every step of both adults done. */
async function openPortraitPastGate(page: Page) {
  await page.goto(`/family/portrait/${pairId}`);
  await expect(page.getByRole("heading", { level: 1, name: PORTRAIT_H1 })).toBeVisible();
  await expect(page.locator('[data-slot="portrait-blocking"], [data-slot="portrait-acknowledge"]')).toHaveCount(0);
  await expect(page.getByText(PORTRAIT_GATE_CHECKBOX, { exact: true })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: GATE_BUTTON }).click();
  await expect(page.locator('[data-slot="portrait-header-sentence"]')).toBeVisible();
}

test("A invites B, B accepts and prepares a file, both sign every permission both ways and acknowledge the Portrait, then A adds a file whose preparation is held", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(900_000);
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
  selfSubjectB = await selfSubjectOf(accountB);
  const principal = await admin.from("subject_principals").select("id")
    .eq("account_id", accountA).eq("subject_id", selfSubjectA).eq("principal_kind", "account_subject")
    .eq("status", "active").single();
  expect(principal.error).toBeNull();
  const invitation = await admin.from("subject_invitations").select("target_id")
    .eq("invitation_kind", "adult_subject").eq("inviter_principal_id", principal.data!.id)
    .eq("status", "accepted").single();
  expect(invitation.error).toBeNull();
  representativeB = invitation.data!.target_id;
  expect(representativeB).not.toBe(selfSubjectB);

  // B's own file, prepared through the real journey with the estimates layer
  // chosen, so B's own column and B's side of the Portrait have a source and
  // the only side without one is A's.
  await page.request.post("/auth/sign-out");
  await signIn(page, B.email, B.password);
  const sourceFileId = await uploadOwnFileWithChosenReports(page, TINY_FIXTURE, {
    fileType: "vcf", purposes: ["reports.polygenic"],
  });
  const source = await admin.from("genome_files").select("subject_id, single_logical_sample_verified_at")
    .eq("id", sourceFileId).single();
  expect(source.error).toBeNull();
  expect(source.data).toMatchObject({ subject_id: selfSubjectB });
  expect(source.data!.single_logical_sample_verified_at, "B's file is prepared, not in flight").not.toBeNull();

  // Each direction is signed from its own account's own session: B toward A
  // against A's own record, A toward B against the record A's invitation
  // created. Then each adult's own Portrait acknowledgement.
  for (const purpose of GRANTED_PURPOSES) await grantPurpose(page, selfSubjectA, purpose);
  pairId = await pairBetween(selfSubjectA, selfSubjectB);
  await acknowledgePortrait(page);
  await page.request.post("/auth/sign-out");
  await signIn(page, A.email, A.password);
  for (const purpose of GRANTED_PURPOSES) await grantPurpose(page, representativeB, purpose);
  await acknowledgePortrait(page);
  await page.request.post("/auth/sign-out");

  // A's file, in A's own context, with the preparation request held open:
  // finalized and stored, and the state these tests wait inside is the
  // server's, not the test's.
  heldContext = await browser.newContext();
  const holder = await heldContext.newPage();
  await signIn(holder, A.email, A.password);
  const held = new Promise<void>((resolve) => { release = resolve; });
  await holder.route("**/api/files/*/process", async (route) => {
    await held;
    await route.continue();
  }, { times: 1 });
  heldFileId = await uploadOwnFileThroughUi(holder, TINY_FIXTURE);
  const stored = await admin.from("genome_files").select("status, subject_id, single_logical_sample_verified_at")
    .eq("id", heldFileId).single();
  expect(stored.error).toBeNull();
  expect(stored.data).toMatchObject({ status: "uploaded", subject_id: selfSubjectA, single_logical_sample_verified_at: null });
});

test("/family/health-picture processing: the other adult's column says their file is still being prepared, and nothing on the page says the file is absent", async ({
  page,
}) => {
  expect(heldFileId && pairId, "the journey above ran").toBeTruthy();
  await signIn(page, B.email, B.password);
  await page.goto("/family/health-picture");

  // The domain's one Tier-2 gate stands in front of the record.
  await expect(page.getByText(GATE_CHECKBOX_LABEL, { exact: true })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: GATE_BUTTON }).click();
  await expect(page.locator("[data-compare-surface]").first()).toBeVisible();

  // A's column is on the page under the joint grant, and its status is the
  // in-flight sentence: not the absent-file sentence, and no result.
  const estimates = page.locator('[data-compare-surface][data-layer="estimate"]');
  await expect(estimates).toHaveCount(1);
  await expect(estimates.locator(`th[data-subject-id="${selfSubjectA}"]`)).toHaveCount(1);
  const statusOfA = estimates.locator(
    `[data-slot="health-picture-column-status"] [data-claim-block][data-subject-id="${selfSubjectA}"]`,
  );
  await expect(statusOfA).toHaveCount(1);
  await expect(statusOfA.locator('[data-slot="cell-absence"]')).toHaveText(CELL_FILE_PREPARING);
  await expect(statusOfA.locator("[data-figure-kind]")).toHaveCount(0);

  // Every one of A's cells in B's rows reads the same sentence and carries
  // nothing else: no letters, no link, no coverage figure.
  const cellsOfA = estimates.locator(
    `[data-slot="health-picture-cell"] [data-claim-block][data-subject-id="${selfSubjectA}"]`,
  );
  const count = await cellsOfA.count();
  expect(count, "B's own results give the table rows for A's cells to appear in").toBeGreaterThan(0);
  for (let index = 0; index < count; index++) {
    await expect(cellsOfA.nth(index).locator('[data-slot="cell-absence"]')).toHaveText(CELL_FILE_PREPARING);
    await expect(cellsOfA.nth(index).locator("[data-figure-kind]")).toHaveCount(0);
    await expect(cellsOfA.nth(index).locator("a")).toHaveCount(0);
  }

  // The absent-file sentence is nowhere on the page, and B's own column is
  // untouched: B's letters are still B's.
  await expect(page.getByText(CELL_NO_PREPARED_FILE, { exact: true })).toHaveCount(0);
  const lettersOfB = estimates.locator(
    `[data-slot="health-picture-cell"] [data-claim-block][data-subject-id="${selfSubjectB}"] [data-figure-kind="genotype"]`,
  );
  expect(await lettersOfB.count()).toBeGreaterThan(0);

  // The hold still stands: the state read above is the server's.
  const stored = await adminClient().from("genome_files").select("status").eq("id", heldFileId).single();
  expect(stored.error).toBeNull();
  expect(stored.data!.status).toBe("uploaded");
});

test("/family/portrait/[pairId] processing: the page says the other adult's file is still being prepared, in the right person on each side, and derives nothing", async ({
  page,
}) => {
  expect(heldFileId && pairId, "the journey above ran").toBeTruthy();

  // B's reading: A's file is in flight, named; B's own side has a source and
  // gets no sentence. This is the register's `processing` on this route, and
  // the file-absent sentences of its other state are asserted absent.
  await signIn(page, B.email, B.password);
  await openPortraitPastGate(page);
  const preparing = page.locator('main [role="status"][data-state="processing"]');
  await expect(preparing).toHaveCount(1);
  const sentences = await preparing.locator("p").allInnerTexts();
  expect(sentences).toHaveLength(1);
  expect(sentences[0]).toMatch(/’s file is still being prepared\. There is nothing to show yet\.$/u);
  expect(sentences[0]).not.toBe(VIEWER_FILE_PREPARING);
  await expect(page.locator('main [role="status"][data-state="empty"]')).toHaveCount(0);
  await expect(page.getByText(VIEWER_NO_FILE_YET, { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-slot="portrait-empty"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="portrait-outputs"]')).toHaveCount(0);
  await expect(page.locator("[data-claim-block], [data-figure-kind]")).toHaveCount(0);
  await expect(page.locator("[data-exact-marker], [data-modelled-marker], [data-slot=outcome-dot]")).toHaveCount(0);
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/(^|[^\d])0%/);
  expect(text).not.toMatch(/\b0 in 100\b/);
  await page.request.post("/auth/sign-out");

  // A's reading, in the held context: A's own file in the second person, and
  // nothing about B, whose file is prepared. A page that showed A's sentence
  // to B, or named B's file as in flight, would be a disclosure defect.
  const mirror = await heldContext.newPage();
  await openPortraitPastGate(mirror);
  const preparingForA = mirror.locator('main [role="status"][data-state="processing"]');
  await expect(preparingForA).toHaveCount(1);
  await expect(preparingForA.locator("p")).toHaveText([VIEWER_FILE_PREPARING]);
  await expect(mirror.locator('main [role="status"][data-state="empty"]')).toHaveCount(0);
  await expect(mirror.locator("[data-claim-block], [data-figure-kind]")).toHaveCount(0);
  await mirror.close();

  const stored = await adminClient().from("genome_files").select("status").eq("id", heldFileId).single();
  expect(stored.error).toBeNull();
  expect(stored.data!.status, "the hold stood for every read above").toBe("uploaded");
});
