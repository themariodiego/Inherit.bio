import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as accountChunk from "@/lib/exports/account-archive-chunk-http";
import type { AccountArchiveChunkDependencies } from "@/lib/exports/account-archive-chunk-http";
import { DOWNLOAD_COOKIE } from "@/lib/future-person/review";
import { chunkReceiptProof, mintReceiptAckNonce } from "@/lib/future-person/review-receipt";
import { mintSessionCsrf, verifySessionCsrf, type CsrfRoute, type CsrfSession } from "@/lib/security/session-csrf-core";
import { hmacSecret } from "@/lib/crypto";

/**
 * api.claim-review-chunk-acknowledgement through its real handler and its real
 * one-time X-Inherit-CSRF gate (owner decision of 22 November 2026, "G8.5: the
 * reviewer chunk-acknowledgement address accepts either kind of session"). The
 * signed-in session's reviewer token is checked first and its account token
 * second; whichever is found is spent once and only that principal's branch
 * runs. The database's spend is an in-memory double with the same rule (one
 * spend per hash, an account-bound token only while its auth session is live);
 * the reviewer's RPCs and the TEST account archive's native seams are doubles
 * that count every read. Each branch keeps its own one-time value: the
 * reviewer's acknowledgement nonce in the body, and the archive's per-chunk
 * proof in X-Inherit-Operation-Proof, where X-Inherit-CSRF carried it.
 */

const ROUTE: CsrfRoute = "api.claim-review-chunk-acknowledgement";
const ORIGIN = "https://inherit.test";
const ACCOUNT = "5c000000-0000-4000-8000-000000000001";
const SESSION = "5c000000-0000-4000-8000-000000000011";
const OTHER_SESSION = "5c000000-0000-4000-8000-000000000012";
const REVIEW_DOWNLOAD = "5c000000-0000-4000-8000-0000000000a1";
const ARCHIVE_DOWNLOAD = "5c000000-0000-4000-8000-0000000000a2";
const REVIEW_COOKIE = "R".repeat(43);
const ARCHIVE_COOKIE = crypto.randomBytes(32).toString("base64url");
const sha256 = (value: string | Uint8Array) => crypto.createHash("sha256").update(value).digest("hex");

const state = vi.hoisted(() => ({
  signedIn: true,
  spent: new Set<string>(),
  liveSessions: new Set<string>(),
  consumeCalls: [] as Record<string, unknown>[],
  /** Every read past the gate: the request body, the reviewer's RPCs, the archive's native seams. */
  reads: [] as string[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== "consume_session_csrf_v1" && name !== "consume_session_csrf_v2") { state.reads.push(`admin:${name}`); return { data: null, error: { code: "XX000" } }; }
      state.consumeCalls.push({ ...args, function: name });
      const accountBound = args.p_session_kind === "authenticated" || args.p_session_kind === "reviewer";
      const live = !accountBound || state.liveSessions.has(`${args.p_account_id}|${args.p_session_id}`);
      const hash = String(args.p_token_hash), fresh = live && !state.spent.has(hash);
      if (fresh) state.spent.add(hash);
      return { data: fresh, error: null };
    },
  }),
}));

vi.mock("@/lib/account-deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-deletion")>()),
  getSensitiveAccountContext: vi.fn(async () => state.signedIn ? { user: { id: ACCOUNT }, sessionId: SESSION } : null),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      state.reads.push(`reviewer:${name}`);
      // The reviewer's native authorizer knows the review download alone, under its own cookie.
      const known = args.p_session_id === REVIEW_DOWNLOAD && args.p_cookie_hash === sha256(REVIEW_COOKIE);
      const result = name === "authorize_claim_review_chunk_v1"
        ? (known ? { data: {}, error: null } : { data: null, error: { code: "42501" } })
        : { data: null, error: known ? null : { code: "42501" } };
      const pending = Promise.resolve(result);
      return Object.assign(pending, { retry: () => Object.assign(pending, { abortSignal: () => pending }), abortSignal: () => pending });
    },
  }),
}));
vi.mock("@/lib/future-person/claims-open", () => ({ futurePersonClaimsOpen: () => true }));
vi.mock("@/lib/future-person/appeals-open", () => ({ testAppealIntakeOpen: () => false }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }), headers: async () => new Headers() }));

/** The TEST account archive's native seams, on, for the account and auth session the gate binds. */
function archive(overrides: Partial<AccountArchiveChunkDependencies> = {}) {
  const bytes = new Uint8Array([3, 5, 7, 11]);
  const ready = { status: "ready" as const, exportId: crypto.randomUUID(), attemptId: crypto.randomUUID(), sizeBytes: bytes.length,
    sha256: sha256(bytes), manifestSha256: "b".repeat(64), expiresAt: new Date(Date.now() + 120_000).toISOString(),
    authorityReceipt: "c".repeat(64), principalHash: "d".repeat(64), segmentCount: 1, pageCount: 1, memberCount: 12, payloadBytes: 1,
    memberSha256: "e".repeat(64), manifestMemberSha256: "f".repeat(64) };
  const deps: AccountArchiveChunkDependencies = {
    enabled: true,
    origin: () => ORIGIN,
    actor: vi.fn(async () => { state.reads.push("archive:actor"); return { accountId: ACCOUNT, sessionId: SESSION }; }),
    context: vi.fn(async (input) => {
      state.reads.push("archive:context");
      // Native names an account target for the archive download under its own cookie only.
      return input.sessionId === ARCHIVE_DOWNLOAD && input.downloadHash === sha256(ARCHIVE_COOKIE)
        ? { sessionId: ARCHIVE_DOWNLOAD, nextSequence: 0, ready: structuredClone(ready) } : null;
    }),
    read: vi.fn(async () => { state.reads.push("archive:read"); return { bytes, release: async () => {} }; }),
    acknowledge: vi.fn(async () => { state.reads.push("archive:acknowledge"); return true; }),
    ...overrides,
  };
  vi.spyOn(accountChunk, "accountArchiveChunkDependencies").mockReturnValue(deps);
  return { deps, bytes };
}

const reviewer: CsrfSession = { kind: "reviewer", accountId: ACCOUNT, sessionId: SESSION };
const account: CsrfSession = { kind: "authenticated", accountId: ACCOUNT, sessionId: SESSION };
const reviewerToken = () => mintSessionCsrf(reviewer, ROUTE);
const accountToken = () => mintSessionCsrf(account, ROUTE);

/** A token in the core's exact format and MAC for a kind this route does not take. */
function thirdKindToken(binding: string): string {
  const expiresAt = Date.now() + 60_000, random = crypto.randomBytes(32).toString("base64url");
  return `${expiresAt}.${random}.${hmacSecret([binding, ROUTE, String(expiresAt), random].join("|"), "session-csrf-v1")}`;
}

/** The request, recording "body" once the first time anything reads its body; the gate reads headers only. */
function counted(request: Request): Request {
  let read = false;
  const note = () => { if (!read) { read = true; state.reads.push("body"); } };
  for (const name of ["json", "text", "arrayBuffer", "formData", "blob", "bytes", "clone"] as const) {
    if (typeof request[name] !== "function") continue;
    const original = (request[name] as (...args: unknown[]) => unknown).bind(request);
    Object.defineProperty(request, name, { value: (...args: unknown[]) => { note(); return original(...args); } });
  }
  const stream = Object.getOwnPropertyDescriptor(Request.prototype, "body")!.get!.bind(request);
  Object.defineProperty(request, "body", { get: () => { note(); return stream(); } });
  return request;
}

function post(download: string, cookie: string, body: unknown, headers: Record<string, string>): Request {
  return counted(new Request(`${ORIGIN}/api/downloads/${download}/chunks/0/acknowledge`, { method: "POST", body: JSON.stringify(body),
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", cookie, ...headers } }));
}
const context = (download: string) => ({ params: Promise.resolve({ session: download, sequence: "0" }) });

async function acknowledge(request: Request, download: string): Promise<Response> {
  const { POST } = await import("./route");
  return POST(request, context(download));
}

/** The reviewer's complete acknowledgement of chunk 0: its proof and its one-time nonce, in the body. */
function reviewerRequest(token: string | null, nonce = mintReceiptAckNonce(REVIEW_DOWNLOAD, 0, sha256(REVIEW_COOKIE), ACCOUNT, SESSION)) {
  return post(REVIEW_DOWNLOAD, `${DOWNLOAD_COOKIE}=${REVIEW_COOKIE}`, { proof: chunkReceiptProof("a".repeat(64), new Uint8Array([1])), nonce },
    token === null ? {} : { "x-inherit-csrf": token });
}

/** The archive's GET of chunk 0, through the real GET handler: its receipt, digest, size and proof. */
async function archiveChunk(bytes: Uint8Array) {
  const { GET } = await import("../route");
  const response = await GET(new Request(`${ORIGIN}/api/downloads/${ARCHIVE_DOWNLOAD}/chunks/0`, { headers: {
    cookie: `__Host-inherit-download=${ARCHIVE_COOKIE}`, "sec-fetch-site": "same-origin" } }), context(ARCHIVE_DOWNLOAD));
  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  // Principle 1: the chunk's answer sets no X-Inherit-CSRF; its proof travels in X-Inherit-Operation-Proof.
  expect(response.headers.has("x-inherit-csrf")).toBe(false);
  const proof = response.headers.get("x-inherit-operation-proof")!;
  expect(proof).toMatch(/^[0-9a-f]{64}$/u);
  return { body: { receipt: response.headers.get("x-inherit-chunk-receipt")!, sha256: sha256(bytes), sizeBytes: bytes.length }, proof };
}

function archiveRequest(value: { receipt: string; sha256: string; sizeBytes: number }, headers: Record<string, string>) {
  return post(ARCHIVE_DOWNLOAD, `__Host-inherit-download=${ARCHIVE_COOKIE}`, value, headers);
}

async function expectRefusedBeforeAnyRead(response: Response) {
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
  expect(response.headers.get("x-inherit-csrf"), "a refusal issues no successor").toBeNull();
  expect(state.reads, "nothing past the gate was read").toEqual([]);
}

beforeEach(() => {
  vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 21).toString("base64"));
  state.signedIn = true;
  state.spent.clear();
  state.consumeCalls.length = 0;
  state.reads.length = 0;
  state.liveSessions.clear();
  state.liveSessions.add(`${ACCOUNT}|${SESSION}`);
  state.liveSessions.add(`${ACCOUNT}|${OTHER_SESSION}`);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("the reviewer's acknowledgement", () => {
  it("spends a reviewer token, runs the reviewer's branch alone and answers with the successor", async () => {
    const { deps } = archive();
    const token = reviewerToken();
    const response = await acknowledge(reviewerRequest(token), REVIEW_DOWNLOAD);
    expect(response.status).toBe(204);
    expect(verifySessionCsrf(response.headers.get("x-inherit-csrf"), reviewer, ROUTE)).not.toBeNull();
    expect(state.consumeCalls).toEqual([expect.objectContaining({ function: "consume_session_csrf_v2", p_session_kind: "reviewer",
      p_route_id: ROUTE, p_token_hash: sha256(token) })]);
    expect(state.reads).toEqual(["body", "reviewer:authorize_claim_review_chunk_v1", "reviewer:acknowledge_claim_review_chunk_v1"]);
    // The TEST account archive's branch is never reached by a reviewer token.
    for (const seam of [deps.actor, deps.context, deps.read, deps.acknowledge]) expect(seam).not.toHaveBeenCalled();
  });

  it.each<[string, () => string | null]>([
    ["missing", () => null],
    ["foreign-session", () => mintSessionCsrf({ ...reviewer, sessionId: OTHER_SESSION } as CsrfSession, ROUTE)],
    ["other-route", () => mintSessionCsrf(reviewer, "api.claim-review-receipt")],
    ["other-kind (rights)", () => thirdKindToken(`token|${sha256("T".repeat(43))}`)],
    ["other-kind (upload session)", () => thirdKindToken(`upload-session|${REVIEW_DOWNLOAD}|${sha256("U".repeat(43))}`)],
    ["the acknowledgement nonce in X-Inherit-CSRF", () => mintReceiptAckNonce(REVIEW_DOWNLOAD, 0, sha256(REVIEW_COOKIE), ACCOUNT, SESSION)],
  ])("refuses a %s token before any read", async (_name, token) => {
    archive();
    await expectRefusedBeforeAnyRead(await acknowledge(reviewerRequest(token()), REVIEW_DOWNLOAD));
    expect(state.consumeCalls).toEqual([]);
  });

  it("refuses a spent reviewer token before any read", async () => {
    archive();
    const token = reviewerToken();
    expect((await acknowledge(reviewerRequest(token), REVIEW_DOWNLOAD)).status).toBe(204);
    state.reads.length = 0;
    await expectRefusedBeforeAnyRead(await acknowledge(reviewerRequest(token), REVIEW_DOWNLOAD));
    expect(state.consumeCalls.map(call => call.p_session_kind)).toEqual(["reviewer", "reviewer"]);
  });

  it("still requires its own one-time acknowledgement nonce in the body", async () => {
    archive();
    for (const nonce of ["synthetic-unused", mintReceiptAckNonce(REVIEW_DOWNLOAD, 1, sha256(REVIEW_COOKIE), ACCOUNT, SESSION),
      mintReceiptAckNonce(REVIEW_DOWNLOAD, 0, sha256(REVIEW_COOKIE), ACCOUNT, OTHER_SESSION)]) {
      state.reads.length = 0;
      const response = await acknowledge(reviewerRequest(reviewerToken(), nonce), REVIEW_DOWNLOAD);
      expect(response.status).toBe(404);
      expect(state.reads, "refused before the reviewer's native acknowledgement").toEqual(["body"]);
    }
  });
});

describe("the TEST account archive's acknowledgement", () => {
  it("spends an account token, runs the archive's branch alone and keeps the chunk's proof in X-Inherit-Operation-Proof", async () => {
    const { deps, bytes } = archive();
    const { body, proof } = await archiveChunk(bytes);
    state.reads.length = 0;
    const token = accountToken();
    const response = await acknowledge(archiveRequest(body, { "x-inherit-csrf": token, "x-inherit-operation-proof": proof }), ARCHIVE_DOWNLOAD);
    expect(response.status).toBe(204);
    expect(verifySessionCsrf(response.headers.get("x-inherit-csrf"), account, ROUTE)).not.toBeNull();
    expect(state.consumeCalls).toEqual([expect.objectContaining({ function: "consume_session_csrf_v1", p_session_kind: "authenticated",
      p_route_id: ROUTE, p_token_hash: sha256(token), p_account_id: ACCOUNT, p_session_id: SESSION })]);
    expect(state.reads).toEqual(["archive:actor", "archive:context", "body", "archive:acknowledge"]);
    expect(deps.acknowledge).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sessionId: ARCHIVE_DOWNLOAD, ordinal: 0,
      sha256: body.sha256, sizeBytes: body.sizeBytes, challengeHash: sha256(body.receipt) }), expect.any(AbortSignal));
  });

  it.each<[string, () => string | null]>([
    ["missing", () => null],
    ["foreign-session", () => mintSessionCsrf({ ...account, sessionId: OTHER_SESSION } as CsrfSession, ROUTE)],
    ["other-route", () => mintSessionCsrf(account, "api.export")],
    ["other two-kind route", () => mintSessionCsrf(account, "api.future-person-claim-objection")],
    ["other-kind (rights)", () => thirdKindToken(`token|${sha256("T".repeat(43))}`)],
    ["other-kind (claim session)", () => thirdKindToken(`claim-session|${sha256("L".repeat(43))}`)],
  ])("refuses a %s token before any read", async (_name, token) => {
    const { bytes } = archive();
    const { body, proof } = await archiveChunk(bytes);
    state.reads.length = 0;
    const presented = token();
    await expectRefusedBeforeAnyRead(await acknowledge(archiveRequest(body, {
      ...(presented === null ? {} : { "x-inherit-csrf": presented }), "x-inherit-operation-proof": proof }), ARCHIVE_DOWNLOAD));
    expect(state.consumeCalls).toEqual([]);
  });

  it("refuses a spent account token before any read", async () => {
    const { bytes } = archive();
    const { body, proof } = await archiveChunk(bytes);
    const token = accountToken();
    expect((await acknowledge(archiveRequest(body, { "x-inherit-csrf": token, "x-inherit-operation-proof": proof }), ARCHIVE_DOWNLOAD)).status).toBe(204);
    state.reads.length = 0;
    await expectRefusedBeforeAnyRead(await acknowledge(archiveRequest(body, { "x-inherit-csrf": token, "x-inherit-operation-proof": proof }), ARCHIVE_DOWNLOAD));
  });

  it("refuses an account token once its auth session has ended", async () => {
    const { bytes } = archive();
    const { body, proof } = await archiveChunk(bytes);
    state.reads.length = 0;
    state.liveSessions.clear();
    await expectRefusedBeforeAnyRead(await acknowledge(archiveRequest(body, { "x-inherit-csrf": accountToken(), "x-inherit-operation-proof": proof }), ARCHIVE_DOWNLOAD));
  });

  it("still requires the chunk's own proof, in X-Inherit-Operation-Proof, exactly as strictly", async () => {
    const { deps, bytes } = archive();
    const { body, proof } = await archiveChunk(bytes);
    const otherChunk = await archiveChunk(bytes);
    for (const [name, headers] of [
      ["no proof", {}],
      ["a wrong proof", { "x-inherit-operation-proof": "0".repeat(64) }],
      ["another GET's proof", { "x-inherit-operation-proof": otherChunk.proof }],
      ["the proof twice", { "x-inherit-operation-proof": `${proof}, ${proof}` }],
    ] as const) {
      state.reads.length = 0;
      const response = await acknowledge(archiveRequest(body, { "x-inherit-csrf": accountToken(), ...headers }), ARCHIVE_DOWNLOAD);
      expect(response.status, name).toBe(404);
      expect(state.reads, name).toEqual(["archive:actor", "archive:context", "body"]);
    }
    expect(deps.acknowledge).not.toHaveBeenCalled();
  });

  it("refuses the proof in its old position, X-Inherit-CSRF", async () => {
    const { deps, bytes } = archive();
    const { body, proof } = await archiveChunk(bytes);
    state.reads.length = 0;
    // The old request exactly: the proof in X-Inherit-CSRF and nothing else. The gate refuses it.
    await expectRefusedBeforeAnyRead(await acknowledge(archiveRequest(body, { "x-inherit-csrf": proof }), ARCHIVE_DOWNLOAD));
    // The two swapped: the gate refuses the proof where the token belongs, before anything is read.
    await expectRefusedBeforeAnyRead(await acknowledge(archiveRequest(body, { "x-inherit-csrf": proof, "x-inherit-operation-proof": accountToken() }), ARCHIVE_DOWNLOAD));
    expect(state.consumeCalls).toEqual([]);
    expect(deps.acknowledge).not.toHaveBeenCalled();
  });
});

describe("each branch runs only for its own principal", () => {
  it("never takes an account token to the reviewer's branch, even with a complete reviewer acknowledgement", async () => {
    const { deps } = archive();
    const response = await acknowledge(reviewerRequest(accountToken()), REVIEW_DOWNLOAD);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    // Spent for the account; native names no account target here, and nothing of the reviewer's runs.
    expect(state.consumeCalls.map(call => call.p_session_kind)).toEqual(["authenticated"]);
    expect(state.reads).toEqual(["archive:actor", "archive:context"]);
    expect(state.reads.filter(read => read.startsWith("reviewer:"))).toEqual([]);
    expect(deps.acknowledge).not.toHaveBeenCalled();
  });

  it("never takes an account token to the reviewer's branch while the TEST archive is off", async () => {
    const { deps } = archive({ enabled: false });
    const response = await acknowledge(reviewerRequest(accountToken()), REVIEW_DOWNLOAD);
    expect(response.status).toBe(404);
    expect(state.reads).toEqual([]);
    for (const seam of [deps.actor, deps.context, deps.read, deps.acknowledge]) expect(seam).not.toHaveBeenCalled();
  });

  it("never takes a reviewer token to the archive's branch, even with a complete archive acknowledgement", async () => {
    const { deps, bytes } = archive();
    const { body, proof } = await archiveChunk(bytes);
    vi.mocked(deps.actor).mockClear(); vi.mocked(deps.context).mockClear();
    state.reads.length = 0;
    const response = await acknowledge(archiveRequest(body, { "x-inherit-csrf": reviewerToken(), "x-inherit-operation-proof": proof }), ARCHIVE_DOWNLOAD);
    expect(response.status).toBe(404);
    expect(state.consumeCalls.map(call => call.p_session_kind)).toEqual(["reviewer"]);
    for (const seam of [deps.actor, deps.context, deps.acknowledge]) expect(seam).not.toHaveBeenCalled();
    expect(state.reads.filter(read => read.startsWith("archive:"))).toEqual([]);
  });

  it("leaves a signed-out request to the handler's 404, spending and reading nothing", async () => {
    archive();
    state.signedIn = false;
    const response = await acknowledge(reviewerRequest(reviewerToken()), REVIEW_DOWNLOAD);
    expect(response.status).toBe(404);
    expect(state.consumeCalls).toEqual([]);
    expect(state.reads).toEqual([]);
  });
});
