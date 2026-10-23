import { expect, test } from "./audited-test";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import path from "node:path";
import { adminClient, createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFilePrepared } from "./own-report-helpers";
import { SUBJECT_EXPORT_HEADING } from "../src/copy/subjects/subject-export";

/**
 * api.subject-export (POST/GET /api/subjects/[id]/export), owner decision of
 * 16 October 2026: the one-record export ships first and refuses, with the
 * stated reason `jointResults`, while the record has live joint results.
 * Step two (20261023100000_subject_export_joint_results.sql) exports a family
 * pair and a live-permission Portrait result; a family conversation on the
 * record and a live embryo cohort role still refuse with that reason.
 *
 * TEST-LOCAL with production OFF and no provider: this deployment has no
 * archive generation capability (the TEST R2 step runs only in
 * provider-qualified CI), so no job is ever created here and the settings
 * page shows no one-record action. What runs is the real route, proxy and
 * database: the record door, the stated refusal computed from the live
 * database, the opaque not-found answers and the closed request checks. The
 * TEST R2 producer, completion and delivery are covered by
 * supabase/tests/subject_export.sql and src/lib/exports/account-archive-worker.test.ts.
 *
 * The owner uploads one real file first. The owner-planted rows are a synthetic `family_pairs` row between two
 * synthetic accounts' own records and, on it, one synthetic canonical family conversation turn for each account,
 * all removed again before the test ends.
 */
const RUN = randomUUID();
const OWNER = { email: `subject-export-${RUN}@e2e.local`, password: "e2e-subject-export-pw" };
const OTHER = { email: `subject-export-other-${RUN}@e2e.local`, password: "e2e-subject-export-other-pw" };
let ownerSelf = "";
let otherSelf = "";
let ownerAccount = "";
let otherAccount = "";

async function selfSubject(accountId: string): Promise<string> {
  const { data, error } = await adminClient().from("subjects").select("id")
    .eq("subject_account_id", accountId).eq("subject_class", "self").eq("lifecycle", "active").single();
  expect(error).toBeNull();
  return (data as { id: string }).id;
}

/** A same-origin browser request from the signed-in page; the page reads every body itself. */
async function call(page: Page, path: string, init: { method: "GET" | "POST"; body?: unknown; csrf?: string }) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, {
      method: init.method, cache: "no-store", credentials: "same-origin", redirect: "error",
      headers: init.method === "POST" ? { "Content-Type": "application/json", "X-Inherit-CSRF": init.csrf ?? "forged" } : undefined,
      body: init.method === "POST" ? JSON.stringify(init.body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, referrer: response.headers.get("referrer-policy"), setCookie: response.headers.has("set-cookie"),
      bytes: new TextEncoder().encode(text).byteLength, body: text ? JSON.parse(text) : null };
  }, { path, init });
}

test.beforeAll(async () => {
  ownerAccount = await createConfirmedUser(OWNER.email, OWNER.password);
  otherAccount = await createConfirmedUser(OTHER.email, OTHER.password);
  ownerSelf = await selfSubject(ownerAccount);
  otherSelf = await selfSubject(otherAccount);
});

test("api.subject-export answers the record door, the stated joint-results refusal and opaque not-found, with no job and no provider", async ({ page }) => {
  test.setTimeout(420_000);
  await signIn(page, OWNER.email, OWNER.password);
  // A real own upload through the browser and the private Storage proxy, so
  // the record the export captures has its one ordinary file.
  const fileId = await uploadOwnFilePrepared(page, path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"), { fileType: "vcf" });
  const stored = await adminClient().from("genome_files").select("subject_id").eq("id", fileId).single();
  expect(stored.error).toBeNull();
  expect((stored.data as { subject_id: string }).subject_id).toBe(ownerSelf);
  const route = `/api/subjects/${ownerSelf}/export`;
  const create = { operation: "create", nonce: "not-a-presented-nonce" };

  // The caller's own record passes the record door; a forged CSRF proof is then refused.
  const eligible = await call(page, route, { method: "POST", body: create });
  expect(eligible).toMatchObject({ status: 403, body: { error: "request_forbidden" }, setCookie: false, referrer: "no-referrer" });

  // Polling without the record's own cookie is resource-not-found-v1 and creates nothing.
  const poll = await call(page, route, { method: "GET" });
  expect(poll).toMatchObject({ status: 404, body: { error: "not_found" }, setCookie: false, referrer: "no-referrer" });

  // Another person's record, an unknown record and a malformed id: the same opaque answer, before field validation.
  for (const path of [`/api/subjects/${otherSelf}/export`, `/api/subjects/${randomUUID()}/export`, "/api/subjects/not-a-record/export"]) {
    expect(await call(page, path, { method: "POST", body: { anything: true } }), path)
      .toMatchObject({ status: 404, body: { error: "not_found" }, setCookie: false });
  }

  // A live family pair alone is the record's history, not a joint result: the record passes the door.
  const admin = adminClient();
  const planted = await admin.from("family_pairs").insert({ subject_a_id: ownerSelf, subject_b_id: otherSelf, status: "pending" }).select("id").single();
  expect(planted.error).toBeNull();
  const pairId = (planted.data as { id: string }).id;
  const chatIds: string[] = [];
  try {
    expect(await call(page, route, { method: "POST", body: create }))
      .toMatchObject({ status: 403, body: { error: "request_forbidden" }, setCookie: false, referrer: "no-referrer" });
    // A family conversation on the pair, one turn for each account: the closed
    // stated refusal, before the body or CSRF is read.
    for (const account of [ownerAccount, otherAccount]) {
      const chat = await admin.from("chats").insert({ user_id: account, scope_kind: "family", family_pair_id: pairId, lifecycle_revision: 1,
        provider_classification: "local", runtime_attestation_revision: 1, model_recipient_revision: 1,
        authorization_fingerprint: "d".repeat(64), legacy_unverified: false }).select("id").single();
      expect(chat.error).toBeNull();
      const chatId = (chat.data as { id: string }).id;
      chatIds.push(chatId);
      const turn = await admin.from("chat_messages").insert({ chat_id: chatId, user_id: account, role: "user", content: { text: "synthetic" },
        turn_id: randomUUID(), turn_ordinal: 1, paired_role: "user", scope_revision: 1, authorization_fingerprint: "d".repeat(64),
        provider_classification: "local", runtime_attestation_revision: 1, model_recipient_revision: 1, legacy_unverified: false });
      expect(turn.error).toBeNull();
    }
    for (const body of [create, { malformed: true }]) {
      expect(await call(page, route, { method: "POST", body }))
        .toMatchObject({ status: 422, body: { error: "invalid_request", issues: ["jointResults"] }, setCookie: false, referrer: "no-referrer" });
    }
    // The other contributor's own export is refused for the same reason.
    const other = await page.context().browser()!.newContext();
    try {
      const otherPage = await other.newPage();
      await signIn(otherPage, OTHER.email, OTHER.password);
      expect(await call(otherPage, `/api/subjects/${otherSelf}/export`, { method: "POST", body: create }))
        .toMatchObject({ status: 422, body: { error: "invalid_request", issues: ["jointResults"] } });
    } finally { await other.close(); }
  } finally {
    if (chatIds.length > 0) {
      const removedChats = await admin.from("chats").delete().in("id", chatIds);
      expect(removedChats.error).toBeNull();
    }
    const removed = await admin.from("family_pairs").delete().eq("id", pairId);
    expect(removed.error).toBeNull();
  }

  // Once the conversation and the pair are gone the record passes the door again.
  expect(await call(page, route, { method: "POST", body: create })).toMatchObject({ status: 403, body: { error: "request_forbidden" } });

  // No job, export row or download session was created for either record.
  const exports = await admin.from("generated_exports").select("id", { count: "exact", head: true }).in("target_id", [ownerSelf, otherSelf]);
  expect(exports.error).toBeNull();
  expect(exports.count).toBe(0);

  // Without a generation capability the settings page offers no one-record action, as for the account export.
  expect((await page.goto("/settings/data"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();
  await expect(page.getByRole("heading", { name: SUBJECT_EXPORT_HEADING })).toHaveCount(0);
  await expect(page.locator('[data-slot="account-export-control"]')).toHaveCount(1);
});
