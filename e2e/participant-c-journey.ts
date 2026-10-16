import path from "node:path";
import { expect, type Browser, type Page, type Request } from "@playwright/test";
import bindings from "../scripts/comprehension/bindings.json";
import { adminClient, createConfirmedUser, DEFAULT_TEST_JURISDICTION, drainMailUntil, signIn, SUPABASE_URL } from "./helpers";
import { GATE_BUTTON } from "@/copy/embryos/gate";
import { ANALYSIS_PERMISSION_BUTTON, FILE_INPUT_LABEL, FINALIZE_BUTTON, MAPPING_COLUMNS_BUTTON, MAPPING_FIELD_QUESTIONS, mappingColumnOption,
  SAVE_DRAFT_BUTTON, SEND_FILE_BUTTON, SEND_INVITATION_BUTTON } from "@/copy/embryos/upload";
import { SIGN_BUTTON } from "@/copy/embryos/signing";
import { signStatements } from "./embryo-signing-helpers";
import { EMBRYO_PUBLISHED_FILE_SELECT, participantCSeed, publishedEmbryoFiles, type ParticipantCReadDiagnostic, type ParticipantCReadStage } from "../scripts/comprehension/participant-c-seed";

import { observeNativeResponses } from "./helpers/native-response-observer";
import { readUploadReceipt } from "../src/lib/embryos/upload-receipt";
import { EMBRYO_PAIR_TABLE_FIXTURE, TABLE_EMBRYOS, TABLE_HEADER } from "../scripts/embryo-pair-table-fixture";

export const participantCPassword = "synthetic-embryo-browser-password";
const origin = "http://localhost:3105";
const defaultFixture = participantCSeed(bindings.accounts.find(row => row.id === "participant-c")).files[0];
export type ParticipantCMail = { to: string | string[]; html?: string };

/** Same native producer used by the ordinary single journey. No result row,
 * signature, permission, job advancement or provider ACK is substituted. */
export async function seedParticipantC(options: { page: Page; browser: Browser;
  ownerEmail: string; parentEmail: string; password: typeof participantCPassword; qcSeed?: "b"; fittedSeed?: "partial";
  /** ADR 0037: the same pair as a laboratory table that states no build and leaves its result column unnamed. */
  tableSeed?: "unstated-build";
  messages: ParticipantCMail[]; jobsSecret?: string; readDiagnostic?: ParticipantCReadDiagnostic;
  runtime: { runWorker(id: string): Promise<void>; proof(id: string): Promise<unknown> };
  beforeFile?: (scope: { owner: string; parentAccount: string; cohortId: string; nativeSessionId: string;
    embryos: { id: string; subject_id: string; sample_ordinal: number; status: string }[];
    ownerPage: Page; parentPage: Page }) => Promise<void> }) {
  const { page, browser, ownerEmail, parentEmail, password, messages, runtime } = options;
  if (options.qcSeed !== undefined && options.qcSeed !== "b") throw new Error("Unregistered QC seed");
  if (options.fittedSeed !== undefined && (options.fittedSeed !== "partial" || options.qcSeed !== undefined))
    throw new Error("Unregistered fitted TEST seed");
  if (options.tableSeed !== undefined && (options.tableSeed !== "unstated-build" || options.qcSeed !== undefined
    || options.fittedSeed !== undefined)) throw new Error("Unregistered table TEST seed");
  const fittedSeed = options.fittedSeed === "partial";
  const qcSeed = options.qcSeed === "b";
  const tableSeed = options.tableSeed === "unstated-build";
  const fixture = tableSeed ? EMBRYO_PAIR_TABLE_FIXTURE : fittedSeed ? "e2e/fixtures/embryo-pair-fitted-partial-grch38.vcf"
    : qcSeed ? "e2e/fixtures/embryo-pair-qc-b-grch38.vcf" : defaultFixture;
  const regular = ownerEmail ==="participant-c@e2e.local" && parentEmail ==="participant-c-parent@e2e.local";
  const fresh = ownerEmail.match(/^cmp-t6-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})@e2e\.local$/);
  if (tableSeed) {
    if (ownerEmail !== "table-test@e2e.local" || parentEmail !== "table-test-parent@e2e.local")
      throw new Error("Exact table TEST parent pair required");
  } else if (fittedSeed) {
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
    let actualFinalization: { cohortId: string; sessionId: string; embryoIds: string[] } | undefined;
    const finalizeObservation = options.beforeFile
      ? await observeNativeResponses(page, { finalize: "^/api/embryo-cohorts$" }) : undefined;
    try {
      await signStatements(page, FINALIZE_BUTTON, owner);
      if (finalizeObservation) {
        const response = await finalizeObservation.read("finalize");
        expect(response.status).toBe(201);
        const body = JSON.parse(response.text);
        const parsed = readUploadReceipt(body);
        actualFinalization = { cohortId: body.cohort_id, sessionId: parsed.session.session,
          embryoIds: parsed.cards.map(card => card.embryo_id) };
      }
    } finally { await finalizeObservation?.dispose(); }
    await expect(page.locator('[data-stage="file"]')).toBeVisible();
    await expect(page.locator('[data-slot="record-key-card"]')).toHaveCount(2);
    if (options.beforeFile) {
      const finalizedCohort = await adminClient().from("embryo_cohorts").select("id,status,publication_revision")
        .eq("owner_account_id", owner).single();
      expect(finalizedCohort.error).toBeNull();
      expect(finalizedCohort.data).toMatchObject({ status: "upload_pending", publication_revision: null });
      if (!finalizedCohort.data) throw new Error("Genuine finalization not observed");
      const reserved = await adminClient().from("embryos").select("id,subject_id,sample_ordinal,status")
        .eq("cohort_id", finalizedCohort.data.id).order("sample_ordinal");
      expect(reserved.error).toBeNull(); expect(reserved.data).toHaveLength(2);
      expect(reserved.data!.map(row => row.status)).toEqual(["pending", "pending"]);
      if (!actualFinalization) throw new Error("Actual finalization response unavailable");
      expect(actualFinalization.cohortId).toBe(finalizedCohort.data.id);
      expect([...actualFinalization.embryoIds].sort()).toEqual(reserved.data!.map(row => row.id).sort());
      await options.beforeFile({ owner, parentAccount, cohortId: finalizedCohort.data.id, nativeSessionId: actualFinalization.sessionId,
        embryos: reserved.data!, ownerPage: page, parentPage: other });
    }
    await page.getByLabel(FILE_INPUT_LABEL, { exact: true }).setInputFiles(path.resolve(fixture));
    const completion = page.waitForResponse(response => /\/api\/embryo-ingest\/[^/]+\/complete$/.test(response.url()) && response.request().method() === "POST");
    // Every request body the browser sends to the ingest routes, for the
    // table's privacy checks below. Nothing is changed or replaced.
    const sent: { method: string; path: string; body: string }[] = [];
    const record = (request: Request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/embryo-ingest/")) sent.push({ method: request.method(), path: url.pathname, body: request.postData() ?? "" });
    };
    if (tableSeed) page.on("request", record);
    const mapping = (method: "POST" | "PUT") => page.waitForResponse(response => /\/api\/embryo-ingest\/[^/]+\/mapping$/.test(response.url())
      && response.request().method() === method);
    const inspected = tableSeed ? mapping("POST") : undefined;
    await page.getByRole("button", { name: SEND_FILE_BUTTON }).click();
    if (tableSeed) {
      expect((await inspected!).status()).toBe(200);
      // The column question: the file names its result column `Bases`, which
      // no header synonym matches, so the reader chooses it.
      const columns = page.locator('[data-stage="columns-question"]');
      await expect(columns).toBeVisible();
      await expect(columns.locator("select")).toHaveCount(1);
      const result = TABLE_HEADER.indexOf("Bases");
      await expect(columns.locator(`option[value="${result}"]`)).toHaveText(mappingColumnOption(result, "Bases"));
      const columnDecision = mapping("PUT");
      await columns.getByLabel(MAPPING_FIELD_QUESTIONS.genotype, { exact: true }).selectOption(String(result));
      await columns.getByRole("button", { name: MAPPING_COLUMNS_BUTTON, exact: true }).click();
      expect((await columnDecision).status()).toBe(200);
      // The build question: the table states no build, so the reader answers it before any chunk.
      const build = page.locator('[data-stage="build-question"]');
      await expect(build).toBeVisible();
      const buildDecision = mapping("PUT");
      await build.locator('button[data-option="GRCh38"]').click();
      expect((await buildDecision).status()).toBe(200);
    }
    expect((await completion).status()).toBe(202);
    if (tableSeed) {
      page.off("request", record);
      const routes = sent.map(({ method, path }) => `${method} ${path.replace(/^\/api\/embryo-ingest\/[^/]+\//, "")}`);
      expect(routes.slice(0, 4)).toEqual(["POST configure", "POST mapping", "PUT mapping", "PUT mapping"]);
      expect(routes.at(-1)).toBe("POST complete");
      expect(routes.slice(4, -1).every(route => /^PUT chunks\/\d+$/.test(route))).toBe(true);
      expect(routes.length).toBeGreaterThan(5);
      expect(JSON.parse(sent[0].body)).toMatchObject({ format: "pgt_table", buildEvidence: [] });
      expect(JSON.parse(sent[1].body).headerColumns).toEqual([...TABLE_HEADER]);
      // Decisions carry column numbers and a build only; no embryo label, file
      // comment or column name leaves the browser in any request.
      for (const decision of sent.slice(2, 4)) expect(decision.body).not.toContain("Bases");
      for (const { body } of sent) {
        for (const label of TABLE_EMBRYOS) expect(body).not.toContain(label);
        expect(body).not.toContain("deterministic synthetic laboratory table");
      }
    }
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
      subjectIds: embryos.data!.map(item => item.subject_id), fileType: tableSeed ? "pgt_table" : "vcf" })).toHaveLength(2);
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

    const nativeRead = async <T>(stage: ParticipantCReadStage, work: () => Promise<T>): Promise<T> => {
      try { return await work(); }
      catch (error) {
        try { options.readDiagnostic?.(stage, error, "unreturned"); } catch { /* Original refusal remains. */ }
        throw error;
      }
    };
    const readPublication = async () => {
        const cohort = await nativeRead("read-cohort-query", async () => {
          const cohort = await adminClient().from("embryo_cohorts").select("id,owner_account_id,status,publication_revision,uploaded_at").eq("id", cohortId).single();
          return cohort;
        });
        const embryos = await nativeRead("read-embryos-query", async () => {
          const embryos = await adminClient().from("embryos").select("id,subject_id,sample_ordinal,status").eq("cohort_id", cohortId).order("sample_ordinal");
          return embryos;
        });
        await nativeRead("read-cohort-result", async () => { expect(cohort.error).toBeNull(); });
        await nativeRead("read-embryos-result", async () => { expect(embryos.error).toBeNull(); });
        const files = await nativeRead("read-files-query", async () => {
          const files = await adminClient().from("genome_files").select(EMBRYO_PUBLISHED_FILE_SELECT).in("subject_id", embryos.data!.map(row => row.subject_id));
          expect(files.error).toBeNull(); return files;
        });
        return { cohort: cohort.data, embryos: embryos.data, files: files.data,
          proof: await nativeRead("read-worker-proof", () => runtime.proof(cohortId)) };

    };
    return { owner, cohortId, embryos: embryos.data!, readPublication, other,
      closeCoParent: () => otherContext.close() };
  } catch (error) { await otherContext.close(); throw error; }
}
