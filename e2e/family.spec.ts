import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import http from "node:http";
import path from "node:path";
import {
  JOBS_SECRET,
  adminClient,
  createConfirmedUser,
  firstViewportInteractives,
  ingestFileAs,
  signIn,
} from "./helpers";
import { INDEPENDENT_LOGIN_REQUIRED } from "@/copy/family/permissions";

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
 */

const A = { email: "family-a@e2e.local", password: "e2e-family-pw" };
const B = { email: "family-b@e2e.local", password: "e2e-family-pw" };

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
  await createConfirmedUser(A.email, A.password);
  await createConfirmedUser(B.email, B.password);
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => resendMock.close(() => resolve()));
});

async function selfSubjectOf(email: string): Promise<string> {
  const admin = adminClient();
  const account = (await admin.auth.admin.listUsers()).data.users.find(
    (user) => user.email === email,
  )!;
  const { data } = await admin
    .from("subjects")
    .select("id")
    .eq("subject_account_id", account.id)
    .eq("subject_class", "self")
    .eq("lifecycle", "active")
    .single();
  return (data as { id: string }).id;
}

async function expectNoResults(page: Page) {
  await expect(page.locator("[data-figure-kind]")).toHaveCount(0);
  await expect(page.locator("[data-claim-block]")).toHaveCount(0);
}

/**
 * Axe in both themes, each on a fresh load in that theme, as every other
 * spec does: the theme provider flips the class on the live page and the
 * chrome animates its colours, so an audit taken on a page that was loaded
 * in the other theme samples mid-transition colours.
 */
async function expectAxeClean(page: Page) {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.reload();
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(
      results.violations
        .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
        .map((violation) => ({ id: violation.id, theme, help: violation.help })),
    ).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light" });
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

test("/family signed in: the hub, its one primary action and the first-viewport budget", async ({
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
  await page.goto("/family/invite");
  await page.getByLabel("Their email address").fill(B.email);
  await page.getByLabel("A note for them").fill("This is my note.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation requested");

  const drain = await request.post("/api/jobs/mail", {
    headers: { authorization: `Bearer ${JOBS_SECRET}` },
  });
  expect(drain.status()).toBe(200);
  const message = captured.find((email) =>
    (Array.isArray(email.to) ? email.to : [email.to]).includes(B.email),
  );
  expect(message, "the invitation must reach the mail provider").toBeTruthy();
  // The optional note travels as words, never as a link.
  expect(message!.html).toContain("This is my note.");
  expect(message!.html).not.toMatch(/href="[^"]*This is my note/);
  const invitationUrl = message!.html?.match(
    /http:\/\/localhost:3100\/withdraw\/[A-Za-z0-9_-]{43}/,
  )?.[0];
  expect(invitationUrl).toBeTruthy();

  // A's hub, before acceptance: nobody to show yet.
  await page.goto("/family");
  await expect(page.getByText("Just you so far.", { exact: true })).toBeVisible();

  // B accepts through their own account.
  await page.request.post("/auth/sign-out");
  await page.goto(invitationUrl!);
  await page.getByRole("link", { name: "Sign in to accept" }).click();
  await page.getByLabel("Email").fill(B.email);
  await page.getByLabel("Password").fill(B.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(invitationUrl!);
  await page.getByRole("button", { name: "Accept through my account" }).click();
  await expect(page.getByRole("heading", { name: "Invitation accepted" })).toBeVisible();

  const admin = adminClient();
  const { data: invitation } = await admin
    .from("subject_invitations")
    .select("target_id")
    .eq("invitation_kind", "adult_subject")
    .eq("status", "accepted")
    .order("accepted_at", { ascending: false })
    .limit(1)
    .single();
  invitedSubjectId = (invitation as { target_id: string }).target_id;
  selfSubjectA = await selfSubjectOf(A.email);
  selfSubjectB = await selfSubjectOf(B.email);
  expect(invitedSubjectId).not.toBe(selfSubjectB);

  // B adds their own file: the invited record never holds one.
  const fileId = await ingestFileAs(
    page,
    B.email,
    B.password,
    path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"),
    "vcf",
  );
  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("genome_files")
          .select("status, subject_id")
          .eq("id", fileId)
          .single();
        return data as { status: string; subject_id: string } | null;
      },
      { timeout: 60_000 },
    )
    .toMatchObject({ status: "annotated", subject_id: selfSubjectB });

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
  await expect(yours.locator('[data-slot="permission-row"]')).toHaveCount(6);
  await expect(yours.locator('[data-permission-state="on"]')).toHaveCount(0);

  const estimates = yours
    .locator('[data-slot="permission-row"]')
    .filter({ hasText: "Statistical estimates" });
  await estimates.getByRole("button", { name: "Turn on" }).click();
  await expect(estimates.locator('[data-slot="permission-state"]')).toHaveText("On");

  // Exactly one live grant, in one direction, for one purpose.
  const { data: grants } = await admin
    .from("purpose_grants")
    .select("purpose, target_id, revoked_at")
    .eq("target_id", selfSubjectB)
    .is("revoked_at", null);
  expect(grants).toHaveLength(1);
  expect(grants![0]).toMatchObject({ purpose: "reports.polygenic" });

  // Portrait cannot be turned on from the session the invitation was
  // accepted in: the row is locked with its reason, not a dead control.
  const portrait = yours.locator('[data-slot="permission-row"]').filter({ hasText: "Portrait" });
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
    .filter({ hasText: "Portrait" });
  await expect(portraitAfter.locator('[data-slot="permission-locked"]')).toHaveCount(0);
  await portraitAfter.getByRole("button", { name: "Turn on" }).click();
  await expect(portraitAfter.locator('[data-slot="permission-state"]')).toHaveText("On");
  const { data: afterMarker } = await admin
    .from("subjects")
    .select("independent_login_at")
    .eq("id", selfSubjectB)
    .single();
  expect((afterMarker as { independent_login_at: string | null }).independent_login_at).not.toBeNull();
  const { data: grantsAfter } = await admin
    .from("purpose_grants")
    .select("purpose")
    .eq("target_id", selfSubjectB)
    .is("revoked_at", null)
    .order("purpose");
  expect((grantsAfter ?? []).map((row) => row.purpose)).toEqual([
    "family.portrait",
    "reports.polygenic",
  ]);
});

test("A passes one Tier-2 gate, then reads B's shared layer attributed to B's own subject", async ({
  page,
}) => {
  await signIn(page, A.email, A.password);

  await page.goto("/family");
  const card = page.locator('[data-slot="person-card"]');
  await expect(card).toHaveCount(1);
  await expect(card.locator('[data-slot="subject-name"]')).toHaveText(B_AS_SEEN_BY_A);
  await expect(card.locator('[data-slot="subject-kind"]')).toHaveText("Shared with you");
  await expect(card.locator('[data-slot="person-state"]')).toHaveText("Reports ready");

  await page.goto(`/family/s-${invitedSubjectId}`);
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

  await page.locator(`a[href="/genome/s-${invitedSubjectId}/reports/${COVERED_SLUGS[2]}"]`).click();
  await expect(page).toHaveURL(`/genome/s-${invitedSubjectId}/reports/${COVERED_SLUGS[2]}`);
  // X4: the block is attributed to the subject the computation used — B's own
  // record, never the handle the route names.
  const block = page.locator("[data-claim-block]").first();
  await expect(block).toHaveAttribute("data-subject-id", selfSubjectB);
  await expect(page.locator(`[data-claim-block][data-subject-id="${invitedSubjectId}"]`)).toHaveCount(0);
  await expect(page.locator('nav[aria-label="Breadcrumb"]')).toContainText("Family /");
});

test("pause, resume and stop take effect on the next request", async ({ page }) => {
  await signIn(page, A.email, A.password);
  await page.goto(`/family/s-${invitedSubjectId}/permissions`);
  await page.getByRole("button", { name: "Pause sharing" }).click();
  await expect(page.getByRole("button", { name: "Resume sharing" })).toBeVisible();

  await page.goto("/family");
  await expect(page.locator('[data-slot="person-state"]')).toHaveText("Sharing paused");
  await page.goto(`/family/s-${invitedSubjectId}`);
  await expect(page.getByText(PAUSED_BODY, { exact: true })).toBeVisible();
  await expectNoResults(page);
  // Every derived surface denies on the next query, with no row deleted.
  expect((await page.request.get(`/genome/s-${invitedSubjectId}/reports`)).status()).toBe(404);

  await page.goto(`/family/s-${invitedSubjectId}/permissions`);
  await page.getByRole("button", { name: "Resume sharing" }).click();
  await expect(page.getByRole("button", { name: "Pause sharing" })).toBeVisible();
  await page.goto(`/family/s-${invitedSubjectId}`);
  await expect(page.getByText(PAUSED_BODY)).toHaveCount(0);

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

  const admin = adminClient();
  const { data: live } = await admin
    .from("purpose_grants")
    .select("grant_id")
    .eq("target_id", selfSubjectB)
    .is("revoked_at", null);
  expect(live).toHaveLength(0);
});
