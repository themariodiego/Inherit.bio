import { expect, test } from "@playwright/test";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { allowCopilot, CAFFEINE_ANSWER, CAFFEINE_PROMPT, CAFFEINE_SLUG, COPILOT_MODEL_HOST,
  expectClosedCompletion, expectedCaffeineCitations, lastToolResult, observeNextChatResponse, saveCopilotProvider, startCopilotFixture, type CopilotFixture } from "./fixtures/canonical-copilot-browser";

// A9: real canonical source/report, distinct named cloud disclosure, complete
// source-backed answer and live withdrawal. The HTTPS fake provider lives in
// the egress-isolated container; no loopback cloud-classification exception.

const USER = { email: `copilot-${randomUUID()}@e2e.local`, password: "e2e-copilot-pw" };
const MOCK_PORT = 8123;
let fixture: CopilotFixture;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  fixture = await startCopilotFixture(MOCK_PORT);
  await createConfirmedUser(USER.email, USER.password);
});

test.afterAll(async () => { await fixture?.stop(); });

test("with no provider configured, setup explains reusable permission and the required same-host network boundary", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/chat");
  const instructions = page.getByTestId("local-mode-instructions");
  await expect(instructions).toBeVisible();
  // Leads with what the copilot does, in plain language, before any setup.
  await expect(instructions).toContainText(
    "Ask questions about your own reports in plain language",
  );
  await expect(instructions).toContainText(
    "Connecting an AI is a one-time technical step",
  );
  await expect(instructions).toContainText("An API key is like a password");
  await expect(instructions).toContainText("explicit permission before using your data");
  await expect(instructions).toContainText("permission names the provider and the information it may receive");
  await expect(instructions).toContainText("It remains in effect until it ends or you withdraw it.");
  await expect(instructions).toContainText("Changing the provider, model or key requires a new permission.");
  await expect(instructions).toContainText("Your AI provider sets its own charges.");
  const advanced = instructions.locator("details");
  await expect(advanced.locator("summary")).toHaveText("Advanced: run an AI beside your own Inherit server");
  await advanced.locator("summary").click();
  await expect(advanced).toContainText("Ollama or LM Studio on the same machine as Inherit");
  await expect(advanced).toContainText("OpenAI-compatible");
  await expect(advanced).toContainText("Local mode requires a configured same-host endpoint and a network that blocks outside connections.");
  await expect(advanced).toContainText("The public Inherit service cannot connect to a model on your computer.");
  await expect(advanced).toContainText("Saving a local endpoint does not itself create that network protection.");
  await expect(
    instructions.getByText("localhost:11434", { exact: false }),
  ).toBeVisible();
});

test("cloud provider requires named disclosure before use; captured report backs the complete answer; withdrawal stops a stale composer", async ({ page }, testInfo) => {
  await signIn(page, USER.email, USER.password);
  const fileId = await uploadOwnFileWithChosenReports(page,
    path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"),
    { fileType: "vcf", purposes: ["reports.polygenic"] });
  await saveCopilotProvider(page, fixture.baseUrl);

  // Saving an endpoint grants nothing. The canonical route has no composer
  // before the separate Settings action, instead of the legacy popup-on-send.
  await page.goto("/copilot/me");
  await expect(page.getByLabel("Message the copilot")).toHaveCount(0);
  await expect(page.getByText("Choose what Copilot may use before asking about your file. Saving a provider does not grant that permission.", { exact: true })).toBeVisible();
  expect((await fixture.snapshot()).calls).toBe(0);
  await page.getByRole("link", { name: "Review Copilot settings", exact: true }).click();
  const permission = page.getByRole("region", { name: "Copilot permission", exact: true });
  await expect(permission).toContainText(`${COPILOT_MODEL_HOST}:${MOCK_PORT}`);
  await expect(permission).toContainText("Individual genotypes you ask about");
  await expect(permission).toContainText("Score-panel coverage and why a validated score is unavailable");
  await expect(permission).not.toContainText("score, percentile");
  await expect(permission).toContainText("Your chat messages");
  await expect(permission).toContainText("Your original DNA file is not sent");
  await allowCopilot(page);

  await fixture.configure({ prompt: CAFFEINE_PROMPT,
    tool: { name: "get_report", arguments: { slug: CAFFEINE_SLUG } }, answer: CAFFEINE_ANSWER });
  await page.goto("/copilot/me");
  await expect(page.getByTestId("data-flow-indicator")).toContainText("Cloud mode");
  const answered = page.waitForResponse(response => new URL(response.url()).pathname === "/api/chat");
  await page.getByLabel("Message the copilot").fill(CAFFEINE_PROMPT);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const response = await answered;
  expect(response.status()).toBe(200);
  await expect(page.getByText(CAFFEINE_ANSWER, { exact: true })).toBeVisible();
  const receipt = await fixture.snapshot();
  expect(receipt.calls).toBe(2);
  const report = lastToolResult(receipt);
  await expectClosedCompletion(response, CAFFEINE_ANSWER, expectedCaffeineCitations(report));
  expect(report).toMatchObject({ slug: CAFFEINE_SLUG,
    sources: [expect.objectContaining({ file_id: fileId, purpose: "reports.polygenic", covered: true,
      variants: expect.arrayContaining([expect.objectContaining({ rsid: "rs762551", outcome: expect.objectContaining({ genotype: "AC" }) })]) })] });
  const source = (report.sources as Array<Record<string, unknown>>)[0];
  const snapshot = source.catalogSnapshot as { schemaVersion: number; templateSha256: string;
    template: { title: string; citations: unknown[] } };
  expect(snapshot.schemaVersion).toBe(1);
  expect(snapshot.templateSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(source.title).toBe("Caffeine metabolism · CYP1A2");
  expect(source.title).toBe(snapshot.template.title);
  expect(source.citations).toEqual(snapshot.template.citations);
  expect(source.citations).toEqual(expect.arrayContaining([expect.objectContaining({ pmid: "10233211" })]));
  expect(report.unavailable_sources).toEqual([]);
  await expect(page.getByText("get_report", { exact: true })).toHaveCount(0);
  // Reopen server-owned history through the actual user control.
  await page.reload();
  await page.getByText("Past conversations", { exact:true }).click();
  const historyRead=page.waitForResponse(result => /^\/api\/chats\/[0-9a-f-]{36}$/.test(new URL(result.url()).pathname));
  await page.getByRole("button", { name:/^Conversation from / }).click();
  const historyResponse=await historyRead;
  expect(historyResponse.status()).toBe(200);
  const savedHistory=await historyResponse.json();
  expect(savedHistory.messages).toHaveLength(2);
  expect(savedHistory.messages[1]).toMatchObject({ content:CAFFEINE_ANSWER,citations:expectedCaffeineCitations(report) });
  expect(savedHistory.messages[1].createdAt).toMatch(/Z$/);
  await expect(page.getByText(CAFFEINE_ANSWER, { exact:true })).toBeVisible();
  expect((await fixture.snapshot()).calls).toBe(2);

  // Actual rendered source-backed answer, at both supported review widths.
  for (const [name,width,height] of [["desktop",1280,900],["mobile",390,844]] as const) {
    await page.setViewportSize({ width,height });
    await expect(page.getByLabel("Message the copilot")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path:testInfo.outputPath(`copilot-${name}.png`),fullPage:true });
  }
  await page.setViewportSize({ width:1280,height:900 });

  // Withdraw in another real tab, then exercise the old composer/context. Its
  // request must fail before any provider request, not merely hide the UI.
  const settings = await page.context().newPage();
  try {
    await settings.goto("/settings/copilot");
    await settings.getByRole("button", { name: "Withdraw Copilot permission", exact: true }).click();
    await expect(settings.getByRole("button", { name: "Allow Copilot for this model", exact: true })).toBeVisible();
    const before = (await fixture.snapshot()).calls;
    const observed = await observeNextChatResponse(page);
    try {
      const refused = page.waitForResponse(result => new URL(result.url()).pathname === "/api/chat");
      await page.getByLabel("Message the copilot").fill("And my alcohol flush?");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      const denied = await refused;
      expect(denied.status()).toBe(403);
      const native = await observed.read();
      expect(native.status).toBe(403);
      expect(JSON.parse(native.text)).toEqual({ error: "copilot_unavailable" });
      expect((await fixture.snapshot()).calls).toBe(before);
    } finally { await observed.dispose(); }
    await page.goto("/copilot/me");
    await expect(page.getByLabel("Message the copilot")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Review Copilot settings", exact: true })).toBeVisible();
  } finally { await settings.close(); }
});
