import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/withdraw/session/route";
import { mintPublicFormToken } from "./operation-token";
import { newRightsSessionSecret, RIGHTS_COOKIE_NAME, rightsSessionHash } from "./rights-session";
import { loadInvitationRefusal, readInvitationRefusal } from "./invitation-refusal";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const secret = newRightsSessionSecret();
const hash = rightsSessionHash(secret);
beforeEach(() => {
  vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
});
afterEach(() => vi.unstubAllEnvs());
function request(body: unknown, overrides: Record<string, string | null> = {}, query = "") {
  const headers = new Headers({
    origin: "https://inherit.bio", "sec-fetch-site": "same-origin",
    "content-type": "application/json", cookie: `${RIGHTS_COOKIE_NAME}=${secret}`,
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) headers.delete(key); else headers.set(key, value);
  }
  return new Request(`https://inherit.bio/api/withdraw/session${query}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
}
const form = () => ({ operation: "refuse", nonce: mintPublicFormToken("invitation-refuse", Date.now(), hash) });

describe("accountless invitation refusal", () => {
  it("accepts the exact form/cookie binding with no account or jurisdiction", async () => {
    const body = form();
    const authority = readInvitationRefusal(request(body), body.nonce);
    const response = await POST(request(body));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted", operation: "refuse" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("refuse_co_parent_invitation_session_v1", {
      p_session_hash: hash, p_nonce: authority!.nonce,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(secret);
  });
  it.each([
    ["origin", null], ["origin", "https://elsewhere.example"],
    ["sec-fetch-site", null], ["sec-fetch-site", "cross-site"], ["sec-fetch-site", "same-site"],
    ["content-type", "text/plain"], ["cookie", null],
    ["cookie", `${RIGHTS_COOKIE_NAME}=${secret}; ${RIGHTS_COOKIE_NAME}=${secret}`],
  ])("rejects %s=%s without database access", async (key, value) => {
    expect((await POST(request(form(), { [key!]: value }))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["token", "targetId", "accountId", "jurisdictionCode"])("rejects an injected %s selector", async key => {
    expect((await POST(request({ ...form(), [key]: "injected" }))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["confirm", "delete", "accept"])("cannot dispatch %s through this invitation form", async operation => {
    expect((await POST(request({ ...form(), operation }))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects wrong-purpose, unbound, expired and other-session form nonces", async () => {
    for (const nonce of [
      mintPublicFormToken("rights-activate", Date.now(), hash),
      mintPublicFormToken("invitation-refuse"),
      mintPublicFormToken("invitation-refuse", Date.now() - 600_001, hash),
      mintPublicFormToken("invitation-refuse", Date.now(), rightsSessionHash(newRightsSessionSecret())),
    ]) {
      expect((await POST(request({ operation: "refuse", nonce }))).status).toBe(404);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects query selectors and oversized bodies before database access", async () => {
    expect((await POST(request(form(), {}, "?target=other"))).status).toBe(404);
    expect((await POST(request({ ...form(), padding: "x".repeat(4096) }))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not expose a database failure or treat it as an accepted refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "private invitation detail" } });
    const response = await POST(request(form()));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("private invitation detail");
  });
  it("serves a form without sending a target or raw session secret to the browser", async () => {
    rpc.mockResolvedValue({ data: "ready", error: null });
    const result = await loadInvitationRefusal(request({}));
    expect(result?.kind).toBe("ready");
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(Object.keys(result!)).toEqual(["kind", "nonce"]);
  });
  it("renders only a generic completed receipt after the draft has been purged", async () => {
    rpc.mockResolvedValue({ data: "done", error: null });
    expect(await loadInvitationRefusal(request({}))).toEqual({ kind: "done" });
  });
  it("returns no action for unknown or stale rights sessions", async () => {
    expect(await loadInvitationRefusal(request({}))).toBeNull();
  });
});
