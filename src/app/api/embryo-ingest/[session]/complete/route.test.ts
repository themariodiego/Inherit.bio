import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/embryo-ingest/[session]/complete` against a mocked database.
 * The transaction itself is the worker stream's `complete_embryo_ingest_v1`
 * (#243), proved by its own pgTAP; this proves the route's authority, request
 * boundary and the mapping of every outcome to the registered answers.
 */
const ACCOUNT = "12345678-1234-4234-8234-000000000001";
const AUTH_SESSION = "12345678-1234-4234-8234-0000000000a1";
const SESSION = "12345678-1234-4234-8234-0000000000c1";
const COHORT = "12345678-1234-4234-8234-0000000000e1";
const UPLOAD = "12345678-1234-4234-8234-0000000000d1";
const JOB = "12345678-1234-4234-8234-0000000000f1";
const ORIGIN = "https://inherit.bio";
const COOKIE_VALUE = "C".repeat(43);
const EXPIRES_AT = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
const sha = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

const mocks = vi.hoisted(() => ({
  account: null as { user: { id: string }; sessionId: string } | null,
  calls: [] as { name: string; args: Record<string, unknown> }[],
  results: {} as Record<string, { data: unknown; error: { code?: string } | null }>,
}));

vi.mock("@/lib/account-deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-deletion")>()),
  getSensitiveAccountContext: async () => mocks.account,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      mocks.calls.push({ name, args });
      const result = mocks.results[name];
      if (!result) throw new Error(`unexpected rpc ${name}`);
      return result;
    },
    from: () => ({ select: () => ({ in: async (_column: string, ids: string[]) => ({
      data: ids.map((id) => ({ id, jurisdiction_code: "GB" })), error: null,
    }) }) }),
  }),
}));

vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const { POST } = await import("./route");
const { mintIngestSessionOperation } = await import("@/lib/embryos/operation-token");

type Operation = "ingest_session_open" | "ingest_complete" | "ingest_complete_csrf";
function token(operation: Operation, overrides: Partial<{ targetId: string; sessionId: string }> = {}) {
  return mintIngestSessionOperation({ accountId: ACCOUNT, sessionId: AUTH_SESSION, targetId: SESSION, operation, ...overrides },
    new Date(EXPIRES_AT));
}

let completion = token("ingest_complete");
let csrf = token("ingest_complete_csrf");

function authorized() {
  return {
    status: "authorized", session: SESSION, cohortId: COHORT, uploadId: UPLOAD, ingestRevision: 4, expiresAt: EXPIRES_AT,
    challengeHash: "a".repeat(64), transportRevision: 7, build: "GRCh38", format: "vcf", sampleCount: 3,
    handles: [0, 1, 2].map((ordinal) => ({ ordinal, hash: String(ordinal).repeat(64) })),
  };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/embryo-ingest/${SESSION}/complete`, {
    method: "POST",
    headers: {
      origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json",
      cookie: `inherit-ingest-${SESSION}=${COOKIE_VALUE}`, "x-inherit-csrf": csrf.token, ...headers,
    },
    body: JSON.stringify(body),
  });
}
const call = (request: Request) => POST(request, { params: Promise.resolve({ session: SESSION }) });
const named = (name: string) => mocks.calls.filter((entry) => entry.name === name);
const body = (overrides: Record<string, unknown> = {}) => ({ chunkCount: 3, nonce: completion.token, ...overrides });

beforeEach(() => {
  mocks.account = { user: { id: ACCOUNT }, sessionId: AUTH_SESSION };
  mocks.calls = [];
  completion = token("ingest_complete");
  csrf = token("ingest_complete_csrf");
  mocks.results = {
    authorize_embryo_ingest_request_v1: { data: authorized(), error: null },
    embryo_ingest_issued_tokens_match_v1: { data: true, error: null },
    complete_embryo_ingest_v1: { data: { status: "sanitization_pending", uploadId: UPLOAD, jobId: JOB, analysisState: "queued" }, error: null },
    prepare_embryo_ingest_unwind_v1: { data: { status: "storage_pending" }, error: null },
  };
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
});

describe("authority", () => {
  it("refuses with no account or outside TEST-LOCAL, before the database", async () => {
    mocks.account = null;
    expect((await call(post(body()))).status).toBe(401);
    mocks.account = { user: { id: ACCOUNT }, sessionId: AUTH_SESSION };
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    expect((await call(post(body()))).status).toBe(403);
    expect(mocks.calls).toEqual([]);
  });

  it("answers a missing cookie or foreign session with the opaque 404", async () => {
    expect((await call(post(body(), { cookie: "" }))).status).toBe(404);
    mocks.results.authorize_embryo_ingest_request_v1 = { data: null, error: { code: "42501" } };
    expect((await call(post(body()))).status).toBe(404);
    expect(named("complete_embryo_ingest_v1")).toEqual([]);
  });

  it("dispatches the unwind for an attempt already failure-pending", async () => {
    mocks.results.authorize_embryo_ingest_request_v1 = { data: { status: "failure_pending", cohortId: COHORT, ingestRevision: 4 }, error: null };
    expect((await call(post(body()))).status).toBe(404);
    expect(named("prepare_embryo_ingest_unwind_v1")).toHaveLength(1);
    expect(named("complete_embryo_ingest_v1")).toEqual([]);
  });

  it.each([
    ["missing", undefined],
    ["the completion nonce in its place", () => completion.token],
    ["another upload session's", () => token("ingest_complete_csrf", { targetId: "12345678-1234-4234-8234-0000000000c2" }).token],
    ["another auth session's", () => token("ingest_complete_csrf", { sessionId: "12345678-1234-4234-8234-0000000000a2" }).token],
  ])("refuses an X-Inherit-CSRF header that is %s, before reading the body", async (_label, header) => {
    const request = post(body(), header ? { "x-inherit-csrf": header() } : {});
    if (!header) request.headers.delete("x-inherit-csrf");
    const response = await call(request);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "request_forbidden" });
    expect(request.bodyUsed).toBe(false);
    expect(named("complete_embryo_ingest_v1")).toEqual([]);
  });

  it.each([
    ["the CSRF token in its place", () => csrf.token],
    ["the configure nonce", () => token("ingest_session_open").token],
    ["another upload session's", () => token("ingest_complete", { targetId: "12345678-1234-4234-8234-0000000000c2" }).token],
    ["a bare nonce", () => completion.nonce],
  ])("answers a completion nonce that is %s with the opaque 404", async (_label, nonce) => {
    expect((await call(post(body({ nonce: nonce() })))).status).toBe(404);
    expect(named("complete_embryo_ingest_v1")).toEqual([]);
  });

  it("completes only with the exact tokens the configure transaction issued", async () => {
    mocks.results.embryo_ingest_issued_tokens_match_v1 = { data: false, error: null };
    expect((await call(post(body()))).status).toBe(404);
    expect(named("embryo_ingest_issued_tokens_match_v1")[0].args).toEqual({
      p_account_id: ACCOUNT, p_auth_session_id: AUTH_SESSION, p_ingest_session_id: SESSION,
      p_cookie_hash: sha(COOKIE_VALUE), p_origin: ORIGIN,
      p_completion_nonce_hash: sha(completion.nonce), p_csrf_hash: sha(csrf.nonce), p_test_jurisdiction: true,
    });
    expect(named("complete_embryo_ingest_v1")).toEqual([]);
    mocks.results.embryo_ingest_issued_tokens_match_v1 = { data: null, error: { code: "55P03" } };
    expect((await call(post(body()))).status).toBe(503);
  });
});

describe("the closed body", () => {
  it.each([
    ["no chunks", { chunkCount: 0 }, ["chunkCount"]],
    ["more chunks than a session allows", { chunkCount: 51 }, ["chunkCount"]],
    ["a string count", { chunkCount: "3" }, ["chunkCount"]],
    ["no nonce", { nonce: undefined }, ["nonce"]],
    ["an extra field", { manifest: "PRIVATE" }, ["body"]],
  ])("refuses %s as an invalid request", async (_label, overrides, issues) => {
    const response = await call(post(body(overrides)));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues });
    expect(named("complete_embryo_ingest_v1")).toEqual([]);
  });
});

describe("outcomes", () => {
  it("answers the first completion 202 with exactly the registered body", async () => {
    const response = await call(post(body()));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "sanitization_pending", uploadId: UPLOAD, jobId: JOB, analysisState: "queued" });
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(named("complete_embryo_ingest_v1").map((entry) => entry.args)).toEqual([{
      p_account: ACCOUNT, p_auth: AUTH_SESSION, p_session: SESSION, p_cookie_hash: sha(COOKIE_VALUE), p_origin: ORIGIN,
      p_cohort: COHORT, p_ingest_revision: 4, p_chunk_count: 3, p_nonce: completion.nonce, p_test: true,
    }]);
    expect(named("prepare_embryo_ingest_unwind_v1")).toEqual([]);
  });

  it("answers an exact replay 200 with the existing job", async () => {
    mocks.results.complete_embryo_ingest_v1 = { data: { status: "sanitization_in_progress", uploadId: UPLOAD, jobId: JOB, analysisState: "running" }, error: null };
    const response = await call(post(body()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "sanitization_in_progress", uploadId: UPLOAD, jobId: JOB, analysisState: "running" });
  });

  it("answers a chunk failure as incomplete_upload after dispatching the unwind", async () => {
    mocks.results.complete_embryo_ingest_v1 = { data: { status: "failure_pending", cohortId: COHORT, ingestRevision: 4, failureCode: "chunk" }, error: null };
    const response = await call(post(body()));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "incomplete_upload" });
    expect(named("prepare_embryo_ingest_unwind_v1").map((entry) => entry.args)).toEqual([{ p_cohort_id: COHORT, p_ingest_revision: 4 }]);
  });

  it.each(["format", "build", "stale-binding", null, undefined])("answers any other terminal branch (%s) with the opaque 404 after dispatching", async (failureCode) => {
    mocks.results.complete_embryo_ingest_v1 = { data: { status: "failure_pending", cohortId: COHORT, ingestRevision: 4,
      ...(failureCode === undefined ? {} : { failureCode }) }, error: null };
    expect((await call(post(body()))).status).toBe(404);
    expect(named("prepare_embryo_ingest_unwind_v1")).toHaveLength(1);
  });

  it("answers a pending table decision with the retryable 503; a configured VCF never reaches it", async () => {
    mocks.results.complete_embryo_ingest_v1 = { data: { status: "mapping_required", kind: "build", expiresAt: EXPIRES_AT }, error: null };
    expect((await call(post(body()))).status).toBe(503);
    expect(named("prepare_embryo_ingest_unwind_v1")).toEqual([]);
  });

  it.each(["42501", "23505", "55000", "22023"])("answers database refusal %s with the opaque 404", async (code) => {
    mocks.results.complete_embryo_ingest_v1 = { data: null, error: { code } };
    expect((await call(post(body()))).status).toBe(404);
  });

  it("answers contention or an unreadable result with the retryable 503", async () => {
    for (const result of [
      { data: null, error: { code: "55P03" } },
      { data: { status: "sanitization_pending", uploadId: UPLOAD, jobId: JOB, analysisState: "queued", manifest: "x" }, error: null },
    ]) {
      mocks.results.complete_embryo_ingest_v1 = result;
      expect((await call(post(body()))).status).toBe(503);
    }
  });
});
