import { expect, test } from "@playwright/test";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { adminClient, createConfirmedUser, drainMailUntil, signIn } from "./helpers";
import { OWN_UPLOAD_COPY } from "@/copy/upload/consent";

/**
 * The three My Genome routes that refuse in an unreviewed jurisdiction, proven
 * against a real pairing: `/genome/[subject]/ancestry`,
 * `/genome/[subject]/reports` and `/genome/[subject]/reports/[slug]`.
 *
 * WHY THIS NEEDS TWO ACCOUNTS, which is the whole reason it did not exist
 * before. `resolveSubjectRoute` (src/lib/family/subject-route.ts) answers
 * `kind: "ok"` for an OWN subject BEFORE it asks about jurisdiction at all, so
 * `/genome/me/...` can never reach the refusal however the jurisdiction is
 * configured. The `kind: "jurisdiction"` branch is reachable only for a FAMILY
 * person, and a family person exists only after a real invitation is accepted.
 * `e2e/family-invite.nojurisdiction.spec.ts` says as much where it explains why
 * it picked the one route whose guard needs nothing set up.
 *
 * WHY THE PAIRING IS BUILT THROUGH THE PRODUCT AND NOT THROUGH THE DATABASE.
 * Writing the rows directly would be quicker and would prove less than it
 * appears to: a hand-made pairing can differ from the one the product creates,
 * and then the refusal asserted here is not the refusal a real person meets.
 * So the invitation is sent, mailed, opened and accepted exactly as in
 * `e2e/family.spec.ts` — but against the MAIN server on port 3100, where the
 * jurisdiction flag is set and the invite route works. The refusal is then read
 * from the off server on 3101. One database stands behind both, and cookies are
 * host-scoped rather than port-scoped, so the session carries across.
 *
 * WHY THE ORDER IS SAFE. `playwright.config.ts` sets `workers: 1` and
 * `fullyParallel: false`, so the mail capture on 8124 cannot collide with the
 * one `e2e/family.spec.ts` binds, and `mode: "serial"` below keeps the pairing
 * ahead of the tests that depend on it.
 *
 * `/family/[person]/permissions` was added on 2026-09-12 and is the fourth
 * route here, for the same reason as the first three: its guard needs a real
 * family person, so it needs this file's pairing. Its refusal has a DIFFERENT
 * SHAPE, traced before it was titled — see the test.
 *
 * THREE MORE ROUTES JOINED ON 2026-09-12, and they needed no new fixture —
 * only this one, which already exists. `/genome/[subject]`,
 * `/genome/[subject]/data` and `/genome/[subject]/data/browser` all call
 * `resolveSubjectRoute`, and that resolver asks the jurisdiction BEFORE it
 * asks whether any purpose is granted (subject-route.ts: the `permits`
 * check precedes the `options.anyOf` check). So this pairing, which has no
 * grants at all, reaches the refusal on all three. That order was read in the
 * resolver before the tests were titled rather than assumed from the two
 * routes above that behave the same way.
 *
 * WHAT IS DELIBERATELY NOT CLAIMED. `/family` and `/family/health-picture`
 * are proven in `e2e/family-hub.nojurisdiction.spec.ts` instead, because
 * tracing showed their guards resolve to the viewer's own unset code when the
 * family is empty and need no pairing at all. `/embryo-analysis` is proven
 * signed out in `e2e/embryo-analysis.spec.ts`.
 *
 * `/family/[person]` is the fourth route added the same day and has a THIRD
 * shape again: it neither replaces the page nor prints a line in a header, but
 * renders `decision.userFacingCopy` as the whole body where the shared results
 * would be. Traced at `family/[person]/page.tsx:167` before it was titled.
 *
 * THE FIRST DRAFT OF THIS PARAGRAPH WAS WRONG, and the way it was wrong is
 * worth keeping. It said `/family/[person]`, `/files`, `/files/upload`,
 * `/copilot/[scope]` and `/overview` all "render no jurisdiction refusal at
 * all", on the strength of one grep for `CapabilityUnavailable`. Three of
 * those five do render one, by three different mechanisms that grep could not
 * see: `/family/[person]` prints `userFacingCopy` directly, `/overview`
 * renders it inside `data-slot="carrier-jurisdiction"`, and
 * `/family/portrait/[pairId]` has a full branch of its own. A grep for one
 * component name is not a survey of a behaviour.
 *
 * So, accurately, of the routes the register lists as
 * `jurisdiction-unavailable` and this file does not prove:
 *   - `/overview` and `/family/portrait/[pairId]` implement a refusal and are
 *     FIXTURE gaps. `/overview` needs the full State-D fixture; the portrait
 *     needs a `family_pairs` row and therefore a mutual portrait grant.
 *   - `/files`, `/files/upload` and `/copilot/[scope]` mention jurisdiction
 *     nowhere in their page modules and are PRODUCT gaps. A test titled for
 *     one of those would certify a refusal that does not exist, which is
 *     exactly what happened to `/settings/people`.
 *
 * A title in this repository IS a claim: `scripts/route-gate.ts` counts a
 * (route, state) pair as proven when a test title names both as whole tokens.
 */

const runId = randomUUID();
const A = { email: `genome-family-a-${runId}@e2e.local`, password: "e2e-genome-family-pw" };
const B = { email: `genome-family-b-${runId}@e2e.local`, password: "e2e-genome-family-pw" };

/** The jurisdiction-enabled server, where a pairing can still be created. */
const MAIN = "http://localhost:3100";

const REFUSAL_HEADING = "Not available in this jurisdiction yet";
/**
 * The register's own sentence, which `/family/[person]/permissions` prints
 * directly instead of using the `<CapabilityUnavailable>` frame the three
 * `/genome/[subject]/…` routes render. Retyped rather than imported from
 * `data/jurisdictions.json`, so the assertion checks that the catalog's
 * sentence reaches the reader rather than agreeing with the catalog by
 * construction.
 */
const REFUSAL_SENTENCE =
  "This part of Inherit is not available here because its legal review is not complete.";
const NOT_ABOUT_YOU = "It says nothing about you or anyone else.";
const NOTHING_RECORDED = "We create no analysis or consent record.";

/** Any registered report; the subject is resolved before the slug is read. */
const SLUG = "lactase-persistence-lct-rs4988235";

interface CapturedEmail { to: string | string[]; html?: string }
const captured: CapturedEmail[] = [];
let mailMock: http.Server;
let pairedSegment = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mailMock = http.createServer((request, response) => {
    let body = "";
    request.on("data", chunk => (body += chunk));
    request.on("end", () => {
      if (request.method === "POST" && request.url?.includes("/emails")) {
        captured.push(JSON.parse(body) as CapturedEmail);
        response.writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ id: `genome-family-${captured.length}` }));
        return;
      }
      response.writeHead(200).end("{}");
    });
  });
  await new Promise<void>(resolve => mailMock.listen(8124, "127.0.0.1", resolve));
  await createConfirmedUser(A.email, A.password);
  await createConfirmedUser(B.email, B.password);
});

test.afterAll(async () => {
  await new Promise<void>(resolve => mailMock.close(() => resolve()));
});

test("the signed-in account reaches this server and is not signed out by it", async ({ page }) => {
  // The control, kept from e2e/family-invite.nojurisdiction.spec.ts and worth
  // repeating for these accounts: a route with no jurisdiction guard answers
  // 200 with the account's own email on it, so every refusal below is the
  // guard's answer rather than a broken session, a redirect or a dead server.
  await signIn(page, A.email, A.password);
  const response = await page.goto("/settings");
  expect(response?.status()).toBe(200);
  await expect(page.locator("main").getByText(A.email, { exact: true })).toBeVisible();
});

test("a real accepted invitation gives the viewer a family subject to ask about", async ({ page, request }) => {
  await signIn(page, A.email, A.password);

  // Inviting needs the adult declaration, which is an account fact and not a
  // DNA permission. Stop at the next disclosure without signing it.
  await page.goto(`${MAIN}/files/upload`);
  await page.getByLabel(OWN_UPLOAD_COPY.birthDateLabel).fill("1990-01-01");
  const completed = page.waitForResponse(response => response.url().endsWith("/api/account/completion")
    && response.request().method() === "POST");
  await page.getByRole("button", { name: OWN_UPLOAD_COPY.accountContinue, exact: true }).click();
  expect((await completed).status()).toBe(200);

  await page.goto(`${MAIN}/family/invite`);
  await page.getByLabel("Their email address").fill(B.email);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation requested");

  const message = await drainMailUntil(request, () => captured.find(email =>
    (Array.isArray(email.to) ? email.to : [email.to]).includes(B.email)), "the invitation");
  // TAKE THE TOKEN, NOT THE HOST, and this is not fussiness. The mail worker
  // composes the link from the NEXT_PUBLIC_APP_URL of whichever server drains
  // the queue, and `drainMailUntil` goes through Playwright's `request`
  // fixture, whose baseURL in this project is the OFF server on 3101. So the
  // emailed link points at 3101 however the invitation was sent. Pinning the
  // host here (as e2e/family.spec.ts reasonably does, running against one
  // server) failed for that reason alone. The token is the invitation; the
  // host is an artefact of which server happened to send it, and acceptance
  // belongs on the jurisdiction-enabled server.
  const token = message.html?.match(/\/withdraw\/([A-Za-z0-9_-]{43})/)?.[1];
  expect(token, "the invitation email carries a withdraw token").toBeTruthy();
  const invitationUrl = `${MAIN}/withdraw/${token}`;

  // B accepts in their own session, which is what creates the pairing.
  await page.request.post(`${MAIN}/auth/sign-out`);
  await page.goto(invitationUrl!);
  await page.getByRole("link", { name: "Sign in to accept" }).click();
  await page.getByLabel("Email").fill(B.email);
  await page.getByLabel("Password").fill(B.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(invitationUrl!);
  await page.getByRole("button", { name: "Accept through my account" }).click();
  await expect(page.getByRole("heading", { name: "Invitation accepted" })).toBeVisible();

  // The segment the routes below are asked about, read from the accepted
  // invitation rather than constructed: `graph.ts` forms it as `s-{subject}`.
  const admin = adminClient();
  const accountA = await admin.auth.admin.listUsers();
  const idA = accountA.data.users.find(user => user.email === A.email)?.id;
  expect(idA).toBeTruthy();
  const selfA = await admin.from("subjects").select("id")
    .eq("subject_account_id", idA!).eq("subject_class", "self").eq("lifecycle", "active").single();
  expect(selfA.error).toBeNull();
  const principal = await admin.from("subject_principals").select("id")
    .eq("account_id", idA!).eq("subject_id", selfA.data!.id)
    .eq("principal_kind", "account_subject").eq("status", "active").single();
  expect(principal.error).toBeNull();
  const invitation = await admin.from("subject_invitations").select("target_id")
    .eq("invitation_kind", "adult_subject").eq("inviter_principal_id", principal.data!.id)
    .eq("status", "accepted").single();
  expect(invitation.error).toBeNull();
  pairedSegment = `s-${invitation.data!.target_id}`;
});

/** Every refused page is the same shape, so the assertions are one function. */
async function expectJurisdictionRefusal(page: import("@playwright/test").Page, url: string) {
  const response = await page.goto(url);
  expect(response?.status()).toBe(200);
  const refusal = page.getByRole("status").filter({ hasText: REFUSAL_HEADING });
  await expect(refusal).toHaveCount(1);
  await expect(refusal).toContainText(NOTHING_RECORDED);
  await expect(refusal).toContainText(NOT_ABOUT_YOU);
  // Nothing of the result survives the refusal. These are the hooks the
  // populated pages carry, so their absence is the refusal being complete
  // rather than a page that merely added a banner above its findings.
  await expect(page.locator('[data-slot="haplogroup"], [data-slot="ancestry-map"], [data-slot="report-skeleton"]'))
    .toHaveCount(0);
  await expect(page.locator("[data-claim-block], [data-figure-kind]")).toHaveCount(0);
}

test("/genome/[subject]/ancestry jurisdiction-unavailable: the refusal replaces the whole result", async ({ page }) => {
  expect(pairedSegment).not.toBe("");
  await signIn(page, A.email, A.password);
  await expectJurisdictionRefusal(page, `/genome/${pairedSegment}/ancestry`);
});

test("/genome/[subject]/reports jurisdiction-unavailable: the refusal replaces the whole library", async ({ page }) => {
  expect(pairedSegment).not.toBe("");
  await signIn(page, A.email, A.password);
  await expectJurisdictionRefusal(page, `/genome/${pairedSegment}/reports`);
  await expect(page.locator("main a[href*='/reports/']")).toHaveCount(0);
});

test("/genome/[subject]/reports/[slug] jurisdiction-unavailable: the subject is refused before the slug is read", async ({ page }) => {
  expect(pairedSegment).not.toBe("");
  await signIn(page, A.email, A.password);
  await expectJurisdictionRefusal(page, `/genome/${pairedSegment}/reports/${SLUG}`);
  // The refusal is about the subject, so an unknown slug refuses identically
  // rather than answering not-found and revealing which reports exist.
  await expectJurisdictionRefusal(page, `/genome/${pairedSegment}/reports/no-such-report-exists`);
});

test("/family/[person]/permissions jurisdiction-unavailable: grants refuse while the rights stay", async ({ page }) => {
  expect(pairedSegment).not.toBe("");
  await signIn(page, A.email, A.password);
  const response = await page.goto(`/family/${pairedSegment}/permissions`);
  expect(response?.status()).toBe(200);

  // A DIFFERENT SHAPE FROM THE THREE ABOVE, and the whole reason this route
  // was traced before being titled. Those three replace the page with a
  // refusal. This one does not, on purpose: the register calls its mode
  // "mixed" because granting is a capability the jurisdiction decides while
  // pausing and stopping are rights that it does not. So the page keeps
  // rendering and the refusal is one line in its header.
  const refusal = page.getByRole("status").filter({ hasText: REFUSAL_SENTENCE });
  await expect(refusal).toHaveCount(1);

  // The capability half: not one permission is settable. `permission-control`
  // is the button a settable row renders, and a row without an action renders
  // `permission-locked` in its place, so this is the refusal reaching every
  // row rather than the page merely printing a sentence above working
  // switches.
  await expect(page.locator('[data-slot="permission-control"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="permission-row"]').first()).toBeVisible();
  await expect(page.locator('[data-slot="permission-locked"]').first()).toBeVisible();

  // The rights half, which is the part that would be a real harm to get
  // wrong: an unreviewed jurisdiction must never trap someone in a sharing
  // arrangement they want out of.
  await expect(page.getByRole("button", { name: "Pause sharing" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop sharing" })).toBeVisible();

  // NOT PROVEN HERE, said rather than left as a silent gap: the page's own
  // comment claims resume is jurisdiction-guarded alongside grant. This
  // pairing is not paused, so the resume control never renders and nothing
  // here tests that claim either way.
});

/**
 * The three routes added on 2026-09-12. Each asserts the shared refusal shape
 * AND the absence of the specific thing that page exists to show, because a
 * refusal that merely adds a banner above the record would satisfy the first
 * assertion and none of the point.
 */

test("/genome/[subject] jurisdiction-unavailable: the hub refuses before it offers a single tool", async ({ page }) => {
  expect(pairedSegment).not.toBe("");
  await signIn(page, A.email, A.password);
  await expectJurisdictionRefusal(page, `/genome/${pairedSegment}`);
  // The tile grid is the hub. Its absence is the refusal replacing the page
  // rather than sitting above a working set of links into the record.
  await expect(page.getByRole("region", { name: "Genome tools" })).toHaveCount(0);
  await expect(page.locator("main a[href*='/reports'], main a[href*='/ancestry']")).toHaveCount(0);
  // The subject bar carries the relative's name and their file count, which
  // are facts about them that an unreviewed jurisdiction has not permitted.
  await expect(page.locator('[data-slot="subject-name"]')).toHaveCount(0);
});

test("/genome/[subject]/data jurisdiction-unavailable: no method, no panel and no provenance survives", async ({ page }) => {
  expect(pairedSegment).not.toBe("");
  await signIn(page, A.email, A.password);
  await expectJurisdictionRefusal(page, `/genome/${pairedSegment}/data`);
  await expect(page.locator('[data-slot="score-panel-result"], [data-slot="score-input-provenance"], [data-slot="input-provenance"]'))
    .toHaveCount(0);
});

test("/genome/[subject]/data/browser jurisdiction-unavailable: the browser is not rendered and no region is fetched", async ({ page }) => {
  expect(pairedSegment).not.toBe("");
  await signIn(page, A.email, A.password);
  // Every request the page makes, so "no region is fetched" is measured
  // rather than inferred from the markup. The refusal must not quietly load
  // the relative's variants behind a message that says it did not.
  const fetched: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) fetched.push(url.pathname);
  });
  await expectJurisdictionRefusal(page, `/genome/${pairedSegment}/data/browser`);
  await expect(page.getByTestId("genome-browser")).toHaveCount(0);
  await expect(page.locator('[data-slot="table-input-provenance"], [data-slot="track-input-provenance"]'))
    .toHaveCount(0);
  expect(fetched.filter((path) => path.includes("browser") || path.includes("variants")), fetched.join(", "))
    .toHaveLength(0);
});

test("/family/[person] jurisdiction-unavailable: the refusal is the body where the shared results would be", async ({ page }) => {
  expect(pairedSegment).not.toBe("");
  await signIn(page, A.email, A.password);
  const response = await page.goto(`/family/${pairedSegment}`);
  expect(response?.status()).toBe(200);

  // A THIRD SHAPE. The `/genome/[subject]/…` routes replace the page with
  // `<CapabilityUnavailable>`; `/family/[person]/permissions` keeps its page
  // and adds a line to the header; this one keeps its frame and puts the
  // register's own sentence where the shared results would go. All three are
  // correct for what the route is, which is why each was traced rather than
  // assumed from the last one.
  const refusal = page.getByRole("status").filter({ hasText: REFUSAL_SENTENCE });
  await expect(refusal).toHaveCount(1);

  // The refusal is exclusive: the page renders it INSTEAD of the paused
  // sentence, the nothing-shared sentence, the Tier-2 gate and the results.
  // If it were additive, a reader could be told the jurisdiction refuses and
  // shown the findings underneath it.
  await expect(page.locator("main a[href*='/reports/']")).toHaveCount(0);
  await expect(page.locator("[data-claim-block], [data-figure-kind]")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(1);
});
