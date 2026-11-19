import { expect, test } from "./audited-test";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { BrowserContext, Page, Request as BrowserRequest } from "@playwright/test";
import config from "../playwright.config";
import {
  adminClient,
  adultInvitationToken,
  adultInvitationUrl,
  completeOwnUploadConsent,
  createConfirmedUser,
  drainMailUntil,
  signIn,
} from "./helpers";
import { reviewFixtureSql, signInReviewer } from "./helpers/claim-review-fixture";
import { observeNativeResponses } from "./helpers/native-response-observer";
import { uploadOwnFilePrepared } from "./own-report-helpers";
import {
  OTHER_ADULT_UPLOAD_COPY as COPY,
  PATH_B_REQUEST_COPY as REQUEST,
  REVIEWED_DOCUMENT_COPY as DOCUMENT,
} from "../src/copy/upload/other-adult";
import { JURISDICTION_AFFIRM, JURISDICTION_SELECT_LABEL } from "../src/copy/settings/jurisdiction";
import { parseArtifactFile } from "../src/lib/legal/artifact-file";
import { artifactStatements } from "../src/lib/uploads/other-adult-upload";

/**
 * payloadBoundaryContract (verification: this file): no request or response
 * body larger than serverlessMaximumObservedBodyBytes crosses a function.
 *
 * Every /api/** request and response of each journey here is measured, in
 * every browser context the journey opens, and the journey fails on any
 * body over 4,500,000 bytes. This file covers the two journeys the subjects
 * endpoints (owner decision 2026-10-16, G2.1) add, TEST-LOCAL only with
 * synthetic data:
 *
 *   1. legalEvidence: the reviewed-document Path B. An uploader sends a
 *      9 MB signed-permission document through api.legal-evidence-upload-
 *      session and three bounded api.evidence-chunk requests; the registered
 *      TEST-LOCAL scanner scans the real stored bytes; a real stepped-up
 *      reviewer, named and assigned by an owner-only fixture operation (never
 *      by the product), reads every chunk and approves; api.subjects sends the
 *      request; the person confirms it with their own signature. A second
 *      document is rejected by the same reviewer, and nothing is sent.
 *   2. largeDownload: api.subject-download opens a revocable chunk session for
 *      the caller's own original, which arrives in bounded api.download-chunk
 *      responses, byte-identical, with no signed URL anywhere.
 *
 * The brief's array, 200 MB VCF and 8-sample cohort journeys are not in this
 * file yet; they need their own fixtures (docs/test-diff-register.md).
 */

const LIMIT = 4_500_000;
const CHUNK = 4_000_000;
const run = promisify(execFile);
const ORIGIN = "http://localhost:3100";
const PASSWORD = "synthetic-payload-password";
const UPLOADER = { email: `payload-uploader-${randomUUID()}@e2e.local`, password: PASSWORD };
const APPROVED = { email: `payload-approved-${randomUUID()}@e2e.local`, name: "Synthetic Approved" };
const REJECTED = { email: `payload-rejected-${randomUUID()}@e2e.local`, name: "Synthetic Rejected" };
const OWNER = { email: `payload-owner-${randomUUID()}@e2e.local`, password: PASSWORD };
const UPLOADER_STATEMENTS = artifactStatements(parseArtifactFile(fs.readFileSync(path.join(process.cwd(),
  "content/legal/consent.upload-other-adult/v2.md"), "utf8"))!.body);
const PERSON_STATEMENTS = artifactStatements(parseArtifactFile(fs.readFileSync(path.join(process.cwd(),
  "content/legal/consent.subject-adult-esignature/v1.md"), "utf8"))!.body);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface CapturedEmail { to: string[] | string; subject: string; html?: string }
const captured: CapturedEmail[] = [];
let resendMock: http.Server;

test.describe.configure({ mode: "serial" });
test.use({ trace: "off" }); // Never retain an upload bearer, a document or a download cookie.

test.beforeAll(async () => {
  resendMock = http.createServer((request, response) => {
    let body = "";
    request.on("data", chunk => (body += chunk));
    request.on("end", () => {
      if (request.method === "POST" && request.url?.includes("/emails")) {
        captured.push(JSON.parse(body) as CapturedEmail);
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: `payload-${captured.length}` }));
        return;
      }
      response.writeHead(200).end("{}");
    });
  });
  await new Promise<void>(resolve => resendMock.listen(8124, "127.0.0.1", resolve));
});

test.afterAll(async () => {
  await new Promise<void>(resolve => resendMock.close(() => resolve()));
});

/**
 * Every /api/** body in this context, both directions. A request body is
 * measured when it is sent. A response body is measured from the browser's
 * own copy of it, from the browser's finished-size count, or from an exact
 * Content-Length; a 204 has no body by definition. Anything left unmeasured
 * fails the journey rather than passing it.
 */
function measureApiBodies(context: BrowserContext, page?: Page) {
  type Entry = { url: string; request: number; response: number | null; declared: number | null };
  // The protocol's own count of response bytes received, per method and path:
  // the fallback for a response whose finished size Playwright never reports.
  const received = new Map<string, number>();
  const cdpReady = page ? (async () => {
    const cdp = await context.newCDPSession(page);
    const keys = new Map<string, string>();
    cdp.on("Network.requestWillBeSent", event => {
      const url = new URL(event.request.url);
      if (url.origin === ORIGIN && url.pathname.startsWith("/api/")) keys.set(event.requestId, `${event.request.method} ${url.pathname}`);
    });
    const totals = new Map<string, number>();
    cdp.on("Network.dataReceived", event => {
      const key = keys.get(event.requestId);
      if (!key) return;
      const total = (totals.get(event.requestId) ?? 0) + event.dataLength;
      totals.set(event.requestId, total);
      // The largest response any request on this method and path received.
      received.set(key, Math.max(received.get(key) ?? 0, total));
    });
    cdp.on("Network.loadingFinished", event => {
      const key = keys.get(event.requestId);
      if (key && !received.has(key)) received.set(key, 0);
    });
    await cdp.send("Network.enable");
  })() : Promise.resolve();
  const entries = new Map<BrowserRequest, Entry>();
  const pending: Promise<void>[] = [];
  const api = (request: BrowserRequest) => {
    const url = new URL(request.url());
    return url.origin === ORIGIN && url.pathname.startsWith("/api/") ? `${request.method()} ${url.pathname}` : null;
  };
  context.on("request", request => {
    const url = api(request);
    if (url) entries.set(request, { url, request: request.postDataBuffer()?.length ?? 0, response: null, declared: null });
  });
  context.on("response", response => {
    const entry = entries.get(response.request());
    if (!entry) return;
    const length = response.headers()["content-length"];
    if (length !== undefined) entry.declared = Number(length);
    if (response.status() === 204) entry.response = 0;
    pending.push(response.body().then(body => { entry.response = Math.max(entry.response ?? 0, body.length); }).catch(() => {}));
  });
  context.on("requestfinished", request => {
    const entry = entries.get(request);
    if (entry) pending.push(request.sizes().then(sizes => {
      entry.response = Math.max(entry.response ?? 0, sizes.responseBodySize);
    }).catch(() => {}));
  });
  const all = async () => {
    await cdpReady;
    await Promise.race([Promise.all(pending), new Promise(resolve => setTimeout(resolve, 15_000))]);
    for (const entry of entries.values()) {
      if (entry.response === null && entry.declared === null && received.has(entry.url)) entry.response = received.get(entry.url)!;
    }
    return [...entries.values()];
  };
  return {
    ready: () => cdpReady,
    all,
    async assertWithinBoundary(minimumRequests: number) {
      const measured = await all();
      expect(measured.length, "the journey's /api/** traffic was measured").toBeGreaterThanOrEqual(minimumRequests);
      const over = measured.filter(entry => entry.request > LIMIT || (entry.response ?? 0) > LIMIT || (entry.declared ?? 0) > LIMIT);
      expect(over, "no /api/** body over serverlessMaximumObservedBodyBytes").toEqual([]);
      const unmeasured = measured.filter(entry => entry.response === null && entry.declared === null);
      expect(unmeasured, "every /api/** response body has a measured or declared size").toEqual([]);
    },
  };
}

function mailTo(address: string, subject: string) {
  return () => captured.find(email => (Array.isArray(email.to) ? email.to : [email.to]).includes(address)
    && email.subject === subject);
}

/** A valid synthetic one-page PDF padded by one inert stream to about `bytes`. */
function syntheticPdf(bytes: number): Buffer {
  const text = "BT /F1 18 Tf 20 210 Td (Synthetic signed permission, test only) Tj ET\n";
  const padding = Math.max(0, bytes - 1_000);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 260] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${padding} >>\nstream\n${"%".repeat(padding)}\nendstream`,
  ];
  let result = "%PDF-1.7\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(result));
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) result += `${String(offset).padStart(10, "0")} 00000 n \n`;
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}

async function openPathB(page: Page) {
  await page.goto("/files/upload");
  const section = page.locator('[data-slot="other-adult-upload"]');
  await expect(section.getByRole("heading", { name: COPY.heading })).toBeVisible();
  if (!(await section.locator("details").evaluate(element => (element as HTMLDetailsElement).open))) {
    await section.locator("summary").click();
  }
  return section;
}

/**
 * The registered TEST-LOCAL scanner over the real stored bytes, one bounded
 * pass at a time until this draft's document is clean. No state is edited by
 * the fixture; it only reads the document's state between passes.
 */
async function scanUntilClean(draftId: string): Promise<void> {
  expect(draftId).toMatch(UUID);
  const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
  for (let pass = 0; pass < 16; pass++) {
    const state = await reviewFixtureSql(`select coalesce((select state from private.permission_documents
      where subject_id='${draftId}'::uuid),'composing')`);
    if (state === "clean") return;
    expect(["composing", "quarantined"], "the document is only ever composed, then quarantined").toContain(state);
    const result = await run(process.execPath, ["--conditions=react-server", "--import", "./scripts/server-only-shim.mjs",
      "--import", "tsx", "scripts/permission-document-scan-worker.run.mts", "--once"], { timeout: 30_000, maxBuffer: 65_536,
      env: { ...process.env, ...servers[0]?.env, NODE_ENV: "test", VERCEL_ENV: "development", INHERIT_TEST_JURISDICTION: "1",
        INHERIT_CLAMD_ADDRESS: "test-double" } });
    expect(result.stderr, "the scan worker prints no diagnostics or plaintext").toBe("");
    expect(result.stdout.trim()).toMatch(/^permission_document_scan_(clean|idle|retry)$/u);
    if (result.stdout.trim() === "permission_document_scan_idle") await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error("The bounded scan worker did not reach this document");
}

/** Reserve a reviewed-document person, sign the uploader artifact, and send the document. Returns the draft id. */
async function reviewedDocumentPerson(page: Page, person: { email: string; name: string }, document: Buffer): Promise<string> {
  const section = await openPathB(page);
  // The browser's own response bytes; the app receives the original response.
  const observer = await observeNativeResponses(page, { draft: "^/api/subject-drafts$", consent: "^/api/consents$",
    session: "^/api/legal-evidence/upload-session$" });
  try {
  const form = section.locator('[data-slot="other-adult-new"]');
  await form.getByLabel(COPY.nameLabel).fill(person.name);
  await form.getByLabel(COPY.emailLabel).fill(person.email);
  await form.getByLabel(COPY.birthLabel).fill("1980-05-05");
  await form.getByRole("radio", { name: DOCUMENT.flowDocument, exact: true }).check();
  await form.getByRole("button", { name: COPY.detailsButton, exact: true }).click();
  const receipt = await observer.read("draft");
  expect(receipt.status).toBe(201);
  const draft = JSON.parse(receipt.text) as { subjectDraftId: string; state: string; next: string };
  expect(draft).toMatchObject({ state: "awaiting_uploader_artifact", next: "sign_uploader_artifact" });
  const draftId = draft.subjectDraftId;
  expect(draftId).toMatch(UUID);

  const sign = section.locator('[data-slot="reviewed-document-sign"]').filter({ hasText: person.name });
  await expect(sign).toHaveCount(1);
  const signButton = sign.getByRole("button", { name: COPY.signButton, exact: true });
  for (const statement of UPLOADER_STATEMENTS) {
    await expect(signButton).toBeDisabled();
    await sign.getByRole("checkbox", { name: statement, exact: true }).check();
  }
  await sign.getByLabel(COPY.typedNameLabel).fill("Synthetic Uploader");
  await signButton.click();
  expect((await observer.read("consent")).status).toBe(201);

  const upload = section.locator('[data-slot="reviewed-document-upload"]').filter({ hasText: person.name });
  await expect(upload).toHaveCount(1);
  await upload.getByLabel(DOCUMENT.documentLabel).setInputFiles({ name: "synthetic-permission.pdf", mimeType: "application/pdf", buffer: document });
  const scanning = page.waitForResponse(response => /^\/api\/evidence\/[^/]+\/complete$/u.test(new URL(response.url()).pathname)
    && response.status() === 202);
  await upload.getByRole("button", { name: DOCUMENT.documentButton, exact: true }).click();
  const session = await observer.read("session");
  expect(session.status).toBe(201);
  const body = JSON.parse(session.text) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["chunkBytes", "chunkRoute", "completeRoute", "documentKind", "expiresAt",
    "maximumChunks", "maximumDocumentBytes", "session"]);
  expect(JSON.stringify(body)).not.toMatch(/legal-evidence\/|bucket|objectPath|http/u);
  expect((await scanning).status()).toBe(202);
  await scanUntilClean(draftId);
  await expect(section.locator('[data-slot="reviewed-document-review"]').filter({ hasText: person.name }).getByRole("status"))
    .toHaveText(DOCUMENT.reviewStatus(person.name), { timeout: 60_000 });
  return draftId;
  } finally {
    await observer.dispose();
  }
}

/** The real reviewer reads every chunk of the exact bytes, then decides. Runs in the reviewer's own page. */
async function review(page: Page, documentId: string, decision: "approved" | "rejected", reason: string) {
  return page.evaluate(async ({ documentId, decision, reason }) => {
    const opened = await fetch(`/api/legal-evidence/${documentId}/review-download`, { credentials: "same-origin", cache: "no-store" });
    if (opened.status !== 200) return { stage: "open", status: opened.status };
    const session = await opened.json() as { session: string; sha256: string; sizeBytes: number; chunkCount: number; chunkRoute: string };
    const csrf = opened.headers.get("x-inherit-csrf"), nonce = opened.headers.get("x-inherit-review-nonce");
    const revision = Number(opened.headers.get("x-inherit-review-revision"));
    const parts: Uint8Array[] = [];
    const chunkSizes: number[] = [];
    for (let sequence = 0; sequence < session.chunkCount; sequence++) {
      const chunk = await fetch(session.chunkRoute.replace("{sequence}", String(sequence)), { credentials: "same-origin", cache: "no-store" });
      if (chunk.status !== 200) return { stage: "chunk", status: chunk.status, sequence };
      const bytes = new Uint8Array(await chunk.arrayBuffer());
      chunkSizes.push(bytes.length);
      parts.push(bytes);
    }
    const whole = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) { whole.set(part, offset); offset += part.length; }
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", whole))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const decided = await fetch(`/api/legal-evidence/${documentId}/review`, {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "content-type": "application/json", "x-inherit-csrf": csrf ?? "" },
      body: JSON.stringify({ decision, reason, documentSha256: session.sha256, reviewRevision: revision, nonce }),
    });
    return { stage: "decided", status: decided.status, body: await decided.json(), digestMatches: digest === session.sha256,
      sizeBytes: session.sizeBytes, chunkSizes, revision };
  }, { documentId, decision, reason });
}

async function permissionDocumentOf(draftId: string): Promise<string> {
  const id = await reviewFixtureSql(`select d.id from private.permission_documents d where d.subject_id='${draftId}'::uuid
    and d.state='clean' and d.review_state='pending'`);
  expect(id, "the scanned document awaits a named review").toMatch(UUID);
  return id;
}

test("legal evidence payload boundary: a reviewed-document Path B request, named-human approval, activation by the person", async ({ page, browser, request, baseURL }) => {
  test.setTimeout(420_000);
  if (!baseURL) throw new Error("Local app origin unavailable");
  const uploaderId = await createConfirmedUser(UPLOADER.email, UPLOADER.password);
  await signIn(page, UPLOADER.email, UPLOADER.password);
  await completeOwnUploadConsent(page);
  // Measured from the reviewed-document journey on; the own-upload consent
  // steps before it are not part of this boundary claim.
  const uploaderBodies = measureApiBodies(page.context(), page);
  await uploaderBodies.ready();

  const document = syntheticPdf(9_000_000);
  const draftId = await reviewedDocumentPerson(page, APPROVED, document);
  const documentId = await permissionDocumentOf(draftId);
  // Three bounded chunks crossed the function, never the 9 MB whole.
  const chunks = (await uploaderBodies.all()).filter(entry => /^PUT \/api\/evidence\/[^/]+\/chunks\/[0-4]$/u.test(entry.url));
  expect(chunks.map(entry => entry.request)).toEqual([CHUNK, CHUNK, document.length - 2 * CHUNK]);

  // A real stepped-up reviewer. Only naming and assigning the reviewer are
  // owner-only operations; the uploader can never be assigned.
  const reviewerContext = await browser.newContext({ baseURL });
  const reviewerBodies = measureApiBodies(reviewerContext);
  try {
    const reviewer = await signInReviewer(reviewerContext, baseURL);
    await reviewFixtureSql(`select private.grant_claim_reviewer_v1('${reviewer}'::uuid)`);
    await expect(reviewFixtureSql(`select private.assign_permission_document_review_v1('${documentId}'::uuid,'${uploaderId}'::uuid)`))
      .rejects.toThrow();
    await reviewFixtureSql(`select private.assign_permission_document_review_v1('${documentId}'::uuid,'${reviewer}'::uuid)`);
    const reviewerPage = await reviewerContext.newPage();
    await reviewerPage.goto("/about");
    const decided = await review(reviewerPage, documentId, "approved",
      "The synthetic permission names the adult and is signed and dated; test only.");
    expect(decided).toMatchObject({ stage: "decided", status: 200, digestMatches: true, sizeBytes: document.length,
      chunkSizes: [CHUNK, CHUNK, document.length - 2 * CHUNK] });
    expect(decided.body).toEqual({ documentId, status: "reviewed", decision: "approved", reviewRevision: (decided.revision as number) + 1 });
    expect(await reviewFixtureSql(`select r.reviewer_account_id::text||'/'||r.decision from private.permission_document_reviews r
      where r.document_id='${documentId}'::uuid`)).toBe(`${reviewer}/approved`);
    await reviewerBodies.assertWithinBoundary(5);
  } finally {
    await reviewerContext.close();
  }

  // api.subjects sends the request only now; the body carries no address.
  const section = await openPathB(page);
  const ask = section.locator('[data-slot="reviewed-document-request"]').filter({ hasText: APPROVED.name });
  await expect(ask).toHaveCount(1);
  const subjects = await observeNativeResponses(page, { finalize: "^/api/subjects$" });
  const finalized = page.waitForRequest(sent => sent.url().endsWith("/api/subjects") && sent.method() === "POST");
  await ask.getByRole("button", { name: DOCUMENT.requestButton, exact: true }).click();
  expect((await finalized).postData()).not.toContain(APPROVED.email);
  const receipt = await subjects.read("finalize");
  await subjects.dispose();
  expect(receipt.status).toBe(202);
  expect(JSON.parse(receipt.text)).toEqual({ status: "received", next: "awaiting_subject_confirmation" });
  await expect(section.locator('[data-slot="reviewed-document-awaiting"]').filter({ hasText: APPROVED.name }).getByRole("status"))
    .toContainText(`Waiting for ${APPROVED.name} to sign.`);
  await uploaderBodies.assertWithinBoundary(8);

  // The person confirms with their own signature, with no account.
  const mail = await drainMailUntil(request, mailTo(APPROVED.email, "A request to add your DNA file to Inherit"), "the reviewed-document request");
  await page.request.post("/auth/sign-out");
  await page.context().clearCookies();
  const token = adultInvitationToken(mail.html);
  expect(token).toBeTruthy();
  await page.goto(adultInvitationUrl(token!));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(`${ORIGIN}/withdraw/session`);
  const confirm = page.locator('[data-slot="path-b-request"]');
  await expect(confirm.getByText(REQUEST.detail(APPROVED.name), { exact: true })).toBeVisible();
  const signButton = confirm.getByRole("button", { name: REQUEST.signButton, exact: true });
  for (const statement of PERSON_STATEMENTS) await confirm.getByRole("checkbox", { name: statement, exact: true }).check();
  await confirm.getByLabel(JURISDICTION_SELECT_LABEL).selectOption("GB");
  await confirm.getByRole("checkbox", { name: JURISDICTION_AFFIRM, exact: true }).check();
  await confirm.getByLabel(REQUEST.typedNameLabel).fill(APPROVED.name);
  await signButton.click();
  await expect(page.getByRole("heading", { name: REQUEST.receipts.confirm.title })).toBeVisible();

  const admin = adminClient();
  const subject = await admin.from("subjects").select("id, lifecycle, subject_class, owner_account_id").eq("id", draftId).single();
  expect(subject.data).toEqual({ id: draftId, lifecycle: "active", subject_class: "other_adult", owner_account_id: uploaderId });
  // The approved document is the activated basis, kept for exactly 730 days.
  expect(await reviewFixtureSql(`select (retain_until - (select max(r.decided_at) from private.permission_document_reviews r
    where r.document_id=d.id)) > interval '729 days' from private.permission_documents d where d.id='${documentId}'::uuid`)).toBe("t");
  await uploaderBodies.assertWithinBoundary(10);
});

test("legal evidence payload boundary: a rejected signed permission sends nothing and ends the draft", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  if (!baseURL) throw new Error("Local app origin unavailable");
  await signIn(page, UPLOADER.email, UPLOADER.password);
  const bodies = measureApiBodies(page.context(), page);
  await bodies.ready();
  const before = captured.length;
  const draftId = await reviewedDocumentPerson(page, REJECTED, syntheticPdf(20_000));
  const documentId = await permissionDocumentOf(draftId);
  const reviewerContext = await browser.newContext({ baseURL });
  try {
    const reviewer = await signInReviewer(reviewerContext, baseURL);
    await reviewFixtureSql(`select private.grant_claim_reviewer_v1('${reviewer}'::uuid);
      select private.assign_permission_document_review_v1('${documentId}'::uuid,'${reviewer}'::uuid);`);
    const reviewerPage = await reviewerContext.newPage();
    await reviewerPage.goto("/about");
    const decided = await review(reviewerPage, documentId, "rejected", "The synthetic page is unsigned and names no adult; test only.");
    expect(decided).toMatchObject({ stage: "decided", status: 200, digestMatches: true });
    expect((decided.body as { decision: string }).decision).toBe("rejected");
    const conflict = await review(reviewerPage, documentId, "approved", "A second decision on the same revision; test only.");
    expect(conflict.stage === "open" ? conflict.status : (conflict as { status: number }).status).toBe(404);
  } finally {
    await reviewerContext.close();
  }
  const section = await openPathB(page);
  await expect(section.locator('[data-slot="reviewed-document-refused"]').filter({ hasText: REJECTED.name }).getByRole("status"))
    .toHaveText(DOCUMENT.refusedStatus(REJECTED.name));
  await expect(section.locator('[data-slot="reviewed-document-request"]')).toHaveCount(0);
  expect(captured.slice(before).filter(email => (Array.isArray(email.to) ? email.to : [email.to]).includes(REJECTED.email))).toEqual([]);
  // The key is gone at commit; the subject is the same tombstone as an expired request.
  expect(await reviewFixtureSql(`select (s.wrapped_document_key is null)::text||'/'||sub.lifecycle from private.permission_documents d
    join private.permission_document_sessions s on s.id=d.session_id join public.subjects sub on sub.id=d.subject_id
    where d.id='${documentId}'::uuid`)).toBe("true/purged");
  await bodies.assertWithinBoundary(6);
});

test("large download payload boundary: the caller's own original arrives in bounded revocable chunks, byte-identical", async ({ page }) => {
  test.setTimeout(300_000);
  const ownerId = await createConfirmedUser(OWNER.email, OWNER.password);
  await signIn(page, OWNER.email, OWNER.password);
  // A synthetic VCF over two chunks: the tiny fixture's records under inert
  // padding header lines, so the original is about 9 MB.
  const base = fs.readFileSync(path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"), "utf8").split("\n");
  const firstRecord = base.findIndex(line => line.startsWith("#CHROM"));
  const padding = Array.from({ length: 9_000 }, (_, index) => `##inherit_synthetic_padding_${index}=${"x".repeat(960)}`);
  const vcf = [base[0], ...padding, ...base.slice(1, firstRecord), ...base.slice(firstRecord)].join("\n");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inherit-payload-"));
  const file = path.join(directory, "synthetic-large-grch38.vcf");
  fs.writeFileSync(file, vcf);
  try {
    await completeOwnUploadConsent(page);
    const fileId = await uploadOwnFilePrepared(page, file, { fileType: "vcf" });
    // Measured from the download on: the browser sent the upload straight to
    // Storage, and the own-upload steps are not part of this claim.
    const bodies = measureApiBodies(page.context(), page);
    await bodies.ready();
    const self = await adminClient().from("subjects").select("id").eq("subject_account_id", ownerId).eq("subject_class", "self").single();
    expect(self.error).toBeNull();
    const original = fs.readFileSync(file);
    const result = await page.evaluate(async ({ subject, fileId }) => {
      const invalid = await fetch(`/api/subjects/${subject}/download?file=${fileId}&offset=0`, { credentials: "same-origin" });
      const foreign = await fetch(`/api/subjects/${crypto.randomUUID()}/download?file=${fileId}`, { credentials: "same-origin" });
      const opened = await fetch(`/api/subjects/${subject}/download?file=${fileId}`, { credentials: "same-origin", cache: "no-store" });
      const descriptor = await opened.json() as { session: string; sha256: string; sizeBytes: number; chunkCount: number; chunkRoute: string };
      const sizes: number[] = [];
      const parts: Uint8Array[] = [];
      for (let sequence = 0; sequence < descriptor.chunkCount; sequence++) {
        const chunk = await fetch(descriptor.chunkRoute.replace("{sequence}", String(sequence)), { credentials: "same-origin", cache: "no-store" });
        if (chunk.status !== 200) return { failedAt: sequence, status: chunk.status };
        const bytes = new Uint8Array(await chunk.arrayBuffer());
        sizes.push(bytes.length);
        parts.push(bytes);
      }
      const whole = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
      let offset = 0;
      for (const part of parts) { whole.set(part, offset); offset += part.length; }
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", whole))].map(byte => byte.toString(16).padStart(2, "0")).join("");
      // A second open revokes the first session: its next chunk is the opaque 404.
      await fetch(`/api/subjects/${subject}/download?file=${fileId}`, { credentials: "same-origin", cache: "no-store" });
      const revoked = await fetch(descriptor.chunkRoute.replace("{sequence}", "0"), { credentials: "same-origin", cache: "no-store" });
      return { invalid: invalid.status, foreign: foreign.status, opened: opened.status, keys: Object.keys(descriptor).sort(),
        descriptor, sizes, digest, revoked: revoked.status };
    }, { subject: self.data!.id as string, fileId });
    expect(result).toMatchObject({ invalid: 422, foreign: 404, opened: 200, revoked: 404 });
    const value = result as { keys: string[]; descriptor: { sha256: string; sizeBytes: number; chunkCount: number }; sizes: number[]; digest: string };
    expect(value.keys).toEqual(["chunkBytes", "chunkCount", "chunkRoute", "filename", "session", "sha256", "sizeBytes"]);
    expect(value.descriptor.sizeBytes).toBe(original.length);
    expect(value.descriptor.sha256).toBe(createHash("sha256").update(original).digest("hex"));
    expect(value.digest).toBe(value.descriptor.sha256);
    expect(value.sizes.length).toBeGreaterThanOrEqual(3);
    expect(value.sizes.slice(0, -1).every(size => size === CHUNK)).toBe(true);
    expect(JSON.stringify(value.descriptor)).not.toMatch(/genomes\/|storage|token=|X-Amz|sign/iu);
    const downloads = (await bodies.all()).filter(entry => /^GET \/api\/downloads\/[^/]+\/chunks\/\d$/u.test(entry.url));
    expect(downloads.length).toBeGreaterThanOrEqual(value.sizes.length);
    await bodies.assertWithinBoundary(value.sizes.length + 3);
    // Every chunk the caller read was recorded once, server side.
    expect(Number(await reviewFixtureSql(`select count(*) from public.download_ranges r join public.download_sessions s
      on s.id=r.session_id where s.purpose='subject-original-download' and s.account_id='${ownerId}'::uuid`)))
      .toBe(value.sizes.length);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
