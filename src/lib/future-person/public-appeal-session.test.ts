import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/crypto", () => ({ hmacSecret: (value: string, context: string) => crypto.createHash("sha256").update(context + "|" + value).digest("hex") }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", async () => {
 const { createClient } = await import("@supabase/supabase-js");
 return { createAdminClient: () => createClient("https://synthetic.invalid", "synthetic-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async(input, init) => {
   const result = await rpc(new URL(String(input)).pathname.split("/").at(-1), JSON.parse(String(init?.body)));
   return Response.json(result.error ?? result.data, { status: result.error ? 400 : 200 });
  } }
 }) };
});
import crypto from "node:crypto";
import { RIGHTS_COOKIE_NAME, rightsSessionHash } from "@/lib/embryos/rights-session";
import { mintPublicFormToken } from "@/lib/embryos/operation-token";
import { loadPublicAppealSession, publicAppealCsrf, readPublicAppealMutation } from "./public-appeal-session";
const secret = "A".repeat(43); const hash = rightsSessionHash(secret);
afterEach(() => vi.unstubAllEnvs());
function request(token: string, extra: Record<string, string> = {}) { return new Request("https://inherit.bio/api/appeals/session/documents", {
 method: "POST", headers: { cookie: `${RIGHTS_COOKIE_NAME}=${secret}`, origin: "https://inherit.bio", "sec-fetch-site": "same-origin",
 "content-type": "application/json", "x-inherit-csrf": publicAppealCsrf(hash, "document"), "x-inherit-operation-nonce": token, ...extra }, body: "{}" }); }
describe("public appeal case session", () => {
 beforeEach(() => { vi.stubEnv("INHERIT_TEST_JURISDICTION", "1"); vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS", "1"); rpc.mockReset(); });
 it("binds the distinct operation to the one exact cookie and purpose", () => {
  const token = mintPublicFormToken("appeal-document", Date.now(), hash);
  expect(readPublicAppealMutation(request(token), "document", token)?.sessionHash).toBe(hash);
  expect(readPublicAppealMutation(request(token), "complete", token)).toBeNull();
  expect(readPublicAppealMutation(request(token, { cookie: `${RIGHTS_COOKIE_NAME}=${secret};${RIGHTS_COOKIE_NAME}=${secret}` }), "document", token)).toBeNull();
  expect(readPublicAppealMutation(request(token, { origin: "https://foreign.example" }), "document", token)).toBeNull();
  expect(readPublicAppealMutation(request(token, { "sec-fetch-site": "cross-site" }), "document", token)).toBeNull();
  expect(readPublicAppealMutation(request(token, { "x-inherit-csrf": "0".repeat(64) }), "document", token)).toBeNull();
 });
 it("keeps TEST default closed before a native read", async () => {
  vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS", "0");
  expect(await loadPublicAppealSession(request("unused"))).toBeNull(); expect(rpc).not.toHaveBeenCalled();
 });
 it("projects only the current case document labels and deadline, never a target", async () => {
  rpc.mockResolvedValue({ data: { caseKind: "subject-objection", deadline: "2026-11-01T00:00:00Z", documentKinds: ["appeal-photo-identity", "appeal-subject-source-control"],
   evidenceState: "collecting", completionAvailable: true, documents: [] }, error: null });
  const view = await loadPublicAppealSession(request("unused")); expect(view?.view.caseKind).toBe("subject-objection");
  expect(rpc).toHaveBeenCalledTimes(1); expect(rpc).toHaveBeenCalledWith("new_public_appeal_evidence_view_v1", { p_session_hash: hash });
  rpc.mockResolvedValue({ data: { ...view!.view, subjectId: crypto.randomUUID() }, error: null });
  expect(await loadPublicAppealSession(request("unused"))).toBeNull();
 });
});
