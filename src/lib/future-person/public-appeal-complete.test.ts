import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", async () => {
 const { createClient } = await import("@supabase/supabase-js");
 return { createAdminClient: () => createClient("https://synthetic.invalid", "synthetic-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (input, init) => {
   const result = await rpc(new URL(String(input)).pathname.split("/").at(-1), JSON.parse(String(init?.body)));
   return Response.json(result.error ?? result.data, { status: result.error ? 400 : 200 });
  } }
 }) };
});
vi.mock("@/lib/crypto", () => ({ hmacSecret: (value: string, context: string) => crypto.createHash("sha256").update(context + "|" + value).digest("hex") }));
import { POST } from "@/app/api/appeals/session/complete/route";
import { publicAppealCsrf } from "./public-appeal-session";
import { RIGHTS_COOKIE_NAME, rightsSessionHash } from "@/lib/embryos/rights-session";
import { mintPublicFormToken } from "@/lib/embryos/operation-token";
const secret = "A".repeat(43), hash = rightsSessionHash(secret);
const photo = "44444444-4444-4444-8444-444444444441", authority = "44444444-4444-4444-8444-444444444442";
const deadline = new Date(Date.now() + 30 * 86_400_000).toISOString();
const foreignHeaders: Record<string, string>[] = [
 { origin: "https://foreign.example" }, { "sec-fetch-site": "cross-site" }, { cookie: `${RIGHTS_COOKIE_NAME}=${secret};${RIGHTS_COOKIE_NAME}=${secret}` },
];
function request(extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
 return new Request("https://inherit.bio/api/appeals/session/complete", { method: "POST", headers: {
  cookie: `${RIGHTS_COOKIE_NAME}=${secret}`, origin: "https://inherit.bio", "sec-fetch-site": "same-origin", "content-type": "application/json",
  "x-inherit-csrf": publicAppealCsrf(hash, "complete"), ...headers,
 }, body: JSON.stringify({ photoIdentityDocumentId: photo, subjectSourceControlDocumentId: authority,
  affirmed: true, nonce: mintPublicFormToken("appeal-complete", Date.now(), hash), ...extra }) });
}
beforeEach(() => { vi.stubEnv("INHERIT_TEST_JURISDICTION", "1"); vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS", "1"); rpc.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
describe("public appeal evidence submission", () => {
 it("submits only the exact handles and returns the closed named-review receipt", async () => {
  rpc.mockResolvedValue({ data: { status: "review_pending", deadline }, error: null });
  const response = await POST(request()); expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ status: "review_pending", deadline });
  expect(rpc).toHaveBeenCalledOnce(); expect(rpc).toHaveBeenCalledWith("complete_new_public_appeal_evidence_v1", {
   p_session_hash: hash, p_nonce: expect.stringMatching(/^[A-Za-z0-9_-]+$/u), p_documents: { photoIdentityDocumentId: photo, subjectSourceControlDocumentId: authority }, p_affirmed: true,
  }); expect(response.headers.get("cache-control")).toContain("no-store");expect(response.headers.get("referrer-policy")).toBe("no-referrer");
 });
 it.each([{ subjectId: photo }, { reviewer: authority }, { kind: "access-or-review-appeal" }, { approved: true }, { affirmed: false }, { nonce: "wrong-purpose" }])(
  "refuses added or invalid authority %j before native work", async extra => {
   const response = await POST(request(extra)); expect(response.status).toBe(404);expect(rpc).not.toHaveBeenCalled();
  });
 it("keeps access-review completion closed instead of inventing an underlying kind", async () => {
  const response = await POST(request({ decisionNoticeDocumentId: authority, underlyingRightsDocumentId: photo }));
  expect(response.status).toBe(404);expect(rpc).not.toHaveBeenCalled();
 });
 it.each(foreignHeaders)(
  "refuses a foreign or ambiguous credential %j", async headers => {
   expect((await POST(request({}, headers))).status).toBe(404);expect(rpc).not.toHaveBeenCalled();
  });
 it("keeps generation/config closed before any mutation", async () => {
  vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS", "0");expect((await POST(request())).status).toBe(404);expect(rpc).not.toHaveBeenCalled();
 });
 it("does not adopt a lost response or expose a native failure", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "synthetic private source detail" } });
  const response = await POST(request());expect(response.status).toBe(404);expect(await response.json()).toEqual({ error: "not_found" });expect(rpc).toHaveBeenCalledOnce();
 });
 it("refuses an expanded success projection instead of leaking its target", async () => {
  rpc.mockResolvedValue({ data: { status: "review_pending", deadline, subjectId: photo }, error: null });
  expect((await POST(request())).status).toBe(503);expect(rpc).toHaveBeenCalledOnce();
 });
});
