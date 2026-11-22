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
import { COPY_IDS } from "../src/copy/copilot/group-scopes";
import { askCopilotAboutButton, subjectLayersLine, subjectPermissionMissingNote, subjectScopeHeading }
  from "../src/copy/copilot/subject-scope";
import { COPILOT_LOCAL_ONLY, GATE_BUTTON, GATE_CHECKBOX_LABEL } from "../src/copy/family/person";
import { PERMISSION_ROWS } from "../src/copy/family/permissions";
import { NOT_DIAGNOSTIC } from "../src/copy/reports/strings";
import { accountCsrf, signOut } from "./helpers/session-csrf";

/**
 * Copilot for one other adult's record (owner decision of 19 November 2026,
 * "G8.5: Copilot for another adult's record opens"), the grantee case, end
 * to end on the one app variant that attests a same-host local model
 * (`copilot-local` project, port 3103, `LOCAL_MODEL_ENV`), against the
 * synthetic provider on 127.0.0.1:8127. Nothing in the product is mocked:
 * real uploads and chosen reports, a real invitation and acceptance, grants
 * signed on the real permissions page, the real intent gate, tools, output
 * guard, provenance and history. Then the same record on the main app
 * variant, which attests no local model: the registered unavailable page.
 *
 * What it proves, in order:
 *   - B turns on two rows on B's own permissions page for A (the estimate
 *     layer and Copilot; Health picture is not needed), and A's Family page
 *     for B links to Copilot about B, whose thread header names B;
 *   - A's answer is drawn from B's saved report, names B as its source, and
 *     both stored rows name B's record and exactly the purposes relied on;
 *   - a report type B holds but did not share with A is never read;
 *   - a question the guard refuses reaches no model;
 *   - an account with no relationship to B reads none of it;
 *   - on a deployment with no attested local model the same address is the
 *     unavailable page, with no composer, conversation, name or token, and a
 *     turn of A's conversation there is refused before anything is read;
 *   - when B turns Copilot off mid-conversation, A's next turn is cut off
 *     with no model call, every stored turn built on B's record is gone,
 *     the history endpoint answers 404 and the link is gone.
 *
 * The uploader case (a Path B record) is driven by the SQL suite
 * `supabase/tests/subject_copilot_path_b.sql`: its browser fixtures live
 * inside `e2e/other-adult-upload.spec.ts` and run the global Path B workers.
 *
 * `CANONICAL_COPILOT_CONTROL_URL` must name the synthetic fixture's control
 * port (CI sets it); there is no fallback.
 */

const journeyPassword = "e2e-copilot-subject-pw";
const A = { email: `copilot-subject-a-${randomUUID()}@e2e.local`, password: journeyPassword };
const B = { email: `copilot-subject-b-${randomUUID()}@e2e.local`, password: journeyPassword };
const C = { email: `copilot-subject-c-${randomUUID()}@e2e.local`, password: journeyPassword };
/** A sees B under the invited record's label: neither self subject carries a name (e2e/family.spec.ts). */
const B_AS_SEEN_BY_A = "Invited adult";
const MOCK_PORT = 8127;
const HOSTED_ORIGIN = "http://localhost:3100";
const FIXTURE_VCF = path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf");
const REPORT_PROMPT = "What does the caffeine report Invited adult shared say?";
const REPORT_ANSWER = "The Caffeine metabolism report that Invited adult shared shows A/C at the position it reads. This is informational, not medical advice.";
const LIST_PROMPT = "Which report types can you read for Invited adult?";
const LIST_ANSWER = "Invited adult shares estimate reports with you, and nothing else.";

test.use({ trace: "off" }); // Upload, invitation and permission bearers stay out of traces.

test.describe("Copilot for one other adult's record, end to end on the local model", () => {
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
    test.setTimeout(420_000);
    fixture = await startCopilotFixture(MOCK_PORT);
    resendMock = http.createServer((request, response) => {
      let body = "";
      request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        if (request.method === "POST" && request.url === "/emails") {
          captured.push(JSON.parse(body));
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: `copilot-subject-${captured.length}` }));
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
    await signOut(pageB);

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
    // B's own later sign-in: the independent-login marker the scope reads an adult after.
    await signOut(pageB);
    await signIn(pageB, B.email, B.password);
    // Two rows only: the estimate layer and Copilot. No Health picture.
    for (const purpose of ["reports.polygenic", "copilot.local"]) await setSharingPurpose(pageB, purpose, true);

    // A's own Copilot: the local model, and A's explicit permission for it.
    await saveCopilotProvider(pageA, `${LOCAL_MODEL_ORIGIN}/v1`);
    await expect(pageA.getByRole("region", { name: "Copilot permission", exact: true }))
      .toContainText("This model runs beside your self-hosted Inherit server.");
    await allowCopilot(pageA);
    // A acknowledges the Family domain's one Tier-2 gate, as on any page with another adult's results.
    await pageA.goto(`/family/s-${invitedSubjectB}`);
    const gate = pageA.locator('[data-slot="result-gate"]');
    await gate.getByRole("checkbox", { name: GATE_CHECKBOX_LABEL, exact: true }).check();
    await gate.getByRole("button", { name: GATE_BUTTON, exact: true }).click();
    await expect(gate).toHaveCount(0);
  });

  test.afterAll(async () => {
    for (const context of contexts) await context.close();
    if (resendMock) await new Promise<void>(resolve => resendMock.close(() => resolve()));
    await fixture?.stop();
  });

  test("/copilot/[scope] complete: A's Copilot about B answers from B's shared report, and every answer names whose data it used", async () => {
    await pageA.goto(`/family/s-${invitedSubjectB}`);
    const link = pageA.locator('[data-slot="person-copilot"]').getByRole("link", { name: askCopilotAboutButton(B_AS_SEEN_BY_A), exact: true });
    await expect(link).toHaveAttribute("href", `/copilot/s-${selfSubjectB}`);
    await link.click();
    await expect(pageA).toHaveURL(new RegExp(`/copilot/s-${selfSubjectB}$`));
    // The thread header names the one person the thread reads.
    await expect(pageA.getByRole("heading", { level: 1 })).toHaveText(subjectScopeHeading(B_AS_SEEN_BY_A));
    await expect(pageA.locator('[data-slot="copilot-local-only"]')).toHaveText(COPILOT_LOCAL_ONLY);
    await expect(pageA.locator('[data-slot="copilot-subject-layers"]')).toHaveText(subjectLayersLine(B_AS_SEEN_BY_A, ["estimate"]));
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
    // The model never receives an identifier for a person, a record or a file.
    const toolText = JSON.stringify(report);
    for (const id of [selfSubjectB, invitedSubjectB, accountB]) expect(toolText).not.toContain(id);
    expect(toolText).not.toContain("file_id");

    const title = (report.sources[0].catalogSnapshot as { template: { title: string } }).template.title;
    expect(body.message.citations[0]).toEqual({ id: `person:s-${invitedSubjectB}`, label: `Shared by ${B_AS_SEEN_BY_A}`,
      href: `/family/s-${invitedSubjectB}` });
    expect(body.message.citations[1]).toMatchObject({ label: `${title} (shared by ${B_AS_SEEN_BY_A})`,
      href: `/genome/s-${invitedSubjectB}/reports/${CAFFEINE_SLUG}` });
    await expect(pageA.getByText(REPORT_ANSWER, { exact: true })).toBeVisible();
    await expect(pageA.locator('[data-slot="chat-not-diagnostic"]').last()).toHaveText(NOT_DIAGNOSTIC);

    // The conversation is a subject chat about B's record; both rows name it and exactly the purposes relied on.
    const { data: chat } = await adminClient().from("chats").select("scope_kind,subject_id,provider_classification").eq("id", chatId).single();
    expect(chat).toEqual({ scope_kind: "subject", subject_id: selfSubjectB, provider_classification: "local" });
    const { data: rows, error } = await adminClient().from("chat_messages")
      .select("role,retrieved_subject_ids,retrieved_purpose_keys,contributor_ids").eq("chat_id", chatId).eq("user_id", accountA);
    expect(error).toBeNull();
    expect(rows).toHaveLength(2);
    for (const row of rows!) {
      expect(row.retrieved_subject_ids).toEqual([selfSubjectB]);
      expect(row.retrieved_purpose_keys).toEqual(["copilot.local", "reports.polygenic"]);
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

  test("a question the guard refuses about B reaches no model and stores nothing", async () => {
    const before = (await fixture.snapshot()).calls;
    const { count: storedBefore } = await adminClient().from("chat_messages").select("id", { count: "exact", head: true }).eq("chat_id", chatId);
    const response = await ask(pageA, `Does ${B_AS_SEEN_BY_A} have diabetes?`);
    expect(response.headers()["x-copilot-refusal"]).toBe("diagnosis");
    expect((await fixture.snapshot()).calls).toBe(before);
    const { count: storedAfter } = await adminClient().from("chat_messages").select("id", { count: "exact", head: true }).eq("chat_id", chatId);
    expect(storedAfter).toBe(storedBefore);
  });

  test("an account with no relationship to B reads nothing of it", async () => {
    await signIn(pageC, C.email, C.password);
    expect((await pageC.request.get(`/api/chats/${chatId}`)).status()).toBe(404);
    const origin = new URL(pageC.url()).origin;
    const append = await pageC.request.post("/api/chat", { headers: { origin, "x-inherit-csrf": await accountCsrf(pageC, "api.chat") },
      data: { chatId, message: "What did they share?" } });
    expect(append.status()).toBe(404);
    const scope = await pageC.goto(`/copilot/s-${selfSubjectB}`);
    expect(scope?.status()).toBe(404);
    const html = await pageC.content();
    expect(html).not.toContain(B_AS_SEEN_BY_A);
    expect(html).not.toContain(REPORT_ANSWER);
    await expect(pageC.getByLabel("Message the copilot")).toHaveCount(0);
  });

  test("/copilot/[scope] not-covered: on the variant with no attested local model the same record is the unavailable page, and A's conversation is refused before anything is read", async () => {
    const before = (await fixture.snapshot()).calls;
    const response = await pageA.goto(`${HOSTED_ORIGIN}/copilot/s-${selfSubjectB}`);
    expect(response?.status()).toBe(200);
    const unavailable = pageA.locator('[data-slot="copilot-local-unavailable"]');
    await expect(unavailable).toBeVisible();
    await expect(pageA.getByRole("heading", { level: 1 })).toHaveText(COPY_IDS["copilot.transport.local-unavailable.heading"]);
    await expect(pageA.getByLabel("Message the copilot")).toHaveCount(0);
    await expect(pageA.getByTestId("data-flow-indicator")).toHaveCount(0);
    const html = await pageA.content();
    expect(html).not.toContain(B_AS_SEEN_BY_A);
    expect(html).not.toContain(REPORT_ANSWER);
    expect(html).not.toMatch(/contextToken/);
    // A turn of A's conversation sent to that variant: the registered answer, no read, no model, no write.
    const { count: storedBefore } = await adminClient().from("chat_messages").select("id", { count: "exact", head: true }).eq("chat_id", chatId);
    const turn = await pageA.request.post(`${HOSTED_ORIGIN}/api/chat`, { headers: { origin: HOSTED_ORIGIN,
      "x-inherit-csrf": await accountCsrf(pageA, "api.chat") }, data: { chatId, message: "Anything else?" } });
    expect(turn.status()).toBe(403);
    expect(await turn.json()).toEqual({ error: "local_transport_unavailable", state: "not-covered",
      reason: "local-transport-unavailable", messageCopyId: "copilot.transport.local-unavailable" });
    expect((await pageA.request.get(`${HOSTED_ORIGIN}/api/chats/${chatId}`)).status()).toBe(404);
    expect((await fixture.snapshot()).calls).toBe(before);
    const { count: storedAfter } = await adminClient().from("chat_messages").select("id", { count: "exact", head: true }).eq("chat_id", chatId);
    expect(storedAfter).toBe(storedBefore);
    // The Family page there offers no link either.
    await pageA.goto(`${HOSTED_ORIGIN}/family/s-${invitedSubjectB}`);
    await expect(pageA.locator('[data-slot="person-copilot"]')).toHaveCount(0);
  });

  test("/copilot/[scope] consent-required: when B turns Copilot off mid-conversation, A's next turn is cut off and every turn built on B's record is gone", async () => {
    await pageA.goto(`/copilot/s-${selfSubjectB}`);
    await pageA.locator("summary", { hasText: "Past conversations" }).click();
    await pageA.getByRole("button", { name: /^Conversation from / }).first().click();
    await expect(pageA.getByText(REPORT_ANSWER, { exact: true })).toBeVisible();
    await setSharingPurpose(pageB, "copilot.local", false);
    const before = (await fixture.snapshot()).calls;
    const response = await ask(pageA, "Anything else Invited adult shared?");
    expect(response.status()).toBe(404);
    expect((await fixture.snapshot()).calls).toBe(before);
    // The panel drops the conversation and the page refreshes to the scope as it now is.
    await expect(pageA.locator('[data-slot="copilot-subject-permission-missing"]')).toBeVisible();
    const { count, error } = await adminClient().from("chat_messages").select("id", { count: "exact", head: true })
      .eq("user_id", accountA).overlaps("retrieved_subject_ids", [selfSubjectB]);
    expect(error).toBeNull();
    expect(count).toBe(0);
    expect((await pageA.request.get(`/api/chats/${chatId}`)).status()).toBe(404);
    await pageA.goto(`/copilot/s-${selfSubjectB}`);
    await expect(pageA.locator('[data-slot="copilot-subject-permission-missing"]').getByRole("status"))
      .toHaveText(subjectPermissionMissingNote(B_AS_SEEN_BY_A));
    await expect(pageA.getByLabel("Message the copilot")).toHaveCount(0);
    await pageA.goto(`/family/s-${invitedSubjectB}`);
    await expect(pageA.locator('[data-slot="person-copilot"]')).toHaveCount(0);
  });
});
