import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import http from "node:http";
import {
  acceptAdultInvitation,
  adminClient,
  adultInvitationToken,
  adultInvitationUrl,
  createConfirmedUser,
  drainMailUntil,
  signIn,
} from "./helpers";
import { OWN_UPLOAD_COPY } from "@/copy/upload/consent";
import {
  ACKNOWLEDGE_BUTTON,
  PORTRAIT_H1,
  VIEWER_NO_FILE_YET,
} from "@/copy/family/portrait";
import { adultDateRequiredFrom } from "@/copy/family/permissions";

/** B's self subject carries the default label, so A sees the invited record's name. */
const B_AS_SEEN_BY_A = "Invited adult";

/**
 * `/family/portrait/[pairId] empty` — the pair exists, both permissions are
 * on, both adults have acknowledged, and NEITHER has added a file.
 *
 * WHY THIS IS ITS OWN FILE, which is the useful part of this header.
 * `e2e/portrait.spec.ts` builds the same pair and then uploads for both, so
 * every state it reaches has files behind it. The obvious way to reach this
 * one from there — delete a file at the end — does not work, and the reason
 * is deliberate product behaviour rather than a fixture problem:
 * `prepare_genome_file_deletion_v1` refuses with `file_delete_shared_graph`
 * (surfaced as 409 `file_delete_subject_unavailable`) as soon as a
 * `family_pairs` row names the subject, because "these graph cases need their
 * existing subject-level disposition, not a file shortcut that might remove
 * another adult's shared working data". Measured 2026-09-13: the delete
 * control on `/files` answers 409 for exactly that reason. So the state is
 * only reachable from the other end — grants before any file — and that is
 * what this file builds.
 *
 * It is also the honest order of events for a real pair. Two people can agree
 * to compare before either has uploaded anything, and what the page says in
 * that window is a disclosure question: it names WHICH of them has nothing,
 * in the second person to that person and by name to the other.
 *
 * The page's four no-output branches are told apart in
 * `e2e/portrait.spec.ts`'s `not-covered` test; this one asserts the other
 * side of the same distinction — `data-state=empty` present with no
 * `data-slot`, and `data-slot=portrait-empty` absent.
 */

const A = { email: `portrait-nofile-a-${randomUUID()}@e2e.local`, password: "e2e-portrait-pw" };
const B = { email: `portrait-nofile-b-${randomUUID()}@e2e.local`, password: "e2e-portrait-pw" };
const INVITEE_LABEL = "Invited adult";
const GATE_CHECKBOX = "I understand this can tell me something I can’t un-know.";
const GATE_BUTTON = "Show what’s shared";
const FORBIDDEN_MEDIA = "main img, main canvas, main svg[role=img]";

interface CapturedEmail { to: string[] | string; html?: string }
const captured: CapturedEmail[] = [];
let resendMock: http.Server;

let accountA = "";
let accountB = "";
let selfSubjectA = "";
let selfSubjectB = "";
let invitedSubjectB = "";
let pairId = "";
let pairSubjectIds: string[] = [];

test.use({ trace: "off" }); // Signed grant bearers stay out of traces.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  resendMock = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      if (request.method === "POST" && request.url?.includes("/emails")) {
        captured.push(JSON.parse(body) as CapturedEmail);
        response.writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ id: `portrait-nofile-${captured.length}` }));
        return;
      }
      response.writeHead(200).end("{}");
    });
  });
  await new Promise<void>((resolve) => resendMock.listen(8124, "127.0.0.1", resolve));
  accountA = await createConfirmedUser(A.email, A.password);
  accountB = await createConfirmedUser(B.email, B.password);
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => resendMock.close(() => resolve()));
});

async function selfSubjectOf(accountId: string): Promise<string> {
  const { data, error } = await adminClient().from("subjects").select("id")
    .eq("subject_account_id", accountId).eq("subject_class", "self").eq("lifecycle", "active").single();
  expect(error).toBeNull();
  return (data as { id: string }).id;
}

/** The real permission POST from the current account, as `e2e/portrait.spec.ts` does it. */
async function grantPortrait(page: Page, recipientHandle: string) {
  await page.goto(`/family/s-${recipientHandle}/permissions`);
  const row = page.locator('[data-slot="permission-column"][data-settable="true"] [data-slot="permission-row"]')
    .filter({ has: page.locator('[data-slot="permission-label"]', { hasText: /^Portrait$/ }) });
  await expect(row.locator('[data-slot="permission-state"]')).toHaveText("Off");
  const response = page.waitForResponse((reply) =>
    reply.url().endsWith("/api/consents") && reply.request().method() === "POST");
  await row.getByRole("button", { name: /Turn on/ }).click();
  expect((await response).status()).toBe(201);
  await expect(row.locator('[data-slot="permission-state"]')).toHaveText("On");
}

async function acknowledge(page: Page) {
  const form = page.locator('[data-slot="portrait-acknowledge"]');
  await expect(form.getByRole("checkbox")).not.toBeChecked();
  await form.getByRole("checkbox").check();
  // The form posts and then refreshes the page. Wait for the server's answer
  // and for the refreshed page to drop the form: a sign-out issued straight
  // after this call can otherwise overtake the request, and the step is never
  // stamped (D-127, main run 35319131306).
  const response = page.waitForResponse((reply) =>
    reply.url().endsWith("/api/family/acknowledge") && reply.request().method() === "POST");
  await form.getByRole("button", { name: ACKNOWLEDGE_BUTTON }).click();
  expect((await response).status()).toBe(200);
  await expect(form).toHaveCount(0);
}

test("two adults agree to compare before either has added a file", async ({ page, request }) => {
  // A's account declaration, which the invitation needs and an upload would
  // otherwise have carried. Nothing is uploaded here or anywhere below.
  await signIn(page, A.email, A.password);
  await page.goto("/files/upload");
  await expect(page.getByRole("heading", { name: OWN_UPLOAD_COPY.accountHeading, exact: true })).toBeVisible();
  await page.getByLabel(OWN_UPLOAD_COPY.birthDateLabel).fill("1990-01-01");
  const completed = page.waitForResponse((reply) =>
    reply.url().endsWith("/api/account/completion") && reply.request().method() === "POST");
  await page.getByRole("button", { name: OWN_UPLOAD_COPY.accountContinue, exact: true }).click();
  expect((await completed).status()).toBe(200);

  await page.goto("/family/invite");
  await page.getByLabel("Their email address").fill(B.email);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation requested");
  const token = await drainMailUntil(request, () => adultInvitationToken(captured
    .find((email) => (Array.isArray(email.to) ? email.to : [email.to]).includes(B.email))
    ?.html), "the invitation");

  await page.request.post("/auth/sign-out");
  await acceptAdultInvitation({
    page, invitationUrl: adultInvitationUrl(token), email: B.email, password: B.password,
  });

  // D-102, ON THE ONE STATE IT DESCRIBES, before the fixture works around it.
  //
  // `family_report_endpoint_v1` builds the grant presentation from BOTH
  // profiles and requires a date of birth at or over eighteen on each, so
  // right now — A completed, B not — A's Portrait control is unsettable. It
  // used to render an empty `permission-locked` paragraph; since the signed
  // copy of 2026-09-14 it names the reason and, by the owner's decision,
  // names the person.
  //
  // What is asserted is the whole of what attribution accepts and the whole
  // of what it refuses: the sentence names B, and it does not say which of
  // the two non-adult answers applies. `adultOnRecord` collapses the
  // database's three-valued `birthDateState` for exactly that reason, so the
  // words below are the only ones a reader can get in either case.
  const invitedSubjectForD102 = await (async () => {
    const admin = adminClient();
    const inviter = await admin.from("subject_principals").select("id")
      .eq("account_id", accountA).eq("subject_id", await selfSubjectOf(accountA))
      .eq("principal_kind", "account_subject").eq("status", "active").single();
    expect(inviter.error).toBeNull();
    const invitation = await admin.from("subject_invitations").select("target_id")
      .eq("inviter_principal_id", inviter.data!.id).eq("invitation_kind", "adult_subject")
      .eq("status", "accepted").single();
    expect(invitation.error).toBeNull();
    return (invitation.data as { target_id: string }).target_id;
  })();
  await page.request.post("/auth/sign-out");
  await signIn(page, A.email, A.password);
  await page.goto(`/family/s-${invitedSubjectForD102}/permissions`);
  const beforeB = page
    .locator('[data-slot="permission-column"][data-settable="true"] [data-slot="permission-row"]')
    .filter({ has: page.locator('[data-slot="permission-label"]', { hasText: /^Portrait$/ }) });
  await expect(beforeB.locator('[data-slot="permission-control"]'),
    "unsettable while the recipient has no date of birth on record").toHaveCount(0);
  await expect(beforeB.locator('[data-slot="permission-locked"]'))
    .toHaveText(adultDateRequiredFrom(B_AS_SEEN_BY_A));
  // Never the empty paragraph the defect was, on any row of either column.
  for (const locked of await page.locator('[data-slot="permission-locked"]').allTextContents()) {
    expect(locked.trim(), "no locked row renders an empty reason").not.toBe("");
  }
  // And never a word that would tell a reader WHICH answer applies.
  const body = (await page.locator("main").innerText()).toLowerCase();
  for (const word of ["under 18", "under eighteen", "minor", "too young"]) {
    expect(body, `the page never says "${word}"`).not.toContain(word);
  }
  await page.request.post("/auth/sign-out");
  await signIn(page, B.email, B.password);

  // B's own account declaration, in B's own session, which clears the state
  // above. Completing both accounts is what the rest of this file needs; it
  // is not a step the portrait state itself requires.
  await page.goto("/files/upload");
  await expect(page.getByRole("heading", { name: OWN_UPLOAD_COPY.accountHeading, exact: true })).toBeVisible();
  await page.getByLabel(OWN_UPLOAD_COPY.birthDateLabel).fill("1991-02-02");
  const completedB = page.waitForResponse((reply) =>
    reply.url().endsWith("/api/account/completion") && reply.request().method() === "POST");
  await page.getByRole("button", { name: OWN_UPLOAD_COPY.accountContinue, exact: true }).click();
  expect((await completedB).status()).toBe(200);
  await page.request.post("/auth/sign-out");

  const admin = adminClient();
  selfSubjectA = await selfSubjectOf(accountA);
  selfSubjectB = await selfSubjectOf(accountB);
  const inviter = await admin.from("subject_principals").select("id")
    .eq("account_id", accountA).eq("subject_id", selfSubjectA)
    .eq("principal_kind", "account_subject").eq("status", "active").single();
  expect(inviter.error).toBeNull();
  const invitation = await admin.from("subject_invitations").select("target_id")
    .eq("inviter_principal_id", inviter.data!.id).eq("invitation_kind", "adult_subject")
    .eq("status", "accepted").single();
  expect(invitation.error).toBeNull();
  invitedSubjectB = (invitation.data as { target_id: string }).target_id;

  // Both permissions, each from its own account, and both acknowledgements.
  await signIn(page, A.email, A.password);
  await grantPortrait(page, invitedSubjectB);
  const pairs = await admin.from("family_pairs").select("id,status,subject_a_id,subject_b_id")
    .or(`subject_a_id.eq.${selfSubjectA},subject_b_id.eq.${selfSubjectA}`);
  expect(pairs.error).toBeNull();
  expect(pairs.data).toHaveLength(1);
  const pair = (pairs.data as { id: string; subject_a_id: string; subject_b_id: string }[])[0];
  pairId = pair.id;
  pairSubjectIds = [pair.subject_a_id, pair.subject_b_id];
  await page.goto(`/family/portrait/${pairId}`);
  await acknowledge(page);
  await page.request.post("/auth/sign-out");

  await signIn(page, B.email, B.password);
  await grantPortrait(page, selfSubjectA);
  await page.goto(`/family/portrait/${pairId}`);
  await acknowledge(page);
  await page.request.post("/auth/sign-out");

  // The fixture's whole claim: two adults, every step done, and no file
  // anywhere. Asserted from the database so the state below cannot be read as
  // a file that failed to appear.
  const files = await admin.from("genome_files").select("id").in("user_id", [accountA, accountB]);
  expect(files.error).toBeNull();
  expect(files.data).toEqual([]);
  const live = await admin.from("purpose_grants").select("target_id")
    .in("target_id", [selfSubjectA, selfSubjectB, invitedSubjectB])
    .eq("purpose", "family.portrait").is("revoked_at", null);
  expect(live.error).toBeNull();
  expect(live.data).toHaveLength(2);
  // Every step the page checks, stamped for both people, read back from the
  // database: the acknowledgement each adult gave and the sign-in each made
  // on their own. A fixture that only clicked could leave either unstamped.
  const stamped = await admin.from("subjects").select("id,portrait_acknowledged_at,independent_login_at")
    .in("id", pairSubjectIds);
  expect(stamped.error).toBeNull();
  expect(stamped.data).toHaveLength(2);
  for (const row of stamped.data as { id: string; portrait_acknowledged_at: string | null; independent_login_at: string | null }[]) {
    expect(row.portrait_acknowledged_at, `${row.id} acknowledged before any test runs`).not.toBeNull();
    expect(row.independent_login_at, `${row.id} signed in on their own before any test runs`).not.toBeNull();
  }
});

test("/family/portrait/[pairId] empty: with no file on either side the page names who has nothing, in the right person, and derives nothing", async ({
  page,
}) => {
  await signIn(page, A.email, A.password);
  await page.goto(`/family/portrait/${pairId}`);

  // Past the domain's one Tier-2 gate, which stands whether or not there is
  // anything behind it.
  await expect(page.getByRole("heading", { level: 1, name: PORTRAIT_H1 })).toBeVisible();
  await expect(page.locator('[data-slot="portrait-blocking"]')).toHaveCount(0);
  await expect(page.getByText(GATE_CHECKBOX, { exact: true })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: GATE_BUTTON }).click();

  // Two sentences, because neither adult has a file: A's own in the second
  // person, B's naming B. This is the register's `empty` on this route.
  const empty = page.locator('main [role="status"][data-state="empty"]');
  await expect(empty).toHaveCount(1);
  await expect(empty.locator("p")).toHaveText([
    VIEWER_NO_FILE_YET,
    `${INVITEE_LABEL} hasn’t added a file yet. There is nothing to show.`,
  ]);

  // Not the `not-covered` branch, which needs prepared files to reach, and
  // not a result of any kind.
  await expect(page.locator('[data-slot="portrait-empty"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="portrait-outputs"]')).toHaveCount(0);
  await expect(page.locator("[data-claim-block]")).toHaveCount(0);
  await expect(page.locator("[data-figure-kind]")).toHaveCount(0);
  await expect(page.locator("[data-exact-marker], [data-modelled-marker], [data-slot=outcome-dot]")).toHaveCount(0);
  await expect(page.locator(FORBIDDEN_MEDIA)).toHaveCount(0);
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/(^|[^\d])0%/);
  expect(text).not.toMatch(/\b0 in 100\b/);

  // B reads the mirror image: B's own sentence in the second person, A's by
  // name. A page that showed the viewer's copy to the other adult would be a
  // disclosure defect rather than a wording one.
  await page.request.post("/auth/sign-out");
  await signIn(page, B.email, B.password);
  await page.goto(`/family/portrait/${pairId}`);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: GATE_BUTTON }).click();
  const emptyForB = page.locator('main [role="status"][data-state="empty"]');
  await expect(emptyForB).toHaveCount(1);
  const sentences = await emptyForB.locator("p").allInnerTexts();
  expect(sentences).toHaveLength(2);
  expect(sentences.filter((sentence) => sentence === VIEWER_NO_FILE_YET)).toHaveLength(1);
  expect(sentences.some((sentence) => /hasn’t added a file yet\. There is nothing to show\.$/u.test(sentence))).toBe(true);
  await expect(page.locator("[data-claim-block]")).toHaveCount(0);
});
