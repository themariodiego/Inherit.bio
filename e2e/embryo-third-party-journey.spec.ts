import http from "node:http";
import { createServerClient } from "@supabase/ssr";
import crypto from "node:crypto";
import path from "node:path";
import type { BrowserContext } from "@playwright/test";
import { expect, test } from "./audited-test";
import { withEmbryoJourney } from "../scripts/ci-embryo-journey";
import { adminClient, ANON_KEY, createConfirmedUser, DEFAULT_TEST_JURISDICTION, drainMailUntil, signIn, SUPABASE_URL } from "./helpers";
import { signStatements } from "./embryo-signing-helpers";
import { provePublishedQcCrossSurface } from "./helpers/embryo-qc-cross-surface";
import { EMBRYO_PUBLISHED_FILE_SELECT, publishedEmbryoFiles } from "../scripts/comprehension/participant-c-seed";
import { GATE_BUTTON } from "@/copy/embryos/gate";
import { ANALYSIS_PERMISSION_BUTTON, FILE_INPUT_LABEL, FINALIZE_BUTTON, parentEmailLabel,
  SAVE_DRAFT_BUTTON, SEND_FILE_BUTTON, SEND_INVITATION_BUTTON } from "@/copy/embryos/upload";
import { SIGN_BUTTON } from "@/copy/embryos/signing";
import { NO_RANKING_STATEMENT } from "@/copy/embryos/tradeoffs";
import { RECORD_KEY_PATTERN } from "@/lib/embryos/record-key-card-values";
import { ROLE_BOTH_PARENTS, ROLE_OTHER_PARENT, waitingForResultsBody } from "@/copy/embryos";

test.use({ baseURL: "http://localhost:3105" });
const origin = "http://localhost:3105";
const password = "synthetic-embryo-browser-password";
const uploaderEmail = "embryo-third-party-uploader@e2e.local";
const parentEmails = ["embryo-third-party-parent-a@e2e.local", "embryo-third-party-parent-b@e2e.local"] as const;
let mail: http.Server;
const messages: { to: string | string[]; html?: string }[] = [];

// Delivery is captured locally; all invitations, signatures, ingest and
// publication still use the product's native transactions and real worker.
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

/** Verify this browser's real Auth session; no claims or permission rows are fabricated. */
async function actualSession(context: BrowserContext, accountId: string) {
  const cookies = await context.cookies();
  const auth = createServerClient(SUPABASE_URL, ANON_KEY, { cookies: { getAll: () => cookies,
    setAll: () => { throw new Error("Card proof must not rotate browser credentials"); } } });
  const verified = await auth.auth.getClaims();
  if (verified.error || verified.data?.claims.sub !== accountId
    || verified.data.claims.role !== "authenticated" || typeof verified.data.claims.session_id !== "string"
    || !/^[0-9a-f-]{36}$/.test(verified.data.claims.session_id)) throw new Error("Actual card recipient session unavailable");
  return verified.data.claims.session_id;
}

/** Real parent settings forms call the exact delivery API. Each response is
 * checked against committed native own-recipient hashes and one-time rights.
 * Raw keys and form proofs stay in memory, with no persisted trace or attachment. */
async function proveParentCards(admin: ReturnType<typeof adminClient>, cohortId: string, contexts: BrowserContext[],
  parents: string[], principalIds: string[], uploaderContext: BrowserContext, uploader: string) {
  const embryos = await admin.from("embryos").select("id,sample_ordinal").eq("cohort_id", cohortId).order("sample_ordinal");
  expect(embryos.error).toBeNull(); expect(embryos.data).toHaveLength(2);
  const embryoIds = embryos.data!.map(row => row.id);
  const rights = async () => {
    const result = await admin.from("future_person_record_key_print_rights")
      .select("embryo_id,recipient_principal_id,status,delivery_kind").in("embryo_id", embryoIds);
    expect(result.error).toBeNull(); expect(result.data).toHaveLength(4);
    return result.data!;
  };
  expect((await rights()).every(row => principalIds.includes(row.recipient_principal_id)
    && row.status === "unconsumed" && row.delivery_kind === "initial")).toBe(true);
  const denied = await admin.rpc("deliver_embryo_record_key_cards_v1", { p_account_id: uploader,
    p_session_id: await actualSession(uploaderContext, uploader), p_cohort_id: cohortId, p_token_nonce: crypto.randomUUID() });
  expect(denied.error?.code).toBe("42501"); expect(denied.data).toBeNull();
  expect((await rights()).every(row => row.status === "unconsumed")).toBe(true);
  const uploaderSettings = await uploaderContext.newPage();
  try {
    await uploaderSettings.goto("/settings/data");
    await expect(uploaderSettings.locator('[data-slot="record-key-card-control"]')).toHaveCount(0);
    await expect(uploaderSettings.locator('[data-slot="record-key-card"]')).toHaveCount(0);
    expect((await rights()).every(row => row.status === "unconsumed")).toBe(true);
  } finally { await uploaderSettings.close(); }
  const keyHashes = new Set<string>();
  for (const [index, accountId] of parents.entries()) {
    const ownPrincipal = (await admin.from("subject_principals").select("id")
      .in("id", principalIds).eq("account_id", accountId).single());
    expect(ownPrincipal.error).toBeNull();
    const principal = ownPrincipal.data!.id;
    const parent = contexts[index].pages()[0];
    const sessionId = await actualSession(contexts[index], accountId);
    await parent.goto("/settings/data");
    const control = parent.locator(`[data-slot="record-key-card-control"][data-cohort-id="${cohortId}"]`);
    await expect(control).toHaveCount(1);
    await expect(parent.locator('[data-slot="record-key-card"]')).toHaveCount(0);
    expect((await rights()).filter(item => item.recipient_principal_id === principal)
      .every(item => item.status === "unconsumed")).toBe(true);
    const reply = parent.waitForResponse(response => new URL(response.url()).pathname === `/api/embryo-cohorts/${cohortId}/record-key-cards`
      && response.request().method() === "POST");
    let row: { cohort_id: string; cards: Record<string, unknown>[] }, nonce: string;
    try {
      const [response] = await Promise.all([reply, control.getByRole("button", { name: "Show my cards", exact: true }).click()]);
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toMatch(/private.*no-store/u);
      const delivery = await response.json();
      if (!Array.isArray(delivery.record_key_cards) || delivery.record_key_cards.length !== 2
        || delivery.record_key_cards.some((item: unknown) => !item || typeof item !== "object" || Array.isArray(item)))
        throw new Error("Own parent API cards unavailable");
      row = { cohort_id: delivery.cohort_id, cards: delivery.record_key_cards };
      const body = response.request().postDataJSON();
      if (!body || Object.keys(body).length !== 1 || typeof body.nonce !== "string")
        throw new Error("Own parent form envelope unavailable");
      const claims = JSON.parse(Buffer.from(body.nonce.split(".")[0], "base64url").toString("utf8"));
      if (claims.accountId !== accountId || claims.sessionId !== sessionId || claims.operation !== "record_key_print"
        || claims.targetKind !== "cohort" || claims.targetId !== cohortId || typeof claims.nonce !== "string"
        || !/^[A-Za-z0-9_-]{16,256}$/.test(claims.nonce)) throw new Error("Own parent form binding failed");
      nonce = claims.nonce;
      // Compare credentials as booleans so a failed assertion cannot print them.
      await control.locator('[data-slot="record-key-value"]').first().waitFor({ state: "visible" });
      const rendered = await control.locator('[data-slot="record-key-value"]').allTextContents();
      expect(rendered.length === 2 && row.cards.every((raw, ordinal) => !!raw && typeof raw === "object"
        && "record_key" in raw && rendered[ordinal] === raw.record_key)).toBe(true);
      await control.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(parent.locator(`[data-slot="record-key-card-control"][data-cohort-id="${cohortId}"]`)).toHaveCount(0);
      await expect(parent.locator('[data-slot="record-key-card"]')).toHaveCount(0);
    } finally {
      // Even a failed card assertion leaves no raw-key DOM for error snapshots.
      await parent.goto("/overview").catch(() => parent.close());
    }
    const args = { p_account_id: accountId, p_session_id: sessionId, p_cohort_id: cohortId, p_token_nonce: nonce! };
    expect(row.cohort_id).toBe(cohortId);
    if (!Array.isArray(row.cards) || row.cards.length !== 2) throw new Error("Own parent cards unavailable");
    const expected = new Map<string, string>();
    for (const [ordinal, raw] of row.cards.entries()) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)
        || typeof raw.record_key !== "string" || !RECORD_KEY_PATTERN.test(raw.record_key)
        || raw.embryo_id !== embryoIds[ordinal] || raw.display_label !== `Embryo ${ordinal + 1}`
        || raw.delivery_kind !== "initial" || raw.closing_date_state !== "provisional_until_terminal_ordinal_resolution")
        throw new Error("Own parent card binding failed");
      const hash = crypto.createHash("sha256").update(raw.record_key).digest("hex");
      expected.set(embryoIds[ordinal], hash); keyHashes.add(hash);
    }
    const saved = await admin.from("future_person_record_key_hashes").select("embryo_id,key_hash")
      .in("embryo_id", embryoIds).eq("recipient_principal_id", principal).eq("status", "current");
    expect(saved.error).toBeNull();
    expect(saved.data?.length === 2).toBe(true);
    // Do not print raw keys or credential-derived values in assertion diagnostics.
    expect(saved.data!.every(item => expected.get(item.embryo_id) === item.key_hash)).toBe(true);
    const after = await rights();
    expect(after.filter(item => item.recipient_principal_id === principal).every(item => item.status === "consumed")).toBe(true);
    if (index === 0) expect(after.filter(item => item.recipient_principal_id !== principal).every(item => item.status === "unconsumed")).toBe(true);
    const replay = await admin.rpc("deliver_embryo_record_key_cards_v1", args);
    expect(replay.error?.code).toBe("23505"); expect(replay.data).toBeNull();
    const reprint = await admin.rpc("deliver_embryo_record_key_cards_v1", { ...args, p_token_nonce: crypto.randomUUID() });
    expect(reprint.error?.code).toBe("42501"); expect(reprint.data).toBeNull();
  }
  expect(keyHashes.size).toBe(4);
  expect((await rights()).every(row => row.status === "consumed")).toBe(true);
}

test("a third-party embryo uploader obtains both genetic parents' native authority before real ingest, publication and parent-only analysis permission", async ({ page, browser }, testInfo) => {
  test.setTimeout(300_000);
  await withEmbryoJourney(process.env, async runtime => {
    const admin = adminClient();
    const uploader = await createConfirmedUser(uploaderEmail, password);
    const parents = await Promise.all(parentEmails.map(email => createConfirmedUser(email, password)));
    expect(new Set([uploader, ...parents]).size).toBe(3);
    const prior = await admin.from("embryo_cohorts").select("id").eq("owner_account_id", uploader);
    const priorDrafts = await admin.from("embryo_cohort_drafts").select("id").eq("owner_account_id", uploader);
    expect(prior.error).toBeNull(); expect(prior.data).toEqual([]);
    expect(priorDrafts.error).toBeNull(); expect(priorDrafts.data).toEqual([]);
    const contexts: BrowserContext[] = [];
    try {
      for (const email of parentEmails) {
        const context = await browser.newContext({ baseURL: origin });
        contexts.push(context);
        await context.route("**/*", route => [origin, SUPABASE_URL].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
        const parent = await context.newPage();
        await signIn(parent, email, password);
      }
      await signIn(page, uploaderEmail, password);
      await page.goto("/embryos/upload");
      await page.getByRole("radio", { name: "Yes", exact: true }).check();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.locator('button[data-option="one-file-columns"]').click();
      await page.getByRole("radio", { name: "Embryos, with both genetic parents’ permission", exact: true }).check();
      await page.locator('[data-slot="attestation"] input').check();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.locator('button[data-option="two-evidenced-parents"]').click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByLabel("Number of embryos in the file").fill("2");
      for (const [index, email] of parentEmails.entries()) await page.getByLabel(parentEmailLabel(index, 2), { exact: true }).fill(email);
      await page.getByRole("button", { name: SAVE_DRAFT_BUTTON }).click();
      await expect(page.locator('[data-stage="owner-sign"]')).toBeVisible();
      const draft = await admin.from("embryo_cohort_drafts")
        .select("id,uploader_principal_id,upload_situation,basis_case").eq("owner_account_id", uploader).single();
      expect(draft.error).toBeNull();
      expect(draft.data).toMatchObject({ upload_situation: "with_genetic_parents_permission", basis_case: "true_two_parent" });
      const draftId = draft.data!.id;
      await signStatements(page, SIGN_BUTTON, uploader, "Synthetic Uploader");
      await expect(page.locator('[data-stage="invite"]')).toBeVisible();
      for (const [index, email] of parentEmails.entries()) await page.getByLabel(parentEmailLabel(index, 2), { exact: true }).fill(email);
      await page.getByRole("button", { name: SEND_INVITATION_BUTTON }).click();
      await expect(page.locator('[data-stage="waiting"]')).toBeVisible();
      await expect(page.locator('[data-slot="file-form"], [data-slot="record-key-card"]')).toHaveCount(0);

      for (const [index, email] of parentEmails.entries()) {
        const parent = contexts[index].pages()[0];
        const message = await drainMailUntil(page.request, () => messages.find(item => [item.to].flat().includes(email) && item.html?.includes("/withdraw/request#")));
        const invitation = message.html!.match(/http:\/\/localhost:3105\/withdraw\/request#[A-Za-z0-9_-]{43}/)?.[0];
        expect(invitation).toBeTruthy();
        await parent.goto(invitation!);
        await parent.getByRole("button", { name: "Continue", exact: true }).click();
        await expect(parent.getByRole("heading", { name: "Review this invitation before you sign" })).toBeVisible();
        for (const box of await parent.getByRole("checkbox").all()) await box.check();
        await parent.getByLabel("Country where you live").selectOption(DEFAULT_TEST_JURISDICTION);
        await parent.getByLabel("Full legal name").fill(`Synthetic Parent ${index + 1}`);
        await parent.getByRole("button", { name: "Sign and accept invitation" }).click();
        await expect(parent.getByRole("heading", { name: "You have accepted the invitation", exact: true })).toBeVisible();
        await expect(parent.getByRole("link", { name: "Go to Your data", exact: true })).toHaveAttribute("href", "/settings/data");
        await parent.goto("/embryos/upload");
        await expect(parent.locator('[data-stage="co-parent-sign"]')).toBeVisible();
        await signStatements(parent, SIGN_BUTTON, parents[index], `Synthetic Parent ${index + 1}`);
        await page.reload();
        if (index === 0) {
          await expect(page.locator('[data-stage="waiting"]')).toBeVisible();
          await expect(page.locator('[data-slot="file-form"], [data-slot="record-key-card"]')).toHaveCount(0);
          await expect(page.getByRole("button", { name: FINALIZE_BUTTON })).toHaveCount(0);
        }
      }
      await expect(page.locator('[data-stage="acknowledge"]')).toBeVisible();
      // A two-parent basis needs the two actual parents, not an evidence
      // review or a fabricated parent role for the separate uploader.
      await expect(page.locator('[data-stage="evidence-review-unavailable"]')).toHaveCount(0);
      const slots = await admin.from("draft_participant_slots").select("slot_kind,principal_id,state")
        .eq("embryo_draft_id", draftId).in("slot_kind", ["parent_a", "parent_b"]).order("slot_kind");
      expect(slots.error).toBeNull(); expect(slots.data).toHaveLength(2);
      expect(slots.data!.map(row => [row.slot_kind, row.state])).toEqual([["parent_a", "current"], ["parent_b", "current"]]);
      const principalIds = slots.data!.map(row => row.principal_id!);
      expect(new Set(principalIds).size).toBe(2);
      expect(principalIds).not.toContain(draft.data!.uploader_principal_id);
      const principals = await admin.from("subject_principals").select("id,account_id,status,principal_kind").in("id", principalIds);
      expect(principals.error).toBeNull(); expect(principals.data).toHaveLength(2);
      expect(principals.data!.map(row => row.account_id).sort()).toEqual([...parents].sort());
      for (const principal of principals.data!) expect(principal).toMatchObject({ status: "active", principal_kind: "genetic_parent" });
      const signatures = await admin.from("consent_signatures").select("artifact_key,purpose,signer_account_id,signer_principal_id")
        .eq("target_kind", "cohort_draft").eq("target_id", draftId);
      expect(signatures.error).toBeNull(); expect(signatures.data).toHaveLength(7);
      const invitations = await admin.from("subject_invitations").select("invitee_principal_id,status")
        .eq("target_kind", "cohort_draft").eq("target_id", draftId);
      expect(invitations.error).toBeNull(); expect(invitations.data).toHaveLength(2);
      expect(invitations.data!.map(row => row.invitee_principal_id).sort()).toEqual([...principalIds].sort());
      expect(invitations.data!.map(row => row.status)).toEqual(["accepted", "accepted"]);
      const uploaderConsent = signatures.data!.filter(row => row.purpose === "embryo-upload-uploader-class");
      expect(uploaderConsent).toEqual([{ artifact_key: "consent.upload-embryo", purpose: "embryo-upload-uploader-class",
        signer_account_id: uploader, signer_principal_id: draft.data!.uploader_principal_id }]);
      for (const purpose of ["embryo-upload-parent-class", "embryo-parentage-attestation", "embryo-disposition-rights-attestation"]) {
        const signed = signatures.data!.filter(row => row.purpose === purpose);
        expect(signed).toHaveLength(2);
        expect(signed.map(row => row.signer_account_id).sort()).toEqual([...parents].sort());
        expect(signed.map(row => row.signer_principal_id).sort()).toEqual([...principalIds].sort());
      }

      const finalizedResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/embryo-cohorts" && response.request().method() === "POST");
      await signStatements(page, FINALIZE_BUTTON, uploader, "Synthetic Uploader");
      const response = await finalizedResponse;
      expect(response.status()).toBe(201);
      const receipt = await response.json();
      expect(receipt.record_key_delivery.caller_state).toBe("not_a_card_recipient");
      expect(Array.isArray(receipt.record_key_cards) && receipt.record_key_cards.length === 0).toBe(true);
      await expect(page.locator('[data-stage="file"]')).toBeVisible();
      await expect(page.locator('[data-slot="record-key-card"]')).toHaveCount(0);
      await proveParentCards(admin, receipt.cohort_id, contexts, parents, principalIds, page.context(), uploader);
      await page.getByLabel(FILE_INPUT_LABEL, { exact: true }).setInputFiles(path.resolve("e2e/fixtures/embryo-pair-grch38.vcf"));
      const completion = page.waitForResponse(response => /\/api\/embryo-ingest\/[^/]+\/complete$/.test(response.url()) && response.request().method() === "POST");
      await page.getByRole("button", { name: SEND_FILE_BUTTON }).click();
      expect((await completion).status()).toBe(202);
      await expect(page.locator('[data-stage="processing"]')).toBeVisible();
      await expect(page.locator('[data-figure-kind]')).toHaveCount(0);
      const cohort = await admin.from("embryo_cohorts").select("id,owner_account_id,upload_class").eq("owner_account_id", uploader).single();
      expect(cohort.error).toBeNull();
      expect(cohort.data).toMatchObject({ owner_account_id: uploader, upload_class: "embryo_third_party" });
      const cohortId = cohort.data!.id;
      const required = await admin.from("embryo_participant_sets").select("principal_id")
        .eq("cohort_id", cohortId).eq("set_kind", "required_upload_principals").is("revoked_at", null);
      expect(required.error).toBeNull(); expect(required.data).toHaveLength(2);
      expect(required.data!.map(row => row.principal_id).sort()).toEqual([...principalIds].sort());
      await runtime.runWorker(cohortId);
      expect(await runtime.proof(cohortId)).toMatchObject({ jobs: 1, sessions: 1, cohorts: 1, sources: 2, parts: 2,
        allPartsCurrent: true, pendingOrdinals: 0, pendingVariants: 0 });
      await expect.poll(async () => (await admin.from("embryo_cohorts").select("status,publication_revision").eq("id", cohortId).single()).data,
        { timeout: 120_000, message: "The real worker must publish the third-party upload" }).toEqual({ status: "active", publication_revision: 1 });
      const embryos = await admin.from("embryos").select("id,subject_id,sample_ordinal,status").eq("cohort_id", cohortId).order("sample_ordinal");
      expect(embryos.error).toBeNull(); expect(embryos.data!.map(row => row.status)).toEqual(["qc_pass", "qc_pass"]);
      const published = await admin.from("embryo_cohorts").select("uploaded_at").eq("id", cohortId).single();
      expect(published.error).toBeNull(); expect(published.data!.uploaded_at).not.toBeNull();
      const files = await admin.from("genome_files").select(EMBRYO_PUBLISHED_FILE_SELECT).in("subject_id", embryos.data!.map(row => row.subject_id));
      expect(files.error).toBeNull();
      expect(publishedEmbryoFiles(files.data, { ownerId: uploader, publishedAt: published.data!.uploaded_at!,
        subjectIds: embryos.data!.map(row => row.subject_id) })).toHaveLength(2);

      await page.goto(`/embryos/compare?cohort=${cohortId}`);
      const consentRequired = page.locator('[role="status"][data-slot="blocking-state"][data-state="consent-required"]');
      await expect(consentRequired).toBeVisible();
      await expect(consentRequired).toHaveText(waitingForResultsBody(ROLE_BOTH_PARENTS));
      await expect(page.locator('[data-slot="cohort-permission"], [data-figure-kind]')).toHaveCount(0);
      for (const [index, context] of contexts.entries()) {
        const parent = context.pages()[0];
        await parent.goto(`/embryos/compare?cohort=${cohortId}`);
        await expect(parent.locator('[data-slot="cohort-permission"]')).toBeVisible();
        await signStatements(parent, ANALYSIS_PERMISSION_BUTTON, parents[index], `Synthetic Parent ${index + 1}`);
        await expect(parent.locator('[data-slot="cohort-permission"]')).toHaveCount(0);
        if (index === 0) {
          await page.reload();
          await expect(consentRequired).toBeVisible();
          await expect(consentRequired).toHaveText(waitingForResultsBody(ROLE_OTHER_PARENT));
          await expect(page.locator('[data-slot="cohort-permission"], [data-figure-kind]')).toHaveCount(0);
        }
      }
      const analysis = await admin.from("consent_signatures").select("signer_account_id,signer_principal_id")
        .eq("target_kind", "cohort").eq("target_id", cohortId).eq("purpose", "embryo.analysis");
      expect(analysis.error).toBeNull(); expect(analysis.data).toHaveLength(2);
      expect(analysis.data!.map(row => row.signer_account_id).sort()).toEqual([...parents].sort());
      expect(analysis.data!.map(row => row.signer_principal_id).sort()).toEqual([...principalIds].sort());
      await page.reload();
      const gate = page.locator('[data-slot="result-gate"]');
      await expect(gate).toBeVisible();
      await gate.getByRole("checkbox").check();
      await gate.getByRole("button", { name: GATE_BUTTON }).click();
      await expect(page.locator('[data-slot="result-gate"], [role="status"][data-slot="blocking-state"][data-state="consent-required"], [data-slot="cohort-permission"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="no-ranking-statement"]')).toHaveText(NO_RANKING_STATEMENT);
      await expect(page.locator('[data-figure-kind="absolute"], [data-figure-kind="interval"]')).toHaveCount(0);

      const readPublication = async () => {
        const cohort = await admin.from("embryo_cohorts").select("id,owner_account_id,status,publication_revision,uploaded_at").eq("id", cohortId).single();
        const embryos = await admin.from("embryos").select("id,subject_id,sample_ordinal,status").eq("cohort_id", cohortId).order("sample_ordinal");
        expect(cohort.error).toBeNull(); expect(embryos.error).toBeNull();
        const files = await admin.from("genome_files").select(EMBRYO_PUBLISHED_FILE_SELECT).in("subject_id", embryos.data!.map(row => row.subject_id));
        expect(files.error).toBeNull();
        return { cohort: cohort.data, embryos: embryos.data, files: files.data, proof: await runtime.proof(cohortId) };
      };
      const qc = await provePublishedQcCrossSurface({ page, ownerId: uploader, cohortId, read: readPublication });
      await testInfo.attach("third-party-embryo-publication", { contentType: "application/json", body: JSON.stringify({
        source: "actual-native-three-account-parent-authority", uploader, parents, draftId, cohortId, qc,
      }) });
    } finally { for (const context of contexts) await context.close(); }
  });
});
