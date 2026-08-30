import { expect, test } from "@playwright/test";
import path from "node:path";
import { createConfirmedUser, ingestFileAs, signIn } from "./helpers";
import { startMockLlm } from "./mock-llm";

// A9 — copilot: local-mode instructions with no provider; the consent
// dialog names the provider and data classes before the first
// genome-touching request to a cloud endpoint; a tool call retrieves a real
// genotype from the user's store; the streamed answer cites the report; the
// grant is revocable in Settings and revocation takes effect.
//
// The "cloud" provider is an OpenAI-compatible mock reached via the
// mock-llm.test hosts alias (see e2e/README: `127.0.0.1 mock-llm.test` in
// /etc/hosts) so isLocalBaseUrl treats it as non-local — exercising the
// real consent path with zero real third-party traffic.

const USER = { email: "copilot@e2e.local", password: "e2e-copilot-pw" };
const MOCK_PORT = 8123;
const MOCK_BASE = `http://mock-llm.test:${MOCK_PORT}/v1`;

let stopMock: (() => Promise<void>) | null = null;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  stopMock = await startMockLlm(MOCK_PORT);
  await createConfirmedUser(USER.email, USER.password);
});

test.afterAll(async () => {
  await stopMock?.();
});

test("with no provider configured, plain-language setup renders and the local option stays the stated privacy preference", async ({
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
  // The local-first privacy PREFERENCE is still present: the self-hosted
  // option is named the most private / privacy-preferred one, and the
  // full local instructions live in the expandable advanced section.
  await expect(instructions).toContainText("most private");
  const advanced = instructions.locator("details");
  await expect(advanced).toContainText("privacy-preferred");
  await advanced.locator("summary").click();
  await expect(
    instructions.getByText("localhost:11434", { exact: false }),
  ).toBeVisible();
});

test("cloud provider requires a consent dialog naming provider and data classes; tool call + cited streamed answer; revocation works", async ({
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

  // Configure the mock as an OpenAI-compatible CLOUD endpoint. The form
  // defaults to Anthropic for fresh users, so pick the provider first.
  await page.goto("/settings");
  await page.getByLabel("Provider", { exact: true }).click();
  await page.getByRole("option", { name: /OpenAI-compatible/ }).click();
  await page.getByLabel("Base URL").fill(MOCK_BASE);
  await expect(
    page.getByText("Detected as a cloud endpoint"),
  ).toBeVisible();
  await page.getByLabel("Model").fill("mock-model");
  await page.getByRole("button", { name: "Save provider" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // First genome-touching request → consent required.
  await page.goto("/chat");
  await expect(page.getByTestId("data-flow-indicator")).toContainText(
    "Cloud mode",
  );
  await page
    .getByLabel("Message the copilot")
    .fill("What is my caffeine genotype?");
  await page.getByRole("button", { name: "Send" }).click();
  await page
    .getByRole("button", { name: "Review what would be shared" })
    .click();

  // The dialog names the provider host and the exact data classes.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`mock-llm.test:${MOCK_PORT}`);
  await expect(dialog).toContainText("Individual genotypes you ask about");
  await expect(dialog).toContainText("Polygenic score results");
  await expect(dialog).toContainText("Your chat messages");
  await page.getByTestId("consent-grant").click();
  await expect(dialog).toHaveCount(0);

  // Resend: now the request flows — tool call runs, answer streams, cites
  // the report and the real genotype from the user's file (A/C at rs762551).
  await page
    .getByLabel("Message the copilot")
    .fill("What is my caffeine genotype?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("get_genotype")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText(/Caffeine metabolism report \(CYP1A2, rs762551\)/),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/your genotype is A\/C/)).toBeVisible();

  // Revoke in Settings → next request requires consent again.
  await page.goto("/settings");
  await page.getByTestId(`revoke-mock-llm.test:${MOCK_PORT}`).click();
  await expect(page.getByText(/revoked \d/)).toBeVisible();

  await page.goto("/chat");
  await page.getByLabel("Message the copilot").fill("And my alcohol flush?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByRole("button", { name: "Review what would be shared" }),
  ).toBeVisible({ timeout: 30_000 });
});
