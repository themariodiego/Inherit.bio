import { type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { expect, test } from "./audited-test";
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
import { LOCAL_MODEL_ORIGIN } from "../scripts/ci-browser-config";
import { allowCopilot, CAFFEINE_SLUG, lastToolResult, saveCopilotProvider, startCopilotFixture, type CopilotFixture }
  from "./fixtures/canonical-copilot-browser";
import { FAMILY_EMPTY_NOTE, FAMILY_SCOPE_LABEL, familyMemberLine } from "../src/copy/copilot/group-scopes";
import { COPILOT_LOCAL_ONLY } from "../src/copy/family/person";
import { PERMISSION_ROWS } from "../src/copy/family/permissions";
import { NOT_DIAGNOSTIC } from "../src/copy/reports/strings";

/**
 * The Family group Copilot scope, end to end, on the one app variant that
 * attests a same-host local model (`copilot-local` project, port 3103,
 * `LOCAL_MODEL_ENV`), against the synthetic provider on 127.0.0.1:8127.
 * Nothing in the product is mocked: real uploads and chosen reports, a real
 * invitation and acceptance, grants signed on the real permissions page, the
 * real intent gate, tools, output guard, provenance and history.
 *
 * What it proves, in order:
 *   - B lets A's Copilot read B's shared estimates (three rows on B's own
 *     permissions page: the estimate layer, Health picture and Copilot), and
 *     A's answer is drawn from B's saved report and names B as its source;
 *   - a report type B holds but did not share with A is never read;
 *   - a question the guard refuses reaches no model;
 *   - an account outside the group reads none of it;
 *   - when B turns Copilot off mid-conversation, A's next turn is cut off
 *     with no model call, every stored turn built on B's data is gone, and the
 *     history endpoint answers 404.
 *
 * `CANONICAL_COPILOT_CONTROL_URL` must name the synthetic fixture's control
 * port (CI sets it); there is no fallback.
 */

/** A synthetic password for fresh @e2e.local accounts, as every browser spec uses. */
const journeyPassword = "e2e-copilot-family-pw";
const A = { email: `copilot-family-a-${randomUUID()}@e2e.local`, password: journeyPassword };
const B = { email: `copilot-family-b-${randomUUID()}@e2e.local`, password: journeyPassword };
const C = { email: `copilot-family-c-${randomUUID()}@e2e.local`, password: journeyPassword };
/** A sees B under the invited record's label: neither self subject carries a name (e2e/family.spec.ts). */
const B_AS_SEEN_BY_A = "Invited adult";
const MOCK_PORT = 8127;
const FIXTURE_VCF = path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf");
const REPORT_PROMPT = "What does the caffeine report Invited adult shared say?";
const REPORT_ANSWER = "The Caffeine metabolism report that Invited adult shared shows A/C at the position it reads. This is informational, not medical advice.";
const LIST_PROMPT = "Which report types can you read for Invited adult?";
const LIST_ANSWER = "Invited adult shares estimate reports with you, and nothing else.";
const NOT_DIAGNOSTIC_SLOT = '[data-slot="chat-not-diagnostic"]';
const TEST_DENY_SENTENCE = "This capability is blocked for the TEST-DENY acceptance fixture.";

test.use({ trace: "off" }); // Upload, invitation and permission bearers stay out of traces.

test.describe("the Family group scope's jurisdiction refusal", () => {
  test("/copilot/[scope] jurisdiction-unavailable: the Family scope states the register's refusal and reads neither the model settings nor the group", async ({ page }) => {
    const denied = { email: `copilot-family-xx-${randomUUID()}@e2e.local`, password: journeyPassword };
    await createConfirmedUser(denied.email, denied.password, { jurisdiction: "XX" });
    await signIn(page, denied.email, denied.password);
    const response = await page.goto("/copilot/family");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Ask about ${FAMILY_SCOPE_LABEL}`);
    const refusal = page.locator('[data-slot="copilot-family-jurisdiction"]');
    await expect(refusal.getByRole("status")).toHaveText(TEST_DENY_SENTENCE);
    await expect(page.getByLabel("Message the copilot")).toHaveCount(0);
    await expect(page.getByTestId("data-flow-indicator")).toHaveCount(0);
    await expect(page.locator('[data-slot="copilot-family-members"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="copilot-local-unavailable"]')).toHaveCount(0);
  });
});

test.describe("the Family group scope, end to end on the local model", () => {
  test.describe.configure({ mode: "serial" });

  let fixture: CopilotFixture;
  let resendMock: http.Server;
  const captured: Array<{ to: string[] | string; html?: string }> = [];
  let contexts: BrowserContext[] = [];
  let pageA: Page, pageB: Page, pageC: Page;
  let accountA = "", accountB = "", selfSubjectA = "", selfSubjectB = "", invitedSubjectB = "", chatId = "";
  const grantsFromB = new Map<string, string>();

  async function selfSubjectOf(accountId: string): Promise<string> {
    const { data, error } = await adminClient().from("subjects").select("id").eq("subject_account_id", accountId)
      .eq("subject_class", "self").eq("lifecycle", "active").single();
    if (error || !data) throw new Error(`self subject: ${error?.message}`);
    return (data as { id: string }).id;
  }

  /** One row on B's own permissions page for A, through its real control. */
  async function setSharingPurpose(page: Page, purpose: string, enabled: boolean) {
    await page.goto(`/family/s-${selfSubjectA}/permissions`);
    const label = PERMISSION_ROWS.find(row => row.id === purpose)!.label;
    const row = page.locator('[data-slot="permission-column"][data-settable="true"] [data-slot="permission-row"]')
      .filter({ has: page.locator('[data-slot="permission-label"]', { hasText: new RegExp(`^${label}$`) }) });
    await expect(row.locator('[data-slot="permission-state"]')).toHaveText(enabled ? "Off" : "On");
    const response = page.waitForResponse(candidate => candidate.request().method() === "POST"
      && (enabled ? candidate.url().endsWith("/api/consents") : candidate.url().endsWith(`/api/consents/${grantsFromB.get(purpose)}/revoke`)));
    await row.getByRole("button", { name: enabled ? /^Turn on / : /^Turn off / }).click();
    const result = await response;
    expect(result.status()).toBe(enabled ? 201 : 200);
    const receipt = await result.json();
    if (enabled) {
      expect(receipt).toMatchObject({ recordKind: "purpose_grant", purposeKey: purpose, artifactKey: "consent.share-with-adult" });
      grantsFromB.set(purpose, receipt.recordId);
    } else expect(receipt).toMatchObject({ revoked: true });
    await expect(row.locator('[data-slot="permission-state"]')).toHaveText(enabled ? "On" : "Off");
  }

  async function ask(page: Page, prompt: string) {
    const response = page.waitForResponse(candidate => new URL(candidate.url()).pathname === "/api/chat");
    await page.getByLabel("Message the copilot").fill(prompt);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    return response;
  }

  test.beforeAll(async ({ browser }, info) => {
    // Two uploads with chosen reports, an invitation through the mail worker,
    // an acceptance, an independent sign-in, three signed grants and a model
    // permission: the setup is the journey, so it takes the long allowance.
    test.setTimeout(420_000);
    fixture = await startCopilotFixture(MOCK_PORT);
    resendMock = http.createServer((request, response) => {
      let body = "";
      request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        if (request.method === "POST" && request.url === "/emails") {
          captured.push(JSON.parse(body));
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: `copilot-family-${captured.length}` }));
        } else response.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve, reject) => { resendMock.once("error", reject); resendMock.listen(8124, "127.0.0.1", resolve); });
    accountA = await createConfirmedUser(A.email, A.password);
    accountB = await createConfirmedUser(B.email, B.password);
    await createConfirmedUser(C.email, C.password);
    const origin = info.project.use.baseURL!;
    contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ baseURL: origin })));
    [pageA, pageB, pageC] = await Promise.all(contexts.map(context => context.newPage()));
    selfSubjectA = await selfSubjectOf(accountA);
    selfSubjectB = await selfSubjectOf(accountB);

    await signIn(pageA, A.email, A.password);
    await uploadOwnFileWithChosenReports(pageA, FIXTURE_VCF, { fileType: "vcf", purposes: ["reports.polygenic"] });
    await signIn(pageB, B.email, B.password);
    // B holds BOTH layers; only the estimate layer is ever shared with A.
    await uploadOwnFileWithChosenReports(pageB, FIXTURE_VCF, { fileType: "vcf", purposes: ["reports.monogenic", "reports.polygenic"] });
    await pageB.request.post("/auth/sign-out");

    await pageA.goto("/family/invite");
    await pageA.getByLabel("Their email address").fill(B.email);
    await pageA.getByRole("checkbox").check();
    await pageA.getByRole("button", { name: "Send invitation" }).click();
    await expect(pageA.getByRole("status")).toContainText("Invitation requested");
    const token = await drainMailUntil(pageA.request, () => captured
      .map(email => (Array.isArray(email.to) ? email.to : [email.to]).includes(B.email) ? adultInvitationToken(email.html) : undefined)
      .find(found => found !== undefined), "the invitation");
    await acceptAdultInvitation({ page: pageB, invitationUrl: adultInvitationUrl(token, origin), email: B.email, password: B.password, origin });
    const invitation = await adminClient().from("subject_invitations").select("target_id")
      .eq("invitation_kind", "adult_subject").eq("status", "accepted")
      .in("inviter_principal_id", (await adminClient().from("subject_principals").select("id").eq("account_id", accountA)).data!.map(row => row.id))
      .single();
    expect(invitation.error).toBeNull();
    invitedSubjectB = invitation.data!.target_id;
    // B's own later sign-in: the independent-login marker Health picture needs.
    await pageB.request.post("/auth/sign-out");
    await signIn(pageB, B.email, B.password);
    for (const purpose of ["reports.polygenic", "family.heritability", "copilot.local"]) await setSharingPurpose(pageB, purpose, true);

    // A's own Copilot: the local model, and A's explicit permission for it.
    await saveCopilotProvider(pageA, `${LOCAL_MODEL_ORIGIN}/v1`);
    await expect(pageA.getByRole("region", { name: "Copilot permission", exact: true }))
      .toContainText("This model runs beside your self-hosted Inherit server.");
    await allowCopilot(pageA);
  });

  test.afterAll(async () => {
    for (const context of contexts) await context.close();
    if (resendMock) await new Promise<void>(resolve => resendMock.close(() => resolve()));
    await fixture?.stop();
  });

  test("A's Family Copilot answers from B's shared report, and every answer names whose data it used", async () => {
    await pageA.goto("/family");
    await expect(pageA.locator('[data-tile="copilot"]').getByRole("link")).toHaveAttribute("href", "/copilot/family");
    await pageA.goto("/copilot/family");
    await expect(pageA.getByRole("heading", { level: 1 })).toHaveText(`Ask about ${FAMILY_SCOPE_LABEL}`);
    await expect(pageA.locator('[data-slot="copilot-local-only"]')).toHaveText(COPILOT_LOCAL_ONLY);
    await expect(pageA.locator('[data-slot="copilot-family-members"] li')).toHaveText([familyMemberLine(B_AS_SEEN_BY_A, ["estimate"])]);
    await expect(pageA.getByTestId("data-flow-indicator")).toContainText("Local mode");

    await fixture.configure({ prompt: REPORT_PROMPT, tool: { name: "get_report", arguments: { slug: CAFFEINE_SLUG } }, answer: REPORT_ANSWER });
    const before = (await fixture.snapshot()).calls;
    const response = await ask(pageA, REPORT_PROMPT);
    expect(response.status()).toBe(200);
    expect(response.headers()["x-copilot-refusal"]).toBeUndefined();
    const body = await response.json();
    chatId = body.chatId;
    expect(body.message.content).toBe(REPORT_ANSWER);
    const receipt = await fixture.snapshot();
    expect(receipt.calls - before).toBe(2);
    const report = lastToolResult(receipt) as { slug: string; sources: Array<Record<string, unknown>> };
    expect(report.slug).toBe(CAFFEINE_SLUG);
    expect(report.sources).toHaveLength(1);
    expect(report.sources[0]).toMatchObject({ person: B_AS_SEEN_BY_A, person_ref: "person-1", purpose: "reports.polygenic", layer: "estimate" });
    // The model never receives an identifier for a person, a subject or a file.
    const toolText = JSON.stringify(report);
    for (const id of [selfSubjectB, invitedSubjectB, accountB]) expect(toolText).not.toContain(id);
    expect(toolText).not.toContain("file_id");

    const title = (report.sources[0].catalogSnapshot as { template: { title: string } }).template.title;
    expect(body.message.citations[0]).toEqual({ id: `person:s-${invitedSubjectB}`, label: `Shared by ${B_AS_SEEN_BY_A}`,
      href: `/family/s-${invitedSubjectB}` });
    expect(body.message.citations[1]).toMatchObject({ label: `${title} (shared by ${B_AS_SEEN_BY_A})`,
      href: `/genome/s-${invitedSubjectB}/reports/${CAFFEINE_SLUG}` });
    await expect(pageA.getByText(REPORT_ANSWER, { exact: true })).toBeVisible();
    await expect(pageA.getByRole("list", { name: "Sources" }).last().getByRole("link", { name: `Shared by ${B_AS_SEEN_BY_A}` }))
      .toHaveAttribute("href", `/family/s-${invitedSubjectB}`);
    await expect(pageA.locator(NOT_DIAGNOSTIC_SLOT).last()).toHaveText(NOT_DIAGNOSTIC);

    // Both stored rows of the turn name B's self subject and exactly the purposes relied on.
    const { data: rows, error } = await adminClient().from("chat_messages")
      .select("role,retrieved_subject_ids,retrieved_purpose_keys,contributor_ids").eq("chat_id", chatId).eq("user_id", accountA);
    expect(error).toBeNull();
    expect(rows).toHaveLength(2);
    for (const row of rows!) {
      expect(row.retrieved_subject_ids).toEqual([selfSubjectB]);
      expect(row.retrieved_purpose_keys).toEqual(["copilot.local", "family.heritability", "reports.polygenic"]);
      expect(row.contributor_ids).toEqual([accountB]);
    }
  });

  test("a report type B holds but did not share with A is never read", async () => {
    const { data: ownMonogenic } = await adminClient().from("purpose_grants").select("grant_id")
      .eq("target_id", selfSubjectB).eq("artifact_key", "consent.own-monogenic").is("revoked_at", null);
    expect(ownMonogenic?.length, "B chose specific-variant reports for their own file").toBeGreaterThan(0);
    await fixture.configure({ prompt: LIST_PROMPT, tool: { name: "list_reports", arguments: {} }, answer: LIST_ANSWER });
    const response = await ask(pageA, LIST_PROMPT);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.chatId).toBe(chatId);
    const list = lastToolResult(await fixture.snapshot()) as { people: Array<{ person: string; shared_report_types: string[];
      reports: Array<{ layer?: string }> }> };
    expect(list.people.map(person => person.person)).toEqual([B_AS_SEEN_BY_A]);
    expect(list.people[0].shared_report_types).toEqual(["estimate"]);
    expect(list.people[0].reports.length).toBeGreaterThan(0);
    expect(list.people[0].reports.every(entry => entry.layer === "estimate")).toBe(true);
  });

  test("a question the guard refuses about a named person reaches no model and stores nothing", async () => {
    const before = (await fixture.snapshot()).calls;
    const { count: storedBefore } = await adminClient().from("chat_messages").select("id", { count: "exact", head: true }).eq("chat_id", chatId);
    const response = await ask(pageA, `Does ${B_AS_SEEN_BY_A} have diabetes?`);
    expect(response.headers()["x-copilot-refusal"]).toBe("diagnosis");
    expect((await fixture.snapshot()).calls).toBe(before);
    const { count: storedAfter } = await adminClient().from("chat_messages").select("id", { count: "exact", head: true }).eq("chat_id", chatId);
    expect(storedAfter).toBe(storedBefore);
  });

  test("an account outside the group reads nothing of it", async () => {
    await signIn(pageC, C.email, C.password);
    const history = await pageC.request.get(`/api/chats/${chatId}`);
    expect(history.status()).toBe(404);
    const origin = new URL(pageC.url()).origin;
    const append = await pageC.request.post("/api/chat", { headers: { origin }, data: { chatId, message: "What did they share?" } });
    expect(append.status()).toBe(404);
    const scope = await pageC.goto("/copilot/family");
    expect(scope?.status()).toBe(200);
    const html = await pageC.content();
    expect(html).not.toContain(B_AS_SEEN_BY_A);
    expect(html).not.toContain(REPORT_ANSWER);
    await expect(pageC.getByLabel("Message the copilot")).toHaveCount(0);
  });

  test("when B turns Copilot off mid-conversation, A's next turn is cut off and every turn built on B's data is gone", async () => {
    await setSharingPurpose(pageB, "copilot.local", false);
    const before = (await fixture.snapshot()).calls;
    // The open conversation's next turn: no model call and no stored half turn.
    const response = await ask(pageA, "Anything else Invited adult shared?");
    expect(response.status()).toBe(404);
    expect((await fixture.snapshot()).calls).toBe(before);
    // The panel drops the conversation and the page refreshes to the group as it now is: nobody.
    await expect(pageA.locator('[data-slot="copilot-family-empty"]')).toBeVisible();
    // Brief item 19: no derived row naming B survives, and history is gone.
    const { count, error } = await adminClient().from("chat_messages").select("id", { count: "exact", head: true })
      .eq("user_id", accountA).overlaps("retrieved_subject_ids", [selfSubjectB]);
    expect(error).toBeNull();
    expect(count).toBe(0);
    expect((await pageA.request.get(`/api/chats/${chatId}`)).status()).toBe(404);
    // A fresh page shows nobody, and no composer.
    await pageA.goto("/copilot/family");
    await expect(pageA.locator('[data-slot="copilot-family-empty"]').getByRole("status")).toHaveText(FAMILY_EMPTY_NOTE);
    await expect(pageA.getByLabel("Message the copilot")).toHaveCount(0);
    await pageA.goto("/family");
    await expect(pageA.locator('[data-tile="copilot"]').getByRole("link")).toHaveCount(0);
  });
});
