import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { expect, test } from "./audited-test";
import { withEmbryoJourney } from "../scripts/ci-embryo-journey";
import bindings from "../scripts/comprehension/bindings.json";
import { adminClient, createConfirmedUser, DEFAULT_TEST_JURISDICTION, drainMailUntil, signIn } from "./helpers";
import { EMBRYO_APP_PORT } from "../scripts/ci-browser-config";
import { GATE_BUTTON } from "@/copy/embryos/gate";
import { ANALYSIS_PERMISSION_BUTTON, FILE_INPUT_LABEL, FINALIZE_BUTTON, SAVE_DRAFT_BUTTON, SEND_FILE_BUTTON, SEND_INVITATION_BUTTON } from "@/copy/embryos/upload";
import { SIGN_BUTTON } from "@/copy/embryos/signing";
import { proveNativeDispositionAndProfile } from "./helpers/embryo-profile-journey";
import { signStatements } from "./embryo-signing-helpers";
import { EMBRYO_PUBLISHED_FILE_SELECT, participantCSeed, publishedEmbryoFiles } from "../scripts/comprehension/participant-c-seed";
import { readTaskSixTrace, startTaskSixTrace } from "./embryo-task-depth";
import { PRIMARY } from "@/copy/overview";
import { NO_RANKING_STATEMENT } from "@/copy/embryos/tradeoffs";
import { openParticipantCReadSession } from "./participant-c-harness";
import { viewSchema } from "../scripts/comprehension/conductor-contract";

/** No product handler, consent, worker or stored result is replaced here.
 * The local mail receiver captures synthetic delivery only. The isolated
 * launcher owns real worker execution; this test never publishes a row. */
const origin = `http://localhost:${EMBRYO_APP_PORT}`;
const password = "synthetic-embryo-browser-password";
const boundSeed = participantCSeed(bindings.accounts.find(account => account.id === "participant-c"));
const ownerEmail = boundSeed.seed.email;
const parentEmail = boundSeed.seed.coParentEmail;
const fixture = boundSeed.files[0];
let mail: http.Server;
const messages: { to: string | string[]; html?: string }[] = [];

test.beforeAll(async () => {
  mail = http.createServer((request, response) => {
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      if (request.method === "POST" && request.url?.includes("/emails")) messages.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: crypto.randomUUID() }));
    });
  });
  await new Promise<void>(resolve => mail.listen(8124, "127.0.0.1", resolve));
});
test.afterAll(async () => { mail?.closeAllConnections(); if (mail) await new Promise<void>(resolve => mail.close(() => resolve())); });

test("participant-c adds the bound embryo pair through both parents, upload and real publication; task depth T6 follows the actual no-ranking statement", async ({ page, browser }, testInfo) => {
  test.setTimeout(300_000);
  await withEmbryoJourney(process.env, async runtime => {
  const owner = await createConfirmedUser(ownerEmail, password);
  const parentAccount = await createConfirmedUser(parentEmail, password);
  const held = await adminClient().from("embryo_cohorts").select("id").eq("owner_account_id", owner);
  expect(held.error).toBeNull();
  expect(held.data, "This fresh journey must not adopt seeded or previous cohort rows").toEqual([]);
  const otherContext = await browser.newContext({ baseURL: origin });
  const other = await otherContext.newPage();
  try {
    await signIn(page, ownerEmail, password);
    await signIn(other, parentEmail, password);
    await page.goto("/embryos/upload");
    await page.getByRole("radio", { name: "Yes", exact: true }).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.locator('button[data-option="one-file-columns"]').click();
    await page.getByRole("radio", { name: "My embryos", exact: true }).check();
    await page.locator('[data-slot="attestation"] input').check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.locator('button[data-option="two-evidenced-parents"]').click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Number of embryos in the file").fill("2");
    await page.getByLabel("Other parent’s email").fill(parentEmail);
    await page.getByRole("button", { name: SAVE_DRAFT_BUTTON }).click();
    await expect(page.locator('[data-stage="owner-sign"]')).toBeVisible();
    await signStatements(page, SIGN_BUTTON, owner);
    await expect(page.locator('[data-stage="invite"]')).toBeVisible();
    await page.getByLabel("Other parent’s email").fill(parentEmail);
    await page.getByRole("button", { name: SEND_INVITATION_BUTTON }).click();
    await expect(page.locator('[data-stage="waiting"]')).toBeVisible();
    await expect(page.locator('[data-slot="file-form"]')).toHaveCount(0);
    const message = await drainMailUntil(page.request, () => messages.find(item => [item.to].flat().includes(parentEmail) && item.html?.includes("/withdraw/request#")));
    const emailed = message.html!.match(/http:\/\/localhost:3105\/withdraw\/request#[A-Za-z0-9_-]{43}/)?.[0];
    expect(emailed).toBeTruthy();
    await other.goto(emailed!);
    await other.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(other.getByRole("heading", { name: "Review this invitation before you sign" })).toBeVisible();
    for (const box of await other.getByRole("checkbox").all()) await box.check();
    await other.getByLabel("Country where you live").selectOption(DEFAULT_TEST_JURISDICTION);
    await other.getByLabel("Full legal name").fill("Synthetic Parent");
    await other.getByRole("button", { name: "Sign and accept invitation" }).click();
    // This heading is rendered only after the real accepted native receipt.
    await expect(other.getByRole("heading", { name: "You have accepted the invitation", exact: true })).toBeVisible();
    await other.goto("/embryos/upload");
    await expect(other.locator('[data-stage="co-parent-sign"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-stage="waiting"]')).toBeVisible();
    await signStatements(other, SIGN_BUTTON, parentAccount);
    await page.reload();
    await expect(page.locator('[data-stage="acknowledge"]')).toBeVisible();
    await signStatements(page, FINALIZE_BUTTON, owner);
    await expect(page.locator('[data-stage="file"]')).toBeVisible();
    await expect(page.locator('[data-slot="record-key-card"]')).toHaveCount(2);
    await page.getByLabel(FILE_INPUT_LABEL, { exact: true }).setInputFiles(path.resolve(fixture));
    const completion = page.waitForResponse(response => /\/api\/embryo-ingest\/[^/]+\/complete$/.test(response.url()) && response.request().method() === "POST");
    await page.getByRole("button", { name: SEND_FILE_BUTTON }).click();
    expect((await completion).status()).toBe(202);
    await expect(page.locator('[data-stage="processing"]')).toBeVisible();
    await expect(page.locator('[data-figure-kind]')).toHaveCount(0);
    const cohort = await adminClient().from("embryo_cohorts").select("id").eq("owner_account_id", owner).single();
    expect(cohort.error).toBeNull();
    const cohortId = cohort.data!.id;
    await runtime.runWorker(cohortId);
    expect(await runtime.proof(cohortId)).toMatchObject({ jobs: 1, sessions: 1, cohorts: 1, sources: 2, parts: 2, allPartsCurrent: true, pendingOrdinals: 0, pendingVariants: 0 });
    await expect.poll(async () => (await adminClient().from("embryo_cohorts").select("status,publication_revision").eq("id", cohortId).single()).data,
      { timeout: 120_000, message: "The actual isolated worker must publish this whole cohort" }).toEqual({ status: "active", publication_revision: 1 });
    const embryos = await adminClient().from("embryos").select("id,subject_id,sample_ordinal,status").eq("cohort_id", cohortId).order("sample_ordinal");
    expect(embryos.error).toBeNull();
    expect(embryos.data!.map(item => item.status)).toEqual(["qc_pass", "qc_pass"]);
    const published = await adminClient().from("embryo_cohorts").select("uploaded_at").eq("id", cohortId).single();
    expect(published.error).toBeNull(); expect(published.data!.uploaded_at).not.toBeNull();
    const files = await adminClient().from("genome_files").select(EMBRYO_PUBLISHED_FILE_SELECT).in("subject_id", embryos.data!.map(item => item.subject_id));
    expect(files.error).toBeNull(); expect(files.data).toHaveLength(2);
    expect(publishedEmbryoFiles(files.data, { ownerId: owner, publishedAt: published.data!.uploaded_at!,
      subjectIds: embryos.data!.map(item => item.subject_id) })).toHaveLength(2);
    for (const [parent, accountId] of [[other, parentAccount], [page, owner]] as const) {
      await parent.goto(`/embryos/compare?cohort=${cohortId}`);
      await expect(parent.locator('[data-slot="cohort-permission"]')).toBeVisible();
      await signStatements(parent, ANALYSIS_PERMISSION_BUTTON, accountId);
      await expect(parent.locator('[data-slot="cohort-permission"]')).toHaveCount(0);
    }
    await page.reload();
    const gate = page.locator('[data-slot="result-gate"]');
    await expect(gate).toBeVisible(); await gate.getByRole("checkbox").check(); await gate.getByRole("button", { name: GATE_BUTTON }).click();
    await expect(page.locator('[data-slot="result-gate"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="consent-required"]')).toHaveCount(0);
    // The genuine seed and explicit current parent permissions are setup.
    // T6 starts from the Overview after its real result gate has been passed.
    await page.goto("/overview");
    await expect(page.locator("main h1")).toBeVisible();
    await startTaskSixTrace(page);
    const primaryCompare = page.locator('main a[data-slot="button"]').getByText(PRIMARY.compareEmbryos, { exact: true });
    await expect(primaryCompare).toHaveCount(1);
    await expect(primaryCompare).toHaveAttribute("href", "/embryos/compare");
    await primaryCompare.click();
    await expect(page).toHaveURL(url => url.pathname === "/embryos/compare");
    await expect(page.locator('[data-slot="no-ranking-statement"]')).toHaveText(NO_RANKING_STATEMENT);
    for (const role of ["button", "combobox", "checkbox", "radio"] as const) {
      await expect(page.getByRole(role, { name: /rank|best embryo|recommend/i })).toHaveCount(0);
    }
    const measured = await readTaskSixTrace(page);
    expect(measured.actions).toBe(1);
    expect(measured.trace).toEqual([{ event: "click", path: "/overview" }]);
    await testInfo.attach("task-depth-T6", { contentType: "application/json", body: JSON.stringify({
      taskId: "T6", source: "actual-native-signed-parent-publication", fixture, cohortId,
      start: "/overview", end: "/embryos/compare", ...measured,
    }) });
    // Consume the actual published seed through the live harness's fresh
    // context/read/action interface, without invoking any inference process.
    const reader = await openParticipantCReadSession({ browser, sessionId: "native-participant-c-T6",
      ownerId: owner, cohortId, email: ownerEmail, password,
      read: async () => {
        const cohort = await adminClient().from("embryo_cohorts").select("id,owner_account_id,status,publication_revision,uploaded_at").eq("id", cohortId).single();
        const embryos = await adminClient().from("embryos").select("id,subject_id,sample_ordinal,status").eq("cohort_id", cohortId).order("sample_ordinal");
        expect(cohort.error).toBeNull(); expect(embryos.error).toBeNull();
        const files = await adminClient().from("genome_files").select(EMBRYO_PUBLISHED_FILE_SELECT).in("subject_id", embryos.data!.map(row => row.subject_id));
        expect(files.error).toBeNull();
        return { cohort: cohort.data, embryos: embryos.data, files: files.data, proof: await runtime.proof(cohortId) };
      } });
    try {
      const view = viewSchema.parse(await reader.observe());
      const compare = view.visibleText.split("\n").find(line => line.endsWith(PRIMARY.compareEmbryos));
      const id = compare?.match(/^\[([^ ]+) link\]/)?.[1];
      expect(id, "The actual harness snapshot must expose the Overview comparison link").toBeTruthy();
      await reader.act({ kind: "click", target: id! });
      const comparison = viewSchema.parse(await reader.observe());
      expect(comparison.path).toBe("/embryos/compare");
      expect(comparison.visibleText).toContain(NO_RANKING_STATEMENT);
      const record = await reader.record();
      expect(record).toEqual({ completed: true, path: ["/overview", "/embryos/compare"],
        actions: 1, entries: 0, confirmationExclusions: [] });
      await testInfo.attach("participant-c-harness-read", { contentType: "application/json", body: JSON.stringify({
        taskId: "T6", source: "actual-current-published-seed", cohortId, ownerId: owner,
        publicationRevision: 1, fixture, ...record,
      }) });
    } finally { await reader.close(); }
    for (const embryo of embryos.data!) {
      await page.goto(`/embryos/${embryo.id}`);
      await expect(page.getByRole("heading", { level: 1, name: `Embryo ${embryo.sample_ordinal + 1}` })).toBeVisible();
      await expect(page.locator('[data-slot="consent-required"]')).toHaveCount(0);
    }
    await proveNativeDispositionAndProfile({owner:page,other,browser,cohortId,
      embryoId:embryos.data![0].id,siblingId:embryos.data![1].id});
  } finally { await otherContext.close(); }
  });
});
