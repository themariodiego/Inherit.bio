import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST`/`PUT /api/embryo-ingest/[session]/mapping` (ADR 0037). Every
 * refusal and every answer of the route, against a mocked database. The
 * database half is proved by `supabase/tests/embryo_table_mapping_route.sql`.
 *
 * Synthetic values only: the header cells are invented column names, and
 * `PRIVATE_*` marks every string that must never leave this route.
 */
const ACCOUNT = "12345678-1234-4234-8234-000000000001";
const AUTH_SESSION = "12345678-1234-4234-8234-0000000000a1";
const SESSION = "12345678-1234-4234-8234-0000000000c1";
const COHORT = "12345678-1234-4234-8234-0000000000e1";
const ORIGIN = "https://inherit.bio";
const COOKIE_VALUE = "C".repeat(43);
const EXPIRES_AT = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
const CHALLENGE_EXPIRES = new Date(Date.now() + 10 * 60 * 1000).toISOString();
/** Ambiguous: two genotype columns. The table's own names never leave. */
const AMBIGUOUS = ["Embryo", "Chromosome", "Position", "Genotype", "Call", "PRIVATE_NOTE"];
const COMPLETE = ["Embryo", "Chromosome", "Position", "Genotype"];

type Rpc = { name: string; args: Record<string, unknown> };
type Result = { data: unknown; error: { code?: string } | null };
const mocks = vi.hoisted(() => ({
  account: null as { user: { id: string }; sessionId: string } | null,
  calls: [] as Rpc[],
  authorize: null as Result | null,
  inspect: null as Result | null,
  decide: null as Result | null,
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
      if (name === "inspect_embryo_table_mapping_v1") return mocks.inspect;
      if (name === "decide_embryo_table_mapping_v1") return mocks.decide;
      if (name === "prepare_embryo_ingest_unwind_v1") {
        if (mocks.unwindThrows) throw new Error("synthetic dispatch failure");
        return { data: { status: "storage_pending" }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from: () => ({ select: () => ({ in: async (_column: string, ids: string[]) => ({
      data: ids.map((id) => ({ id, jurisdiction_code: "GB" })), error: null,
    }) }) }),
  }),
}));

vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const { POST, PUT } = await import("./route");
const { mintIngestSessionOperation, readEmbryoOperation } = await import("@/lib/embryos/operation-token");

function authorized(overrides: Record<string, unknown> = {}) {
  return {
    status: "authorized", session: SESSION, cohortId: COHORT, uploadId: "12345678-1234-4234-8234-0000000000d1",
    ingestRevision: 4, expiresAt: EXPIRES_AT, challengeHash: null, transportRevision: 1,
    build: null, format: "pgt_table", sampleCount: 2,
    handles: [0, 1].map((ordinal) => ({ ordinal, hash: String(ordinal).repeat(64) })),
    ...overrides,
  };
}

type Operation = "ingest_mapping_inspect" | "ingest_mapping_decide" | "ingest_session_open" | "ingest_complete";
function token(operation: Operation, overrides: Partial<{ accountId: string; sessionId: string; targetId: string }> = {}) {
  return mintIngestSessionOperation({ accountId: ACCOUNT, sessionId: AUTH_SESSION, targetId: SESSION, operation, ...overrides },
    new Date(EXPIRES_AT));
}

let inspection = token("ingest_mapping_inspect");
let decision = token("ingest_mapping_decide");
const CHALLENGE_ID = "K".repeat(43);

function request(method: "POST" | "PUT", payload: unknown, headers: Record<string, string> = {}, session = SESSION) {
  return new Request(`${ORIGIN}/api/embryo-ingest/${session}/mapping`, {
    method,
    headers: {
      origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json",
      cookie: `inherit-ingest-${session}=${COOKIE_VALUE}`, ...headers,
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}
const inspect = (payload: unknown, headers?: Record<string, string>, session = SESSION) =>
  POST(request("POST", payload, headers, session), { params: Promise.resolve({ session }) });
const decide = (payload: unknown, headers?: Record<string, string>, session = SESSION) =>
  PUT(request("PUT", payload, headers, session), { params: Promise.resolve({ session }) });
const header = (headerColumns: string[] = AMBIGUOUS, nonce = inspection.token) => ({ headerColumns, nonce });
const columns = (mappings: unknown = [{ columnIndex: 3, field: "genotype" }], nonce = decision.token) =>
  ({ challengeId: CHALLENGE_ID, mappings, nonce });
const build = (referenceBuild: unknown = "GRCh38", nonce = decision.token) => ({ challengeId: CHALLENGE_ID, referenceBuild, nonce });

const named = (name: string) => mocks.calls.filter((entry) => entry.name === name);
const sha = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const challenge = (kind: "columns" | "build") => ({ data: { status: "challenge", kind, revision: 77, expiresAt: CHALLENGE_EXPIRES }, error: null });
const transport = (built: "GRCh37" | "GRCh38" = "GRCh38") => ({ data: { status: "transport", build: built, revision: 912_345_678 }, error: null });

beforeEach(() => {
  mocks.account = { user: { id: ACCOUNT }, sessionId: AUTH_SESSION };
  mocks.calls = [];
  mocks.authorize = { data: authorized(), error: null };
  mocks.inspect = challenge("columns");
  mocks.decide = challenge("build");
  mocks.unwindThrows = false;
  inspection = token("ingest_mapping_inspect");
  decision = token("ingest_mapping_decide");
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
});

describe("authority before anything is read, on both methods", () => {
  it.each([["POST", inspect, header()], ["PUT", decide, columns()]] as const)("%s refuses a request with no account", async (_method, send, body) => {
    mocks.account = null;
    expect((await send(body)).status).toBe(401);
    expect(mocks.calls).toEqual([]);
  });

  it.each([["POST", inspect, header()], ["PUT", decide, columns()]] as const)("%s refuses a cross-site request", async (_method, send, body) => {
    for (const headers of [{ "sec-fetch-site": "cross-site" }, { origin: "https://elsewhere.example" }] as Record<string, string>[]) {
      expect((await send(body, headers)).status).toBe(403);
    }
    expect(mocks.calls).toEqual([]);
  });

  it.each([["POST", inspect, header()], ["PUT", decide, columns()]] as const)("%s refuses outside TEST-LOCAL before the database", async (_method, send, body) => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    const response = await send(body);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("jurisdiction_unavailable");
    expect(mocks.calls).toEqual([]);
  });

  it("answers a malformed session id, a query string or a missing cookie with the opaque 404", async () => {
    expect((await inspect(header(), {}, "not-a-session")).status).toBe(404);
    expect((await inspect(header(), { cookie: "" })).status).toBe(404);
    const query = new Request(`${ORIGIN}/api/embryo-ingest/${SESSION}/mapping?build=GRCh38`, {
      method: "POST", body: JSON.stringify(header()),
      headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json",
        cookie: `inherit-ingest-${SESSION}=${COOKIE_VALUE}` },
    });
    expect((await POST(query, { params: Promise.resolve({ session: SESSION }) })).status).toBe(404);
    expect(mocks.calls).toEqual([]);
  });

  it("passes the database only server-derived credentials", async () => {
    await inspect(header());
    expect(named("authorize_embryo_ingest_request_v1")[0].args).toEqual({
      p_account_id: ACCOUNT, p_auth_session_id: AUTH_SESSION, p_ingest_session_id: SESSION,
      p_cookie_hash: sha(COOKIE_VALUE), p_origin: ORIGIN, p_test_jurisdiction: true,
    });
  });

  it("answers a foreign session with the opaque 404 and reads no body", async () => {
    mocks.authorize = { data: null, error: { code: "42501" } };
    const sent = request("POST", header());
    expect((await POST(sent, { params: Promise.resolve({ session: SESSION }) })).status).toBe(404);
    expect(sent.bodyUsed).toBe(false);
    expect(named("inspect_embryo_table_mapping_v1")).toEqual([]);
  });

  it("dispatches the unwind for an attempt already failure-pending, and answers 404", async () => {
    mocks.authorize = { data: { status: "failure_pending", cohortId: COHORT, ingestRevision: 4 }, error: null };
    expect((await decide(columns())).status).toBe(404);
    expect(named("prepare_embryo_ingest_unwind_v1").map((entry) => entry.args)).toEqual([{ p_cohort_id: COHORT, p_ingest_revision: 4 }]);
    expect(named("decide_embryo_table_mapping_v1")).toEqual([]);
  });

  it("acts only on a table session whose transport is not yet issued", async () => {
    for (const overrides of [{ format: "vcf" }, { format: null }, { challengeHash: "a".repeat(64), build: "GRCh38" }]) {
      mocks.calls = [];
      mocks.authorize = { data: authorized(overrides), error: null };
      expect((await inspect(header())).status).toBe(404);
      expect((await decide(columns())).status).toBe(404);
      expect(named("inspect_embryo_table_mapping_v1")).toEqual([]);
      expect(named("decide_embryo_table_mapping_v1")).toEqual([]);
    }
  });
});

describe("POST: the bounded header copy", () => {
  it.each([
    ["no columns", { headerColumns: [] }, ["headerColumns"]],
    ["129 columns", { headerColumns: Array.from({ length: 129 }, (_, index) => `C${index}`) }, ["headerColumns"]],
    ["an empty cell", { headerColumns: ["Embryo", ""] }, ["headerColumns"]],
    ["an 81-character cell", { headerColumns: ["Embryo", "x".repeat(81)] }, ["headerColumns"]],
    ["a control character", { headerColumns: ["Embryo\tSex"] }, ["headerColumns"]],
    ["a missing nonce", { nonce: undefined }, ["nonce"]],
    ["an example value", { examples: ["PRIVATE_A"] }, ["body"]],
    ["a sample label", { sampleLabel: "PRIVATE_A" }, ["body"]],
  ])("refuses %s as a retryable invalid request, before the database", async (_label, overrides, issues) => {
    const response = await inspect({ ...header(), ...overrides });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues });
    expect(named("inspect_embryo_table_mapping_v1")).toEqual([]);
    expect(named("prepare_embryo_ingest_unwind_v1")).toEqual([]);
  });

  it("refuses a non-JSON or encoded body as the body", async () => {
    for (const headers of [{ "content-type": "text/plain" }, { "content-encoding": "gzip" }] as Record<string, string>[]) {
      expect(await (await inspect(header(), headers)).json()).toEqual({ error: "invalid_request", issues: ["body"] });
    }
    expect(await (await inspect("{not json")).json()).toEqual({ error: "invalid_request", issues: ["body"] });
  });

  it.each([
    ["the upload session's own nonce", () => token("ingest_session_open").token],
    ["a decision nonce", () => token("ingest_mapping_decide").token],
    ["another upload session", () => token("ingest_mapping_inspect", { targetId: "12345678-1234-4234-8234-0000000000c2" }).token],
    ["another account", () => token("ingest_mapping_inspect", { accountId: "12345678-1234-4234-8234-000000000002" }).token],
    ["a forged token", () => `${inspection.token.split(".")[0]}.${"0".repeat(64)}`],
    ["the bare inner nonce", () => inspection.nonce],
  ])("answers %s with the opaque 404", async (_label, value) => {
    expect((await inspect(header(AMBIGUOUS, value()))).status).toBe(404);
    expect(named("inspect_embryo_table_mapping_v1")).toEqual([]);
  });

  /**
   * The register's forbidden headers, refused in memory before anything
   * derived from the header is written. Planted regression: drop the
   * forbidden check from `inspectHeader` and the outcome becomes a challenge.
   */
  it.each(["Sex", "Gender", "Karyotype", "Biological sex", "Male", "female", "X", "Y", "M", "MT", "Embryo sex", "Sex chromosomes"])(
    "refuses the header %j terminally, before anything derived is written", async (cell) => {
      mocks.inspect = { data: { status: "terminal", branch: "header", cohortId: COHORT, ingestRevision: 4 }, error: null };
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await inspect(header([...COMPLETE, cell]));
      expect(response.status).toBe(404);
      const [sent] = named("inspect_embryo_table_mapping_v1");
      expect(sent.args).toMatchObject({ p_outcome: "header", p_column_count: null, p_locus: null, p_challenge: null,
        p_next_nonce: null, p_completion_nonce: null, p_csrf_nonce: null, p_nonce: inspection.nonce });
      expect(named("prepare_embryo_ingest_unwind_v1").map((entry) => entry.args)).toEqual([{ p_cohort_id: COHORT, p_ingest_revision: 4 }]);
      // A one- or two-letter name is matched as a whole JSON string, so a
      // random token that happens to hold the letter is not a false finding.
      const needle = cell.length > 2 ? cell : JSON.stringify(cell);
      expect(JSON.stringify(mocks.calls)).not.toContain(needle);
      expect(await response.text()).not.toContain(needle);
      expect(log).not.toHaveBeenCalled();
      log.mockRestore();
    });

  it("refuses a forbidden column even when the rest of the header is not a table", async () => {
    mocks.inspect = { data: { status: "terminal", branch: "header", cohortId: COHORT, ingestRevision: 4 }, error: null };
    await inspect(header(["Well", "Sex"]));
    expect(named("inspect_embryo_table_mapping_v1")[0].args.p_outcome).toBe("header");
  });

  it.each([
    ["not a table under the header rule", ["Well", "Plate", "Note"], "format"],
    ["a table whose plan has no column left to choose", ["Embryo", "Chromosome", "Position"], "mapping"],
  ] as const)("refuses a header that is %s terminally", async (_label, cells, branch) => {
    mocks.inspect = { data: { status: "terminal", branch, cohortId: COHORT, ingestRevision: 4 }, error: null };
    expect((await inspect(header([...cells]))).status).toBe(404);
    expect(named("inspect_embryo_table_mapping_v1")[0].args.p_outcome).toBe(branch);
    expect(named("prepare_embryo_ingest_unwind_v1")).toHaveLength(1);
  });

  it("answers a column challenge with neutral column numbers, canonical candidates and one decision nonce", async () => {
    const response = await inspect(header());
    expect(response.status).toBe(200);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const answer = await response.json();
    expect(Object.keys(answer).sort()).toEqual(["challengeId", "decisions", "expiresAt", "kind", "maximumDecisions", "nonce"]);
    expect(answer).toMatchObject({ kind: "columns", maximumDecisions: 4, expiresAt: CHALLENGE_EXPIRES,
      decisions: [
        { sourceColumn: "Column 4", columnIndex: 3, candidateFields: ["genotype"] },
        { sourceColumn: "Column 5", columnIndex: 4, candidateFields: ["genotype"] },
      ] });
    expect(answer.challengeId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const next = readEmbryoOperation(answer.nonce);
    expect(next).toMatchObject({ operation: "ingest_mapping_decide", targetKind: "ingest_session", targetId: SESSION,
      accountId: ACCOUNT, sessionId: AUTH_SESSION, expiresAt: Date.parse(EXPIRES_AT) });
    expect(named("inspect_embryo_table_mapping_v1")[0].args).toEqual({
      p_account_id: ACCOUNT, p_auth_session_id: AUTH_SESSION, p_ingest_session_id: SESSION,
      p_cookie_hash: sha(COOKIE_VALUE), p_origin: ORIGIN, p_cohort_id: COHORT, p_ingest_revision: 4,
      p_outcome: "columns", p_column_count: 6, p_locus: "chrom-pos", p_nonce: inspection.nonce,
      p_challenge: answer.challengeId, p_next_nonce: next!.nonce, p_completion_nonce: null, p_csrf_nonce: null,
      p_test_jurisdiction: true,
    });
  });

  it("never sends a header string to the database or back to the caller, and logs nothing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const text = await (await inspect(header())).text();
    for (const cell of ["PRIVATE_NOTE", "Genotype", "Call", "Embryo", "Chromosome"]) {
      expect(JSON.stringify(mocks.calls)).not.toContain(cell);
      expect(text).not.toContain(cell);
    }
    expect(log).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    log.mockRestore();
    info.mockRestore();
  });

  it("asks the build question before any chunk when the header resolves and the build is decision-required", async () => {
    mocks.inspect = challenge("build");
    const answer = await (await inspect(header(COMPLETE))).json();
    expect(answer).toEqual({
      kind: "build", challengeId: answer.challengeId, questionCopyId: "upload.build.question",
      options: [
        { value: "GRCh37", labelCopyId: "upload.build.grch37" },
        { value: "GRCh38", labelCopyId: "upload.build.grch38" },
        { value: "unknown", labelCopyId: "upload.build.unknown", route: "/embryos/request-data" },
      ],
      expiresAt: CHALLENGE_EXPIRES, nonce: answer.nonce,
    });
    expect(readEmbryoOperation(answer.nonce)?.operation).toBe("ingest_mapping_decide");
    expect(named("inspect_embryo_table_mapping_v1")[0].args).toMatchObject({ p_outcome: "build", p_column_count: null,
      p_locus: "chrom-pos", p_challenge: answer.challengeId });
  });

  it("answers the transport at once when the header resolves and the build was stated", async () => {
    mocks.authorize = { data: authorized({ build: "GRCh37" }), error: null };
    mocks.inspect = transport("GRCh37");
    const answer = await (await inspect(header(["Sample", "SNP", "Genotype"]))).json();
    expect(Object.keys(answer).sort()).toEqual(["build", "challenge", "completionNonce", "csrfToken", "kind", "revision"]);
    expect(answer).toMatchObject({ kind: "transport", build: "GRCh37", revision: 912_345_678 });
    const completion = readEmbryoOperation(answer.completionNonce);
    const csrf = readEmbryoOperation(answer.csrfToken);
    expect(completion?.operation).toBe("ingest_complete");
    expect(csrf?.operation).toBe("ingest_complete_csrf");
    expect(named("inspect_embryo_table_mapping_v1")[0].args).toMatchObject({ p_outcome: "transport", p_locus: "rsid",
      p_challenge: answer.challenge, p_next_nonce: null, p_completion_nonce: completion!.nonce, p_csrf_nonce: csrf!.nonce });
  });

  it("refuses to answer when the database's outcome is not the one this route decided", async () => {
    for (const [result, cells] of [
      [challenge("build"), AMBIGUOUS],
      [transport(), COMPLETE],
      [{ data: { status: "terminal", branch: "format", cohortId: COHORT, ingestRevision: 4 }, error: null }, AMBIGUOUS],
    ] as const) {
      mocks.inspect = result;
      expect((await inspect(header([...cells]))).status).toBe(503);
    }
  });

  it("dispatches the unwind for an attempt the transaction found failure-pending", async () => {
    mocks.inspect = { data: { status: "failure_pending", cohortId: COHORT, ingestRevision: 4 }, error: null };
    expect((await inspect(header())).status).toBe(404);
    expect(named("prepare_embryo_ingest_unwind_v1")).toHaveLength(1);
  });

  it("still answers the terminal 404 when the dispatch itself fails", async () => {
    mocks.unwindThrows = true;
    mocks.inspect = { data: { status: "terminal", branch: "header", cohortId: COHORT, ingestRevision: 4 }, error: null };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await inspect(header([...COMPLETE, "Sex"]))).status).toBe(404);
  });

  it.each(["42501", "23505", "55000", "P0002"])("answers %s with the opaque 404", async (code) => {
    mocks.inspect = { data: null, error: { code } };
    expect((await inspect(header())).status).toBe(404);
    expect(named("prepare_embryo_ingest_unwind_v1")).toEqual([]);
  });

  it("answers contention, a contract breach and an unexpected shape with the retryable 503", async () => {
    for (const result of [{ data: null, error: { code: "55P03" } }, { data: null, error: { code: "22023" } },
      { data: { status: "challenge", kind: "columns", revision: 7, expiresAt: CHALLENGE_EXPIRES, header: "leak" }, error: null },
      { data: null, error: null }]) {
      mocks.inspect = result;
      expect((await inspect(header())).status).toBe(503);
    }
  });
});

describe("PUT: one closed decision on the current challenge", () => {
  it.each([
    ["an unknown field", { ...columns(), header: "PRIVATE_NOTE" }],
    ["a source label", { ...columns(), sourceLabel: "PRIVATE_A" }],
    ["an embryo label", { ...build(), embryoLabel: "PRIVATE_A" }],
    ["a sex field", { ...columns(), sex: "XX" }],
    ["a genotype value", { ...columns(), genotypeValue: "AG" }],
    ["a build threshold", { ...build(), buildThreshold: 0.5 }],
    ["both shapes at once", { ...columns(), referenceBuild: "GRCh38" }],
    ["neither shape", { challengeId: CHALLENGE_ID, nonce: "x" }],
    ["a short challenge id", { ...columns(), challengeId: "short" }],
    ["no mappings", columns([])],
    ["five mappings", columns([0, 1, 2, 3, 4].map((columnIndex) => ({ columnIndex, field: "genotype" })))],
    ["a repeated column", columns([{ columnIndex: 3, field: "genotype" }, { columnIndex: 3, field: "sample" }])],
    ["a repeated field", columns([{ columnIndex: 3, field: "genotype" }, { columnIndex: 4, field: "genotype" }])],
    ["sample and embryo together", columns([{ columnIndex: 0, field: "sample" }, { columnIndex: 1, field: "embryo" }])],
    ["a non-canonical field", columns([{ columnIndex: 3, field: "sex" }])],
    ["a column index of 128", columns([{ columnIndex: 128, field: "genotype" }])],
    ["a fractional index", columns([{ columnIndex: 1.5, field: "genotype" }])],
    ["a label inside a mapping", columns([{ columnIndex: 3, field: "genotype", label: "PRIVATE_NOTE" }])],
    ["another build name", build("hg38")],
    ["a non-JSON body", "{not json"],
  ])("answers %s with the retryable opaque 404, before the database", async (_label, body) => {
    expect((await decide(body)).status).toBe(404);
    expect(named("decide_embryo_table_mapping_v1")).toEqual([]);
    expect(named("prepare_embryo_ingest_unwind_v1")).toEqual([]);
  });

  it.each([
    ["the inspection nonce", () => token("ingest_mapping_inspect").token],
    ["the completion nonce", () => token("ingest_complete").token],
    ["another upload session", () => token("ingest_mapping_decide", { targetId: "12345678-1234-4234-8234-0000000000c2" }).token],
    ["another auth session", () => token("ingest_mapping_decide", { sessionId: "12345678-1234-4234-8234-0000000000a2" }).token],
  ])("answers a nonce for %s with the opaque 404", async (_label, value) => {
    expect((await decide(columns(undefined, value()))).status).toBe(404);
    expect(named("decide_embryo_table_mapping_v1")).toEqual([]);
  });

  it("follows a column decision with the build question while the build is decision-required", async () => {
    const response = await decide(columns());
    expect(response.status).toBe(200);
    const answer = await response.json();
    expect(answer).toMatchObject({ kind: "build", questionCopyId: "upload.build.question", expiresAt: CHALLENGE_EXPIRES });
    const next = readEmbryoOperation(answer.nonce);
    expect(next?.operation).toBe("ingest_mapping_decide");
    expect(named("decide_embryo_table_mapping_v1")[0].args).toEqual({
      p_account_id: ACCOUNT, p_auth_session_id: AUTH_SESSION, p_ingest_session_id: SESSION,
      p_cookie_hash: sha(COOKIE_VALUE), p_origin: ORIGIN, p_cohort_id: COHORT, p_ingest_revision: 4,
      p_challenge: CHALLENGE_ID, p_resolution: [{ columnIndex: 3, field: "genotype" }], p_nonce: decision.nonce,
      p_build_challenge: answer.challengeId, p_build_nonce: next!.nonce,
      p_transport_challenge: null, p_completion_nonce: null, p_csrf_nonce: null, p_test_jurisdiction: true,
    });
    expect(answer.challengeId).not.toBe(CHALLENGE_ID);
  });

  it("follows a column decision with the transport when the header stated the build", async () => {
    mocks.authorize = { data: authorized({ build: "GRCh38" }), error: null };
    mocks.decide = transport("GRCh38");
    const answer = await (await decide(columns())).json();
    expect(answer).toMatchObject({ kind: "transport", build: "GRCh38", revision: 912_345_678 });
    expect(named("decide_embryo_table_mapping_v1")[0].args).toMatchObject({ p_build_challenge: null, p_build_nonce: null,
      p_transport_challenge: answer.challenge });
  });

  it("answers a build decision with the transport, the completion nonce and the CSRF token, never an empty 204", async () => {
    mocks.decide = transport("GRCh37");
    const response = await decide(build("GRCh37"));
    expect(response.status).toBe(200);
    const answer = await response.json();
    expect(Object.keys(answer).sort()).toEqual(["build", "challenge", "completionNonce", "csrfToken", "kind", "revision"]);
    const completion = readEmbryoOperation(answer.completionNonce);
    const csrf = readEmbryoOperation(answer.csrfToken);
    expect(named("decide_embryo_table_mapping_v1")[0].args).toMatchObject({ p_resolution: { referenceBuild: "GRCh37" },
      p_transport_challenge: answer.challenge, p_completion_nonce: completion!.nonce, p_csrf_nonce: csrf!.nonce });
    expect(answer.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("ends the upload on unknown: buildUnknown, after the unwind is dispatched", async () => {
    mocks.decide = { data: { status: "terminal", branch: "build_unknown", cohortId: COHORT, ingestRevision: 4 }, error: null };
    const response = await decide(build("unknown"));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "build_unknown", next: { labelCopyId: "upload.build.ask-laboratory", route: "/embryos/request-data" },
    });
    expect(named("prepare_embryo_ingest_unwind_v1")).toHaveLength(1);
  });

  it("refuses a build the database records that is not the one answered", async () => {
    mocks.decide = transport("GRCh37");
    expect((await decide(build("GRCh38"))).status).toBe(503);
    mocks.decide = { data: { status: "terminal", branch: "build_unknown", cohortId: COHORT, ingestRevision: 4 }, error: null };
    expect((await decide(build("GRCh38"))).status).toBe(503);
    mocks.decide = challenge("columns");
    expect((await decide(columns())).status).toBe(503);
  });

  it("answers an expired, stale or cross-kind challenge the transaction marked failure-pending with 404", async () => {
    mocks.decide = { data: { status: "failure_pending", cohortId: COHORT, ingestRevision: 4 }, error: null };
    expect((await decide(columns())).status).toBe(404);
    expect(named("prepare_embryo_ingest_unwind_v1")).toHaveLength(1);
  });

  it.each(["42501", "23505", "55000", "P0002", "22023"])("answers %s, which changed nothing, with the opaque 404", async (code) => {
    mocks.decide = { data: null, error: { code } };
    expect((await decide(columns())).status).toBe(404);
    expect(named("prepare_embryo_ingest_unwind_v1")).toEqual([]);
  });

  it("answers contention and an unexpected shape with the retryable 503", async () => {
    for (const result of [{ data: null, error: { code: "55P03" } }, { data: null, error: null },
      { data: { status: "resolved", kind: "columns" }, error: null }]) {
      mocks.decide = result;
      expect((await decide(columns())).status).toBe(503);
    }
  });

  it("carries no CSRF header requirement: the session CSRF rule belongs to completion", async () => {
    mocks.decide = transport();
    expect((await decide(build())).status).toBe(200);
  });
});
