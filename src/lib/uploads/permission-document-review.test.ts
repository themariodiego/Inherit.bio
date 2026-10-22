import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { decryptSecret } from "@/lib/crypto";
import { mintReviewNonce, reviewCsrf } from "@/lib/future-person/review";
import { decidePermissionDocument, permissionDocumentDecisionBody, permissionReviewContext } from "./permission-document-review";

const documentId = "44444444-4444-4444-8444-444444444444";
const reviewerId = "55555555-5555-4555-8555-555555555555";
const sessionId = "66666666-6666-4666-8666-666666666666";
const sha256 = "b".repeat(64);
const current = { documentId, sha256, reviewRevision: 3, documentKind: "adult-signed-permission" as const };
const REASON = "Signature and date match the named adult; synthetic review note only.";

beforeEach(() => vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64")));
afterEach(() => vi.unstubAllEnvs());

function rpcAnswering(answer: (name: string, args: Record<string, unknown>) => { data: unknown; error: { code?: string } | null }) {
  const calls: [string, Record<string, unknown>][] = [];
  const rpc = (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]);
    return { retry: () => ({ abortSignal: async () => answer(name, args) }) };
  };
  return { rpc, calls };
}

function decide(body: Record<string, unknown>, csrf = reviewCsrf(documentId, reviewerId, sessionId)) {
  return { request: new Request(`https://inherit.bio/api/legal-evidence/${documentId}/review`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-inherit-csrf": csrf },
  }), body };
}
type Decide = ReturnType<typeof decide>;
const run = (call: Decide, account: { userId: string; sessionId: string }, rpc: Parameters<typeof decidePermissionDocument>[4]) =>
  decidePermissionDocument(call.request, documentId, call.body, account, rpc, current);

const body = (patch: Record<string, unknown> = {}) => ({ decision: "approved", reason: REASON, documentSha256: sha256,
  reviewRevision: 3, nonce: mintReviewNonce(documentId, reviewerId, sessionId), ...patch });

describe("the named-human review of a signed-permission document", () => {
  it("records the reviewer's own decision with a sealed reason and answers evidence-review-v1", async () => {
    const { rpc, calls } = rpcAnswering(() => ({ data: { documentId, decision: "approved", reviewRevision: 4 }, error: null }));
    const response = await run(decide(body()), { userId: reviewerId, sessionId }, rpc);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ documentId, status: "reviewed", decision: "approved", reviewRevision: 4 });
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(calls).toHaveLength(1);
    const [name, args] = calls[0]!;
    expect(name).toBe("decide_permission_document_v1");
    expect(args).toMatchObject({ p_document: documentId, p_sha256: sha256, p_review_revision: 3, p_decision: "approved" });
    expect(args.p_nonce_hash).toMatch(/^[0-9a-f]{64}$/);
    // The reason never leaves this request in the clear.
    expect(JSON.stringify(args)).not.toContain("synthetic review note");
    const sealed = String(args.p_reason_ciphertext);
    expect(sealed).toMatch(/^\\x[0-9a-f]+$/);
    expect(decryptSecret(Buffer.from(sealed.slice(2), "hex"))).toBe(REASON);
  });

  it("records a rejection the same way", async () => {
    const { rpc } = rpcAnswering(() => ({ data: { documentId, decision: "rejected", reviewRevision: 4 }, error: null }));
    const response = await run(decide(body({ decision: "rejected" })), { userId: reviewerId, sessionId }, rpc);
    expect(await response.json()).toEqual({ documentId, status: "reviewed", decision: "rejected", reviewRevision: 4 });
  });

  it("refuses rejected-documentary-conflict until contradiction-v1 exists, recording nothing", async () => {
    const { rpc, calls } = rpcAnswering(() => ({ data: null, error: null }));
    const response = await run(decide(body({ decision: "rejected-documentary-conflict" })), { userId: reviewerId, sessionId }, rpc);
    expect(response.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("refuses a stale revision, another object, a foreign CSRF or nonce, and every forbidden field before the database", async () => {
    const { rpc, calls } = rpcAnswering(() => ({ data: null, error: null }));
    const account = { userId: reviewerId, sessionId };
    const cases = [
      decide(body({ reviewRevision: 2 })), decide(body({ documentSha256: "c".repeat(64) })),
      decide(body(), reviewCsrf(documentId, reviewerId, documentId)),
      decide(body({ nonce: mintReviewNonce(documentId, sessionId, sessionId) })),
      decide(body({ nonce: mintReviewNonce(sessionId, reviewerId, sessionId) })),
      decide(body({ reason: "too short" })),
      ...["targetId", "targetKind", "documentKind", "reviewerId", "ownerId", "objectPath", "documentBytes", "approvalEffectiveAt"]
        .map((field) => decide(body({ [field]: "x" }))),
    ];
    for (const call of cases) expect((await run(call, account, rpc)).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("hides the database's refusals, and never answers a decision the database did not commit", async () => {
    const account = { userId: reviewerId, sessionId };
    for (const code of ["42501", "23505", "22023"]) {
      const { rpc } = rpcAnswering(() => ({ data: null, error: { code } }));
      expect((await run(decide(body()), account, rpc)).status).toBe(404);
    }
    for (const data of [{ documentId, decision: "rejected", reviewRevision: 4 }, { documentId, decision: "approved", reviewRevision: 3 },
      { documentId: sessionId, decision: "approved", reviewRevision: 4 }, null]) {
      const { rpc } = rpcAnswering(() => ({ data, error: null }));
      expect((await run(decide(body()), account, rpc)).status).toBe(503);
    }
  });

  it("parses the closed body and the review context, and tells a non-permission document apart", async () => {
    expect(permissionDocumentDecisionBody.safeParse(body()).success).toBe(true);
    const signal = new AbortController().signal;
    expect(await permissionReviewContext(rpcAnswering(() => ({ data: null, error: null })).rpc, documentId, signal))
      .toEqual({ kind: "none" });
    expect(await permissionReviewContext(rpcAnswering(() => ({ data: null, error: { code: "42501" } })).rpc, documentId, signal))
      .toEqual({ kind: "denied" });
    expect(await permissionReviewContext(rpcAnswering(() => ({ data: current, error: null })).rpc, documentId, signal))
      .toEqual({ kind: "permission", value: current });
    expect(await permissionReviewContext(rpcAnswering(() => ({ data: { ...current, documentId: sessionId }, error: null })).rpc,
      documentId, signal)).toEqual({ kind: "unavailable" });
  });
});
