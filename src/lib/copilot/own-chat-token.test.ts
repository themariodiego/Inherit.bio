import { beforeEach, describe, expect, it } from "vitest";
import { mintOwnChatToken, readOwnChatToken, snapshotHash } from "./own-chat-token";
import type { OwnCopilotAuthority } from "./own-provider-authority";
export const authority: OwnCopilotAuthority = { accountId: "80000000-0000-4000-8000-000000000001", sessionId: "80000000-0000-4000-8000-000000000002", subjectId: "80000000-0000-4000-8000-000000000003", context: { accountRevision: 1, authSessionRevision: 1, jurisdictionRevision: 1, subjectBindingRevision: 1, accountBindingRevision: 1, uploadConsentId: "80000000-0000-4000-8000-000000000004", subjectLifecycleRevision: 1, originatingSessionRevision: 1, principalId: "80000000-0000-4000-8000-000000000005", principalRevision: 1 }, settingsRevision: 1, providerClass: "local", runtimeAttestationRevision: 1, runtimeAttestationFingerprint: "a".repeat(64), recipientRevision: 1, copilotGrantId: "80000000-0000-4000-8000-000000000006", copilotGrantRevision: 1, providerGrantId: null, providerGrantRevision: null };
describe("server-owned Copilot context", () => {
    beforeEach(() => { process.env.BYOK_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64"); });
    it("binds account/session/subject/purpose/provider and exact projection with a fresh nonce", () => {
        const input = { authority, projectionHash: snapshotHash({ sources: [] }) };
        const one = mintOwnChatToken(input, 1000), two = mintOwnChatToken(input, 1000);
        expect(readOwnChatToken(one, 1001)).toMatchObject({ ...input, issuingRoute: "copilot.self" });
        expect(one).not.toEqual(two);
    });
    it("refuses altered signed claims, future, expired, oversized and extended tokens", () => {
        const token = mintOwnChatToken({ authority, projectionHash: "b".repeat(64) }, 1000);
        const [payload, sig] = token.split(".");
        const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
        claims.authority.subjectId = authority.accountId;
        expect(readOwnChatToken(`${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${sig}`, 1001)).toBeNull();
        expect(readOwnChatToken(token, 999)).toBeNull();
        expect(readOwnChatToken(token, 541000)).toBeNull();
        expect(readOwnChatToken(token + ".extra", 1001)).toBeNull();
        expect(readOwnChatToken("a".repeat(12001), 1001)).toBeNull();
    });
    it("hashes JSONB key order identically while retaining source order/content", () => {
        expect(snapshotHash({ b: 2, a: { d: 4, c: 3 } })).toBe(snapshotHash({ a: { c: 3, d: 4 }, b: 2 }));
        expect(snapshotHash([1, 2])).not.toBe(snapshotHash([2, 1]));
    });
});
