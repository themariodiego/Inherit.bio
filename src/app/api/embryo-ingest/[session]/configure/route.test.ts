import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/embryo-ingest/[session]/configure` (ADR 0035). Every refusal and
 * every success branch of the route, against a mocked database. The database
 * half is proved by `supabase/tests/embryo_vcf_configure_route.sql`.
 *
 * Synthetic values only: the header lines are the public chromosome 1 lengths
 * and reference names the product parser pins; nothing is anyone's data.
 */
const ACCOUNT = "12345678-1234-4234-8234-000000000001";
const AUTH_SESSION = "12345678-1234-4234-8234-0000000000a1";
const SESSION = "12345678-1234-4234-8234-0000000000c1";
const COHORT = "12345678-1234-4234-8234-0000000000e1";
const ORIGIN = "https://inherit.bio";
const COOKIE_VALUE = "C".repeat(43);
const EXPIRES_AT = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
const GRCH38 = ["##fileformat=VCFv4.2", "##reference=GRCh38", "##contig=<ID=chr1,length=248956422>"];
const SENSITIVE_LINE = "##contig=<ID=chr1,length=248956422,assembly=GRCh38,synthetic=marker-7Q>";

type Rpc = { name: string; args: Record<string, unknown> };
const mocks = vi.hoisted(() => ({
  account: null as { user: { id: string }; sessionId: string } | null,
  calls: [] as Rpc[],
  authorize: null as { data: unknown; error: { code?: string } | null } | null,
  configure: null as { data: unknown; error: { code?: string } | null } | null,
  unwindThrows: false,
}));

vi.mock("@/lib/account-deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-deletion")>()),
  getSensitiveAccountContext: async () => mocks.account,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      mocks.calls.push({ name, args });
      if (name === "authorize_embryo_ingest_request_v1") return mocks.authorize;
      if (name === "configure_embryo_vcf_ingest_v1") return mocks.configure;
      if (name === "prepare_embryo_ingest_unwind_v1") {
        if (mocks.unwindThrows) throw new Error("synthetic dispatch failure");
        return { data: { status: "storage_pending" }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    // The acting account's declared jurisdiction (G5.1a).
    from: () => ({ select: () => ({ in: async (_column: string, ids: string[]) => ({
      data: ids.map((id) => ({ id, jurisdiction_code: "GB" })), error: null,
    }) }) }),
  }),
}));

vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const { POST } = await import("./route");
const { mintIngestSessionOperation, readEmbryoOperation } = await import("@/lib/embryos/operation-token");

function authorized(overrides: Record<string, unknown> = {}) {
  return {
    status: "authorized", session: SESSION, cohortId: COHORT, uploadId: "12345678-1234-4234-8234-0000000000d1",
    ingestRevision: 4, expiresAt: EXPIRES_AT, challengeHash: null, transportRevision: 1,
    build: null, format: null, sampleCount: 3,
    handles: [0, 1, 2].map((ordinal) => ({ ordinal, hash: String(ordinal).repeat(64) })),
    ...overrides,
  };
}

function openNonce(overrides: Partial<{ accountId: string; sessionId: string; targetId: string }> = {},
  operation: "ingest_session_open" | "ingest_complete" = "ingest_session_open") {
  return mintIngestSessionOperation({
    accountId: ACCOUNT, sessionId: AUTH_SESSION, targetId: SESSION, operation, ...overrides,
  }, new Date(EXPIRES_AT));
}

let nonce = openNonce();
function body(overrides: Record<string, unknown> = {}) {
  return { format: "vcf", buildEvidence: GRCH38, sampleCount: 3, nonce: nonce.token, ...overrides };
}

function post(payload: unknown, headers: Record<string, string> = {}, session = SESSION) {
  return new Request(`${ORIGIN}/api/embryo-ingest/${session}/configure`, {
    method: "POST",
    headers: {
      origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json",
      cookie: `inherit-ingest-${session}=${COOKIE_VALUE}`, ...headers,
    },
    body: JSON.stringify(payload),
  });
}

function call(request: Request, session = SESSION) {
  return POST(request, { params: Promise.resolve({ session }) });
}

const named = (name: string) => mocks.calls.filter((entry) => entry.name === name);
const sha = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

beforeEach(() => {
  mocks.account = { user: { id: ACCOUNT }, sessionId: AUTH_SESSION };
  mocks.calls = [];
  mocks.authorize = { data: authorized(), error: null };
  mocks.configure = { data: { status: "configured", build: "GRCh38", revision: 912_345_678 }, error: null };
  mocks.unwindThrows = false;
  nonce = openNonce();
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
});

describe("authority before anything is read", () => {
  it("refuses a request with no account", async () => {
    mocks.account = null;
    const response = await call(post(body()));
    expect(response.status).toBe(401);
    expect(mocks.calls).toEqual([]);
  });

  it("refuses a cross-site request or one without exact Origin", async () => {
    const variants: Record<string, string>[] = [
      { "sec-fetch-site": "cross-site" }, { origin: "https://elsewhere.example" }, { "sec-fetch-site": "same-site" },
    ];
    for (const headers of variants) {
      const response = await call(post(body(), headers));
      expect(response.status).toBe(403);
    }
    expect(mocks.calls).toEqual([]);
  });

  it("refuses outside TEST-LOCAL with the capability refusal, before the database", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    const response = await call(post(body()));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("jurisdiction_unavailable");
    expect(mocks.calls).toEqual([]);
  });

  it("answers a malformed session id, a query string or a missing cookie with the opaque 404", async () => {
    expect((await call(post(body(), {}, "not-a-session"), "not-a-session")).status).toBe(404);
    const query = new Request(`${ORIGIN}/api/embryo-ingest/${SESSION}/configure?build=GRCh38`, {
      method: "POST", body: JSON.stringify(body()),
      headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json",
        cookie: `inherit-ingest-${SESSION}=${COOKIE_VALUE}` },
    });
    expect((await call(query)).status).toBe(404);
    expect((await call(post(body(), { cookie: "" }))).status).toBe(404);
    expect(mocks.calls).toEqual([]);
  });

  it("passes the database only server-derived credentials", async () => {
    await call(post(body()));
    expect(named("authorize_embryo_ingest_request_v1")[0].args).toEqual({
      p_account_id: ACCOUNT, p_auth_session_id: AUTH_SESSION, p_ingest_session_id: SESSION,
      p_cookie_hash: sha(COOKIE_VALUE), p_origin: ORIGIN, p_test_jurisdiction: true,
    });
  });

  it("answers a foreign or unknown session with the opaque 404 and reads no body", async () => {
    mocks.authorize = { data: null, error: { code: "42501" } };
    const request = post(body());
    const response = await call(request);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(request.bodyUsed).toBe(false);
    expect(named("configure_embryo_vcf_ingest_v1")).toEqual([]);
  });

  it("dispatches the unwind for an attempt already failure-pending, and answers 404", async () => {
    mocks.authorize = { data: { status: "failure_pending", cohortId: COHORT, ingestRevision: 4 }, error: null };
    const request = post(body());
    const response = await call(request);
    expect(response.status).toBe(404);
    expect(request.bodyUsed).toBe(false);
    expect(named("prepare_embryo_ingest_unwind_v1").map((entry) => entry.args))
      .toEqual([{ p_cohort_id: COHORT, p_ingest_revision: 4 }]);
    expect(named("configure_embryo_vcf_ingest_v1")).toEqual([]);
  });
});

describe("the closed body, refused in memory as a retryable invalid request", () => {
  /**
   * Planted regression: remove the prefix check from `readConfigureBody` and
   * this fails, because the request reaches the configure transaction.
   */
  it.each([
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE_A\tSAMPLE_B\tSAMPLE_C",
    "##SAMPLE=<ID=SAMPLE_A>",
    "##PEDIGREE=<Child=SAMPLE_A>",
    "##source=SyntheticCaller",
  ])("refuses the forbidden line %j before any write, audit or log", async (line) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await call(post(body({ buildEvidence: [...GRCH38, line] })));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["buildEvidence"] });
    expect(named("configure_embryo_vcf_ingest_v1")).toEqual([]);
    expect(named("prepare_embryo_ingest_unwind_v1")).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    log.mockRestore();
    info.mockRestore();
  });

  it.each([
    ["sample names", { sampleNames: ["SAMPLE_A"] }, ["body"]],
    ["a declared reference build", { referenceBuild: "GRCh38" }, ["body"]],
    ["a declared build", { build: "GRCh38" }, ["body"]],
    ["a sex field", { sex: "unknown" }, ["body"]],
    ["a table format", { format: "pgt_table" }, ["format"]],
    ["a zero sample count", { sampleCount: 0 }, ["sampleCount"]],
    ["a missing nonce", { nonce: undefined }, ["nonce"]],
    ["65 lines", { buildEvidence: Array.from({ length: 65 }, () => "##reference=GRCh38") }, ["buildEvidence"]],
  ])("refuses %s", async (_label, overrides, issues) => {
    const response = await call(post(body(overrides)));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues });
    expect(named("configure_embryo_vcf_ingest_v1")).toEqual([]);
  });
});

describe("the one-time nonce from upload-session-v1", () => {
  it.each([
    ["another upload session", () => openNonce({ targetId: "12345678-1234-4234-8234-0000000000c2" }).token],
    ["another auth session", () => openNonce({ sessionId: "12345678-1234-4234-8234-0000000000a2" }).token],
    ["another account", () => openNonce({ accountId: "12345678-1234-4234-8234-000000000002" }).token],
    ["the completion operation", () => openNonce({}, "ingest_complete").token],
    ["a forged token", () => `${nonce.token.split(".")[0]}.${"0".repeat(64)}`],
    ["a bare nonce", () => nonce.nonce],
  ])("answers a nonce for %s with the opaque 404", async (_label, token) => {
    const response = await call(post(body({ nonce: token() })));
    expect(response.status).toBe(404);
    expect(named("configure_embryo_vcf_ingest_v1")).toEqual([]);
  });

  it("answers an already configured session with the opaque 404, whatever its format", async () => {
    for (const overrides of [{ format: "vcf", build: "GRCh38", challengeHash: "a".repeat(64) },
      { format: "pgt_table" }, { challengeHash: "a".repeat(64) }]) {
      mocks.calls = [];
      mocks.authorize = { data: authorized(overrides), error: null };
      expect((await call(post(body()))).status).toBe(404);
      expect(named("configure_embryo_vcf_ingest_v1")).toEqual([]);
    }
  });
});

describe("configured", () => {
  it("answers embryo-vcf-transport-v1 with the server-derived build and fresh credentials", async () => {
    const response = await call(post(body()));
    expect(response.status).toBe(200);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const answer = await response.json();
    expect(Object.keys(answer).sort()).toEqual(["build", "challenge", "completionNonce", "csrfToken", "revision"]);
    expect(answer.build).toBe("GRCh38");
    expect(answer.revision).toBe(912_345_678);
    expect(answer.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [configure] = named("configure_embryo_vcf_ingest_v1");
    const completion = readEmbryoOperation(answer.completionNonce);
    const csrf = readEmbryoOperation(answer.csrfToken);
    expect(completion).toMatchObject({ accountId: ACCOUNT, sessionId: AUTH_SESSION, operation: "ingest_complete",
      targetKind: "ingest_session", targetId: SESSION, expiresAt: Date.parse(EXPIRES_AT) });
    expect(csrf).toMatchObject({ accountId: ACCOUNT, sessionId: AUTH_SESSION, operation: "ingest_complete_csrf",
      targetKind: "ingest_session", targetId: SESSION, expiresAt: Date.parse(EXPIRES_AT) });
    expect(configure.args).toEqual({
      p_account_id: ACCOUNT, p_auth_session_id: AUTH_SESSION, p_ingest_session_id: SESSION,
      p_cookie_hash: sha(COOKIE_VALUE), p_origin: ORIGIN, p_cohort_id: COHORT, p_ingest_revision: 4,
      p_build: "GRCh38", p_sample_count: 3, p_nonce: nonce.nonce, p_challenge: answer.challenge,
      p_completion_nonce: completion!.nonce, p_csrf_nonce: csrf!.nonce, p_test_jurisdiction: true,
    });
  });

  it("never sends a submitted line to the database or back to the caller, and logs nothing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await call(post(body({ buildEvidence: ["##fileformat=VCFv4.2", SENSITIVE_LINE] })));
    expect(response.status).toBe(200);
    const text = await response.text();
    const sent = JSON.stringify(mocks.calls);
    for (const fragment of ["marker-7Q", "##contig", "##fileformat", "assembly="]) {
      expect(sent).not.toContain(fragment);
      expect(text).not.toContain(fragment);
    }
    expect(log).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    log.mockRestore();
    info.mockRestore();
    warn.mockRestore();
  });

  it("derives GRCh37 from the header and never takes a build from the caller", async () => {
    mocks.configure = { data: { status: "configured", build: "GRCh37", revision: 5 }, error: null };
    const response = await call(post(body({ buildEvidence: ["##reference=file:///ref/hg19.fa"] })));
    expect(response.status).toBe(200);
    expect(named("configure_embryo_vcf_ingest_v1")[0].args.p_build).toBe("GRCh37");
  });

  it("refuses to answer when the database records a build this route did not derive", async () => {
    mocks.configure = { data: { status: "configured", build: "GRCh37", revision: 5 }, error: null };
    expect((await call(post(body()))).status).toBe(503);
  });

  it("issues a different challenge and token pair on every request", async () => {
    const first = await (await call(post(body()))).json();
    nonce = openNonce();
    const second = await (await call(post(body()))).json();
    expect(second.challenge).not.toBe(first.challenge);
    expect(second.completionNonce).not.toBe(first.completionNonce);
    expect(second.csrfToken).not.toBe(first.csrfToken);
  });
});

describe("terminal branches", () => {
  it.each([
    [[] as string[]],
    [["##fileformat=VCFv4.2"]],
    [["##reference=GRCh38", "##contig=<ID=1,length=249250621>"]],
    [["##reference=NCBI36"]],
  ])("sends no build for %j, and answers build_unknown after dispatching the unwind", async (lines) => {
    mocks.configure = { data: { status: "terminal", branch: "build_unknown", cohortId: COHORT, ingestRevision: 4 }, error: null };
    const response = await call(post(body({ buildEvidence: lines })));
    expect(named("configure_embryo_vcf_ingest_v1")[0].args.p_build).toBeNull();
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "build_unknown", next: { labelCopyId: "upload.build.ask-laboratory", route: "/embryos/request-data" },
    });
    expect(named("prepare_embryo_ingest_unwind_v1").map((entry) => entry.args))
      .toEqual([{ p_cohort_id: COHORT, p_ingest_revision: 4 }]);
  });

  it.each([
    ["cohort_single_sample", 1],
    ["sample_count_mismatch", 2],
    ["sample_count_mismatch", Number.MAX_SAFE_INTEGER],
  ] as const)("answers %s for %d sample columns after dispatching the unwind", async (branch, sampleCount) => {
    mocks.configure = { data: { status: "terminal", branch, cohortId: COHORT, ingestRevision: 4 }, error: null };
    const response = await call(post(body({ sampleCount })));
    expect(named("configure_embryo_vcf_ingest_v1")[0].args.p_sample_count).toBe(sampleCount);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: branch });
    expect(named("prepare_embryo_ingest_unwind_v1")).toHaveLength(1);
  });

  it("still answers the terminal branch when the dispatch itself fails", async () => {
    mocks.unwindThrows = true;
    mocks.configure = { data: { status: "terminal", branch: "cohort_single_sample", cohortId: COHORT, ingestRevision: 4 }, error: null };
    const response = await call(post(body({ sampleCount: 1 })));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "cohort_single_sample" });
  });

  it("refuses a build branch the route did not ask for", async () => {
    mocks.configure = { data: { status: "terminal", branch: "build_unknown", cohortId: COHORT, ingestRevision: 4 }, error: null };
    expect((await call(post(body()))).status).toBe(503);
    expect(named("prepare_embryo_ingest_unwind_v1")).toHaveLength(1);
  });

  it("answers an attempt the transaction found failure-pending with 404 after dispatching", async () => {
    mocks.configure = { data: { status: "failure_pending", cohortId: COHORT, ingestRevision: 4 }, error: null };
    const response = await call(post(body()));
    expect(response.status).toBe(404);
    expect(named("prepare_embryo_ingest_unwind_v1")).toHaveLength(1);
  });
});

describe("database refusals", () => {
  it.each(["42501", "23505", "55000", "P0002"])("answers %s with the opaque 404", async (code) => {
    mocks.configure = { data: null, error: { code } };
    const response = await call(post(body()));
    expect(response.status).toBe(404);
    expect(named("prepare_embryo_ingest_unwind_v1")).toEqual([]);
  });

  it("answers contention and anything unexpected with the retryable 503", async () => {
    for (const result of [
      { data: null, error: { code: "55P03" } },
      { data: null, error: { code: "22023" } },
      { data: { status: "configured", build: "GRCh38", revision: 9, challenge: "leak" }, error: null },
      { data: null, error: null },
    ]) {
      mocks.configure = result;
      expect((await call(post(body()))).status).toBe(503);
    }
  });
});
