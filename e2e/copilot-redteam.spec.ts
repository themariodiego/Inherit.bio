import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { adminClient, createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { OWN_REPORT_CHOICES } from "../src/lib/uploads/own-report-purpose";
import { LOCAL_MODEL_ORIGIN } from "../scripts/ci-browser-config";
import { allowCopilot, CAFFEINE_ANSWER, CAFFEINE_PROMPT, CAFFEINE_SLUG, expectClosedCompletion, expectedCaffeineCitations,
  lastToolResult, saveCopilotProvider, startCopilotFixture, type CopilotFixture } from "./fixtures/canonical-copilot-browser";
import type { CanonicalProviderPlan } from "./fixtures/canonical-copilot-provider";
import redteam from "./fixtures/copilot-redteam.json";
import { refusalFor, type RefusalId } from "@/copy/copilot/refusals";
import { NOT_DIAGNOSTIC } from "@/copy/reports/strings";
import { checkRelativeRisk, checkResponsePolicy } from "@/lib/copilot/guard";

/**
 * G4.8 (brief line 2635): the committed adversarial prompt set
 * `e2e/fixtures/copilot-redteam.json` (44 prompts over the six classes the
 * brief lists) run against the shipped Copilot on the local-model path.
 *
 * The path is real. This file runs only under the `copilot-local` project,
 * against the fourth app variant (`scripts/ci-browser-config.ts`,
 * `LOCAL_MODEL_ENV`), the one app in CI that attests a same-host,
 * egress-isolated local model for exactly one origin: the synthetic provider
 * on the container's own loopback, reached as plain `http://127.0.0.1:8127`.
 * The settings page classifies it local, the permission names the local
 * class, and the thread's indicator reads "Local mode". Nothing else is
 * mocked: the real intent gate, tools, output guard, consent and history.
 *
 * Three assertions the brief states, over every response: zero responses
 * match a prohibited pattern (each assistant turn is exactly the registry's
 * refusal string or the compliant answer the record names, and every
 * rendered assistant text is re-read by `checkResponsePolicy`); every
 * response containing a numeric risk carries an absolute figure (re-read by
 * `checkRelativeRisk`, and every adversarial relative-risk completion is
 * replaced whole); every response carries the same non-diagnostic line the
 * surfaces carry (`NOT_DIAGNOSTIC`, counted under every assistant turn). And
 * retrieval is scoped to the thread's own file: the report tool's sources
 * name that file alone, and after the report grant is turned off it returns
 * no report at all (zero rows), whatever the provider then claims.
 *
 * An `input` case never reaches the provider: the fixture's call count does
 * not move. An `output` case reaches it and the provider's completion is the
 * maximally violating answer the record holds; exactly two provider requests
 * prove the real tool ran, and the captured tool result is held to the shape
 * the record says it has. `src/lib/copilot/redteam.test.ts` runs the same set
 * against the guard at unit speed.
 */

type Case = {
  id: string; class: string; gate: "input" | "output" | "revoked"; prompt: string; refusal?: RefusalId;
  tool?: CanonicalProviderPlan["tool"]; answer?: string; toolJson?: Record<string, unknown>;
  mustContain?: string[]; mustNotContain?: string[];
};
const CASES = redteam.cases as Case[];
const INPUT = CASES.filter(c => c.gate === "input");
const OUTPUT = CASES.filter(c => c.gate === "output");
const REVOKED = CASES.filter(c => c.gate === "revoked");
const USER = { email: `copilot-redteam-${randomUUID()}@e2e.local`, password: "e2e-copilot-redteam-pw" };
const MOCK_PORT = 8127;
const NOT_DIAGNOSTIC_SLOT = '[data-slot="chat-not-diagnostic"]';

let fixture: CopilotFixture;
let userId = "";
let fileId = "";
let subjectLabel = "";
let context: BrowserContext | undefined;
let page: Page;
/** Assistant turns rendered in the open conversation, each owed the non-diagnostic line. */
let assistantTurns = 0;
/** How often each exact refusal string is on the page, so a repeat is counted rather than found once. */
const seen = new Map<string, number>();

test.describe.configure({ mode: "serial" });

async function ask(prompt: string) {
  const response = page.waitForResponse(candidate => new URL(candidate.url()).pathname === "/api/chat");
  await page.getByLabel("Message the copilot").fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  return response;
}

/** The refusal string is the whole assistant turn, and the turn carries the surfaces' line. */
async function expectRefusalTurn(id: RefusalId) {
  const expected = refusalFor(id, subjectLabel);
  const count = (seen.get(expected) ?? 0) + 1;
  seen.set(expected, count);
  await expect(page.getByText(expected, { exact: true })).toHaveCount(count);
  assistantTurns += 1;
  await expect(page.locator(NOT_DIAGNOSTIC_SLOT)).toHaveCount(assistantTurns);
  await expect(page.locator(NOT_DIAGNOSTIC_SLOT).last()).toHaveText(NOT_DIAGNOSTIC);
  await expect(page.getByText("Checking your question…", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Message the copilot")).toBeEnabled();
  return expected;
}

/** Every rendered assistant text, read from the bubble that carries the non-diagnostic line. */
function assistantTexts(): Promise<string[]> {
  return page.locator(NOT_DIAGNOSTIC_SLOT).evaluateAll(nodes =>
    nodes.map(node => node.parentElement?.querySelector("p")?.textContent ?? ""));
}

/** The brief's three assertions over every response rendered so far. */
async function expectEveryResponseHeld() {
  const texts = await assistantTexts();
  expect(texts).toHaveLength(assistantTurns);
  await expect(page.locator(NOT_DIAGNOSTIC_SLOT)).toHaveCount(assistantTurns);
  for (const text of texts) {
    expect(text.length).toBeGreaterThan(0);
    expect(checkResponsePolicy(text).intent, text).toBe("allowed");
    expect(checkRelativeRisk(text).ok, text).toBe(true);
  }
}

test.beforeAll(async ({ browser }, info) => {
  // This one hook stands up the whole serial suite: a real file upload through
  // the local Storage provider, the provider save, the consent grant and four
  // navigations. The default 120 s is the tightest budget for that on a loaded
  // runner (this project runs last), where run 35416394061 timed it out during
  // sign-in. The a11y hooks take the same allowance for the same reason; it
  // extends the setup only and weakens no assertion.
  test.setTimeout(300_000);
  fixture = await startCopilotFixture(MOCK_PORT);
  userId = await createConfirmedUser(USER.email, USER.password);
  context = await browser.newContext({ baseURL: info.project.use.baseURL });
  page = await context.newPage();
  await signIn(page, USER.email, USER.password);
  fileId = await uploadOwnFileWithChosenReports(page, path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"),
    { fileType: "vcf", purposes: ["reports.polygenic"] });
  const { data, error } = await adminClient().from("subjects").select("display_label")
    .eq("subject_account_id", userId).eq("subject_class", "self").single();
  if (error || !data) throw new Error(`synthetic subject: ${error?.message}`);
  subjectLabel = data.display_label;
  // The local-model path, end to end: the plain loopback origin is accepted
  // because this app variant attests it, the permission names the local
  // class, and the thread says where questions go.
  await saveCopilotProvider(page, `${LOCAL_MODEL_ORIGIN}/v1`);
  const permission = page.getByRole("region", { name: "Copilot permission", exact: true });
  await expect(permission).toContainText("This model runs beside your self-hosted Inherit server.");
  await expect(permission).toContainText(LOCAL_MODEL_ORIGIN);
  await allowCopilot(page);
  await page.goto("/copilot/me");
  await expect(page.getByTestId("data-flow-indicator")).toContainText("Local mode");
});

test.afterAll(async () => {
  await context?.close();
  await fixture?.stop();
});

test("the local-model path answers: an allowed prompt reaches the loopback provider, the answer keeps its citations, and retrieval names this thread's own file alone", async () => {
  await fixture.configure({ prompt: CAFFEINE_PROMPT, tool: { name: "get_report", arguments: { slug: CAFFEINE_SLUG } }, answer: CAFFEINE_ANSWER });
  const before = (await fixture.snapshot()).calls;
  const response = await ask(CAFFEINE_PROMPT);
  expect(response.status()).toBe(200);
  expect(response.headers()["x-copilot-refusal"]).toBeUndefined();
  await expect(page.getByText(CAFFEINE_ANSWER, { exact: true })).toBeVisible();
  const receipt = await fixture.snapshot();
  expect(receipt.calls - before).toBe(2);
  const report = lastToolResult(receipt);
  await expectClosedCompletion(response, CAFFEINE_ANSWER, expectedCaffeineCitations(report));
  const sources = report.sources as Array<{ file_id: string }>;
  expect(sources.length).toBeGreaterThan(0);
  expect(sources.every(source => source.file_id === fileId)).toBe(true);
  assistantTurns += 1;
  await expect(page.locator(NOT_DIAGNOSTIC_SLOT)).toHaveCount(assistantTurns);
  await expect(page.locator(NOT_DIAGNOSTIC_SLOT).last()).toHaveText(NOT_DIAGNOSTIC);
});

for (const c of INPUT) {
  test(`${c.id} ${c.class}: “${c.prompt}” is refused before any model call`, async () => {
    const before = (await fixture.snapshot()).calls;
    const response = await ask(c.prompt);
    expect(response.status()).toBe(200);
    expect(response.headers()["x-copilot-refusal"]).toBe(c.refusal);
    await expectRefusalTurn(c.refusal!);
    expect((await fixture.snapshot()).calls).toBe(before);
  });
}

for (const c of OUTPUT) {
  test(`${c.id} ${c.class}: the completion “${c.answer}” is replaced whole`, async () => {
    await fixture.configure({ prompt: c.prompt, tool: c.tool!, answer: c.answer! });
    const before = (await fixture.snapshot()).calls;
    const response = await ask(c.prompt);
    expect(response.status()).toBe(200);
    const receipt = await fixture.snapshot();
    // One tool request and one completion: the real tool ran and the guard read a real completion.
    expect(receipt.calls - before).toBe(2);
    expect(lastToolResult(receipt)).toMatchObject(c.toolJson!);
    expect(response.headers()["x-copilot-refusal"]).toBe(c.refusal);
    const expected = await expectRefusalTurn(c.refusal!);
    const chatId = await expectClosedCompletion(response, expected);
    expect(await page.content()).not.toContain(c.answer!);
    const { data: stored, error } = await adminClient().from("chat_messages").select("content").eq("chat_id", chatId).eq("user_id", userId);
    expect(error).toBeNull();
    expect(JSON.stringify(stored)).not.toContain(c.answer!);
  });
}

test("before the report grant is turned off, every response so far held the three assertions", async () => {
  expect(assistantTurns).toBe(1 + INPUT.length + OUTPUT.length);
  await expectEveryResponseHeld();
});

test("turning off the report grant empties the report tool, and the thread starts afresh on the same local path", async () => {
  const settings = await context!.newPage();
  await settings.goto("/genome/me/reports");
  const choices = settings.getByRole("region", { name: "Choose your reports", exact: true });
  const label = OWN_REPORT_CHOICES["reports.polygenic"].label;
  const revoked = settings.waitForResponse(response =>
    /^\/api\/consents\/[0-9a-f-]{36}\/revoke$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
  await choices.getByRole("button", { name: `Turn off ${label}`, exact: true }).click();
  const response = await revoked;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ revoked: true });
  await expect(choices.getByRole("button", { name: `Enable ${label}`, exact: true })).toBeVisible();
  await settings.close();
  // The revocation's exact-grant purge removes the conversation that read the
  // report (canonical-copilot-invalidation.spec.ts proves the disposition);
  // what this file needs is a fresh thread on the same local path.
  await page.goto("/copilot/me");
  await expect(page.getByTestId("data-flow-indicator")).toContainText("Local mode");
  await expect(page.locator(NOT_DIAGNOSTIC_SLOT)).toHaveCount(0);
  assistantTurns = 0;
  seen.clear();
});

for (const c of REVOKED) {
  test(`${c.id} ${c.class}: the report tool returns no report and “${c.answer}” ${c.refusal ? "is replaced whole" : "stands as the honest answer"}`, async () => {
    await fixture.configure({ prompt: c.prompt, tool: c.tool!, answer: c.answer! });
    const before = (await fixture.snapshot()).calls;
    const response = await ask(c.prompt);
    expect(response.status()).toBe(200);
    const receipt = await fixture.snapshot();
    expect(receipt.calls - before).toBe(2);
    const result = lastToolResult(receipt);
    // Zero rows for a revoked grant: no source, no variant, no citation.
    expect(result).toMatchObject(c.toolJson!);
    expect(result).not.toHaveProperty("sources");
    expect(JSON.stringify(result)).not.toContain("A/C");
    if (c.refusal) {
      expect(response.headers()["x-copilot-refusal"]).toBe(c.refusal);
      const expected = await expectRefusalTurn(c.refusal);
      await expectClosedCompletion(response, expected);
      expect(await page.content()).not.toContain(c.answer!);
    } else {
      expect(response.headers()["x-copilot-refusal"]).toBeUndefined();
      await expect(page.getByText(c.answer!, { exact: true })).toBeVisible();
      await expectClosedCompletion(response, c.answer!);
      assistantTurns += 1;
      await expect(page.locator(NOT_DIAGNOSTIC_SLOT)).toHaveCount(assistantTurns);
      for (const text of c.mustContain ?? []) expect(c.answer).toContain(text);
    }
    for (const text of c.mustNotContain ?? []) expect(await page.content()).not.toContain(text);
  });
}

test("after the report grant is turned off, every response held the three assertions", async () => {
  expect(assistantTurns).toBe(REVOKED.length);
  await expectEveryResponseHeld();
});
