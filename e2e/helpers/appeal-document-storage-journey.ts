import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { Browser, Page } from "@playwright/test";
import config from "../../playwright.config";
import { EICAR_TEST_STRING } from "../../src/lib/scan/test-double-scanner";
import { expect } from "../audited-test";
import { adminClient, anonClient } from "../helpers";
import { reviewFixtureSql, reviewPicture, signInReviewer } from "./claim-review-fixture";
import { observeNativeResponses } from "./native-response-observer";

const run = promisify(execFile);
const ORIGIN = "http://localhost:3102";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const targetBag = `select md5(jsonb_build_object(
 'subjects',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.subjects s),
 'cohorts',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.embryo_cohorts c))::text)`;

/** Actual application upload/Storage/worker/receipt. The explicitly TEST-only
 * scanner inspects real decrypted Storage bytes; it is not a production provider. */
export async function appealDocumentStorageJourney(page: Page, browser: Browser) {
  const principal = randomUUID();
  const reviewerContext = await browser.newContext();
  const foreignContext = await browser.newContext();
  let caseId: string | undefined;
  const native = adminClient();
  expect(await reviewFixtureSql("select enabled::text from private.new_public_appeal_config where singleton")).toBe("false");
  try {
    const reviewer = await signInReviewer(reviewerContext, ORIGIN);
    const foreignReviewer = await signInReviewer(foreignContext, ORIGIN);
    await reviewFixtureSql(`select private.grant_claim_reviewer_v1('${reviewer}');
      select private.grant_claim_reviewer_v1('${foreignReviewer}')`);
    // Real Auth account provisioning legitimately creates its own subject.
    // Capture all target rows after both identities exist, before the case.
    const targetsBefore = await reviewFixtureSql(targetBag);
    await reviewFixtureSql(`update private.new_public_appeal_config set enabled=true where singleton;
      insert into public.subject_principals(id,account_id,principal_kind) values('${principal}','${reviewer}','reviewer');
      insert into private.new_public_appeal_reviewers(principal_id,principal_revision,purpose_revision) values('${principal}',1,1);`);
    await page.goto(`${ORIGIN}/legal/appeals`);
    const form = page.locator("main form");
    await form.getByLabel("Request type", { exact: true }).selectOption("subject-objection");
    await form.getByLabel("Your name", { exact: true }).fill("Synthetic document requester");
    await form.getByLabel("Your email address", { exact: true }).fill(`appeal-storage-${randomBytes(8).toString("hex")}@e2e.local`);
    await form.getByLabel("Why do you want to make this request? Use 20 to 8,000 characters.", { exact: true })
      .fill("This synthetic evidence request must never change any source or target authority.");
    await form.getByRole("checkbox").check();
    const submitted = page.waitForResponse(response => response.url() === `${ORIGIN}/api/appeals` && response.request().method() === "POST");
    await form.getByRole("button", { name: "Send request", exact: true }).click();
    expect((await submitted).status()).toBe(202);
    caseId = await reviewFixtureSql(`select id from private.new_public_appeal_intakes where reviewer_principal_id='${principal}' and state='committed'`);
    if (!UUID.test(caseId)) throw new Error("Actual synthetic appeal unavailable");
    const caseLiteral = caseId;
    const outbox = await reviewFixtureSql(`select outbox_id from private.new_public_appeal_intakes where id='${caseLiteral}'`);
    if (!UUID.test(outbox)) throw new Error("Actual synthetic appeal delivery unavailable");
    let token: string | undefined;
    for (let pass = 0; pass < 4 && !token; pass++) {
      const issued = await native.rpc("claim_mail_outbox").retry(false);
      if (issued.error) throw new Error("Actual synthetic appeal issuance refused");
      const row = issued.data?.[0];
      if (row?.outbox_id !== outbox) continue;
      if (typeof row.delivery_token !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(row.delivery_token)) throw new Error("Actual synthetic token unavailable");
      const authorized = await native.rpc("authorize_mail_submission_v1", { p_outbox_id: row.outbox_id, p_attempt_ordinal: row.attempt_ordinal }).retry(false);
      if (authorized.error || authorized.data !== true) throw new Error("Actual synthetic submission refused");
      token = row.delivery_token;
    }
    if (!token) throw new Error("Actual synthetic appeal issuance unavailable");
    // The real interstitial consumes the genuinely issued one-use token. No
    // cookie, rights row, Auth claim or verified recipient is manufactured.
    await page.goto(`${ORIGIN}/withdraw/request#${token}`);
    token = undefined;
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Files for your request", exact: true })).toBeVisible();
    const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
    const environment = servers.find(server => server?.url === `${ORIGIN}/auth/sign-in` || server?.port === 3102)?.env;
    if (!environment) throw new Error("Existing TEST application unavailable");

    async function scan(session: string, expected: "clean" | "refused") {
      for (let pass = 0; pass < 16; pass++) {
        const state = await reviewFixtureSql(`select state from private.appeal_documents where session_id='${session}'`);
        if (state === expected) return;
        expect(state, "only a genuine quarantined object may reach the scanner").toBe("quarantined");
        const result = await run(process.execPath, ["--conditions=react-server", "--import", "./scripts/server-only-shim.mjs", "--import", "tsx",
          "scripts/appeal-document-scan-worker.run.mts", "--once"], { timeout: 15_000, maxBuffer: 65_536,
          env: { ...process.env, ...environment, NODE_ENV: "test", VERCEL_ENV: "development", INHERIT_TEST_JURISDICTION: "1", INHERIT_CLAMD_ADDRESS: "test-double" } });
        expect(result.stderr).toBe("");
        expect(result.stdout.trim()).toMatch(/^appeal_document_scan_(clean|idle|refused|retry|failed)$/u);
      }
      throw new Error("Bounded actual appeal scan did not settle");
    }

    async function upload(label: string, ordinal: number, bytes: Buffer, expected: "clean" | "refused") {
      await page.getByLabel(label, { exact: true }).setInputFiles({ name: "original-name-must-never-be-sent.png", mimeType: "image/png", buffer: bytes });
      // Completion legitimately polls the same route. Observe only the one
      // native open request; keep the app's completion requests unchanged.
      const observed = await observeNativeResponses(page, { opened: "^/api/appeals/session/documents$" });
      try {
        const quarantine = page.waitForResponse(response => /^\/api\/evidence\/[^/]+\/complete$/u.test(new URL(response.url()).pathname) && response.status() === 202);
        await page.getByRole("button", { name: "Send file", exact: true }).nth(ordinal).click();
        const opened = await observed.read("opened");
        expect(opened.status).toBe(201);
        const body = JSON.parse(opened.text) as Record<string, unknown>;
        expect(Object.keys(body).sort()).toEqual(["chunkBytes", "chunkRoute", "completeRoute", "documentKind", "expiresAt", "maximumChunks", "maximumDocumentBytes", "session"]);
        if (typeof body.session !== "string" || !UUID.test(body.session)) throw new Error("Actual evidence session unavailable");
        const session = body.session;
        expect(opened.text).not.toMatch(/legal-evidence|original-name-must-never-be-sent/u);
        expect((await quarantine).status()).toBe(202);
        const beforeRefusal = await reviewFixtureSql(`select md5(jsonb_build_object('session',to_jsonb(session),
          'document',(select to_jsonb(document) from private.appeal_documents document where document.session_id=session.id),
          'fragments',(select coalesce(jsonb_agg(to_jsonb(fragment) order by fragment.sequence),'[]')
            from private.appeal_document_fragments fragment where fragment.session_id=session.id))::text)
          from private.appeal_document_sessions session where session.id='${session}'`);
        const deniedChunk = await page.request.put(`${ORIGIN}/api/evidence/${session}/chunks/0`, {
          headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/octet-stream" },
          data: Buffer.from("No CSRF proof"),
        });
        expect(deniedChunk.status()).toBe(404);
        expect(await reviewFixtureSql(`select md5(jsonb_build_object('session',to_jsonb(session),
          'document',(select to_jsonb(document) from private.appeal_documents document where document.session_id=session.id),
          'fragments',(select coalesce(jsonb_agg(to_jsonb(fragment) order by fragment.sequence),'[]')
            from private.appeal_document_fragments fragment where fragment.session_id=session.id))::text)
          from private.appeal_document_sessions session where session.id='${session}'`)).toBe(beforeRefusal);
        expect(await reviewFixtureSql(`select (document.state='quarantined' and document.scan_verdict is null
          and document.object_key=session.planned_object_key and document.sha256=session.declared_sha256
          and document.intake_id='${caseLiteral}'::uuid and document.media_type='image/png'
          and document.object_key ~ '^appeal-case/' and split_part(document.object_key,'/',2)=document.intake_id::text
          and split_part(document.object_key,'/',3)=document.id::text and document.object_key ~ '/[0-9a-f-]{36}[.]png$')::text
          from private.appeal_documents document join private.appeal_document_sessions session on session.id=document.session_id
          where session.id='${session}'`)).toBe("true");
        const key = await reviewFixtureSql(`select object_key from private.appeal_documents where session_id='${session}'`);
        const sealed = await native.storage.from("legal-evidence").download(key);
        if (sealed.error || !sealed.data) throw new Error("Actual sealed evidence object unavailable");
        const ciphertext = Buffer.from(await sealed.data.arrayBuffer());
        try {
          expect(ciphertext.length).toBe(bytes.length + 28);
          expect(ciphertext.includes(bytes), "Storage contains envelope ciphertext, not the uploaded document").toBe(false);
        } finally { ciphertext.fill(0); }
        expect(Boolean((await anonClient().storage.from("legal-evidence").download(key)).error)).toBe(true);
        expect(Boolean((await anonClient().storage.from("legal-evidence").createSignedUrl(key, 60)).error)).toBe(true);
        expect(await reviewFixtureSql(`select count(*) from storage.objects where bucket_id='legal-evidence'
          and name in(select object_key from private.appeal_document_fragments where session_id='${session}')`)).toBe("0");
        await scan(session, expected);
        if (expected === "refused") {
          await expect(page.getByRole("status")).toHaveText("This document could not be received. Please try again.");
          expect(await reviewFixtureSql(`select (state='refused' and refusal_code='infected' and scan_verdict is null and object_deleted_at is not null)::text
            from private.appeal_documents where session_id='${session}'`)).toBe("true");
          expect(Boolean((await native.storage.from("legal-evidence").download(key)).error)).toBe(true);
        } else await expect(page.getByRole("status").filter({ hasText: "Document received for review." })).toHaveCount(ordinal + 1);
      } finally { await observed.dispose(); }
    }
    const infected = Buffer.concat([reviewPicture(2, 2), Buffer.from(EICAR_TEST_STRING, "ascii")]);
    const photo = reviewPicture(3, 2), authority = reviewPicture(4, 2);
    try {
      await upload("Photo identity document", 0, infected, "refused");
      await upload("Photo identity document", 0, photo, "clean");
      await upload("Evidence that the source is yours", 1, authority, "clean");
    } finally { infected.fill(0); photo.fill(0); authority.fill(0); }
    await page.getByRole("checkbox").check();
    const completion = page.waitForResponse(response => response.url() === `${ORIGIN}/api/appeals/session/complete` && response.request().method() === "POST");
    await page.getByRole("button", { name: "Send for review", exact: true }).click();
    expect((await completion).status()).toBe(202);
    await expect(page.getByRole("heading", { name: "Your files were sent", exact: true })).toBeVisible();
    const reviewerPage = await reviewerContext.newPage();
    expect((await reviewerPage.goto(`${ORIGIN}/reviews/appeals/${caseLiteral}`))?.status()).toBe(200);
    await expect(reviewerPage.getByRole("button", { name: "Open file", exact: true })).toHaveCount(2);
    await reviewerPage.getByRole("button", { name: "Open file", exact: true }).first().click();
    await expect(reviewerPage.getByRole("img", { name: "Review file", exact: true })).toBeVisible();
    await expect(reviewerPage.getByLabel("I read this file.", { exact: true })).toBeEnabled();
    expect(await reviewFixtureSql(`select (count(*)=1 and bool_and(chunk.acknowledged_at is not null))::text
      from private.public_appeal_review_chunks chunk join private.public_appeal_review_downloads download on download.id=chunk.download_id
      where download.case_id='${caseLiteral}'`)).toBe("true");
    const denied = await foreignContext.newPage();
    expect((await denied.goto(`${ORIGIN}/reviews/appeals/${caseLiteral}`))?.status()).toBe(404);
    await expect(denied.getByRole("button", { name: "Open file", exact: true })).toHaveCount(0);
    expect(await reviewFixtureSql(targetBag)).toBe(targetsBefore);
  } finally {
    try {
      await reviewFixtureSql(`update public.appeal_intakes set state='withdrawn',decided_at=clock_timestamp()
        where id in(select id from private.new_public_appeal_intakes where reviewer_principal_id='${principal}') and state in('submitted','reviewing');
        select private.shred_new_public_appeal_v1(id) from private.new_public_appeal_intakes where reviewer_principal_id='${principal}' and state<>'closed'`);
      if (caseId && UUID.test(caseId)) {
        const due = await native.rpc("appeal_document_objects_due_v1", { p_limit: 1000 }).retry(false);
        if (due.error) throw new Error("Actual evidence retention unavailable");
        const rawDue: unknown = due.data;
        if (!Array.isArray(rawDue) || rawDue.some((row: unknown) => !row || typeof row !== "object"
          || Object.keys(row).join("|") !== "object_key" || typeof (row as Record<string, unknown>).object_key !== "string"))
          throw new Error("Actual evidence retention locators unavailable");
        const dueRows = rawDue as { object_key: string }[];
        const owned = JSON.parse(await reviewFixtureSql(`select coalesce(jsonb_agg(key),'[]') from (
          select object_key key from private.appeal_documents where intake_id='${caseId}'
          union select planned_object_key from private.appeal_document_sessions where intake_id='${caseId}' and planned_object_key is not null
          union select object_key from private.appeal_document_fragments where session_id in(select id from private.appeal_document_sessions where intake_id='${caseId}')) keys`)) as unknown;
        if (!Array.isArray(owned) || owned.some(key => typeof key !== "string"
          || !/^appeal-case\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}[.](?:part|pdf|jpg|png)$/u.test(key)))
          throw new Error("Actual case cleanup locators unavailable");
        const ownedKeys = owned as string[];
        const keys = [...new Set(dueRows.map(row => row.object_key).filter(key => ownedKeys.includes(key)))];
        if (keys.length) {
          if ((await native.storage.from("legal-evidence").remove(keys)).error) throw new Error("Actual evidence deletion refused");
          const confirmed = await native.rpc("confirm_appeal_document_objects_deleted_v1", { p_object_keys: keys, p_route_id: "jobs.retention" }).retry(false);
          if (confirmed.error) throw new Error("Actual evidence deletion acknowledgment refused");
        }
        expect(await reviewFixtureSql(`select count(*) from storage.objects where bucket_id='legal-evidence' and name=any(array[${ownedKeys.map(key => `'${key}'`).join(",")} ]::text[])`)).toBe("0");
        expect(await reviewFixtureSql(`select count(*) from private.appeal_document_sessions where intake_id='${caseId}' and wrapped_document_key is not null`)).toBe("0");
      }
    } finally {
      await reviewFixtureSql(`update private.new_public_appeal_reviewers set active=false where principal_id='${principal}';
        update private.new_public_appeal_config set enabled=false where singleton;`);
      await reviewerContext.close();
      await foreignContext.close();
    }
  }
}
