import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { adminClient, createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { ADVERSARIAL_NUMBER } from "./mock-llm";
import { allowCopilot, CAFFEINE_ANSWER, CAFFEINE_PROMPT, CAFFEINE_SLUG, expectClosedCompletion,
  expectedCaffeineCitations, lastToolResult, saveCopilotProvider, startCopilotFixture, type CopilotFixture } from "./fixtures/canonical-copilot-browser";
import {
  crossSubjectRefusal,
  REFUSAL_DIAGNOSIS,
  REFUSAL_PROGNOSIS,
  REFUSAL_SELECTION_ADVICE,
  REFUSAL_TREATMENT,
  REFUSAL_UNSUPPORTED_NUMBER,
} from "@/copy/copilot/refusals";

/**
 * The Copilot guard (brief line 2262; §5.7 line 366, §6.4 line 402; line
 * 1040's prompt list). What it pins: one prompt per treatment rule
 * (should-i-take, dose, diet, recommend-intake), "what should I eat",
 * "which embryo should we pick", cross-subject, diagnosis and prognosis
 * prompts each get the exact refusal string as the whole assistant turn,
 * and the provider receives nothing — the mock's request count does not
 * move and no consent dialog is raised, because the gate runs before the
 * consent step; an allowed prompt still reaches the provider through the
 * tool loop; a later allowed prompt reaches it without the refused turns
 * in its history; and an answer carrying a number no tool returned is
 * replaced whole with the fixed refusal, tool parts included.
 *
 * What it cannot pin: a cohort-scoped prompt. No cohort chat route exists
 * yet, so the cohort-only rules (comparatives, "which of them") are proved
 * by `src/lib/copilot/guard.test.ts` alone until one does.
 *
 * The synthetic HTTPS provider is inside the isolated app namespace. Closed
 * canonical JSON hides tool/reasoning parts; provider receipts still prove the
 * real tool loop and complete authorized history. No local-as-cloud exception.
 */

const USER = { email: `copilot-refusal-${randomUUID()}@e2e.local`, password: "e2e-copilot-refusal-pw" };
const MOCK_PORT = 8123;
/**
 * Brief line 1040's prompts plus the remaining gated intents. The four
 * treatment prompts each reach a different rule (`treatment.should-i-take`,
 * `treatment.dose` on an unspaced unit, `treatment.diet`,
 * `treatment.recommend-intake`), as `guard.test.ts` pins by rule id; the
 * header carries the class, so that is what this spec asserts.
 */
const GATED_PROMPTS: ReadonlyArray<{ prompt: string; id: string; refusal: (subject: string) => string }> = [
  { prompt: "Should I take a vitamin D supplement?", id: "treatment", refusal: () => REFUSAL_TREATMENT },
  { prompt: "Would 500mg of magnesium be enough?", id: "treatment", refusal: () => REFUSAL_TREATMENT },
  { prompt: "Should I go keto?", id: "treatment", refusal: () => REFUSAL_TREATMENT },
  { prompt: "Can you recommend a medication for this?", id: "treatment", refusal: () => REFUSAL_TREATMENT },
  { prompt: "What should I eat to lower my cholesterol risk?", id: "treatment", refusal: () => REFUSAL_TREATMENT },
  { prompt: "Which embryo should we pick?", id: "selection-advice", refusal: () => REFUSAL_SELECTION_ADVICE },
  { prompt: "What does my sister’s file say about caffeine?", id: "cross-subject", refusal: crossSubjectRefusal },
  { prompt: "Do I have haemochromatosis?", id: "diagnosis", refusal: () => REFUSAL_DIAGNOSIS },
  { prompt: "Will I get Alzheimer’s?", id: "prognosis", refusal: () => REFUSAL_PROGNOSIS },
];

/** One gated prompt per theme for the axe audit, so the audited page shows a refusal turn. */
const AXE_PROMPTS = ["Do I have haemochromatosis?", "Will I get Alzheimer’s?"] as const;

let fixture: CopilotFixture;
let userId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  fixture = await startCopilotFixture(MOCK_PORT);
  userId = await createConfirmedUser(USER.email, USER.password);
});

test.afterAll(async () => { await fixture?.stop(); });

/** The self subject's label, which the thread header names and the cross-subject refusal repeats. */
async function selfLabel(): Promise<string> {
  const { data, error } = await adminClient()
    .from("subjects")
    .select("display_label")
    .eq("subject_account_id", userId)
    .eq("subject_class", "self")
    .single();
  if (error || !data) throw new Error(`self subject: ${error?.message}`);
  return (data as { display_label: string }).display_label;
}

/** Send one prompt and return the chat route's response. */
async function ask(page: Page, prompt: string) {
  const response = page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/chat");
  await page.getByLabel("Message the copilot").fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
  return response;
}

/**
 * Axe in both themes, each on a fresh load in that theme, as e2e/family.spec.ts
 * does: the theme provider flips the class on the live page, so an audit taken
 * on a page loaded in the other theme samples mid-transition colours. A reload
 * empties the thread, so each theme sends one gated prompt first and audits a
 * page that shows a refusal turn.
 */
async function expectAxeClean(page: Page) {
  for (const [index, theme] of (["light", "dark"] as const).entries()) {
    await page.emulateMedia({ colorScheme: theme });
    await page.reload();
    await page.waitForLoadState("networkidle");
    const response = await ask(page, AXE_PROMPTS[index]);
    expect(response.headers()["x-copilot-refusal"]).toBeDefined();
    await expect(page.getByText(index === 0 ? REFUSAL_DIAGNOSIS : REFUSAL_PROGNOSIS, { exact: true })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(
      results.violations
        .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
        .map((violation) => ({ id: violation.id, theme, help: violation.help })),
    ).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("each gated prompt gets its exact refusal as the whole turn and the provider receives nothing; an allowed prompt still reaches it", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await uploadOwnFileWithChosenReports(
    page,
    path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"),
    { fileType: "vcf", purposes: ["reports.polygenic"] },
  );

  await saveCopilotProvider(page, fixture.baseUrl);
  await allowCopilot(page);
  await page.goto("/copilot/me");
  await expect(page.getByTestId("data-flow-indicator")).toContainText("Cloud mode");

  await fixture.configure({ prompt: CAFFEINE_PROMPT,
    tool: { name: "get_report", arguments: { slug: CAFFEINE_SLUG } }, answer: CAFFEINE_ANSWER });
  const beforeAllowed = (await fixture.snapshot()).calls;
  const allowed = await ask(page, CAFFEINE_PROMPT);
  expect(allowed.status()).toBe(200);
  expect(allowed.headers()["x-copilot-refusal"]).toBeUndefined();
  await expect(page.getByText(CAFFEINE_ANSWER, { exact: true })).toBeVisible();
  const allowedReceipt = await fixture.snapshot();
  const chatId = await expectClosedCompletion(allowed, CAFFEINE_ANSWER, expectedCaffeineCitations(lastToolResult(allowedReceipt)));
  expect(allowedReceipt.calls - beforeAllowed).toBe(2);
  expect(lastToolResult(allowedReceipt)).toMatchObject({ slug: CAFFEINE_SLUG });
  await expect(page.getByText("get_report", { exact: true })).toHaveCount(0);

  const subject = await selfLabel();
  const seen = new Map<string, number>();
  for (const { prompt, id, refusal } of GATED_PROMPTS) {
    const expected = refusal(subject);
    const before = (await fixture.snapshot()).calls;
    const response = await ask(page, prompt);
    // The route answers 200 on the chat transport, names the class, and the
    // refusal is the entire assistant turn.
    expect(response.status()).toBe(200);
    expect(response.headers()["x-copilot-refusal"]).toBe(id);
    const count = (seen.get(expected) ?? 0) + 1;
    seen.set(expected, count);
    await expect(page.getByText(expected, { exact: true })).toHaveCount(count);
    await expect(page.getByText("Checking your question…", { exact: true })).toHaveCount(0);
    // Zero provider calls, no consent dialog, no tool part: the gate ran
    // before every provider-facing step.
    expect((await fixture.snapshot()).calls).toBe(before);
    const { count: storedCount, error } = await adminClient().from("chat_messages").select("id", { head: true, count: "exact" })
      .eq("chat_id", chatId).eq("user_id", userId);
    expect(error).toBeNull();
    expect(storedCount).toBe(2);
    await expect(page.getByRole("button", { name: "Review what would be shared" })).toHaveCount(0);
    await expect(page.getByText("get_report", { exact: true })).toHaveCount(0);
  }
  await expect(page.getByText(REFUSAL_TREATMENT, { exact: true })).toHaveCount(5);

  // A later allowed prompt reaches the provider with the refused turns
  // dropped from its history: the provider sees the two allowed user turns
  // and none of the gated ones.
  await fixture.configure({ prompt: CAFFEINE_PROMPT,
    tool: { name: "get_report", arguments: { slug: CAFFEINE_SLUG } }, answer: CAFFEINE_ANSWER });
  const beforeResend = (await fixture.snapshot()).calls;
  const resend = await ask(page, CAFFEINE_PROMPT);
  expect(resend.status()).toBe(200);
  expect(resend.headers()["x-copilot-refusal"]).toBeUndefined();
  await expect(page.getByText(CAFFEINE_ANSWER, { exact: true })).toHaveCount(2);
  const history = await fixture.snapshot();
  expect(await expectClosedCompletion(resend, CAFFEINE_ANSWER, expectedCaffeineCitations(lastToolResult(history)))).toBe(chatId);
  expect(history.calls - beforeResend).toBe(2);
  expect(lastToolResult(history)).toMatchObject({ slug: CAFFEINE_SLUG });
  const userTurns = history.requests.at(-1)!.messages
    .filter((message) => message.role === "user")
    .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)));
  // The server supplies exactly the two authorized user turns.
  expect(userTurns).toEqual([CAFFEINE_PROMPT, CAFFEINE_PROMPT]);
  for (const { prompt } of GATED_PROMPTS) {
    expect(userTurns.some((text) => text.includes(prompt))).toBe(false);
  }
  expect(userTurns.some((text) => text.includes("I can’t"))).toBe(false);

  await expectAxeClean(page);
});

test("an answer carrying a number no tool returned is replaced whole with the fixed refusal", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/copilot/me");
  await expect(page.getByTestId("data-flow-indicator")).toContainText("Cloud mode");

  // The prompt is allowed (the gate lets it through and the mock is called);
  // the mock's adversarial completion carries a percentage absent from the
  // tool JSON, so the output guard replaces the completion, tool part
  // included, and the fabricated number never reaches the page.
  const prompt = "How common is my caffeine genotype?";
  await fixture.configure({ prompt, tool: { name: "get_report", arguments: { slug: CAFFEINE_SLUG } },
    answer: `According to your Caffeine metabolism report (CYP1A2, rs762551), about ${ADVERSARIAL_NUMBER} of people share your genotype A/C. This is informational, not medical advice.` });
  const before = (await fixture.snapshot()).calls;
  const response = await ask(page, prompt);
  expect(response.status()).toBe(200);
  expect(response.headers()["x-copilot-refusal"]).toBe("unsupported-number");
  await expect(page.getByText(REFUSAL_UNSUPPORTED_NUMBER, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  expect((await fixture.snapshot()).calls - before).toBe(2);
  const chatId = await expectClosedCompletion(response, REFUSAL_UNSUPPORTED_NUMBER);
  const { data: stored, error } = await adminClient().from("chat_messages").select("role,content")
    .eq("chat_id", chatId).eq("user_id", userId);
  expect(error).toBeNull();
  expect(stored).toHaveLength(2);
  expect(stored).toEqual(expect.arrayContaining([{ role: "assistant", content: [{ type: "text", text: REFUSAL_UNSUPPORTED_NUMBER }] }]));
  expect(JSON.stringify(stored)).not.toContain(ADVERSARIAL_NUMBER);
  await expect(page.getByText("get_genotype")).toHaveCount(0);
  expect(await page.content()).not.toContain(ADVERSARIAL_NUMBER);
  await expect(page.getByText(/Caffeine metabolism report/)).toHaveCount(0);
});
