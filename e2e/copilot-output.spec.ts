import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { adminClient, createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { allowCopilot, expectClosedCompletion, lastToolResult, saveCopilotProvider, startCopilotFixture,
  type CopilotFixture } from "./fixtures/canonical-copilot-browser";
import cases from "./fixtures/copilot-output-cases.json";
import { refusalFor, REFUSAL_IDS, type RefusalId } from "@/copy/copilot/refusals";

// These are allowed questions with adversarial provider completions, not
// prohibited questions stopped by the input gate. The real route executes
// its own tool, buffers character-split completions, then renders or refuses.
// This self-scope regression suite does not stand in for the full 80-case
// family/cohort/Portrait evaluation required by A.9.
const USER = { email: `copilot-output-${randomUUID()}@e2e.local`, password: "e2e-output-test-pw" };
const MOCK_PORT = 8125;
let fixture: CopilotFixture;
let userId = "";
let context: BrowserContext | undefined;
let page: Page;
let subjectLabel = "";

async function ask(prompt: string) {
  const response = page.waitForResponse(candidate => new URL(candidate.url()).pathname === "/api/chat");
  await page.getByLabel("Message the copilot").fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
  return response;
}

test.beforeAll(async ({ browser }, info) => {
  fixture = await startCopilotFixture(MOCK_PORT);
  userId = await createConfirmedUser(USER.email, USER.password);
  context = await browser.newContext({ baseURL: info.project.use.baseURL });
  page = await context.newPage();
  await signIn(page, USER.email, USER.password);
  await uploadOwnFileWithChosenReports(page, path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"),
    { fileType: "vcf", purposes: ["reports.polygenic"] });
  const { data, error } = await adminClient().from("subjects").select("display_label")
    .eq("subject_account_id", userId).eq("subject_class", "self").single();
  if (error || !data) throw new Error(`synthetic subject: ${error?.message}`);
  subjectLabel = data.display_label;

  await saveCopilotProvider(page, fixture.baseUrl);
  await allowCopilot(page);
});

test.afterAll(async () => {
  await context?.close();
  await fixture?.stop();
});

for (const entry of cases) {
  test(`output ${entry.id}: ${entry.refusal ?? "useful explanation"} through the actual chat route`, async () => {
    await page.goto("/copilot/me");
    await expect(page.getByTestId("data-flow-indicator")).toContainText("Cloud mode");
    const prompt = `Explain my report using example ${entry.id}.`;
    await fixture.configure({ prompt, tool: { name: "get_genotype", arguments: { rsid: "rs762551" } }, answer: entry.answer });
    const before = (await fixture.snapshot()).calls;
    const response = await ask(prompt);
    expect(response.status()).toBe(200);
    // Exactly one tool request followed by one provider completion proves
    // this exercised the output gate, not an input refusal or consent error.
    const provider = await fixture.snapshot();
    expect(provider.calls - before).toBe(2);
    expect(lastToolResult(provider)).toMatchObject({ rsid: "rs762551", covered: true, status: "called", genotype: "A/C" });
    expect(response.headers()["x-copilot-refusal"]).toBe(entry.refusal);

    // Canonical chat-completion-v1 is closed JSON. Provider character deltas
    // remain real, but internal tools/reasoning never become browser parts.
    let expected = entry.answer;
    if (entry.refusal) {
      expect(REFUSAL_IDS).toContain(entry.refusal);
      expected = refusalFor(entry.refusal as RefusalId, subjectLabel);
      // Whole-turn equality checks the network payload as well as the DOM;
      // there must be no partial completion or leaked tool data.
    }
    const chatId = await expectClosedCompletion(response, expected);
    await expect(page.getByText("get_genotype", { exact: true })).toHaveCount(0);
    const { data: stored, error } = await adminClient().from("chat_messages")
      .select("role,content").eq("chat_id", chatId).eq("user_id", userId);
    expect(error).toBeNull();
    expect(stored).toHaveLength(2);
    expect(stored).toEqual(expect.arrayContaining([
      { role: "user", content: [{ type: "text", text: prompt }] },
      { role: "assistant", content: [{ type: "text", text: expected }] },
    ]));
    await expect(page.getByText(expected, { exact: true })).toBeVisible();
    await expect(page.getByText("Checking your question…", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Message the copilot")).toBeEnabled();
    await expect(page.getByLabel("Message the copilot")).toBeEmpty();
    await expect(page.locator('[data-nextjs-dialog], .vite-error-overlay')).toHaveCount(0);
  });
}
