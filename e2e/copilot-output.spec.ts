import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { adminClient, createConfirmedUser, ingestFileAs, signIn } from "./helpers";
import { mockLlmCalls, startMockLlm } from "./mock-llm";
import cases from "./fixtures/copilot-output-cases.json";
import { refusalFor, REFUSAL_IDS, type RefusalId } from "@/copy/copilot/refusals";

// These are allowed questions with adversarial provider completions, not
// prohibited questions stopped by the input gate. The real route executes
// its own tool, buffers character-split completions, then renders or refuses.
// This self-scope regression suite does not stand in for the full 80-case
// family/cohort/Portrait evaluation required by A.9.
const USER = { email: `copilot-output-${randomUUID()}@e2e.local`, password: "e2e-output-test-pw" };
const MOCK_PORT = 8125;
let stopMock: (() => Promise<void>) | undefined;
let context: BrowserContext | undefined;
let page: Page;
let subjectLabel = "";
let deliveredBytes: Buffer | undefined;

async function ask(prompt: string) {
  const response = page.waitForResponse(candidate => new URL(candidate.url()).pathname === "/api/chat");
  await page.getByLabel("Message the copilot").fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
  return response;
}

test.beforeAll(async ({ browser }, info) => {
  stopMock = await startMockLlm(MOCK_PORT, {
    answerForPrompt(prompt) {
      const id = /using example (c\d+)\./u.exec(prompt)?.[1];
      return cases.find(entry => entry.id === id)?.answer;
    },
  });
  const userId = await createConfirmedUser(USER.email, USER.password);
  context = await browser.newContext({ baseURL: info.project.use.baseURL });
  page = await context.newPage();
  // Capture the real server bytes through Playwright's request transport,
  // then forward them unchanged. Chromium's CDP response-body inspection
  // decodes this charset-less SSE as Windows-1252, unlike the SDK's UTF-8
  // TextDecoder. No app route or provider completion is stubbed here.
  await page.route("**/api/chat**", async route => {
    if (new URL(route.request().url()).pathname !== "/api/chat") return route.continue();
    const response = await route.fetch();
    deliveredBytes = await response.body();
    await route.fulfill({ response, body: deliveredBytes });
  });
  await signIn(page, USER.email, USER.password);
  await ingestFileAs(page, USER.email, USER.password, path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"), "vcf");
  const { data, error } = await adminClient().from("subjects").select("display_label")
    .eq("subject_account_id", userId).eq("subject_class", "self").single();
  if (error || !data) throw new Error(`synthetic subject: ${error?.message}`);
  subjectLabel = data.display_label;

  await page.goto("/settings/copilot");
  await page.getByLabel("Provider", { exact: true }).click();
  await page.getByRole("option", { name: /OpenAI-compatible/ }).click();
  await page.getByLabel("Base URL").fill(`http://localhost.localdomain:${MOCK_PORT}/v1`);
  await expect(page.getByText(/Cloud service found/)).toBeVisible();
  await page.getByLabel("Model").fill("mock-model");
  await page.getByRole("button", { name: "Save provider" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.goto("/copilot/me");
  await ask("What is my caffeine genotype?");
  await page.getByRole("button", { name: "Review what would be shared" }).click();
  await page.getByTestId("consent-grant").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test.afterAll(async () => {
  await context?.close();
  await stopMock?.();
});

for (const entry of cases) {
  test(`output ${entry.id}: ${entry.refusal ?? "useful explanation"} through the actual chat route`, async () => {
    await page.goto("/copilot/me");
    await expect(page.getByTestId("data-flow-indicator")).toContainText("Cloud mode");
    const before = mockLlmCalls();
    deliveredBytes = undefined;
    const response = await ask(`Explain my report using example ${entry.id}.`);
    expect(response.status()).toBe(200);
    // Exactly one tool request followed by one provider completion proves
    // this exercised the output gate, not an input refusal or consent error.
    expect(mockLlmCalls() - before).toBe(2);
    expect(response.headers()["x-copilot-refusal"]).toBe(entry.refusal);

    expect(deliveredBytes).toBeDefined();
    const raw = deliveredBytes!.toString("utf8");
    const chunks: Array<{ type: string; delta?: string }> = raw.split("\n")
      .filter(line => line.startsWith("data: ") && line !== "data: [DONE]")
      .map(line => JSON.parse(line.slice(6)));
    const delivered = chunks.filter(chunk => chunk.type === "text-delta").map(chunk => chunk.delta ?? "").join("");
    let expected = entry.answer;
    if (entry.refusal) {
      expect(REFUSAL_IDS).toContain(entry.refusal);
      expected = refusalFor(entry.refusal as RefusalId, subjectLabel);
      // Whole-turn equality checks the network payload as well as the DOM;
      // there must be no partial completion or leaked tool data.
      expect(chunks.some(chunk => chunk.type.startsWith("tool-"))).toBe(false);
      await expect(page.getByText("get_genotype")).toHaveCount(0);
    } else {
      expect(chunks.some(chunk => chunk.type === "tool-output-available")).toBe(true);
      await expect(page.getByText("get_genotype")).toHaveCount(1);
    }
    expect(delivered).toBe(expected);
    await expect(page.getByText(expected, { exact: true })).toBeVisible();
    await expect(page.getByText("Thinking…")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
    await expect(page.locator('[data-nextjs-dialog], .vite-error-overlay')).toHaveCount(0);
  });
}
