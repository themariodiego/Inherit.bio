import http from "node:http";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { mixedQcVcf } from "../scripts/ci-browser/embryo-mixed-qc-fixture";
import { assertMixedQcPublication } from "../scripts/ci-browser/embryo-mixed-qc-proof";
import { QC_TABLE_ROWS } from "@/components/embryo/compare/qc-table";
import { QC_FAILED_CHIP, DROPOUT_NOT_MEASURED_NO_RANGE, DROPOUT_NOT_MEASURED } from "@/copy/embryos/qc";
import { expect, test, type Page } from "@playwright/test";
import { withEmbryoJourney } from "../scripts/ci-embryo-journey";
import bindings from "../scripts/comprehension/bindings.json";
import { adminClient, createConfirmedUser, drainMailUntil, signIn } from "./helpers";
import { EMBRYO_APP_PORT } from "../scripts/ci-browser-config";
import { GATE_BUTTON } from "@/copy/embryos/gate";
import { ANALYSIS_PERMISSION_BUTTON, FILE_INPUT_LABEL, FINALIZE_BUTTON, SAVE_DRAFT_BUTTON, SEND_FILE_BUTTON, SEND_INVITATION_BUTTON } from "@/copy/embryos/upload";
import { SIGN_BUTTON } from "@/copy/embryos/signing";

/** No product handler, consent, worker or stored result is replaced here.
 * The local mail receiver captures synthetic delivery only. The isolated
 * launcher owns real worker execution; this test never publishes a row. */
const origin = `http://localhost:${EMBRYO_APP_PORT}`;
const password = "synthetic-embryo-browser-password";
const ownerEmail = "mixed-qc-owner@e2e.local";
const parentEmail = "mixed-qc-parent@e2e.local";
const fixture = bindings.accounts.find(account => account.id === "participant-c")!.files[0];
let mail: http.Server;
const messages: { to: string | string[]; html?: string }[] = [];

async function signStatements(page: Page, button: string) {
  const form = page.locator('[data-slot="signing-form"]');
  for (const box of await form.getByRole("checkbox").all()) await box.check();
  await form.getByLabel("Full legal name").fill("Synthetic Parent");
  await form.getByRole("button", { name: button, exact: true }).click();
  // All real artifact receipts and the refreshed server stage must finish
  // before another browser can inspect the newly committed signatures.
  await expect(form).toHaveCount(0);
}

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

test("mixed measured calls preserve a failed embryo without a source after real publication", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await withEmbryoJourney(process.env, async runtime => {
  const owner = await createConfirmedUser(ownerEmail, password);
  await createConfirmedUser(parentEmail, password);
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
    await signStatements(page, SIGN_BUTTON);
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
    await other.getByLabel("Country where you live").selectOption("DK");
    await other.getByLabel("Full legal name").fill("Synthetic Parent");
    await other.getByRole("button", { name: "Sign and accept invitation" }).click();
    // This heading is rendered only after the real accepted native receipt.
    await expect(other.getByRole("heading", { name: "You have accepted the invitation", exact: true })).toBeVisible();
    await other.goto("/embryos/upload");
    await expect(other.locator('[data-stage="co-parent-sign"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-stage="waiting"]')).toBeVisible();
    await signStatements(other, SIGN_BUTTON);
    await page.reload();
    await expect(page.locator('[data-stage="acknowledge"]')).toBeVisible();
    await signStatements(page, FINALIZE_BUTTON);
    await expect(page.locator('[data-stage="file"]')).toBeVisible();
    await expect(page.locator('[data-slot="record-key-card"]')).toHaveCount(2);
    await page.getByLabel(FILE_INPUT_LABEL, { exact: true }).setInputFiles({ name: "synthetic-mixed-qc.vcf", mimeType: "text/plain", buffer: Buffer.from(mixedQcVcf(readFileSync(fixture, "utf8"))) });
    const completion = page.waitForResponse(response => /\/api\/embryo-ingest\/[^/]+\/complete$/.test(response.url()) && response.request().method() === "POST");
    await page.getByRole("button", { name: SEND_FILE_BUTTON }).click();
    expect((await completion).status()).toBe(202);
    await expect(page.locator('[data-stage="processing"]')).toBeVisible();
    await expect(page.locator('[data-figure-kind]')).toHaveCount(0);
    const cohort = await adminClient().from("embryo_cohorts").select("id").eq("owner_account_id", owner).single();
    expect(cohort.error).toBeNull();
    const cohortId = cohort.data!.id;
    await runtime.runWorker(cohortId);
    assertMixedQcPublication(await runtime.proof(cohortId));
    await expect.poll(async () => (await adminClient().from("embryo_cohorts").select("status,publication_revision").eq("id", cohortId).single()).data,
      { timeout: 120_000, message: "The actual isolated worker must publish this whole cohort" }).toEqual({ status: "active", publication_revision: 1 });
    const embryos = await adminClient().from("embryos").select("id,subject_id,sample_ordinal,status").eq("cohort_id", cohortId).order("sample_ordinal");
    expect(embryos.error).toBeNull();
    expect(embryos.data!.map(item => item.status)).toEqual(["qc_pass", "qc_fail"]);
    const files = await adminClient().from("genome_files").select("subject_id,status").in("subject_id", embryos.data!.map(item => item.subject_id));
    expect(files.error).toBeNull(); expect(files.data).toHaveLength(1);
    expect(files.data!.map(file => file.subject_id)).toEqual([embryos.data![0].subject_id]);
    const qcRows = await adminClient().from("embryo_qc").select("embryo_id,sites_expected,sites_called,call_rate,qc_verdict,figure_basis,parent_a_concordance,parent_b_concordance,allelic_dropout_estimate,contamination_estimate").in("embryo_id", embryos.data!.map(item => item.id));
    expect(qcRows.error).toBeNull(); expect(qcRows.data).toHaveLength(2);
    expect(qcRows.data!.find(row => row.embryo_id === embryos.data![1].id)).toMatchObject({ sites_expected: 1200, sites_called: 588, call_rate: 0.49, qc_verdict: "fail", figure_basis: { producer: "embryo-split-calls-v1", call_rate: { basis: "observed" } }, parent_a_concordance: null, parent_b_concordance: null, allelic_dropout_estimate: null, contamination_estimate: null });
    expect(files.data!.every(file => file.status === "normalization_complete")).toBe(true);
    for (const parent of [other, page]) {
      await parent.goto(`/embryos/compare?cohort=${cohortId}`);
      await expect(parent.locator('[data-slot="cohort-permission"]')).toBeVisible();
      await signStatements(parent, ANALYSIS_PERMISSION_BUTTON);
      await expect(parent.locator('[data-slot="cohort-permission"]')).toHaveCount(0);
    }
    await page.reload();
    const gate = page.locator('[data-slot="result-gate"]');
    await expect(gate).toBeVisible(); await gate.getByRole("checkbox").check(); await gate.getByRole("button", { name: GATE_BUTTON }).click();
    await expect(page.locator('[data-slot="result-gate"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="consent-required"]')).toHaveCount(0);
    const failedId = embryos.data![1].id;
    const quality = page.locator('[data-slot="qc-table"]');
    await expect(quality).toBeVisible();
    await expect(quality.locator('thead th[data-embryo-id]')).toHaveCount(2);
    for (const row of QC_TABLE_ROWS) {
      await expect(quality.locator(`[data-qc-row="${row}"]`)).toHaveCount(1);
      await expect(quality.locator(`[data-qc-row="${row}"] td`)).toHaveCount(2);
    }
    await expect(quality.locator('[data-qc-row="qc_verdict"] td').nth(1)).toContainText(QC_FAILED_CHIP);
    await expect(quality.locator('[data-qc-row="call_rate"] td').nth(1).locator('[data-figure-basis="observed"]')).toHaveCount(1);
    for (const layer of ["variant_call", "estimate"]) {
      const table = page.locator(`table[data-layer="${layer}"]`);
      await expect(table.locator('thead th[data-embryo-id]')).toHaveCount(2);
      const header = table.locator(`th[data-embryo-id="${failedId}"]`);
      await expect(header).toContainText(QC_FAILED_CHIP);
      await expect(header.locator("a")).toHaveCount(0);
      const footer = table.locator(`[data-slot="column-footer"][data-embryo-id="${failedId}"]`);
      await expect(footer.locator('[data-reason="embryo_call_rate"]')).toBeVisible();
      await expect(footer.locator('[data-figure-kind="coverage"]')).toHaveCount(1);
    }
    await expect(page.locator('[data-figure-kind="absolute"], [data-figure-kind="interval"], [data-figure-kind="carrier-status"]')).toHaveCount(0);
    await expect(page.getByText(DROPOUT_NOT_MEASURED_NO_RANGE, { exact: true })).toHaveCount(2);
    await expect(page.getByText(DROPOUT_NOT_MEASURED, { exact: true })).toHaveCount(0);
    for (const embryo of embryos.data!) {
      await page.goto(`/embryos/${embryo.id}`);
      await expect(page.getByRole("heading", { level: 1, name: `Embryo ${embryo.sample_ordinal + 1}` })).toBeVisible();
      await expect(page.locator('[data-slot="consent-required"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="qc-verdict"]')).toHaveAttribute("data-verdict", embryo.sample_ordinal === 0 ? "pass" : "fail");
      await expect(page.locator('[data-figure-kind="absolute"], [data-figure-kind="interval"]')).toHaveCount(0);
    }
  } finally { await otherContext.close(); }
  });
});
