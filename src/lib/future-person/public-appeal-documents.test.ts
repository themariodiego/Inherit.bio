import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const native = vi.hoisted(() => ({ rpc: vi.fn(), wrapped: [] as Buffer[] }));
vi.mock("@/lib/crypto", async () => {
 const actual = await vi.importActual<typeof import("@/lib/crypto")>("@/lib/crypto");
 return { ...actual, hmacSecret: (value: string, context: string) => crypto.createHash("sha256").update(context + "|" + value).digest("hex") };
});
vi.mock("./document-envelope", async () => {
 const actual = await vi.importActual<typeof import("./document-envelope")>("./document-envelope");
 return { ...actual, newWrappedDocumentKey: () => {
  const bytes = actual.newWrappedDocumentKey(); native.wrapped.push(bytes); return bytes;
 } };
});
vi.mock("@/lib/supabase/admin", async () => {
 const { createClient } = await import("@supabase/supabase-js");
 return { createAdminClient: () => createClient("https://synthetic.invalid", "synthetic-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (input, init) => {
   const result = await native.rpc(new URL(String(input)).pathname.split("/").at(-1), JSON.parse(String(init?.body)));
   return Response.json(result.error ?? result.data, { status: result.error ? 400 : 200 });
  } }
 }) };
});
import { POST } from "@/app/api/appeals/session/documents/route";
import { publicAppealCsrf } from "./public-appeal-session";
import { EVIDENCE_COOKIE, EVIDENCE_CSRF_HEADER, EVIDENCE_COMPLETE_NONCE_HEADER } from "./evidence-session";
import { RIGHTS_COOKIE_NAME, rightsSessionHash } from "@/lib/embryos/rights-session";
import { mintPublicFormToken } from "@/lib/embryos/operation-token";
import { claimDataKey } from "./document-envelope";
const secret = "A".repeat(43), hash = rightsSessionHash(secret);
const session = "44444444-4444-4444-8444-444444444441";
const opened = () => ({ status: "open", session, documentKind: "appeal-photo-identity", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
function request(extra: Record<string, unknown> = {}, headers: Record<string, string> = {}, signal?: AbortSignal) {
 return new Request("https://inherit.bio/api/appeals/session/documents", { method: "POST", signal, headers: {
  cookie: `${RIGHTS_COOKIE_NAME}=${secret}`, origin: "https://inherit.bio", "sec-fetch-site": "same-origin", "content-type": "application/json",
  "x-inherit-csrf": publicAppealCsrf(hash, "document"), "x-inherit-operation-nonce": mintPublicFormToken("appeal-document", Date.now(), hash), ...headers,
 }, body: JSON.stringify({ documentKind: "appeal-photo-identity", mediaType: "application/pdf", sizeBytes: 5000, sha256: "b".repeat(64), ...extra }) });
}
beforeEach(() => {
 vi.stubEnv("INHERIT_TEST_JURISDICTION", "1"); vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS", "1");
 vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64")); native.rpc.mockReset(); native.wrapped.length = 0;
});
afterEach(() => vi.unstubAllEnvs());
describe("public appeal independent document sessions", () => {
 it("opens only the native case-bound session, returns credentials in headers and clears its owned wrapped key", async () => {
  native.rpc.mockResolvedValue({ data: opened(), error: null }); const response = await POST(request());
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ session, documentKind: "appeal-photo-identity", chunkBytes: 4_000_000, maximumChunks: 5,
   maximumDocumentBytes: 20_000_000, chunkRoute: `/api/evidence/${session}/chunks/{sequence}`, completeRoute: `/api/evidence/${session}/complete`, expiresAt: expect.any(String) });
  expect(native.rpc).toHaveBeenCalledOnce();
  const [name, args] = native.rpc.mock.calls[0]!; expect(name).toBe("open_public_appeal_document_v1");
  expect(Object.keys(args).sort()).toEqual(["p_cookie_hash", "p_document_kind", "p_media_type", "p_nonce", "p_session_hash", "p_sha256", "p_size_bytes", "p_wrapped_document_key"]);
  expect(args.p_session_hash).toBe(hash); expect(args.p_cookie_hash).toMatch(/^[0-9a-f]{64}$/u);
  const key = claimDataKey(String(args.p_wrapped_document_key).slice(2)); expect(key).toHaveLength(32);key.fill(0);
  expect(response.headers.get("set-cookie")).toContain(`${EVIDENCE_COOKIE}=`);
  expect(response.headers.get(EVIDENCE_CSRF_HEADER)).toMatch(/^[0-9a-f]{64}$/u);expect(response.headers.get(EVIDENCE_COMPLETE_NONCE_HEADER)).toBeTruthy();
  expect(native.wrapped).toHaveLength(1);expect(native.wrapped[0]!.every(byte => byte === 0)).toBe(true);
 });
 it.each([{ subjectId: session }, { reviewer: session }, { bucket: "legal-evidence" }, { objectKey: "synthetic/object" }, { nonce: "body-operation" }, { sizeBytes: 20_000_001 }])(
  "refuses expanded authority or bounds before native work %j", async extra => {
   expect((await POST(request(extra))).status).toBe(404);expect(native.rpc).not.toHaveBeenCalled();expect(native.wrapped).toHaveLength(0);
  });
 it("does not relabel another native document kind", async () => {
  native.rpc.mockResolvedValue({ data: { ...opened(), documentKind: "appeal-genetic-parent-authority" }, error: null });
  expect((await POST(request())).status).toBe(503);expect(native.rpc).toHaveBeenCalledOnce();expect(native.wrapped[0]!.every(byte => byte === 0)).toBe(true);
 });
 it("does not adopt an unknown native commit or retry a failed transport", async () => {
  native.rpc.mockRejectedValue(new Error("synthetic lost response")); const response = await POST(request());
  expect(response.status).toBe(503);expect(await response.json()).toEqual({ error: "unavailable" });
  expect(native.rpc).toHaveBeenCalledOnce();expect(native.wrapped[0]!.every(byte => byte === 0)).toBe(true);
 });
 it("keeps the default TEST scope closed before native or key work", async () => {
  vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS", "0");expect((await POST(request())).status).toBe(404);
  expect(native.rpc).not.toHaveBeenCalled();expect(native.wrapped).toHaveLength(0);
 });
 it("refuses an already aborted caller before invoking the cold native builder", async () => {
  const controller = new AbortController();controller.abort();expect((await POST(request({}, {}, controller.signal))).status).toBe(503);
  expect(native.rpc).not.toHaveBeenCalled();expect(native.wrapped).toHaveLength(0);
 });
});
