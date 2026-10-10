import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const source = vi.hoisted(() => ({ rpc: vi.fn(), claims: true, appeals: true }));
const id = (n: number) => `84000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const account = { user: { id: id(8) }, sessionId: id(9) };
vi.mock("@/lib/account-deletion", () => ({ getSensitiveAccountContext: async () => account }));
vi.mock("@/lib/future-person/claims-open", () => ({ futurePersonClaimsOpen: () => source.claims }));
vi.mock("@/lib/future-person/appeals-open", () => ({ testAppealIntakeOpen: () => source.appeals }));
vi.mock("@/lib/supabase/server", async () => {
 const { createClient } = await import("@supabase/supabase-js");
 return { createClient: async () => createClient("https://synthetic.invalid", "own-synthetic-jwt", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (input, init) => {
   const result = await source.rpc(new URL(String(input)).pathname.split("/").at(-1), JSON.parse(String(init?.body)));
   return Response.json(result.error ?? result.data, { status: result.error ? 400 : 200 });
  } },
 }) };
});
import { GET } from "@/app/api/legal-evidence/[id]/review-download/route";
import { POST as acknowledge } from "@/app/api/downloads/[session]/chunks/[sequence]/acknowledge/route";
import { downloadCookie, downloadCookieHash } from "./review";
import { mintReceiptAckNonce, receiptCsrf } from "./review-receipt";
beforeEach(() => { vi.clearAllMocks(); source.claims = true; source.appeals = true; vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 83).toString("base64")); });
afterEach(() => vi.unstubAllEnvs());
const request = () => new Request(`https://inherit.bio/api/legal-evidence/${id(4)}/review-download`, { headers: { "sec-fetch-site": "same-origin" } });
describe("review download respects independent native domains before insertion", () => {
 it.each(["claim", "appeal"])("opens a current enabled %s document after native classification", async domain => {
  source.rpc.mockResolvedValueOnce({ data: domain, error: null }).mockResolvedValueOnce({ data: { session: id(5), sizeBytes: 32, sha256: "a".repeat(64),
   chunkCount: 1, mediaType: "application/pdf", documentKind: domain === "appeal" ? "appeal-photo-identity" : "future-photo-identity" }, error: null });
  const response = await GET(request(), { params: Promise.resolve({ id: id(4) }) });
  expect(response.status).toBe(200); expect(source.rpc.mock.calls.map(call => call[0])).toEqual(["review_document_domain_v1", "open_claim_review_download_v1"]);
  expect(response.headers.get("set-cookie")).toBeTruthy();
 });
 it.each(["claim", "appeal"])("cannot mint a %s session while only the other domain is enabled", async domain => {
  source.claims = domain !== "claim"; source.appeals = domain !== "appeal"; source.rpc.mockResolvedValue({ data: domain, error: null });
  expect((await GET(request(), { params: Promise.resolve({ id: id(4) }) })).status).toBe(404);
  expect(source.rpc.mock.calls.map(call => call[0])).toEqual(["review_document_domain_v1"]);
 });
 it.each([null, "foreign-domain"])("refuses absent or unknown native classification %s", async domain => {
  source.rpc.mockResolvedValue({ data: domain, error: null });
  expect((await GET(request(), { params: Promise.resolve({ id: id(4) }) })).status).toBe(404);
  expect(source.rpc).toHaveBeenCalledTimes(1);
 });
 it("refuses foreign native authority without invoking the session writer", async () => {
  source.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  expect((await GET(request(), { params: Promise.resolve({ id: id(4) }) })).status).toBe(404); expect(source.rpc).toHaveBeenCalledTimes(1);
 });
 it("refuses a different returned document domain even after a valid classification", async () => {
  source.rpc.mockResolvedValueOnce({ data: "claim", error: null }).mockResolvedValueOnce({ data: { session: id(5), sizeBytes: 32,
   sha256: "a".repeat(64), chunkCount: 1, mediaType: "application/pdf", documentKind: "appeal-photo-identity" }, error: null });
  const response = await GET(request(), { params: Promise.resolve({ id: id(4) }) }); expect(response.status).toBe(404); expect(response.headers.get("set-cookie")).toBeNull();
 });
});
function ackRequest() {
 const cookie = downloadCookie("A".repeat(43)).split(";")[0]!;
 const hash = downloadCookieHash(new Request("https://inherit.bio", { headers: { cookie } }))!;
 return new Request(`https://inherit.bio/api/downloads/${id(5)}/chunks/0/acknowledge`, { method: "POST", headers: {
  origin: "https://inherit.bio", "sec-fetch-site": "same-origin", "content-type": "application/json", cookie,
  "x-inherit-csrf": receiptCsrf(id(5), hash, account.user.id, account.sessionId),
 }, body: JSON.stringify({ proof: "a".repeat(64), nonce: mintReceiptAckNonce(id(5), 0, hash, account.user.id, account.sessionId) }) });
}
describe("ACK keeps fresh native transport and independent feature scope", () => {
 it.each(["claim", "appeal"])("settles a current enabled %s ACK only after reauthorization", async domain => {
  source.rpc.mockResolvedValueOnce({ data: domain === "appeal" ? { transport: "appeal" } : {}, error: null }).mockResolvedValueOnce({ data: null, error: null });
  expect((await acknowledge(ackRequest(), { params: Promise.resolve({ session: id(5), sequence: "0" }) })).status).toBe(204);
  expect(source.rpc.mock.calls.map(call => call[0])).toEqual(["authorize_claim_review_chunk_v1", "acknowledge_claim_review_chunk_v1"]);
 });
 it.each(["claim", "appeal"])("refuses a closed %s ACK without recording it", async domain => {
  source.claims = domain !== "claim"; source.appeals = domain !== "appeal";
  source.rpc.mockResolvedValue({ data: domain === "appeal" ? { transport: "appeal" } : {}, error: null });
  expect((await acknowledge(ackRequest(), { params: Promise.resolve({ session: id(5), sequence: "0" }) })).status).toBe(404); expect(source.rpc).toHaveBeenCalledTimes(1);
 });
 it("refuses unknown transport and native revocation before ACK", async () => {
  source.rpc.mockResolvedValueOnce({ data: { transport: "foreign" }, error: null });
  expect((await acknowledge(ackRequest(), { params: Promise.resolve({ session: id(5), sequence: "0" }) })).status).toBe(404);
  source.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
  expect((await acknowledge(ackRequest(), { params: Promise.resolve({ session: id(5), sequence: "0" }) })).status).toBe(404);
  expect(source.rpc.mock.calls.every(call => call[0] === "authorize_claim_review_chunk_v1")).toBe(true);
 });
});
