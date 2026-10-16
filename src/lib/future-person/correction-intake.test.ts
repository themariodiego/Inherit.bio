import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ rpc: vi.fn() }));
const transport = vi.hoisted(() => ({ signals: [] as (AbortSignal | null | undefined)[] }));
vi.mock("@/lib/supabase/admin", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { createAdminClient: () => createClient("https://synthetic.invalid", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      transport.signals.push(init?.signal);
      const result = await native.rpc(new URL(String(input)).pathname.split("/").at(-1), JSON.parse(String(init?.body)));
      return Response.json(result.error ?? result.data, { status: result.error ? 400 : 200 });
    } },
  }) };
});
import { POST } from "@/app/api/future-person/claim/session/corrections/route";
import { claimantCsrf, loadClaimantRights } from "./rights";
import { RIGHTS_COOKIE_NAME, rightsSessionHash } from "@/lib/embryos/rights-session";
import { mintCorrectionIntakeNonce, readCorrectionIntakeNonce } from "./correction-intake-nonce";
import { correctionField, openNewCorrection } from "./correction-case-envelope";
import { sealClaimantContact, openMailContact } from "./claimant-contact";
import { appealKeyedDigests } from "./appeal-keyed-digests";
const id = (n: number) => `85000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const secret = Buffer.alloc(32, 72).toString("base64url"), session = rightsSessionHash(secret), cookie = `${RIGHTS_COOKIE_NAME}=${secret}`;
const statement = "This is the complete synthetic original correction statement.";
const safeView = { safeClaimedSubjectLabel: "Your claimed record", lifecycleState: "claimed_unbound", retentionMaximumDays: null, allowedActionIds: ["correct"] };
function request(body: unknown, extra: Record<string, string> = {}, query = "") {
  return new Request(`https://synthetic.invalid/api/future-person/claim/session/corrections${query}`, { method: "POST",
    headers: { "content-type": "application/json", cookie, origin: "https://synthetic.invalid", "sec-fetch-site": "same-origin", "x-inherit-csrf": claimantCsrf(session), ...extra },
    body: typeof body === "string" ? body : JSON.stringify(body) });
}
function body(field = "display-label") { return { field, statement, nonce: mintCorrectionIntakeNonce(session) }; }
function frame(field = "display-label") {
  const contactHex = sealClaimantContact(id(90), "synthetic@example.test").slice(2), bytes = Buffer.from(contactHex, "hex");
  try {
    const scope = { version: 1, caseKind: "correction", caseId: id(1), originalAuthorPrincipalId: id(2), initialStatementRevision: 1,
      originalSubmittedAt: "2026-10-05T12:00:00.000Z", originalDeadline: "2026-11-04T12:00:00.000Z", requestedField: field, originalSubjectId: id(3) };
    return { native: { scope, rightsSessionId: id(4), authorityRevision: 2, tokenHashId: id(5), reviewerPrincipalId: id(6), reviewerPrincipalRevision: 3,
      assignmentRevision: 1, sourceContactReferenceId: id(7), sourceContactFingerprint: crypto.createHash("sha256").update(bytes).digest("hex"), caseContactId: id(8) },
      selected: { caseContactId: id(8), sourceContactCiphertextHex: contactHex } };
  } finally { bytes.fill(0); }
}
beforeEach(() => {
  native.rpc.mockReset(); transport.signals.length = 0;
  vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 73).toString("base64")); vi.stubEnv("INHERIT_HMAC_KEYRING", "");
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1"); vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS", "1");
});
afterEach(() => vi.unstubAllEnvs());
// SOURCE ONLY / UNRUN. Genuine codec/client/route, synthetic native responses.
// No database writes, reviewer authority, delivery or disposal are proved.
describe("genuine correction intake stays bound to native claimant authority", () => {
  it.each(correctionField.options)("seals the full %s statement and returns only the exact committed receipt", async field => {
    const input = body(field), prepared = frame(field), nonce = readCorrectionIntakeNonce(input.nonce, session);
    native.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "prepare_new_correction_v1") { expect(args).toEqual({ p_session_hash: session, p_nonce: nonce, p_field: field }); return { data: prepared.native, error: null }; }
      if (name === "read_new_correction_intake_contact_v1") { expect(args).toEqual({ p_session_hash: session, p_nonce: nonce, p_expected: prepared.native }); return { data: prepared.selected, error: null }; }
      if (name === "commit_new_correction_v1") return { data: { status: "review_pending", correctionId: id(1) }, error: null };
      throw new Error("unexpected operation");
    });
    const response = await POST(request(input)); expect(response.status).toBe(202); expect(await response.json()).toEqual({ status: "review_pending", correctionId: id(1) });
    expect(native.rpc.mock.calls.map(call => call[0])).toEqual(["prepare_new_correction_v1", "read_new_correction_intake_contact_v1", "commit_new_correction_v1"]);
    const commit = native.rpc.mock.calls[2]![1] as Record<string, unknown>;
    expect(commit.p_expected).toEqual(prepared.native); expect(commit.p_nonce).toBe(nonce); expect(commit.p_session_hash).toBe(session);
    const hex = (key: string) => { const value = commit[key]; expect(typeof value).toBe("string"); const text = String(value); expect(text.startsWith("\\x")).toBe(true); return text.slice(2); };
    expect(openNewCorrection(prepared.native.scope, { format: "reviewer-only-case-statement-v1", statementCiphertextHex: hex("p_statement"),
      workingCiphertextHex: hex("p_working"), wrappedCaseKeyHex: hex("p_wrapped_key") })).toBe(statement);
    const contactBytes = Buffer.from(hex("p_contact_cipher"), "hex");
    try { expect(openMailContact(contactBytes)).toBe("synthetic@example.test"); } finally { contactBytes.fill(0); }
    expect(commit.p_contact_hmac_set).toEqual(appealKeyedDigests("contact", "synthetic@example.test"));
    expect(JSON.stringify(commit)).not.toContain(statement); expect(JSON.stringify(commit)).not.toContain("synthetic@example.test");
    expect(transport.signals).toHaveLength(3); expect(transport.signals.every(signal => signal === transport.signals[0])).toBe(true);
    expect(transport.signals[0]?.aborted).toBe(true); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/u);
  });
  it("refuses either closed TEST flag before reading the body or starting a native call", async () => {
    for (const key of ["INHERIT_TEST_JURISDICTION", "INHERIT_TEST_REQUESTER_STATEMENTS"]) {
      vi.stubEnv(key, "0"); const req = request(body()), response = await POST(req); expect(response.status).toBe(404);
      expect(req.bodyUsed).toBe(false);
      expect(native.rpc).not.toHaveBeenCalled(); vi.stubEnv(key, "1");
    }
  });
  it("refuses cross-origin, duplicate cookie, bad CSRF, crossed session and URL selectors before RPC", async () => {
    const headers: Record<string, string>[] = [{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "cross-site" }, { cookie: `${cookie}; ${cookie}` },
      { "x-inherit-csrf": "f".repeat(64) }, { cookie: `${RIGHTS_COOKIE_NAME}=${Buffer.alloc(32, 74).toString("base64url")}` }];
    for (const extra of headers) expect((await POST(request(body(), extra))).status).toBe(404);
    expect((await POST(request(body(), {}, "?subjectId=forbidden"))).status).toBe(404); expect(native.rpc).not.toHaveBeenCalled();
  });
  it("refuses unknown selectors, duplicate keys, lone surrogates and invalid field/prose", async () => {
    const input = body();
    for (const value of [{ ...input, subjectId: id(10) }, { ...input, field: "genotype" }, { ...input, statement: "too short" }, { ...input, statement: "a".repeat(4001) },
      { ...input, statement: `${statement}\ud800` }, JSON.stringify(input).replace('"field":"display-label"', '"field":"display-label","field":"report-provenance"')]) {
      expect((await POST(request(value))).status).toBe(422);
    }
    expect(native.rpc).not.toHaveBeenCalled();
  });
  it("refuses unbound native preparation and a field mismatch without claiming an accepted case", async () => {
    native.rpc.mockResolvedValue({ data: null, error: { code: "55000" } }); expect((await POST(request(body()))).status).toBe(404);
    expect(native.rpc).toHaveBeenCalledTimes(1); native.rpc.mockClear();
    native.rpc.mockResolvedValue({ data: frame("report-provenance").native, error: null }); expect((await POST(request(body()))).status).toBe(404);
    expect(native.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not commit an incorrect selected contact identity or fingerprint", async () => {
    const prepared = frame();
    for (const selected of [{ ...prepared.selected, caseContactId: id(99) }, { ...prepared.selected, sourceContactCiphertextHex: "ab".repeat(29) }]) {
      native.rpc.mockReset(); native.rpc.mockResolvedValueOnce({ data: prepared.native, error: null }).mockResolvedValueOnce({ data: selected, error: null });
      expect((await POST(request(body()))).status).toBe(503); expect(native.rpc.mock.calls.map(call => call[0])).toEqual(["prepare_new_correction_v1", "read_new_correction_intake_contact_v1"]);
    }
  });
  it("refuses a missing, foreign or widened commit receipt after exactly one commit", async () => {
    const prepared = frame();
    for (const receipt of [null, { status: "review_pending", correctionId: id(99) }, { status: "review_pending", correctionId: id(1), statement }]) {
      native.rpc.mockReset(); native.rpc.mockResolvedValueOnce({ data: prepared.native, error: null }).mockResolvedValueOnce({ data: prepared.selected, error: null }).mockResolvedValueOnce({ data: receipt, error: null });
      expect((await POST(request(body()))).status).toBe(503); expect(native.rpc).toHaveBeenCalledTimes(3);
    }
  });
  it("does not return an accepted receipt when request abort leaves the real commit pending", async () => {
    const prepared = frame(), abort = new AbortController(); let resolve!: (value: unknown) => void;
    const pending = new Promise(done => { resolve = done; });
    native.rpc.mockResolvedValueOnce({ data: prepared.native, error: null }).mockResolvedValueOnce({ data: prepared.selected, error: null })
      .mockImplementationOnce(() => { abort.abort(); return pending; });
    const original = request(body()), req = new Request(original, { signal: abort.signal });
    expect((await POST(req)).status).toBe(503); expect(native.rpc).toHaveBeenCalledTimes(3);
    resolve({ data: { status: "review_pending", correctionId: id(1) }, error: null });
    for (let index = 0; index < 20; index++) await Promise.resolve();
  });
});

describe("correction GET mints only after the actual read-only permitted rights view", () => {
  it("reads one native view and returns a stateless session-bound nonce without preparation", async () => {
    native.rpc.mockResolvedValue({ data: safeView, error: null });
    const loaded = await loadClaimantRights(new Request("https://synthetic.invalid/withdraw/session", { headers: { cookie } }));
    expect(loaded?.correctionNonce).toEqual(expect.any(String)); expect(readCorrectionIntakeNonce(loaded!.correctionNonce!, session)).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    expect(native.rpc.mock.calls).toEqual([["future_person_rights_view_v1", { p_session_hash: session }]]);
  });
  it("returns no correction token for another purpose or denied native authority", async () => {
    native.rpc.mockResolvedValue({ data: { ...safeView, allowedActionIds: ["analysis-stop"] }, error: null });
    expect((await loadClaimantRights(new Request("https://synthetic.invalid/withdraw/session", { headers: { cookie } })))?.correctionNonce).toBeNull();
    native.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(await loadClaimantRights(new Request("https://synthetic.invalid/withdraw/session", { headers: { cookie } }))).toBeNull();
  });
  it("preserves the existing closed-flag safe read and offers no correction form token", async () => {
    vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS", ""); native.rpc.mockResolvedValue({ data: safeView, error: null });
    const loaded = await loadClaimantRights(new Request("https://synthetic.invalid/withdraw/session", { headers: { cookie } }));
    expect(loaded?.correctionNonce).toBeNull(); expect(native.rpc.mock.calls).toEqual([["future_person_rights_view_v1", { p_session_hash: session }]]);
  });
  it("mints no token after an aborted actual rights read that settles later", async () => {
    const abort = new AbortController(); let resolve!: (value: unknown) => void;
    const pending = new Promise(done => { resolve = done; });
    native.rpc.mockImplementationOnce(() => { abort.abort(); return pending; });
    expect(await loadClaimantRights(new Request("https://synthetic.invalid/withdraw/session", { headers: { cookie }, signal: abort.signal }))).toBeNull();
    expect(native.rpc.mock.calls).toEqual([["future_person_rights_view_v1", { p_session_hash: session }]]);
    resolve({ data: safeView, error: null }); for (let index = 0; index < 20; index++) await Promise.resolve();
  });
});
