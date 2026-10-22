import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { BrowserContext, Page, Request as BrowserRequest } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { z } from "zod";
import { SHARED_RECEIPT_PROJECT, type NativeParentDeletionReceipt } from "../../scripts/tools/claimed-provenance-fixture";
import { ANON_KEY, SUPABASE_URL } from "../helpers";
import { observeNativeResponses } from "./native-response-observer";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const nativeResponse = z.object({ status: z.literal("notice_period"), noticeEndsAt: z.string().datetime({ offset: true }) }).strict();

/** Quiet exact metadata lookup. No Auth token, contact, signed nonce or native
 * error payload leaves stdin or reaches a receipt/error/log. */
function ownerMetadata(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", `supabase_db_${SHARED_RECEIPT_PROJECT}`, "psql", "-XAtq",
      "--set=ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = []; let bytes = 0, finished = false;
    const finish = (value?: string) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (value === undefined) reject(new Error("Exact native parent receipt unavailable")); else resolve(value);
    };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(); }, 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 65_536) { child.kill("SIGKILL"); finish(); } else chunks.push(chunk);
    });
    child.stderr.on("data", () => { /* Preserve only the fixed refusal code. */ });
    child.once("error", () => finish()); child.stdin.once("error", () => finish());
    child.once("close", code => finish(code === 0 ? Buffer.concat(chunks).toString("utf8").trim() : undefined));
    child.stdin.end(`begin read only; set local statement_timeout='15s'; set local lock_timeout='2s';\n${sql};\nrollback;\n`);
  });
}

/** The real current page issues its own operation nonce; the untouched native
 * POST verifies and consumes it. This proves current issuance/request only.
 * It cannot establish elapsed seven days, mail delivery or disposal authority. */
export async function requestNativeParentDeletion(page: Page, context: BrowserContext, expectedAccount: string): Promise<NativeParentDeletionReceipt> {
  assert(UUID.test(expectedAccount), "Expected synthetic owner UUID");
  const config = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");
  assert.equal(config.match(/^project_id = "([A-Za-z0-9_-]+)"$/mu)?.[1], SHARED_RECEIPT_PROJECT,
    "Only the root-owned synthetic runtime may issue this request");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: new URL("../..", import.meta.url), encoding: "utf8" }).trim();
  assert(/^[0-9a-f]{40}$/u.test(sourceCommit));
  assert.equal(new URL(page.url()).origin, "http://127.0.0.1:3105", "Use the registered isolated native app");
  const apiPort = config.match(/^\[api\][\s\S]*?^port = (\d+)$/mu)?.[1];
  assert(apiPort && SUPABASE_URL === `http://127.0.0.1:${apiPort}`, "Auth must use the exact owned project");
  const cookies = await context.cookies();
  const auth = createServerClient(SUPABASE_URL, ANON_KEY, { cookies: { getAll: () => cookies,
    setAll: () => { throw new Error("Native account request must use the existing fresh session"); } } });
  const current = await auth.auth.getClaims();
  if (current.error || !current.data || current.data.claims.sub !== expectedAccount
    || current.data.claims.role !== "authenticated" || typeof current.data.claims.session_id !== "string"
    || !UUID.test(current.data.claims.session_id)) throw new Error("Actual parent authentication unavailable");
  const session = current.data.claims.session_id;
  await page.goto("/settings/data");
  const observer = await observeNativeResponses(page, { deletion: "^/api/account/delete$" });
  let count = 0, nonceHash: string | undefined;
  const observeRequest = (request: BrowserRequest) => {
    const url = new URL(request.url());
    if (request.method() !== "POST" || url.origin !== "http://127.0.0.1:3105" || url.pathname !== "/api/account/delete" || url.search) return;
    count += 1;
    let body: Record<string, unknown>;
    try { body = request.postDataJSON() as Record<string, unknown>; } catch { return; }
    if (!body || Object.keys(body).sort().join(",") !== "confirmation,nonce"
      || body.confirmation !== "account.delete.confirmation" || typeof body.nonce !== "string") return;
    nonceHash = createHash("sha256").update(body.nonce).digest("hex");
  };
  page.on("request", observeRequest);
  try {
    await page.getByLabel(/Type/u).fill("delete my genome");
    await page.getByTestId("delete-account").click();
    const response = await observer.read("deletion");
    assert.equal(response.status, 202, "Native owner request must actually succeed");
    const result = nativeResponse.parse(JSON.parse(response.text));
    assert.equal(count, 1, "Exactly one untouched native POST must occur");
    assert(nonceHash && /^[0-9a-f]{64}$/u.test(nonceHash), "The native request nonce must be observed");
    await page.getByRole("heading", { name: "Account deletion scheduled", exact: true }).waitFor();
    const metadata = JSON.parse(await ownerMetadata(`select jsonb_build_object('deletionId',d.id,
      'requestedAt',d.requested_at,'noticeEndsAt',d.notice_ends_at) from public.account_deletion_requests d
      join public.account_operation_nonces n on n.account_id=d.account_id and n.operation='account_delete'
        and n.session_id='${session}'::uuid and n.nonce_hash='${nonceHash}' and n.consumed_at is not null
      where d.account_id='${expectedAccount}'::uuid and d.state='notice_period'
        and d.notice_ends_at='${result.noticeEndsAt}'::timestamptz
        and d.notice_ends_at=d.requested_at+interval '7 days'`)) as Record<string, unknown>;
    const parsed = z.object({ deletionId: z.string().regex(UUID), requestedAt: z.string(), noticeEndsAt: z.string() }).strict().parse(metadata);
    assert.equal(Date.parse(parsed.noticeEndsAt), Date.parse(result.noticeEndsAt));
    return Object.freeze({ version: "claimed-provenance-native-parent-request-v1", projectId: SHARED_RECEIPT_PROJECT,
      sourceCommit, accountId: expectedAccount, authSessionId: session, deletionId: parsed.deletionId,
      nonceHash, requestedAt: parsed.requestedAt, noticeEndsAt: parsed.noticeEndsAt });
  } finally { page.off("request", observeRequest); await observer.dispose(); }
}
