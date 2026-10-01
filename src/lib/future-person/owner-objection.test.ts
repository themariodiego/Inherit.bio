import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimDataKey, openDocumentBytes } from "./document-envelope";
import { mintPublicFormToken } from "@/lib/embryos/operation-token";
import { rightsSessionHash } from "@/lib/embryos/rights-session";
import { ownerObjectionBody, ownerObjectionCsrf, ownerObjectionMutation, sealOwnerObjection } from "./owner-objection";
const scope = { claimId: "61000000-0000-4000-8000-000000000001", noticeId: "61000000-0000-4000-8000-000000000002", noticeRevision: 2 };
const secret = "a".repeat(43); const hash = rightsSessionHash(secret);
beforeEach(() => vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 18).toString("base64")));
afterEach(() => vi.unstubAllEnvs());
const text = "The supplied record link needs a named person's review.";
function request(token: string, edits: HeadersInit = {}) {
  const headers = new Headers({ cookie: `inherit-rights=${secret}`, origin: "http://localhost", "sec-fetch-site": "same-origin", "x-inherit-csrf": ownerObjectionCsrf(hash) });
  new Headers(edits).forEach((value, key) => headers.set(key, value));
  return { request: new Request("http://localhost/api/future-person/claim/session/objection", { method: "POST", headers }), token };
}
describe("owner-only objection envelope and proof", () => {
  it("uses a fresh independent wrapped key, authenticating the exact notice and revision", () => {
    const first = sealOwnerObjection(text, scope), next = sealOwnerObjection(text, scope);
    expect(first.wrappedKey).not.toBe(next.wrappedKey); expect(first.ciphertext).not.toBe(next.ciphertext);
    const key = claimDataKey(first.wrappedKey.slice(2));
    try {
      expect(openDocumentBytes(key, `future-person-owner-objection-v1|${JSON.stringify(scope)}`, Buffer.from(first.ciphertext.slice(2), "hex"))?.toString()).toBe(text);
      for (const changed of [{ ...scope, noticeRevision: 3 }, { ...scope, noticeId: scope.claimId }, { ...scope, claimId: scope.noticeId }])
        expect(openDocumentBytes(key, `future-person-owner-objection-v1|${JSON.stringify(changed)}`, Buffer.from(first.ciphertext.slice(2), "hex"))).toBeNull();
    } finally { key.fill(0); }
  });
  it("rejects short, overlong, control-bearing, missing and targeted request fields", () => {
    for (const body of [{ nonce: "x" }, { statement: "short", nonce: "x" }, { statement: "x".repeat(4001), nonce: "x" },
      { statement: text + "\u0000", nonce: "x" }, { statement: text, nonce: "x", claimId: scope.claimId }])
      expect(ownerObjectionBody.safeParse(body).success).toBe(false);
    expect(ownerObjectionBody.parse({ statement: `  ${text}  `, nonce: "x" }).statement).toBe(text);
  });
  it("accepts only the current cookie's distinct recent operation proof and same origin", () => {
    const token = mintPublicFormToken("future-person-claim-objection", Date.now(), hash);
    const current = request(token); expect(ownerObjectionMutation(current.request, current.token)).not.toBeNull();
    const refusalHeaders: Record<string, string>[] = [{ origin: "https://example.test" }, { "sec-fetch-site": "cross-site" }, { "x-inherit-csrf": "f".repeat(64) },
      { cookie: `inherit-rights=${secret}; inherit-rights=${secret}` }];
    for (const edits of refusalHeaders) {
      const altered = request(token, edits); expect(ownerObjectionMutation(altered.request, altered.token)).toBeNull();
    }
    const other = mintPublicFormToken("future-person-recovery-key", Date.now(), hash);
    expect(ownerObjectionMutation(current.request, other)).toBeNull();
    expect(ownerObjectionMutation(current.request, mintPublicFormToken("future-person-claim-objection", Date.now() - 11 * 60000, hash))).toBeNull();
    expect(ownerObjectionMutation(current.request, mintPublicFormToken("future-person-claim-objection", Date.now(), "f".repeat(64)))).toBeNull();
  });
});
