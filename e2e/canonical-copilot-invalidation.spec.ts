import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { adminClient, createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFilePrepared, uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { OWN_REPORT_CHOICES } from "../src/lib/uploads/own-report-purpose";
import { allowCopilot, CAFFEINE_ANSWER, CAFFEINE_PROMPT, CAFFEINE_SLUG, expectClosedCompletion,
  expectedCaffeineCitations, lastToolResult, observeNextChatResponse, saveCopilotProvider, startCopilotFixture, type CopilotFixture } from "./fixtures/canonical-copilot-browser";
import type { CanonicalProviderPlan } from "./fixtures/canonical-copilot-provider";

const original = path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf");
let fixture: CopilotFixture;
test.describe.configure({ mode: "serial" });
test.beforeEach(async () => { fixture = await startCopilotFixture(8126); });
test.afterEach(async () => { await fixture?.stop(); });

async function setup(page: Page, reports = true) {
  const email = `copilot-boundary-${randomUUID()}@e2e.local`, password = "synthetic-copilot-boundary-password";
  const userId = await createConfirmedUser(email, password);
  await signIn(page, email, password);
  const fileId = reports
    ? await uploadOwnFileWithChosenReports(page, original, { fileType: "vcf", purposes: ["reports.polygenic"] })
    : await uploadOwnFilePrepared(page, original, { fileType: "vcf" });
  return { userId, fileId };
}
async function connect(page: Page) {
  await saveCopilotProvider(page, fixture.baseUrl); await allowCopilot(page); await page.goto("/copilot/me");
}
async function send(page: Page, prompt: string) {
  const response = page.waitForResponse(value => new URL(value.url()).pathname === "/api/chat");
  await page.getByLabel("Message the copilot").fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  return response;
}
async function ask(page: Page, plan: CanonicalProviderPlan, capturedReport = false) {
  await fixture.configure(plan);
  const before = (await fixture.snapshot()).calls;
  const response = await send(page, plan.prompt);
  expect(response.status()).toBe(200);
  await expect(page.getByText(plan.answer, { exact: true })).toBeVisible();
  const receipt = await fixture.snapshot(); expect(receipt.calls - before).toBe(2);
  const result = lastToolResult(receipt);
  const chatId = await expectClosedCompletion(response, plan.answer, capturedReport ? expectedCaffeineCitations(result) : []);
  return { chatId, result };
}
async function storedPair(userId: string, chatId: string) {
  const { data, error } = await adminClient().from("chat_messages").select("id,role,content,turn_id,turn_ordinal")
    .eq("user_id", userId).eq("chat_id", chatId).order("role");
  expect(error).toBeNull(); expect(data).toHaveLength(2);
  expect(data!.map(row => row.role).sort()).toEqual(["assistant", "user"]);
  expect(data![0].turn_id).toBe(data![1].turn_id);
  expect(data![0].turn_ordinal).toBe(data![1].turn_ordinal);
  return data!;
}
async function denyHistory(page: Page, chatId: string) {
  const result = await page.evaluate(async id => {
    const response = await fetch(`/api/chats/${id}`, { credentials: "same-origin", redirect: "error" });
    return { status: response.status, body: await response.json() };
  }, chatId);
  expect(result).toEqual({ status: 404, body: { error: "not_found" } });
}
async function initialPair(page: Page, userId: string) {
  const { chatId } = await ask(page, { prompt: CAFFEINE_PROMPT,
    tool: { name: "get_report", arguments: { slug: CAFFEINE_SLUG } }, answer: CAFFEINE_ANSWER }, true);
  const pair = await storedPair(userId, chatId);
  return { chatId, pair };
}
async function interruptAnswer(page: Page, pauseBefore: "tool" | "answer", mutate: (settings: Page) => Promise<void>) {
  const prompt = "Explain what the report source contains.";
  const withheld = "This completion must remain inside the synthetic provider.";
  await fixture.configure({ prompt, tool: { name: "get_report", arguments: { slug: CAFFEINE_SLUG } }, answer: withheld, pauseBefore });
  const before = (await fixture.snapshot()).calls;
  // Keep this promise pending while a second real browser tab changes authority.
  const observed = await observeNextChatResponse(page);
  try {
    const answered = send(page, prompt);
    // If the barrier itself fails, the test still fails there; observe the
    // pending response rejection while afterEach releases/stops the fixture.
    void answered.catch(() => undefined);
    await fixture.waitUntilPaused();
    await expect(page.getByLabel("Message the copilot")).toBeDisabled();
    const settings = await page.context().newPage();
    try { await mutate(settings); }
    finally { await fixture.release(); await settings.close(); }
    const response = await answered;
    expect(response.status()).toBe(403);
    const native = await observed.read();
    expect(native.status).toBe(403);
    expect(JSON.parse(native.text)).toEqual({ error: "copilot_unavailable" });
    expect((await fixture.snapshot()).calls - before).toBe(pauseBefore === "tool" ? 1 : 2);
    expect(await page.content()).not.toContain(withheld);
  } finally { await observed.dispose(); }
}

// These are two genuine current sources, not fabricated legacy-normalization rows.
test("two prepared sources preserve conflict, missing and ungenerated-report distinctions", async ({ page }, info) => {
  await setup(page, false);
  const conflicting = info.outputPath("synthetic-conflicting.vcf");
  const bytes = readFileSync(original, "utf8");
  const changed = bytes.replace("chr15\t74749576\trs762551\tC\tA\t50\tPASS\t.\tGT\t0/1", "chr15\t74749576\trs762551\tC\tA\t50\tPASS\t.\tGT\t0/0");
  expect(changed).not.toBe(bytes); writeFileSync(conflicting, changed);
  await uploadOwnFilePrepared(page, conflicting, { fileType: "vcf" });
  await connect(page);
  const conflict = await ask(page, { prompt: "Explain the source disagreement.", tool: { name: "get_genotype", arguments: { rsid: "rs762551" } },
    answer: "The source calls disagree, so no genotype is shown." });
  expect(conflict.result).toMatchObject({ rsid: "rs762551", covered: false, status: "conflict", conflict: true });
  expect(conflict.result).not.toHaveProperty("genotype");
  const missing = await ask(page, { prompt: "Explain a position absent from my files.", tool: { name: "get_genotype", arguments: { rsid: "rs123" } },
    answer: "Your files do not cover this position. This is a limit of the files, not a result about you." });
  expect(missing.result).toMatchObject({ rsid: "rs123", covered: false, status: "not-covered" });
  expect(missing.result).not.toHaveProperty("genotype");
  const ungenerated = await ask(page, { prompt: "Explain whether this report is available.", tool: { name: "get_report", arguments: { slug: CAFFEINE_SLUG } },
    answer: "No completed report is available under your selected purposes." });
  expect(ungenerated.result).toMatchObject({ error: "report_not_generated" });
  expect(ungenerated.result).not.toHaveProperty("sources");
});

test("report withdrawal before the tool response blocks the turn and both stored history halves", async ({ page }) => {
  const { userId } = await setup(page); await connect(page);
  const { chatId, pair } = await initialPair(page, userId);
  let revokedGrantId = "";
  await interruptAnswer(page, "tool", async settings => {
    await settings.goto("/genome/me/reports");
    const choices = settings.getByRole("region", { name: "Choose your reports", exact: true });
    const label = OWN_REPORT_CHOICES["reports.polygenic"].label;
    const revoked = settings.waitForResponse(response => /^\/api\/consents\/[0-9a-f-]{36}\/revoke$/.test(new URL(response.url()).pathname)
      && response.request().method() === "POST");
    await choices.getByRole("button", { name: `Turn off ${label}`, exact: true }).click();
    const response = await revoked;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ revoked: true });
    revokedGrantId = new URL(response.url()).pathname.split("/")[3];
    await expect(choices.getByRole("button", { name: `Enable ${label}`, exact: true })).toBeVisible();
  });
  await denyHistory(page, chatId);
  // The actual report-revocation action synchronously executes its frozen
  // exact-grant purge. Inspect that disposition; never dispatch a global worker.
  const admin = adminClient();
  const removed = await admin.from("chat_messages").select("id").eq("user_id", userId).eq("chat_id", chatId);
  expect(removed.error).toBeNull(); expect(removed.data).toEqual([]);
  const phase = await admin.from("retention_due_phases").select("retention_row_id,status,terminal_outcome_code,immutable_envelope")
    .eq("phase_id", "own-report-purpose-purge").contains("immutable_envelope", { grantId: revokedGrantId, accountId: userId }).single();
  expect(phase.error).toBeNull();
  expect(phase.data).toMatchObject({ status: "succeeded", terminal_outcome_code: "exact_grant_residuals_zero" });
  const manifestId = (phase.data!.immutable_envelope as { manifestId: string }).manifestId;
  const manifest = await admin.from("purge_manifests").select("state,frozen_manifest_hash,physical_purge_started_at")
    .eq("id", manifestId).eq("retention_row_id", phase.data!.retention_row_id).single();
  expect(manifest.error).toBeNull(); expect(manifest.data?.state).toBe("complete");
  expect(manifest.data?.frozen_manifest_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(manifest.data?.physical_purge_started_at).toBeTruthy();
  const entries = await admin.from("purge_manifest_entries").select("row_key,status").eq("manifest_id", manifestId)
    .eq("target_id", "chat-derived-contexts").eq("store_name", "public.chat_messages");
  expect(entries.error).toBeNull(); expect(entries.data).toHaveLength(2);
  expect(entries.data!.map(row => (row.row_key as { id: string }).id).sort()).toEqual(pair.map(row => row.id).sort());
  expect(entries.data!.every(row => row.status === "deleted")).toBe(true);
  const disposition = await admin.from("retention_rows").select("state").eq("id", phase.data!.retention_row_id).single();
  expect(disposition.error).toBeNull(); expect(disposition.data?.state).toBe("complete");
  await page.goto("/copilot/me");
  const raw = await ask(page, { prompt: "Read the observed caffeine call.", tool: { name: "get_genotype", arguments: { rsid: "rs762551" } },
    answer: "The observed genotype is A/C." });
  expect(raw.result).toMatchObject({ status: "called", genotype: "AC" });
});

test("deleting a source after the tool result removes its pairs and preserves an independent source and conversation", async ({ page }) => {
  const { userId, fileId: retainedId } = await setup(page);
  await connect(page);
  const independent = await initialPair(page, userId);
  // This later source was absent from the first conversation's projection.
  const fileId = await uploadOwnFilePrepared(page, original, { fileType: "vcf" });
  expect(retainedId).not.toBe(fileId);
  const retained = await adminClient().from("genome_files").select("bucket_path").eq("id", retainedId).single();
  expect(retained.error).toBeNull();
  const target = await adminClient().from("genome_files").select("bucket_path").eq("id", fileId).eq("user_id", userId).single();
  expect(target.error).toBeNull(); expect(target.data!.bucket_path).not.toBe(retained.data!.bucket_path);
  await page.goto("/copilot/me");
  const { chatId, pair } = await initialPair(page, userId);
  expect(chatId).not.toBe(independent.chatId);
  await interruptAnswer(page, "answer", async settings => {
    await settings.goto("/files"); settings.once("dialog", dialog => dialog.accept());
    const row = settings.locator("li").filter({ has: settings.locator(`a[href="/api/files/${fileId}/download"]`) });
    await expect(row).toHaveCount(1);
    const deleted = settings.waitForResponse(response => new URL(response.url()).pathname === `/api/files/${fileId}` && response.request().method() === "DELETE");
    await row.getByRole("button", { name: "Delete", exact: true }).click();
    expect((await deleted).status()).toBe(204); await expect(row).toHaveCount(0);
  });
  await denyHistory(page, chatId);
  const oldMessages = await adminClient().from("chat_messages").select("id").eq("user_id", userId).eq("chat_id", chatId);
  expect(oldMessages.error).toBeNull(); expect(oldMessages.data).toEqual([]);
  const exactIds = await adminClient().from("chat_messages").select("id").eq("user_id", userId).in("id", pair.map(row => row.id));
  expect(exactIds.error).toBeNull(); expect(exactIds.data).toEqual([]);
  const removed = await adminClient().from("genome_files").select("id").eq("id", fileId);
  expect(removed.error).toBeNull(); expect(removed.data).toEqual([]);
  const removedObject = await adminClient().storage.from("genomes").download(target.data!.bucket_path);
  expect(removedObject.error).not.toBeNull();
  const saved = await adminClient().storage.from("genomes").download(retained.data!.bucket_path);
  expect(saved.error).toBeNull(); expect(Buffer.from(await saved.data!.arrayBuffer())).toEqual(readFileSync(original));
  expect(await storedPair(userId, independent.chatId)).toEqual(independent.pair);
  const oldHistory = await page.evaluate(async id => {
    const response = await fetch(`/api/chats/${id}`, { credentials: "same-origin", redirect: "error" });
    return { status: response.status, body: await response.json() };
  }, independent.chatId);
  expect(oldHistory.status).toBe(200);
  expect(oldHistory.body.messages).toHaveLength(2);
  expect(oldHistory.body.messages.map((row: { id: string }) => row.id).sort()).toEqual(independent.pair.map(row => row.id).sort());
});

test("Copilot permission withdrawal after the tool result blocks persistence and regrant cannot reopen old history", async ({ page }) => {
  const { userId } = await setup(page); await connect(page);
  const { chatId, pair } = await initialPair(page, userId);
  await interruptAnswer(page, "answer", async settings => {
    await settings.goto("/settings/copilot");
    await settings.getByRole("button", { name: "Withdraw Copilot permission", exact: true }).click();
    await expect(settings.getByRole("button", { name: "Allow Copilot for this model", exact: true })).toBeVisible();
  });
  await denyHistory(page, chatId); expect(await storedPair(userId, chatId)).toEqual(pair);
  await page.goto("/settings/copilot"); await allowCopilot(page);
  await denyHistory(page, chatId);
  await page.goto("/copilot/me");
  const fresh = await ask(page, { prompt: CAFFEINE_PROMPT, tool: { name: "get_report", arguments: { slug: CAFFEINE_SLUG } }, answer: CAFFEINE_ANSWER }, true);
  expect(fresh.chatId).not.toBe(chatId); await storedPair(userId, fresh.chatId);
});

test("changing the model after the tool result invalidates its exact recipient permission", async ({ page }) => {
  const { userId } = await setup(page); await connect(page);
  const { chatId, pair } = await initialPair(page, userId);
  await interruptAnswer(page, "answer", async settings => {
    await settings.goto("/settings/copilot");
    await settings.getByLabel("Model", { exact: true }).fill("mock-model-new-revision");
    await settings.getByRole("button", { name: "Save provider", exact: true }).click();
    await expect(settings.getByText("Provider saved. Review the separate Copilot permission below.", { exact: true })).toBeVisible();
    await expect(settings.getByRole("button", { name: "Allow Copilot for this model", exact: true })).toBeVisible();
  });
  await denyHistory(page, chatId); expect(await storedPair(userId, chatId)).toEqual(pair);
  await page.goto("/copilot/me"); await expect(page.getByLabel("Message the copilot")).toHaveCount(0);
});
