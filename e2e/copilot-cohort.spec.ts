import { type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test } from "./audited-test";
import { adminClient, createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { grantAnalysis, seedPublishedCohort } from "./cohort-copilot-seed";
import { LOCAL_MODEL_ORIGIN } from "../scripts/ci-browser-config";
import { allowCopilot, saveCopilotProvider, startCopilotFixture, type CopilotFixture } from "./fixtures/canonical-copilot-browser";
import { COHORT_CITATION_LABEL, cohortEmbryoLine } from "../src/copy/copilot/group-scopes";
import { STANDING_STATEMENT } from "../src/copy/embryos/compare";
import { EMBRYO_STATUS, ROLE_OTHER_PARENT, waitingForResultsBody } from "../src/copy/embryos/index";
import { GATE_BUTTON } from "../src/copy/embryos/gate";

/**
 * The Embryo (cohort) Copilot scope, end to end, on the one app variant that
 * attests a same-host local model (`copilot-local`, port 3103), against the
 * synthetic provider on 127.0.0.1:8127. The scope is built under TEST-LOCAL
 * only, and it is read-only over a published cohort.
 *
 * The cohort is seeded as published with the service role, and each
 * parent's analysis grant is signed through the one database function the
 * consent route calls (`e2e/cohort-copilot-seed.ts`): no browser path ingests
 * embryo files or offers that grant yet. Everything after that is the
 * product's own: the embryo pages' states and Tier-2 gate, A's own local
 * model permission, the intent gate, the closed context, the output guard,
 * provenance and history.
 *
 * What it proves, in order:
 *   - with one parent's grant missing, the scope says so and reads nothing;
 *   - past both grants and the gate, A asks about the embryos' quality
 *     checks, and the answer cites the comparison and exactly the embryos it
 *     names; the stored turn records every embryo read and every grant;
 *   - a ranking question reaches no model (ADR 0034);
 *   - an account outside the cohort reads none of it;
 *   - when the other parent's grant is withdrawn, A's next turn is cut off
 *     with no model call and the stored conversation is gone.
 *
 * `CANONICAL_COPILOT_CONTROL_URL` must name the synthetic fixture's control
 * port (CI sets it); there is no fallback.
 */

test.use({ trace: "off" }); // Upload and consent bearers stay out of traces.

const journeyPassword = "e2e-copilot-cohort-pw";
const A = { email: `copilot-cohort-a-${randomUUID()}@e2e.local`, password: journeyPassword };
const B = { email: `copilot-cohort-b-${randomUUID()}@e2e.local`, password: journeyPassword };
const C = { email: `copilot-cohort-c-${randomUUID()}@e2e.local`, password: journeyPassword };
const MOCK_PORT = 8127;
const FIXTURE_VCF = path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf");
const QC_PROMPT = "What did the quality check find for each embryo?";
const QC_ANSWER = "Embryo 1 had a call rate of 0.98. Embryo 2 did not pass its quality check. This is informational, not medical advice.";

test.describe("the Embryo cohort scope, end to end on the local model", () => {
  test.describe.configure({ mode: "serial" });

  let fixture: CopilotFixture;
  let contexts: BrowserContext[] = [];
  let pageA: Page, pageC: Page;
  let accountA = "", accountB = "", cohortId = "", chatId = "";
  let embryoIds: string[] = [], subjectIds: string[] = [];

  async function ask(page: Page, prompt: string) {
    const response = page.waitForResponse(candidate => new URL(candidate.url()).pathname === "/api/chat");
    await page.getByLabel("Message the copilot").fill(prompt);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    return response;
  }

  test.beforeAll(async ({ browser }, info) => {
    test.setTimeout(300_000);
    fixture = await startCopilotFixture(MOCK_PORT);
    accountA = await createConfirmedUser(A.email, A.password);
    accountB = await createConfirmedUser(B.email, B.password);
    await createConfirmedUser(C.email, C.password);
    contexts = await Promise.all([0, 1].map(() => browser.newContext({ baseURL: info.project.use.baseURL })));
    [pageA, pageC] = await Promise.all(contexts.map(context => context.newPage()));
    await signIn(pageA, A.email, A.password);
    // A's own file: the own-Copilot permission is given over A's own upload consent.
    await uploadOwnFileWithChosenReports(pageA, FIXTURE_VCF, { fileType: "vcf", purposes: ["reports.polygenic"] });
    ({ cohortId, embryoIds, subjectIds } = await seedPublishedCohort({ owner: accountA, parents: [accountA, accountB], embryos: [
      { ordinal: 0, status: "qc_pass", callRate: 0.98 },
      { ordinal: 1, status: "qc_fail", callRate: 0.7 },
      { ordinal: 2, status: "qc_marginal", callRate: 0.91 },
    ] }));
    await grantAnalysis(accountA, cohortId);
    await signIn(pageC, C.email, C.password);
  });

  test.afterAll(async () => {
    for (const context of contexts) await context.close();
    await fixture?.stop();
  });

  test("while the other parent has not turned results on, the cohort's Copilot says so and reads nothing", async () => {
    const before = (await fixture.snapshot()).calls;
    const response = await pageA.goto(`/copilot/c-${cohortId}`);
    expect(response?.status()).toBe(200);
    const blocked = pageA.locator('[data-slot="copilot-cohort-blocked"]');
    await expect(blocked.getByRole("status")).toContainText(waitingForResultsBody(ROLE_OTHER_PARENT));
    await expect(pageA.getByLabel("Message the copilot")).toHaveCount(0);
    await expect(pageA.locator('[data-slot="copilot-cohort-embryos"]')).toHaveCount(0);
    expect(await pageA.content()).not.toMatch(/call_rate|contextToken|copilot-cohort-embryos/);
    expect((await fixture.snapshot()).calls).toBe(before);
  });

  test("past both grants, the gate and A's own model permission, the page names what Copilot can read", async () => {
    await grantAnalysis(accountB, cohortId);
    await pageA.goto(`/copilot/c-${cohortId}`);
    // The embryo domain's one Tier-2 gate stands in front of every derived read.
    const gate = pageA.locator('[data-slot="copilot-cohort-gated"] [data-slot="result-gate"]');
    await gate.getByRole("checkbox").check();
    await gate.getByRole("button", { name: GATE_BUTTON }).click();
    await expect(pageA.locator('[data-slot="copilot-cohort-provider-required"]')).toBeVisible();
    await saveCopilotProvider(pageA, `${LOCAL_MODEL_ORIGIN}/v1`);
    await allowCopilot(pageA);
    await pageA.goto(`/copilot/c-${cohortId}`);
    await expect(pageA.locator('[data-slot="copilot-cohort-embryos"] li')).toHaveText([
      cohortEmbryoLine("Embryo 1", EMBRYO_STATUS.qc_pass),
      cohortEmbryoLine("Embryo 2", EMBRYO_STATUS.qc_fail),
      cohortEmbryoLine("Embryo 3", EMBRYO_STATUS.qc_marginal),
    ]);
    await expect(pageA.locator('[data-slot="copilot-standing-statement"]')).toHaveText(STANDING_STATEMENT);
    await expect(pageA.getByTestId("data-flow-indicator")).toContainText("Local mode");
    await expect(pageA.locator("main")).not.toContainText(/\b(sex|male|female|rank|ranked|best embryo)\b/i);
  });

  test("A's answer comes from the embryos' quality checks and cites the comparison and exactly the embryos it names", async () => {
    await fixture.configure({ prompt: QC_PROMPT, answer: QC_ANSWER });
    const response = await ask(pageA, QC_PROMPT);
    expect(response.status()).toBe(200);
    const body = await response.json();
    chatId = body.chatId;
    expect(body.message).toEqual({ role: "assistant", content: QC_ANSWER, embryoFindings: [], citations: [
      { id: `cohort:${cohortId}`, label: COHORT_CITATION_LABEL, href: `/embryos/compare?cohort=${cohortId}` },
      { id: `embryo:${embryoIds[0]}`, label: "Embryo 1", href: `/embryos/${embryoIds[0]}` },
      { id: `embryo:${embryoIds[1]}`, label: "Embryo 2", href: `/embryos/${embryoIds[1]}` },
    ] });
    await expect(pageA.getByText(QC_ANSWER)).toBeVisible();
    // The model saw the closed context: the embryos and their checks, and no genotype, file or sex.
    const sent = JSON.stringify((await fixture.snapshot()).requests.at(-1)!.messages);
    expect(sent).toContain("Embryo 3");
    expect(sent).toContain("0.91");
    expect(sent).not.toMatch(/genotype"|original_filename|chrX|karyotype/);
    // The stored turn: every embryo it read, under which purpose, and whose grants.
    const { data: rows, error } = await adminClient().from("chat_messages").select("role,retrieved_subject_ids,retrieved_purpose_keys,contributor_ids")
      .eq("chat_id", chatId);
    expect(error).toBeNull();
    const answer = rows!.find(row => row.role === "assistant")!;
    expect([...answer.retrieved_subject_ids].sort()).toEqual([...subjectIds].sort());
    expect(answer.retrieved_purpose_keys).toEqual(["embryo.analysis"]);
    expect(answer.contributor_ids).toHaveLength(2);
    const dependencies = await adminClient().from("copilot_turn_dependencies").select("chat_id", { count: "exact", head: true }).eq("chat_id", chatId);
    expect(dependencies.count).toBe(9);
  });

  test("a question asking Copilot to rank or pick an embryo is refused before any model call", async () => {
    const before = (await fixture.snapshot()).calls;
    const response = await ask(pageA, "Which embryo is the best one to transfer?");
    expect(response.headers()["x-copilot-refusal"]).toBe("selection-advice");
    expect((await fixture.snapshot()).calls).toBe(before);
  });

  test("an account outside the cohort reads none of it", async () => {
    expect((await pageC.goto(`/copilot/c-${cohortId}`))?.status()).toBe(404);
    expect((await pageC.request.get(`/api/chats/${chatId}`)).status()).toBe(404);
    const origin = new URL(pageC.url()).origin;
    const post = await pageC.request.post("/api/chat", { headers: { origin }, data: { chatId, message: "What did it say?" } });
    expect([403, 404]).toContain(post.status());
  });

  test("when the other parent's analysis grant is withdrawn, A's next turn is cut off and the stored conversation is gone", async () => {
    const admin = adminClient();
    const principals = (await admin.from("subject_principals").select("id").eq("account_id", accountB)).data!.map(row => row.id);
    const { data: grant } = await admin.from("purpose_grants").select("grant_id").eq("target_kind", "cohort").eq("target_id", cohortId)
      .eq("purpose", "embryo.analysis").in("signer_principal_id", principals).is("revoked_at", null).single();
    // The same two writes every withdrawal path makes; the database trigger does the rest.
    expect((await admin.from("purpose_grants").update({ revoked_at: new Date().toISOString(), revocation_reason: "withdrawn" })
      .eq("grant_id", grant!.grant_id)).error).toBeNull();
    expect((await admin.from("directional_grants").update({ status: "revoked", ended_at: new Date().toISOString() })
      .eq("grant_id", grant!.grant_id)).error).toBeNull();
    const { count } = await admin.from("chat_messages").select("id", { count: "exact", head: true }).eq("chat_id", chatId);
    expect(count).toBe(0);
    const before = (await fixture.snapshot()).calls;
    const response = await ask(pageA, "And Embryo 3?");
    expect([403, 404]).toContain(response.status());
    expect((await fixture.snapshot()).calls).toBe(before);
    expect((await pageA.request.get(`/api/chats/${chatId}`)).status()).toBe(404);
    await pageA.goto(`/copilot/c-${cohortId}`);
    await expect(pageA.locator('[data-slot="copilot-cohort-blocked"]').getByRole("status"))
      .toContainText(waitingForResultsBody(ROLE_OTHER_PARENT));
    await expect(pageA.getByLabel("Message the copilot")).toHaveCount(0);
  });
});
