import { expect, test, type Page } from "@playwright/test";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  drainMailUntil,
  adminClient,
  createConfirmedUser,
  expectAxeClean,
  firstViewportInteractives,
  signIn,
} from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { INDEPENDENT_LOGIN_REQUIRED } from "@/copy/family/permissions";
import { OWN_UPLOAD_COPY } from "@/copy/upload/consent";

/**
 * Family surfaces (design docs/design/w9-family-surfaces.md §6.2): the hub,
 * the invite screen, one person, the two permission columns and the
 * pause / resume / stop lifecycle, over two real accounts with a real
 * accepted invitation and a real processed file.
 *
 * What it pins: the two public panels survive the route-group move; the
 * signed-in hub keeps its heading, its one primary action and the X6.1
 * budget; a card says nothing about another adult's files before a grant;
 * the Tier-2 gate withholds every result server-side; a shared report is
 * attributed to the counterpart's own subject; and pause and stop take
 * effect on the very next request.
 *
 * Execution needs an isolated disposable mail queue (the real worker is global)
 * and a local Resend capture reachable from the app. Do not run its mail drain
 * against a preserved shared stack without reviewing every eligible queue item.
 */

const runId = randomUUID();
const A = { email: `family-a-${runId}@e2e.local`, password: "e2e-family-pw" };
const B = { email: `family-b-${runId}@e2e.local`, password: "e2e-family-pw" };
const SOURCE_PATH = path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf");

/** B's self subject carries the default label, so A sees the invited record's name. */
const B_AS_SEEN_BY_A = "Invited adult";
/** A's self subject carries the default label too, and so does its handle. */
const A_AS_SEEN_BY_B = "Another adult";

const PRE_CONSENT =
  "Comparing two people’s DNA can show that they are related, or not related, in ways neither expected. Inherit cannot un-see this.";
const GATE_CHECKBOX = "I understand this can tell me something I can’t un-know.";
const GATE_SESSION = "You won’t be asked again until you sign out.";
const BASELINE_ABSENT =
  "No baseline: Inherit does not know this person’s sex and age band.";
const NOT_SHARED = `${B_AS_SEEN_BY_A} has not shared anything with you yet. You will see nothing here until they do.`;
/** The same sentence the other way round, for B's view of A. Retyped rather
 *  than imported, as NOT_SHARED is: the assertion is that the copy reaches the
 *  reader, not that the copy module agrees with itself. */
const NOT_SHARED_BY_A = `${A_AS_SEEN_BY_B} has not shared anything with you yet. You will see nothing here until they do.`;
const PAUSED_BODY =
  "Sharing with this person is paused. Nothing about them shows here until one of you resumes it.";

/** The four templates the tiny fixture covers (e2e/overview.spec.ts pins the same set). */
const COVERED_SLUGS = [
  "muscle-composition-actn3-rs1815739",
  "sprint-power-actn3",
  "caffeine-metabolism-cyp1a2-rs762551",
  "lactase-persistence-lct-rs4988235",
];

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
] as const;

interface CapturedEmail {
  to: string[] | string;
  subject: string;
  html?: string;
}

const captured: CapturedEmail[] = [];
let resendMock: http.Server;
let invitedSubjectId = "";
let selfSubjectA = "";
let selfSubjectB = "";
let accountA = "";
let accountB = "";
let sourceFileId = "";
let selfReportGrantId = "";
let sourceBefore: Record<string, unknown>;

test.use({ trace: "off" }); // Restricted upload/presentation bearers stay out of traces.

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
          .end(JSON.stringify({ id: `family-${captured.length}` }));
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
  return data!.id;
}

/** One live, revision-matched direction; self analysis never counts as sharing. */
async function liveGrants(subjectId: string, recipientId: string, direction: "self" | "subject_to_recipient") {
  const admin = adminClient();
  const bases = await admin.from("purpose_grants").select("grant_id,grant_revision,purpose,target_id,revoked_at")
    .eq("target_id", subjectId).is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  expect(bases.error).toBeNull();
  if (!bases.data!.length) return [];
  const directions = await admin.from("directional_grants").select("grant_id,grant_revision")
    .in("grant_id", bases.data!.map(row => row.grant_id)).eq("recipient_account_id", recipientId)
    .eq("direction", direction).eq("status", "current");
  expect(directions.error).toBeNull();
  return bases.data!.filter(base => directions.data!.some(row => row.grant_id === base.grant_id
    && row.grant_revision === base.grant_revision)).sort((a, b) => a.purpose.localeCompare(b.purpose));
}

async function sourceReceipt() {
  const result = await adminClient().from("genome_files")
    .select("id,user_id,subject_id,status,file_type,bucket_path,sha256,upload_revision,normalization_source_revision,normalization_completed_at")
    .eq("id", sourceFileId).eq("user_id", accountB).single();
  expect(result.error).toBeNull();
  return result.data!;
}

async function expectOwnSourceAndGrantPreserved() {
  expect(await sourceReceipt()).toEqual(sourceBefore);
  const own = await liveGrants(selfSubjectB, accountB, "self");
  expect(own).toHaveLength(1);
  expect(own[0]).toMatchObject({ grant_id: selfReportGrantId, purpose: "reports.polygenic" });
}

async function expectNoResults(page: Page) {
  await expect(page.locator("[data-figure-kind]")).toHaveCount(0);
  await expect(page.locator("[data-claim-block]")).toHaveCount(0);
}

test("/family signed out keeps the two required panels ahead of any sign-in wall", async ({
  page,
}) => {
  await page.goto("/family");
  await expect(page.getByRole("heading", { level: 1, name: "Family" })).toBeVisible();
  // L-22: the future-person panel is in the unauthenticated server-rendered HTML.
  const html = await page.content();
  expect(html).toContain("If a child is born from this");
  await expect(
    page.getByRole("heading", { name: "Not available in any production jurisdiction yet" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Read the Future Person Charter" }),
  ).toHaveAttribute("href", "/legal/future-person");
  await expectNoResults(page);
});

/**
 * `/family empty`. The hub for an account that has no family yet, and it says
 * so in words - "Just you so far." - rather than rendering an absence the
 * reader has to infer. That is the test this repository applies, and this is
 * a cleaner case of it than most: the page IS the family, the family holds
 * one person, and the single primary action is the one that would change
 * that.
 *
 * Ordering carries the claim. This spec is serial and the account is paired
 * with a second one in a later test, so `empty` here is a real state of a
 * real account at this point in the run, not an artefact of a fixture that
 * happens not to have been populated.
 */
test("/family empty: the hub says only you are here, with one primary action and the first-viewport budget", async ({
  page,
}) => {
  await signIn(page, A.email, A.password);
  await page.goto("/family");
  await expect(page.getByRole("heading", { level: 1, name: "Family" })).toBeVisible();
  // Six headings is the cap for an app surface; this hub uses four.
  const headings = page.locator("main :is(h1, h2, h3, h4, h5, h6)");
  expect(await headings.count()).toBeLessThanOrEqual(6);
  await expect(page.getByText("Just you so far.", { exact: true })).toBeVisible();

  const primary = page.locator('main [data-variant="default"]');
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveText("Add another adult");
  await expect(page.getByRole("link", { name: "Add another adult" })).toHaveAttribute(
    "href",
    "/family/invite",
  );

  // Every rendered link answers 200: a tile with no destination carries its
  // blocking sentence instead of a dead link.
  const hrefs = await page.locator("main a[href^='/']").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("href")!),
  );
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of new Set(hrefs)) {
    const response = await page.request.get(href);
    expect(response.status(), href).toBe(200);
  }
  for (const tile of ["individual-risks", "portrait", "copilot"]) {
    const section = page.locator(`[data-tile="${tile}"]`);
    await expect(section).toBeVisible();
    if ((await section.locator("a").count()) === 0) {
      await expect(section.locator('[data-slot="tile-blocked"]')).not.toHaveText("");
    }
  }

  await expectNoResults(page);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(() => document.fonts.ready);
    const interactives = await firstViewportInteractives(page);
    expect(interactives.length, `${viewport.name}: ${interactives.join(" | ")}`).toBeLessThanOrEqual(12);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectAxeClean(page);
});

test("/family/invite states the pre-consent sentence above the form and offers no Path B", async ({
  page,
}) => {
  await signIn(page, A.email, A.password);
  await page.goto("/family/invite");
  await expect(page.getByRole("heading", { level: 1, name: "Invite another adult" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Invite them." })).toBeVisible();

  const statement = page.locator('[data-slot="pre-consent-statement"]');
  await expect(statement).toHaveText(PRE_CONSENT);
  // Non-collapsible, and above the form.
  await expect(page.locator("details", { hasText: PRE_CONSENT })).toHaveCount(0);
  const statementBox = await statement.boundingBox();
  // The invite form, not the shell's sign-out form in the account landmark.
  const formBox = await page
    .locator("form")
    .filter({ has: page.getByLabel("Their email address") })
    .boundingBox();
  expect(statementBox!.y).toBeLessThan(formBox!.y);

  await expect(page.getByLabel("A note for them")).toBeVisible();
  // Path B has no screen, so its secondary link is not rendered.
  await expect(page.getByText("They can’t use Inherit themselves")).toHaveCount(0);
});

test("A invites B, B accepts, adds a file and shares one layer from their own session", async ({
  page,
  request,
}) => {
  await signIn(page, A.email, A.password);
  // Recipient adulthood is a real account declaration, separate from any DNA
  // upload or report permission. Stop at the next disclosure without signing it.
  await page.goto("/files/upload");
  await expect(page.getByRole("heading", { name: OWN_UPLOAD_COPY.accountHeading, exact: true })).toBeVisible();
  await page.getByLabel(OWN_UPLOAD_COPY.birthDateLabel).fill("1990-01-01");
  const completedAccount = page.waitForResponse(response => response.url().endsWith("/api/account/completion")
    && response.request().method() === "POST");
  await page.getByRole("button", { name: OWN_UPLOAD_COPY.accountContinue, exact: true }).click();
  expect((await completedAccount).status()).toBe(200);
  await expect(page.getByRole("heading", { name: OWN_UPLOAD_COPY.insuranceHeading, exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: OWN_UPLOAD_COPY.insuranceCheckbox, exact: true })).not.toBeChecked();
  await page.goto("/family/invite");
  await page.getByLabel("Their email address").fill(B.email);
  await page.getByLabel("A note for them").fill("This is my note.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation requested");

  const message = await drainMailUntil(request, () => captured.find((email) =>
    (Array.isArray(email.to) ? email.to : [email.to]).includes(B.email),
  ), "the invitation");
  // The optional note travels as words, never as a link.
  expect(message.html).toContain("This is my note.");
  expect(message.html).not.toMatch(/href="[^"]*This is my note/);
  const invitationUrl = message.html?.match(
    /http:\/\/localhost:3100\/withdraw\/[A-Za-z0-9_-]{43}/,
  )?.[0];
  expect(invitationUrl).toBeTruthy();

  // A's hub, before acceptance: nobody to show yet.
  await page.goto("/family");
  await expect(page.getByText("Just you so far.", { exact: true })).toBeVisible();

  // B accepts through their own account.
  await page.request.post("/auth/sign-out");
  await page.goto(invitationUrl!);
  // `/withdraw/[token]` is a registered page whose only real URL is the one an
  // invitation issues, so `e2e/a11y.spec.ts` cannot reach it and its audit is
  // here, at the same bar. Read-only: the raw token is consumed by
  // `api.rights-activate`, never by a page load.
  await expectAxeClean(page);
  await page.getByRole("link", { name: "Sign in to accept" }).click();
  await page.getByLabel("Email").fill(B.email);
  await page.getByLabel("Password").fill(B.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(invitationUrl!);
  await page.getByRole("button", { name: "Accept through my account" }).click();
  await expect(page.getByRole("heading", { name: "Invitation accepted" })).toBeVisible();

  const admin = adminClient();
  selfSubjectA = await selfSubjectOf(accountA);
  selfSubjectB = await selfSubjectOf(accountB);
  const principal = await admin.from("subject_principals").select("id")
    .eq("account_id", accountA).eq("subject_id", selfSubjectA).eq("principal_kind", "account_subject")
    .eq("status", "active").single();
  expect(principal.error).toBeNull();
  const { data: invitation, error: invitationError } = await admin
    .from("subject_invitations")
    .select("target_id")
    .eq("invitation_kind", "adult_subject")
    .eq("inviter_principal_id", principal.data!.id)
    .eq("status", "accepted")
    .single();
  expect(invitationError).toBeNull();
  invitedSubjectId = invitation!.target_id;
  expect(invitedSubjectId).not.toBe(selfSubjectB);

  // Stay in B's acceptance session. Preparation and self report generation
  // are real UI actions, separate from B's later permission for A to read them.
  sourceFileId = await uploadOwnFileWithChosenReports(page, SOURCE_PATH, {
    fileType: "vcf", purposes: ["reports.polygenic"],
  });
  sourceBefore = await sourceReceipt();
  expect(sourceBefore).toMatchObject({ status: "stored", subject_id: selfSubjectB, user_id: accountB });
  const invitedFiles = await admin.from("genome_files").select("id").eq("subject_id", invitedSubjectId);
  expect(invitedFiles.error).toBeNull();
  expect(invitedFiles.data).toEqual([]);
  const selfGrants = await liveGrants(selfSubjectB, accountB, "self");
  expect(selfGrants).toHaveLength(1);
  expect(selfGrants[0]).toMatchObject({ purpose: "reports.polygenic" });
  selfReportGrantId = selfGrants[0].grant_id;
  expect(await liveGrants(selfSubjectB, accountA, "subject_to_recipient")).toEqual([]);
  expect(await liveGrants(selfSubjectA, accountB, "subject_to_recipient")).toEqual([]);

  // B's own view of A, and the two independent columns.
  await page.goto(`/family/s-${selfSubjectA}/permissions`);
  await expect(page.getByRole("heading", { level: 1, name: "Permissions" })).toBeVisible();
  const theirs = page.locator('[data-slot="permission-column"][data-settable="false"]');
  await expect(theirs).toContainText(`What you will see about ${A_AS_SEEN_BY_B}`);
  await expect(theirs.locator('[data-slot="permission-locked"]').first()).toHaveText(
    `Only ${A_AS_SEEN_BY_B} can turn this on.`,
  );
  await expect(theirs.locator('[data-slot="permission-control"]')).toHaveCount(0);

  const yours = page.locator('[data-slot="permission-column"][data-settable="true"]');
  await expect(yours).toContainText(`What ${A_AS_SEEN_BY_B} will see about you`);
  // Seven since 2026-09-12, when `raw.browse` was split from `raw.export` so
  // that letting a relative DOWNLOAD your file and letting them READ IT ON
  // SCREEN became separate choices. Pinned exactly, not as a floor: a row
  // appearing or vanishing on the page a person uses to control what someone
  // else sees about them should never pass unremarked.
  await expect(yours.locator('[data-slot="permission-row"]')).toHaveCount(7);
  await expect(yours.locator('[data-permission-state="on"]')).toHaveCount(0);

  const estimates = yours
    .locator('[data-slot="permission-row"]')
    .filter({ has: page.locator('[data-slot="permission-label"]', { hasText: /^Statistical estimates$/ }) });
  await estimates.getByRole("button", { name: "Turn on" }).click();
  await expect(estimates.locator('[data-slot="permission-state"]')).toHaveText("On");

  // Exactly one live sharing grant in B→A, separate from B's self grant.
  const grants = await liveGrants(selfSubjectB, accountA, "subject_to_recipient");
  expect(grants).toHaveLength(1);
  expect(grants[0]).toMatchObject({ purpose: "reports.polygenic" });
  expect(await liveGrants(selfSubjectA, accountB, "subject_to_recipient")).toEqual([]);
  await expectOwnSourceAndGrantPreserved();

  // Portrait cannot be turned on from the session the invitation was
  // accepted in: the row is locked with its reason, not a dead control.
  // By the row's own label: the lock reason on other rows could otherwise match.
  const portrait = yours
    .locator('[data-slot="permission-row"]')
    .filter({ has: page.locator('[data-slot="permission-label"]', { hasText: /^Portrait$/ }) });
  await expect(portrait.locator('[data-slot="permission-locked"]')).toHaveText(
    INDEPENDENT_LOGIN_REQUIRED,
  );
  await expect(portrait.locator('[data-slot="permission-control"]')).toHaveCount(0);
  const { data: beforeMarker } = await admin
    .from("subjects")
    .select("independent_login_at")
    .eq("id", selfSubjectB)
    .single();
  expect((beforeMarker as { independent_login_at: string | null }).independent_login_at).toBeNull();

  // A sign-in of B's own, after the acceptance, stamps the marker and makes
  // the row settable; the grant then succeeds from B's own session.
  await page.request.post("/auth/sign-out");
  await signIn(page, B.email, B.password);
  await page.goto(`/family/s-${selfSubjectA}/permissions`);
  const portraitAfter = page
    .locator('[data-slot="permission-column"][data-settable="true"] [data-slot="permission-row"]')
    .filter({ has: page.locator('[data-slot="permission-label"]', { hasText: /^Portrait$/ }) });
  await expect(portraitAfter.locator('[data-slot="permission-locked"]')).toHaveCount(0);
  await portraitAfter.getByRole("button", { name: "Turn on" }).click();
  await expect(portraitAfter.locator('[data-slot="permission-state"]')).toHaveText("On");
  const { data: afterMarker } = await admin
    .from("subjects")
    .select("independent_login_at")
    .eq("id", selfSubjectB)
    .single();
  expect((afterMarker as { independent_login_at: string | null }).independent_login_at).not.toBeNull();
  const grantsAfter = await liveGrants(selfSubjectB, accountA, "subject_to_recipient");
  expect(grantsAfter.map(row => row.purpose)).toEqual(["family.portrait", "reports.polygenic"]);
  expect(await liveGrants(selfSubjectA, accountB, "subject_to_recipient")).toEqual([]);
  await expectOwnSourceAndGrantPreserved();

  // The permissions page in both themes, on the state a person actually
  // reaches it in: both columns populated, one row settable and one locked.
  // `/family/[person]/permissions` is a registered authenticated page and
  // `e2e/a11y.spec.ts` cannot build two accounts and an accepted invitation,
  // so its coverage is here, at the same bar.
  await expectAxeClean(page);
});

/**
 * `/family/[person] empty`, and it is the mirror of the partial-coverage test
 * below rather than a weaker version of it. B looks at A, and A has granted B
 * nothing: the grants asserted above are all one-directional, B to A. So the
 * page has genuinely nothing about A to show, which is what `empty` means
 * everywhere else in the register — the page works, and there is no content
 * for it yet.
 *
 * Deliberately NOT `not-covered` or `partial-coverage`. Nothing here is
 * uncovered by anyone's file and nothing is partly shown: A's file may not
 * even exist, and the page cannot know, because a viewer with no grant is told
 * nothing about whether there is anything to grant. That distinction is the
 * point of the sentence — it names the person and says what will change it,
 * without leaking whether A has uploaded anything at all.
 */
test("/family/[person] empty: with nothing granted in this direction, the page names the person and says so", async ({
  page,
}) => {
  // B's session, looking at A. The reverse of every other read in this file.
  await page.request.post("/auth/sign-out");
  await signIn(page, B.email, B.password);
  await page.goto(`/family/s-${selfSubjectA}`);

  await expect(page.getByRole("status")).toHaveText(NOT_SHARED_BY_A);

  // The empty state is EXCLUSIVE, the same reading applied to the refusals:
  // one status region, and none of the surfaces a shared record would bring.
  await expect(page.getByRole("status")).toHaveCount(1);
  await expect(page.locator("main a[href*='/reports']")).toHaveCount(0);
  await expect(page.locator("[data-claim-block], [data-figure-kind]")).toHaveCount(0);

  // And it says nothing about whether A has a file. A count here would tell B
  // something A never shared, which is the whole reason the sentence is
  // phrased about sharing rather than about content.
  await expect(page.locator('[data-slot="subject-files"]')).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/\b\d+ file/);
});

/**
 * `/family/[person] partial-coverage`, on the same reading as
 * `/genome/[subject]/data/browser partial-coverage`: the page shows both
 * halves and this test asserts both. Every report of the layer B shared is
 * listed, and the layer B did NOT share is named absent in B's own terms -
 * "has not shared Specific variants with you" - exactly once, beside a
 * baseline-absent sentence also asserted to appear exactly once. A page that
 * silently omitted the unshared layer would look complete and would fail
 * here.
 *
 * `consent-required` is NOT claimed for the Tier-2 gate this test also
 * passes, though the shape is tempting: no personal content reaches the
 * browser until an affirmative checkbox and button. The reason is that the
 * gate is an acknowledgement - session-scoped, asserted here as never
 * written to device storage - while every `consent-required` state this
 * repository has claimed rests on a recorded, revocable consent artifact.
 * Calling a session acknowledgement a consent would blur a distinction the
 * product keeps deliberately, so the pair is left unproven.
 */
test("/family/[person] partial-coverage: past the Tier-2 gate, the shared layer is listed and the unshared one is named absent", async ({
  page,
}) => {
  await signIn(page, A.email, A.password);

  await page.goto("/family");
  const card = page.locator('[data-slot="person-card"]');
  await expect(card).toHaveCount(1);
  await expect(card.locator('[data-slot="subject-name"]')).toHaveText(B_AS_SEEN_BY_A);
  await expect(card.locator('[data-slot="subject-kind"]')).toHaveText("Shared with you");
  await expect(card.locator('[data-slot="person-state"]')).toHaveText("Reports ready");

  // A direct detail URL must return to the gate before any personal content.
  const beforeGateRequests: string[] = [];
  const observeBeforeGate = (request: import("@playwright/test").Request) => {
    const pathname = new URL(request.url()).pathname;
    if (/^\/rest\/v1\/(?:user_variants|report_observed_calls|user_prs|genome_files|ancestry_results)(?:\/|$)/.test(pathname)
      || /^\/rest\/v1\/rpc\/(?:own_|recipient_|family_).*report/.test(pathname)
      || /^\/api\/files\//.test(pathname)) beforeGateRequests.push(`${request.method()} ${pathname}`);
  };
  page.on("request", observeBeforeGate);
  await page.goto(`/genome/s-${invitedSubjectId}/reports/${COVERED_SLUGS[2]}`);
  await expect(page).toHaveURL(`/family/s-${invitedSubjectId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Individual risks" })).toBeVisible();
  await expect(page.locator('nav[aria-label="Breadcrumb"]')).toHaveText(
    `Family / ${B_AS_SEEN_BY_A}`,
  );
  await expect(page.locator('[data-subject-bar="true"] [data-slot="subject-kind"]')).toHaveText(
    "Shared with you",
  );

  // The gate is server-side: no result reaches the browser before it passes.
  await expect(page.getByText(GATE_CHECKBOX, { exact: true })).toBeVisible();
  await expect(page.getByText(GATE_SESSION, { exact: true })).toBeVisible();
  const gatedHtml = await page.content();
  expect(gatedHtml).not.toContain("data-figure-kind");
  expect(gatedHtml).not.toContain("data-claim-block");
  for (const slug of COVERED_SLUGS) expect(gatedHtml).not.toContain(slug);
  // The acknowledgement is never written to device storage.
  const stored = await page.evaluate(() => ({
    local: JSON.stringify(window.localStorage),
    session: JSON.stringify(window.sessionStorage),
  }));
  expect(stored.local).not.toMatch(/tier2|family/i);
  expect(stored.session).not.toMatch(/tier2|family/i);
  expect(beforeGateRequests, "no browser-side personal data request before the Tier-2 gate").toEqual([]);
  page.off("request", observeBeforeGate);

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Show what’s shared" }).click();

  for (const slug of COVERED_SLUGS) {
    await expect(
      page.locator(`a[href="/genome/s-${invitedSubjectId}/reports/${slug}"]`),
    ).toHaveCount(1);
  }
  // The layer B did not share is absent, and said once.
  await expect(page.getByText(`${B_AS_SEEN_BY_A} has not shared Specific variants with you.`)).toBeVisible();
  await expect(page.getByText(BASELINE_ABSENT, { exact: true })).toHaveCount(1);

  // The person page in both themes, past the gate and showing the shared
  // layer — the other registered authenticated page `e2e/a11y.spec.ts` cannot
  // reach. The Tier-2 acknowledgement is session-scoped, so it survives the
  // reload each theme takes.
  await expectAxeClean(page);
  await expect(page.getByText(BASELINE_ABSENT, { exact: true })).toHaveCount(1);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.screenshot({ path: test.info().outputPath(`shared-person-${viewport.name}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator(`a[href="/genome/s-${invitedSubjectId}/reports/${COVERED_SLUGS[2]}"]`).click();
  await expect(page).toHaveURL(`/genome/s-${invitedSubjectId}/reports/${COVERED_SLUGS[2]}`);
  // X4: the block is attributed to the subject the computation used — B's own
  // record, never the handle the route names.
  const block = page.locator("[data-claim-block]").first();
  await expect(block).toHaveAttribute("data-subject-id", selfSubjectB);
  await expect(block.locator('[data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText("A/C");
  await expect(page.locator(`[data-claim-block][data-subject-id="${invitedSubjectId}"]`)).toHaveCount(0);
  await expect(page.locator('nav[aria-label="Breadcrumb"]')).toContainText("Family /");
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`shared-report-${viewport.name}.png`), fullPage: true });
  }
});

/**
 * `/family/[person]/permissions complete`, on the reading already recorded
 * for `/settings complete`: this page has no partial shape. It renders the
 * whole permission surface for a live relationship - the controls, their
 * current position, and the confirmed stop with its three-item dialog - and
 * this test does not merely look at them, it operates all three and checks
 * what each one does to the next request.
 *
 * The tombstone shape is deliberately NOT claimed as a second state. After
 * the stop, this page renders "Sharing ended on ... N results built from this
 * pairing were deleted." A reader could call that `empty`, and the argument
 * against is that a relationship which has ENDED is a different thing from a
 * page with nothing in it - the tombstone is content, and it is the record
 * that the deletion happened. Deciding that silently by retitling would be
 * the wrong way to settle it.
 *
 * What makes this test worth more than the pair: it holds the deletion
 * guarantee. Paused and stopped sharing both deny every derived surface on
 * the very next request (404, asserted), while B's original bytes, B's own
 * generation permission and B's own findings are all asserted to survive.
 * That is the "revoke access immediately, preserve unrelated data" promise,
 * checked in a browser rather than asserted in prose.
 */
test("/family/[person]/permissions complete: pause, resume and stop render and take effect on the next request", async ({ page }) => {
  await signIn(page, A.email, A.password);
  // The prior test's acknowledgement cannot survive this new login/session.
  await page.goto(`/genome/s-${invitedSubjectId}/reports/${COVERED_SLUGS[2]}`);
  await expect(page).toHaveURL(`/family/s-${invitedSubjectId}`);
  await expect(page.getByText(GATE_CHECKBOX, { exact: true })).toBeVisible();
  await expectNoResults(page);
  const freshSessionHtml = await page.content();
  for (const slug of COVERED_SLUGS) expect(freshSessionHtml).not.toContain(slug);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Show what’s shared" }).click();
  await expect(page.locator(`a[href="/genome/s-${invitedSubjectId}/reports/${COVERED_SLUGS[2]}"]`)).toHaveCount(1);
  await page.goto(`/family/s-${invitedSubjectId}/permissions`);
  const grantsBeforePause = await liveGrants(selfSubjectB, accountA, "subject_to_recipient");
  await page.getByRole("button", { name: "Pause sharing" }).click();
  await expect(page.getByRole("button", { name: "Resume sharing" })).toBeVisible();

  await page.goto("/family");
  await expect(page.locator('[data-slot="person-state"]')).toHaveText("Sharing paused");
  await page.goto(`/family/s-${invitedSubjectId}`);
  await expect(page.getByText(PAUSED_BODY, { exact: true })).toBeVisible();
  await expectNoResults(page);
  expect(await liveGrants(selfSubjectB, accountA, "subject_to_recipient")).toEqual(grantsBeforePause);
  await expectOwnSourceAndGrantPreserved();
  // Every derived surface denies on the next query, with no row deleted.
  expect((await page.request.get(`/genome/s-${invitedSubjectId}/reports`)).status()).toBe(404);

  await page.goto(`/family/s-${invitedSubjectId}/permissions`);
  await page.getByRole("button", { name: "Resume sharing" }).click();
  await expect(page.getByRole("button", { name: "Pause sharing" })).toBeVisible();
  await page.goto(`/family/s-${invitedSubjectId}`);
  await expect(page.getByText(PAUSED_BODY)).toHaveCount(0);
  for (const slug of COVERED_SLUGS) {
    await expect(page.locator(`a[href="/genome/s-${invitedSubjectId}/reports/${slug}"]`)).toHaveCount(1);
  }
  expect(await liveGrants(selfSubjectB, accountA, "subject_to_recipient")).toEqual(grantsBeforePause);
  await expectOwnSourceAndGrantPreserved();

  await page.goto(`/family/s-${invitedSubjectId}/permissions`);
  await page.getByRole("button", { name: "Stop sharing" }).click();
  const dialog = page.locator('[data-slot="stop-dialog"]');
  await expect(dialog).toContainText(`Stop sharing with ${B_AS_SEEN_BY_A}?`);
  await expect(dialog).toContainText(
    `Stop sharing with ${B_AS_SEEN_BY_A}? Every result built from the two of you is deleted within 60 seconds. This can’t be undone.`,
  );
  await expect(dialog.locator("li")).toHaveCount(3);
  await dialog.getByRole("button", { name: "Stop sharing for good" }).click();

  await expect(page.locator('[data-slot="sharing-tombstone"]')).toContainText(
    /^Sharing ended on .+\. \d+ results built from this pairing were deleted\./,
  );

  // Acceptance 19: every derived surface answers with nothing, from every
  // account that had access, on the very next request.
  await page.goto(`/family/s-${invitedSubjectId}`);
  await expect(page.getByText(NOT_SHARED, { exact: true })).toBeVisible();
  await expectNoResults(page);
  expect((await page.request.get(`/genome/s-${invitedSubjectId}/reports`)).status()).toBe(404);
  expect(
    (await page.request.get(`/genome/s-${invitedSubjectId}/reports/${COVERED_SLUGS[2]}`)).status(),
  ).toBe(404);

  expect(await liveGrants(selfSubjectB, accountA, "subject_to_recipient")).toEqual([]);
  expect(await liveGrants(selfSubjectA, accountB, "subject_to_recipient")).toEqual([]);
  await expectOwnSourceAndGrantPreserved();
  const original = await adminClient().storage.from("genomes").download(sourceBefore.bucket_path as string);
  expect(original.error).toBeNull();
  expect(Buffer.from(await original.data!.arrayBuffer())).toEqual(readFileSync(SOURCE_PATH));

  // Stopping recipient sharing does not withdraw B's own generation permission
  // or remove B's original and stored findings.
  await page.request.post("/auth/sign-out");
  await signIn(page, B.email, B.password);
  await page.goto(`/genome/me/reports/${COVERED_SLUGS[2]}`);
  const ownBlock = page.locator("[data-claim-block]").first();
  await expect(ownBlock).toHaveAttribute("data-subject-id", selfSubjectB);
  await expect(ownBlock.locator('[data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText("A/C");
});
