import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import bindings from "../scripts/comprehension/bindings.json";
import { adminClient, createConfirmedUser, DEFAULT_TEST_JURISDICTION, drainMailUntil, signIn, SUPABASE_URL } from "./helpers";
import { GATE_BUTTON } from "@/copy/embryos/gate";
import { ANALYSIS_PERMISSION_BUTTON, FILE_INPUT_LABEL, FINALIZE_BUTTON, SAVE_DRAFT_BUTTON, SEND_FILE_BUTTON, SEND_INVITATION_BUTTON } from "@/copy/embryos/upload";
import { SIGN_BUTTON } from "@/copy/embryos/signing";
import { signStatements } from "./embryo-signing-helpers";
import { EMBRYO_PUBLISHED_FILE_SELECT, participantCSeed, publishedEmbryoFiles } from "../scripts/comprehension/participant-c-seed";

export const participantCPassword = "synthetic-embryo-browser-password";
const origin = "http://localhost:3105";
const defaultFixture = participantCSeed(bindings.accounts.find(row => row.id === "participant-c")).files[0];
export type ParticipantCMail = { to: string | string[]; html?: string };

/** Same native producer used by the ordinary single journey. No result row,
 * signature, permission, job advancement or provider ACK is substituted. */
export async function seedParticipantC(options: { page: Page; browser: Browser;
  ownerEmail: string; parentEmail: string; password: typeof participantCPassword; qcSeed?: "b"; fittedSeed?: "partial";
  messages: ParticipantCMail[]; jobsSecret?: string;
  runtime: { runWorker(id: string): Promise<void>; proof(id: string): Promise<unknown> } }) {
  const { page, browser, ownerEmail, parentEmail, password, messages, runtime } = options;
  if (options.qcSeed !== undefined && options.qcSeed !== "b") throw new Error("Unregistered QC seed");
  if (options.fittedSeed !== undefined && (options.fittedSeed !== "partial" || options.qcSeed !== undefined))
    throw new Error("Unregistered fitted TEST seed");
  const fittedSeed = options.fittedSeed === "partial";
  const qcSeed = options.qcSeed === "b";
  const fixture = fittedSeed ? "e2e/fixtures/embryo-pair-fitted-partial-grch38.vcf"
    : qcSeed ? "e2e/fixtures/embryo-pair-qc-b-grch38.vcf" : defaultFixture;
  const regular = ownerEmail ==="participant-c@e2e.local" && parentEmail ==="participant-c-parent@e2e.local";
  const fresh = ownerEmail.match(/^cmp-t6-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})@e2e\.local$/);
  if (fittedSeed) {
    if (ownerEmail !== "fitted-test@e2e.local" || parentEmail !== "fitted-test-parent@e2e.local")
      throw new Error("Exact fitted TEST parent pair required");
  } else {
  if (qcSeed ? ownerEmail !== "qc-seed-b@e2e.local" || parentEmail !== "qc-seed-b-parent@e2e.local"
    : !regular && (!fresh || parentEmail !==`cmp-t6-${fresh[1]}-parent@e2e.local`)) throw new Error("Exact synthetic parent pair required");
  }
  const owner = await createConfirmedUser(ownerEmail, password);
  const parentAccount = await createConfirmedUser(parentEmail, password);
  const held = await adminClient().from("embryo_cohorts").select("id").eq("owner_account_id", owner);
  expect(held.error).toBeNull();
  expect(held.data, "This fresh journey must not adopt seeded or previous cohort rows").toEqual([]);
  const otherContext = await browser.newContext({ baseURL: origin });
  await otherContext.route("**/*", route => [origin, SUPABASE_URL].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
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
    const message = await drainMailUntil(page.request, () => messages.find(item => [item.to].flat().includes(parentEmail) && item.html?.includes("/withdraw/request#")),
      "the parent invitation this journey requested", options.jobsSecret);
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

    const readPublication = async () => {
        const cohort = await adminClient().from("embryo_cohorts").select("id,owner_account_id,status,publication_revision,uploaded_at").eq("id", cohortId).single();
        const embryos = await adminClient().from("embryos").select("id,subject_id,sample_ordinal,status").eq("cohort_id", cohortId).order("sample_ordinal");
        expect(cohort.error).toBeNull(); expect(embryos.error).toBeNull();
        const files = await adminClient().from("genome_files").select(EMBRYO_PUBLISHED_FILE_SELECT).in("subject_id", embryos.data!.map(row => row.subject_id));
        expect(files.error).toBeNull();
        return { cohort: cohort.data, embryos: embryos.data, files: files.data, proof: await runtime.proof(cohortId) };

    };
    return { owner, cohortId, embryos: embryos.data!, readPublication, other,
      closeCoParent: () => otherContext.close() };
  } catch (error) { await otherContext.close(); throw error; }
}
