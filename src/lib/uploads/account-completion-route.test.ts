import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getClaims: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: mocks }) }));
import { POST } from "@/app/api/account/completion/route";
import { mintOwnAccountCompletionPresentation, mintOwnConsentPresentation } from "./own-consent-token";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
afterAll(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
const input = {
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  subjectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  accountRevision: 2, authSessionRevision: 3, jurisdictionRevision: 4,
  subjectBindingRevision: 5, accountBindingRevision: 1,
};
function requestCase(snapshot = input) {
  const presentation = mintOwnAccountCompletionPresentation(snapshot);
  return {
    ...presentation,
    body: { dateOfBirth: "1990-01-01", presentationToken: presentation.token },
    headers: { origin: "https://inherit.bio", "sec-fetch-site": "same-origin", "x-inherit-csrf": presentation.token },
  };
}
function send(body: unknown, headers: Record<string, string>) {
  return POST(new Request("https://inherit.bio/api/account/completion", {
    method: "POST", headers, body: JSON.stringify(body),
  }));
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: input.accountId } } });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: input.accountId, session_id: input.sessionId } } });
  mocks.rpc.mockResolvedValue({ data: { status: "completed" }, error: null });
});
describe("initial account completion route", () => {
  it("writes through the atomic RPC with separate subject and account-binding revisions", async () => {
    const { body, headers, nonceHash } = requestCase();
    const res = await send(body, headers);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "completed" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("complete_own_upload_account_v1", {
      p_account_id: input.accountId, p_session_id: input.sessionId, p_subject_id: input.subjectId,
      p_account_revision: 2, p_auth_session_revision: 3, p_jurisdiction_revision: 4,
      p_subject_binding_revision: 5, p_account_binding_revision: 1,
      p_date_of_birth: body.dateOfBirth, p_nonce_hash: nonceHash,
    });
  });
  it.each(["origin", "sec-fetch-site", "x-inherit-csrf"])("requires %s", async key => {
    const c = requestCase(); const headers: Record<string, string> = { ...c.headers }; delete headers[key];
    expect((await send(c.body, headers)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects foreign origins and mismatched CSRF headers", async () => {
    const c = requestCase();
    for (const patch of [{ origin: "http://localhost" }, { "sec-fetch-site": "same-site" }, { "x-inherit-csrf": "wrong" }]) {
      expect((await send(c.body, { ...c.headers, ...patch })).status).toBe(403);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["accountId", "sessionId"] as const)("rejects a correctly signed foreign %s", async key => {
    const c = requestCase({ ...input, [key]: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
    expect((await send(c.body, c.headers)).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires matching validated user and session claims", async () => {
    const c = requestCase();
    for (const claims of [null, { sub: input.subjectId, session_id: input.sessionId }, { sub: input.accountId }]) {
      mocks.getClaims.mockResolvedValue({ data: { claims } });
      expect((await send(c.body, c.headers)).status).toBe(401);
    }
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await send(c.body, c.headers)).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects invalid bodies separately from a valid underage declaration", async () => {
    const c = requestCase();
    for (const body of [null, { ...c.body, age: 20 }, { dateOfBirth: c.body.dateOfBirth }]) {
      expect(await (await send(body, c.headers)).json()).toEqual({ error: "invalid_request" });
    }
    for (const dateOfBirth of ["2008-09-07", "2001-02-29", "2027-01-01"]) {
      expect(await (await send({ ...c.body, dateOfBirth }, c.headers)).json()).toEqual({ error: "adult_account_required" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses malformed JSON without a write", async () => {
    const c = requestCase();
    const res = await POST(new Request("https://inherit.bio/api/account/completion", {
      method: "POST", headers: c.headers, body: "{",
    }));
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses expired and consent-signing presentations", async () => {
    const c = requestCase();
    vi.advanceTimersByTime(540_000);
    expect((await send(c.body, c.headers)).status).toBe(404);
    const consent = mintOwnConsentPresentation({ ...input, artifactKey: "consent.upload-self",
      artifactVersion: 1, artifactBodySha256: "a".repeat(64) });
    expect((await send({ ...c.body, presentationToken: consent.token },
      { ...c.headers, "x-inherit-csrf": consent.token })).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["42501", 404, "not_found"], ["23505", 404, "not_found"],
    ["22023", 422, "adult_account_required"], ["55000", 409, "account_already_completed"],
    ["XX000", 503, "unavailable"],
  ])("normalizes database error %s without exposing details", async (code, status, error) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private database details" } });
    const c = requestCase(); const res = await send(c.body, c.headers);
    expect(res.status).toBe(status); expect(await res.json()).toEqual({ error });
  });
  it.each([null, [], "completed", { status: "pending" }, { status: "completed", dateOfBirth: "1990-01-01" }])(
    "does not forward an invalid or open receipt", async data => {
      mocks.rpc.mockResolvedValue({ data, error: null }); const c = requestCase();
      const res = await send(c.body, c.headers);
      expect(res.status).toBe(503); expect(await res.json()).toEqual({ error: "unavailable" });
    },
  );
});
