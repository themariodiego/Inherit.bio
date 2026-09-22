import { expect, test, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { subjectFinalizationReceipt, subjectNormalizationReceipt, subjectQueuedPreparationReceipt } from "../src/lib/uploads/subject-upload-contract";
import { adminClient, completeOwnUploadConsent, createConfirmedUser, signIn } from "./helpers";
import { generateOwnFileWithChosenReports } from "./own-report-helpers";
import { withPreparedJourney } from "../scripts/ci-prepared-journey";
import type { CanonicalProviderPlan } from "./fixtures/canonical-copilot-provider";
import { allowCopilot, CAFFEINE_ANSWER, CAFFEINE_PROMPT, CAFFEINE_SLUG, expectClosedCompletion,
  expectedCaffeineCitations, lastToolResult, observeNextChatResponse, saveCopilotProvider,
  startCopilotFixture, type CopilotFixture } from "./fixtures/canonical-copilot-browser";

type RegionPercent = { code: string; percent: number };
const byCode = (a: RegionPercent, b: RegionPercent) => a.code.localeCompare(b.code);

/** Combine only two committed synthetic inputs. The added report position is
 * outside the ancestry panel; all results still come from the real pipeline. */
async function journeySource(name: string) {
  const directory = path.join(process.cwd(), "e2e/fixtures");
  const [regional, tiny] = await Promise.all([
    readFile(path.join(directory, name), "utf8"), readFile(path.join(directory, "tiny-grch38.vcf"), "utf8"),
  ]);
  const lines = regional.trimEnd().split("\n"), records = lines.filter(line => !line.startsWith("#"));
  const report = tiny.split("\n").filter(line => line.split("\t")[2] === "rs762551");
  expect(report).toHaveLength(1);
  expect(records.some(line => line.split("\t")[2] === "rs762551")).toBe(false);
  records.push(report[0]);
  records.sort((a, b) => {
    const left = a.split("\t"), right = b.split("\t");
    return Number(left[0].replace(/^chr/, "")) - Number(right[0].replace(/^chr/, ""))
      || Number(left[1]) - Number(right[1]);
  });
  return Buffer.from([...lines.filter(line => line.startsWith("#")), ...records].join("\n") + "\n");
}

async function openGenomeTool(page: Page, name: "Reports" | "Ancestry" | "Copilot") {
  await page.goto("/genome/me");
  await page.getByRole("link", { name: `Open ${name}`, exact: true }).click();
}

async function ask(page: Page, fixture: CopilotFixture, prompt: string, tool: CanonicalProviderPlan["tool"], answer: string) {
  await fixture.configure({ prompt, tool, answer });
  const answered = page.waitForResponse(response => new URL(response.url()).pathname === "/api/chat"
    && response.request().method() === "POST");
  void answered.catch(() => {});
  await page.getByLabel("Message the copilot").fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const response = await answered;
  expect(response.status()).toBe(200);
  await expect(page.getByText(answer, { exact: true })).toBeVisible();
  return { response, tool: lastToolResult(await fixture.snapshot()) };
}

// The application, source, grants, captured results and cleanup are real. Only
// inference is a controlled HTTPS fixture; this is never hosted model evidence.
test("own prepared object: real source, chosen reports, ancestry, raw Copilot and revocation", async ({ page }) => {
  test.setTimeout(300_000);
  await withPreparedJourney(process.env, async preparedFixture => {
    const scenario = { name: "aims-regional-merged-grch38.vcf", merged: true };
    const fixture = await startCopilotFixture(8123);
    try {
      const user = { email: `own-journey-${randomUUID()}@e2e.local`, password: "e2e-own-journey-password" };
      const userId = await createConfirmedUser(user.email, user.password);
      await signIn(page, user.email, user.password);
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(scenario.merged ? "/overview" : "/genome/me");
      if (scenario.merged) await page.getByRole("link", { name: "I have a DNA file", exact: true }).click();
      else await page.getByRole("link", { name: "Add a file", exact: true })
        .and(page.locator('main [data-variant="default"]')).click();
      await expect(page).toHaveURL(/\/files\/upload(?:\?|$)/);
      await completeOwnUploadConsent(page, page.url());
      const finalized = page.waitForResponse(response => /\/api\/files\/[0-9a-f-]{36}\/finalize$/.test(response.url())
        && response.request().method() === "POST");
      const queued = page.waitForResponse(response => /\/api\/files\/[0-9a-f-]{36}\/process$/.test(response.url())
        && response.request().method() === "POST");
      for (const promise of [finalized, queued]) void promise.catch(() => {});
      const bytes = await journeySource(scenario.name);
      await page.locator('input[type="file"]').setInputFiles({ name: "synthetic.data", mimeType: "application/octet-stream", buffer: bytes });
      const finalization = await finalized;
      expect(finalization.status()).toBe(200);
      const { fileId } = subjectFinalizationReceipt.parse(await finalization.json());
      const queueResponse = await queued;
      expect(queueResponse.status()).toBe(202);
      const queueReceipt = subjectQueuedPreparationReceipt.parse(await queueResponse.json());
      expect(queueReceipt.fileId).toBe(fileId);
      const prepared = page.waitForResponse(response => response.url().endsWith(`/api/files/${fileId}/process`)
        && response.request().method() === "POST" && response.status() === 200);
      void prepared.catch(() => {});
      await preparedFixture.runWorker(fileId);
      const preparation = await prepared;
      expect(preparation.status()).toBe(200);
      expect(subjectNormalizationReceipt.parse(await preparation.json()).fileId).toBe(fileId);
      await expect(page.getByText("Your file is stored and prepared. Reports have not been generated yet.", { exact: false })).toBeVisible();
      expect(await preparedFixture.proof(fileId)).toEqual({ jobs: 1, manifests: 1, membersCurrent: true,
        normalizations: 0, observedCalls: 0, analysisRuns: 0 });
      const admin = adminClient();
      const source = await admin.from("genome_files").select("id,subject_id,sha256,bucket_path").eq("id", fileId).single();
      expect(source.error).toBeNull();
      expect(source.data!.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      const stored = await admin.storage.from("genomes").download(source.data!.bucket_path);
      expect(stored.error).toBeNull();
      expect(Buffer.from(await stored.data!.arrayBuffer())).toEqual(bytes);
      const grants = await admin.from("purpose_grants").select("grant_id").eq("target_id", source.data!.subject_id);
      expect(grants.error).toBeNull(); expect(grants.data).toEqual([]);

      await generateOwnFileWithChosenReports(page, fileId, ["reports.polygenic", "ancestry"]);
      await openGenomeTool(page, "Reports");
      await page.getByRole("link", { name: /^Caffeine metabolism · CYP1A2,/ }).click();
      await expect(page).toHaveURL(new RegExp(`/genome/me/reports/${CAFFEINE_SLUG}$`));
      const genotype = page.locator('[data-variant-result="762551"] [data-figure-kind="genotype"] [data-slot="figure-value"]');
      await expect(genotype).toHaveText("A/C");
      await openGenomeTool(page, "Ancestry");
      const surface = page.locator('[data-slot="regional-ancestry"]');
      await expect(surface).toHaveAttribute("data-fit-converged", "true");
      const rows = surface.locator('[data-slot="region-row"]');
      await expect(rows).toHaveCount(scenario.merged ? 5 : 7);
      const displayed = (await rows.evaluateAll(elements => elements.map(element => ({
        code: element.getAttribute("data-region")!,
        percent: parseFloat(element.querySelector('[data-slot="figure-value"]')!.textContent!),
      })))).sort(byCode);
      expect(displayed.every(row => Number.isFinite(row.percent))).toBe(true);
      const largest = [...displayed].sort((a, b) => b.percent - a.percent)[0];
      const caveat = await surface.locator('[data-slot="regional-caveat"]').innerText();
      const supportNote = await surface.locator('[data-slot="stored-support-note"]').innerText();
      const coverage = (await surface.locator('[data-figure-kind="coverage"] [data-slot="figure-value"]').innerText())
        .match(/^read ([\d,]+) of the ([\d,]+) positions this needs$/);
      expect(coverage).not.toBeNull();
      const markersRead = Number(coverage![1].replaceAll(",", ""));
      const minimum = (await surface.getByText(/^This result needs at least /).innerText()).match(/at least (\d+) usable/);
      expect(minimum).not.toBeNull();
      const splitDisclosure = surface.locator('details[data-slot="regional-split"]');
      if (scenario.merged) {
        await splitDisclosure.locator("summary").click();
        await expect(splitDisclosure.locator('[data-slot="regional-split-caveat"]')).toHaveText(caveat);
      }
      const displayedSplit = (await surface.locator('[data-split-region]').evaluateAll(elements => elements.map(element => ({
        code: element.getAttribute("data-split-region")!,
        percent: parseFloat(element.querySelector('[data-slot="figure-value"]')!.textContent!),
      })))).sort(byCode);
      expect(displayedSplit).toHaveLength(scenario.merged ? 3 : 0);
      expect(displayedSplit.every(row => Number.isFinite(row.percent))).toBe(true);

      await saveCopilotProvider(page, fixture.baseUrl);
      await openGenomeTool(page, "Copilot");
      await expect(page.getByLabel("Message the copilot")).toHaveCount(0);
      expect((await fixture.snapshot()).calls).toBe(0);
      await page.getByRole("link", { name: "Review Copilot settings", exact: true }).click();
      await expect(page.getByRole("region", { name: "Copilot permission", exact: true })).toContainText(/ancestry/i);
      await allowCopilot(page);
      await openGenomeTool(page, "Copilot");
      const rawAnswer = "The source genotype is A/C.";
      const raw = await ask(page, fixture, "Read my source call at rs762551.",
        { name: "get_genotype", arguments: { rsid: "rs762551" } }, rawAnswer);
      expect(raw.tool).toMatchObject({ status: "called", genotype: "A/C" });
      const firstChatId = await expectClosedCompletion(raw.response, rawAnswer);
      const report = await ask(page, fixture, CAFFEINE_PROMPT,
        { name: "get_report", arguments: { slug: CAFFEINE_SLUG } }, CAFFEINE_ANSWER);
      expect(report.tool).toMatchObject({ slug: CAFFEINE_SLUG, sources: [expect.objectContaining({ file_id: fileId,
        purpose: "reports.polygenic", variants: expect.arrayContaining([expect.objectContaining({ rsid: "rs762551",
          outcome: expect.objectContaining({ genotype: "AC" }) })]) })], unavailable_sources: [] });
      const chatId = await expectClosedCompletion(report.response, CAFFEINE_ANSWER, expectedCaffeineCitations(report.tool));

      expect(chatId).toBe(firstChatId);
      const answer = `Your displayed ancestry estimate for region ${largest.code} is ${largest.percent}%.`;
      const ancestry = await ask(page, fixture, "Explain my displayed ancestry estimate.", { name: "get_report", arguments: { slug: "inherit:ancestry" } }, answer);
      expect(ancestry.tool.slug).toBe("inherit:ancestry");
      expect(ancestry.tool.unavailable_sources).toEqual([]);
      expect(ancestry.tool.sources).toHaveLength(1);
      const captured = (ancestry.tool.sources as Array<{ file_id: string; status: string; merged: boolean;
        regions: Array<RegionPercent & { range: { unavailable: boolean } }>;
        split: Array<RegionPercent & { range: { unavailable: boolean } }>;
        ancestrySnapshot: { fileId: string; runId: string; resultHash: string } }>)[0];
      expect(captured).toMatchObject({ file_id: fileId, status: "available", merged: scenario.merged,
        reportingCaveat: caveat, note: supportNote, markersRead, markersRequired: Number(minimum![1]), basis: "modelled" });
      expect(captured.regions.map(({ code, percent }) => ({ code, percent })).sort(byCode)).toEqual(displayed);
      expect(captured.split.map(({ code, percent }) => ({ code, percent })).sort(byCode)).toEqual(displayedSplit);
      for (const region of [...captured.regions, ...captured.split]) expect(region.range).toEqual({ unavailable: true });
      expect(captured.ancestrySnapshot.fileId).toBe(fileId);
      expect(captured.ancestrySnapshot.runId).toMatch(/^[0-9a-f-]{36}$/);
      expect(captured.ancestrySnapshot.resultHash).toMatch(/^[0-9a-f]{64}$/);
      const citations = [{ id: `ancestry:${fileId}:${captured.ancestrySnapshot.runId}:${captured.ancestrySnapshot.resultHash}`,
        label: "Your captured ancestry result", href: "/genome/me/ancestry" }];
      expect(await expectClosedCompletion(ancestry.response, answer, citations)).toBe(chatId);
      expect((await fixture.snapshot()).calls).toBe(6);

      await page.reload();
      await page.getByText("Past conversations", { exact: true }).click();
      const historyRead = page.waitForResponse(response => new URL(response.url()).pathname === `/api/chats/${chatId}`);
      await page.getByRole("button", { name: /^Conversation from / }).click();
      const history = await historyRead;
      expect(history.status()).toBe(200);
      const saved = await history.json();
      expect(saved.chatId).toBe(chatId);
      expect(saved.messages.map(({ role, content, citations }: { role: string; content: string; citations: unknown }) =>
        ({ role, content, citations }))).toEqual([
        { role: "user", content: "Read my source call at rs762551.", citations: [] },
        { role: "assistant", content: rawAnswer, citations: [] },
        { role: "user", content: CAFFEINE_PROMPT, citations: [] },
        { role: "assistant", content: CAFFEINE_ANSWER, citations: expectedCaffeineCitations(report.tool) },
        { role: "user", content: "Explain my displayed ancestry estimate.", citations: [] },
        { role: "assistant", content: answer, citations },
      ]);
      await expect(page.getByText(answer, { exact: true })).toBeVisible();
      expect((await fixture.snapshot()).calls).toBe(6);

      const choices = await page.context().newPage();
      try {
        await choices.goto("/genome/me/reports");
        const revoked = choices.waitForResponse(response => /\/api\/consents\/[0-9a-f-]{36}\/revoke$/.test(response.url())
          && response.request().method() === "POST");
        await choices.getByRole("region", { name: "Choose your reports", exact: true })
          .getByRole("button", { name: "Turn off Ancestry", exact: true }).click();
        expect((await revoked).status()).toBe(200);
        const observed = await observeNextChatResponse(page);
        try {
          const refused = page.waitForResponse(response => new URL(response.url()).pathname === "/api/chat");
          await page.getByLabel("Message the copilot").fill("What about my ancestry now?");
          await page.getByRole("button", { name: "Send", exact: true }).click();
          expect((await refused).status()).toBe(403);
          const native = await observed.read();
          expect(native.status).toBe(403);
          expect(JSON.parse(native.text)).toEqual({ error: "copilot_unavailable" });
          expect((await fixture.snapshot()).calls).toBe(6);
        } finally { await observed.dispose(); }
      } finally { await choices.close(); }
      await openGenomeTool(page, "Ancestry");
      await expect(page.locator('[data-figure-kind="ancestry-share"]')).toHaveCount(0);
      await openGenomeTool(page, "Reports");
      await page.getByRole("link", { name: /^Caffeine metabolism · CYP1A2,/ }).click();
      await expect(genotype).toHaveText("A/C");
      const retained = await admin.from("genome_files").select("id,sha256").eq("id", fileId).single();
      expect(retained.error).toBeNull();
      expect(retained.data).toEqual({ id: fileId, sha256: source.data!.sha256 });
      const oldHistory = await page.request.get(`/api/chats/${chatId}`);
      expect(oldHistory.status()).toBe(404);
      const removedPairs = await admin.from("chat_messages").select("id").eq("user_id", userId).eq("chat_id", chatId);
      expect(removedPairs.error).toBeNull(); expect(removedPairs.data).toEqual([]);
      await openGenomeTool(page, "Copilot");
      const remaining = await ask(page, fixture, "Read the source after ancestry withdrawal.",
        { name: "get_genotype", arguments: { rsid: "rs762551" } }, rawAnswer);
      expect(remaining.tool).toMatchObject({ status: "called", genotype: "A/C" });
      const remainingChat = await expectClosedCompletion(remaining.response, rawAnswer);
      expect(remainingChat).not.toBe(chatId);
      expect((await fixture.snapshot()).calls).toBe(8);
      expect(await preparedFixture.proof(fileId)).toMatchObject({ jobs: 1, manifests: 1, membersCurrent: true,
        normalizations: 0, observedCalls: 0 });

      await page.goto("/files"); page.once("dialog", dialog => dialog.accept());
      const row = page.locator("li").filter({ has: page.locator(`a[href="/api/files/${fileId}/download"]`) });
      await expect(row).toHaveCount(1);
      const deleted = page.waitForResponse(response => new URL(response.url()).pathname === `/api/files/${fileId}`
        && response.request().method() === "DELETE" && response.status() === 204);
      void deleted.catch(() => {});
      await row.getByRole("button", { name: "Delete", exact: true }).click();
      expect((await deleted).status()).toBe(204); await expect(row).toHaveCount(0);
      expect((await page.request.get(`/api/chats/${remainingChat}`)).status()).toBe(404);
      const removed = await admin.from("genome_files").select("id").eq("id", fileId);
      expect(removed.error).toBeNull(); expect(removed.data).toEqual([]);
      const gone = await admin.storage.from("genomes").download(source.data!.bucket_path);
      expect(gone.error).not.toBeNull();
      expect(await preparedFixture.proof(fileId)).toEqual({ jobs: 0, manifests: 0, membersCurrent: false,
        normalizations: 0, observedCalls: 0, analysisRuns: 0 });
      expect((await fixture.snapshot()).calls).toBe(8);
      expect(errors).toEqual([]);
    } finally { await fixture.stop(); }
  });
});
