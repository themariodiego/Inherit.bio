import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/withdraw/session/route";
import { readAdultSubjectResponse } from "./adult-subject-review";
import { mintPublicFormToken } from "./operation-token";
import { newRightsSessionSecret, RIGHTS_COOKIE_NAME, rightsSessionHash } from "./rights-session";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), account: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/account-deletion", () => ({ getSensitiveAccountContext: mocks.account, isSameOrigin: vi.fn() }));
const secret = newRightsSessionSecret();
const hash = rightsSessionHash(secret);

beforeEach(() => {
  vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
  vi.clearAllMocks();
  mocks.rpc.mockReset().mockResolvedValue({ data: "deleted", error: null });
  mocks.account.mockRejectedValue(new Error("account lookup must not authorize deletion"));
});
afterEach(() => vi.unstubAllEnvs());

function request(body: unknown, overrides: Record<string, string | null> = {}, query = "") {
  const headers = new Headers({ origin: "https://inherit.bio", "sec-fetch-site": "same-origin",
    "content-type": "application/json", cookie: `${RIGHTS_COOKIE_NAME}=${secret}` });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) headers.delete(key); else headers.set(key, value);
  }
  return new Request(`https://inherit.bio/api/withdraw/session${query}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
}
const form = () => ({ operation: "delete", nonce: mintPublicFormToken("adult-subject-respond", Date.now(), hash) });

describe("accountless pending adult reservation deletion HTTP contract", () => {
  it("dispatches delete through the exact signed session form without an account or a refusal action", async () => {
    const body = form();
    const authority = readAdultSubjectResponse(request(body), body.nonce);
    expect(authority).not.toBeNull();
    const response = await POST(request(body));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted", operation: "delete" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("respond_adult_subject_invitation_session_v1", {
      p_session_hash: hash, p_nonce: authority!.nonce, p_action: "delete",
    });
    expect(mocks.account).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(secret);
  });

  it("keeps explicit adult refusal a distinct action on its existing session contract", async () => {
    mocks.rpc.mockResolvedValue({ data: "refused", error: null });
    const body = { ...form(), operation: "refuse" };
    const response = await POST(request(body));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted", operation: "refuse" });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("respond_adult_subject_invitation_session_v1",
      { p_session_hash: hash, p_nonce: expect.any(String), p_action: "refuse" });
    expect(mocks.account).not.toHaveBeenCalled();
  });

  it.each([
    ["origin", null], ["origin", "https://elsewhere.invalid"],
    ["sec-fetch-site", null], ["sec-fetch-site", "cross-site"], ["sec-fetch-site", "same-site"],
    ["content-type", "text/plain"], ["cookie", null],
    ["cookie", `${RIGHTS_COOKIE_NAME}=${secret}; ${RIGHTS_COOKIE_NAME}=${secret}`],
  ])("rejects %s=%s before database or account access", async (key, value) => {
    const response = await POST(request(form(), { [key!]: value }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.account).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each(["token", "targetId", "accountId", "action"])("rejects an injected %s selector", async key => {
    expect((await POST(request({ ...form(), [key]: "other" }))).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses wrong-purpose, unbound, expired and other-session form nonces without dispatch", async () => {
    for (const nonce of [
      mintPublicFormToken("invitation-refuse", Date.now(), hash),
      mintPublicFormToken("rights-activate", Date.now(), hash),
      mintPublicFormToken("adult-subject-respond"),
      mintPublicFormToken("adult-subject-respond", Date.now() - 600_001, hash),
      mintPublicFormToken("adult-subject-respond", Date.now(), rightsSessionHash(newRightsSessionSecret())),
    ]) expect((await POST(request({ operation: "delete", nonce }))).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects query selectors, oversized JSON, invalid JSON and invalid UTF-8 before dispatch", async () => {
    const base = request(form());
    const invalidJson = new Request(base.url, { method: "POST", headers: base.headers, body: "{" });
    const invalidUtf8 = new Request(base.url, { method: "POST", headers: base.headers, body: new Uint8Array([255]) });
    for (const candidate of [request(form(), {}, "?target=other"),
      request({ ...form(), padding: "x".repeat(4096) }), invalidJson, invalidUtf8]) {
      expect((await POST(candidate)).status).toBe(404);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "refused", "accepted", null, { status: "deleted" }])(
    "does not report deletion for a mismatched RPC outcome %j", async data => {
      mocks.rpc.mockResolvedValue({ data, error: null });
      const response = await POST(request(form()));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
      expect(mocks.account).not.toHaveBeenCalled();
    },
  );

  it("rejects an RPC error even with a success body and keeps private details out of the response", async () => {
    mocks.rpc.mockResolvedValue({ data: "deleted", error: { message: "private invitation detail" } });
    const response = await POST(request(form()));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(mocks.account).not.toHaveBeenCalled();
  });
});
