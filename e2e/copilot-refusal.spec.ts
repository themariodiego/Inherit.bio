import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { adminClient, createConfirmedUser, ingestFileAs, signIn } from "./helpers";
import { ADVERSARIAL_NUMBER, mockLlmCalls, startMockLlm } from "./mock-llm";
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
 * 1040's prompt list). What it pins: a supplement, dosage, diet, "which
 * embryo should we pick", cross-subject, diagnosis and prognosis prompt each
 * get the exact refusal string as the whole assistant turn, and the provider
 * receives nothing — the mock's request count does not move and no consent
 * dialog is raised, because the gate runs before the consent step; an
 * allowed prompt still reaches the provider through the tool loop; and an
 * answer carrying a number no tool returned is replaced whole with the
 * fixed refusal, tool parts included.
 *
 * The "cloud" provider is the same in-process mock e2e/copilot.spec.ts uses,
 * reached through a host name isLocalBaseUrl treats as non-local, so the
 * real consent path runs with zero real third-party traffic. Every
 * assertion here is derivable from the code: the refusal strings are
 * imported from the registry, the refusal id comes back in the
 * `x-copilot-refusal` header, and the mock's counter is read in-process.
 */

const USER = { email: "copilot-refusal@e2e.local", password: "e2e-copilot-refusal-pw" };
const MOCK_PORT = 8123;
const MOCK_HOST = "localhost.localdomain";
const MOCK_BASE = `http://${MOCK_HOST}:${MOCK_PORT}/v1`;

/** Brief line 1040's five prompts plus the two remaining gated intents. */
const GATED_PROMPTS: ReadonlyArray<{ prompt: string; id: string; refusal: (subject: string) => string }> = [
  { prompt: "Should I take a vitamin D supplement?", id: "treatment", refusal: () => REFUSAL_TREATMENT },
  { prompt: "What dosage of folic acid should I take?", id: "treatment", refusal: () => REFUSAL_TREATMENT },
  { prompt: "What should I eat to lower my cholesterol risk?", id: "treatment", refusal: () => REFUSAL_TREATMENT },
  { prompt: "Which embryo should we pick?", id: "selection-advice", refusal: () => REFUSAL_SELECTION_ADVICE },
  { prompt: "What does my sister’s file say about caffeine?", id: "cross-subject", refusal: crossSubjectRefusal },
  { prompt: "Do I have haemochromatosis?", id: "diagnosis", refusal: () => REFUSAL_DIAGNOSIS },
  { prompt: "Will I get Alzheimer’s?", id: "prognosis", refusal: () => REFUSAL_PROGNOSIS },
];

let stopMock: (() => Promise<void>) | null = null;
let userId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  stopMock = await startMockLlm(MOCK_PORT);
  userId = await createConfirmedUser(USER.email, USER.password);
  const admin = adminClient();
  await admin.from("llm_keys").delete().eq("user_id", userId);
  await admin.from("llm_settings").delete().eq("user_id", userId);
  await admin.from("subject_consents").delete().eq("account_id", userId).eq("consent_type", "cloud_model");
  await admin.from("consent_grants").delete().eq("user_id", userId);
});

test.afterAll(async () => {
  await stopMock?.();
});

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
  const response = page.waitForResponse((candidate) => candidate.url().includes("/api/chat"));
  await page.getByLabel("Message the copilot").fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
  return response;
}

/**
 * Axe in both themes, each on a fresh load in that theme, as e2e/family.spec.ts
 * does: the theme provider flips the class on the live page, so an audit taken
 * on a page loaded in the other theme samples mid-transition colours.
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

test("each gated prompt gets its exact refusal as the whole turn and the provider receives nothing; an allowed prompt still reaches it", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await ingestFileAs(
    page,
    USER.email,
    USER.password,
    path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"),
    "vcf",
  );

  // The mock as an OpenAI-compatible CLOUD endpoint, as e2e/copilot.spec.ts.
  await page.goto("/settings/copilot");
  await page.getByLabel("Provider", { exact: true }).click();
  await page.getByRole("option", { name: /OpenAI-compatible/ }).click();
  await page.getByLabel("Base URL").fill(MOCK_BASE);
  await expect(page.getByText(/Cloud service found/)).toBeVisible();
  await page.getByLabel("Model").fill("mock-model");
  await page.getByRole("button", { name: "Save provider" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.goto("/copilot/me");
  await expect(page.getByTestId("data-flow-indicator")).toContainText("Cloud mode");

  // Consent first, so that afterwards the only thing between a prompt and
  // the provider is the gate itself.
  await ask(page, "What is my caffeine genotype?");
  await page.getByRole("button", { name: "Review what would be shared" }).click();
  await page.getByTestId("consent-grant").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The allowed prompt reaches the provider: the tool call runs, the answer
  // streams, the mock's counter moves.
  const beforeAllowed = mockLlmCalls();
  const allowed = await ask(page, "What is my caffeine genotype?");
  expect(allowed.status()).toBe(200);
  expect(allowed.headers()["x-copilot-refusal"]).toBeUndefined();
  await expect(page.getByText(/Caffeine metabolism report \(CYP1A2, rs762551\)/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/your genotype is A\/C/)).toBeVisible();
  await expect(page.getByText("get_genotype")).toHaveCount(1);
  expect(mockLlmCalls()).toBeGreaterThan(beforeAllowed);

  const subject = await selfLabel();
  const seen = new Map<string, number>();
  for (const { prompt, id, refusal } of GATED_PROMPTS) {
    const expected = refusal(subject);
    const before = mockLlmCalls();
    const response = await ask(page, prompt);
    // The route answers 200 on the chat transport, names the class, and the
    // refusal is the entire assistant turn.
    expect(response.status()).toBe(200);
    expect(response.headers()["x-copilot-refusal"]).toBe(id);
    const count = (seen.get(expected) ?? 0) + 1;
    seen.set(expected, count);
    await expect(page.getByText(expected, { exact: true })).toHaveCount(count);
    await expect(page.getByText("Thinking…")).toHaveCount(0);
    // Zero provider calls, no consent dialog, no tool part: the gate ran
    // before every provider-facing step.
    expect(mockLlmCalls()).toBe(before);
    await expect(page.getByRole("button", { name: "Review what would be shared" })).toHaveCount(0);
    await expect(page.getByText("get_genotype")).toHaveCount(1);
  }
  await expect(page.getByText(REFUSAL_TREATMENT, { exact: true })).toHaveCount(3);

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
  const before = mockLlmCalls();
  const response = await ask(page, "How common is my caffeine genotype?");
  expect(response.status()).toBe(200);
  expect(response.headers()["x-copilot-refusal"]).toBe("unsupported-number");
  await expect(page.getByText(REFUSAL_UNSUPPORTED_NUMBER, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  expect(mockLlmCalls()).toBeGreaterThan(before);
  await expect(page.getByText("get_genotype")).toHaveCount(0);
  expect(await page.content()).not.toContain(ADVERSARIAL_NUMBER);
  await expect(page.getByText(/Caffeine metabolism report/)).toHaveCount(0);
});
