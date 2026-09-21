import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT = "12345678-1234-4234-8234-000000000001";
const SESSION = "12345678-1234-4234-8234-0000000000a1";
const DRAFT = "12345678-1234-4234-8234-0000000000b1";
const INGEST_SESSION = "12345678-1234-4234-8234-0000000000c1";
const SECRET = "A".repeat(43);
const CHALLENGE = "kZ9Qd3yQ8wq7fF2bN5hT1xV4cR6sJ0mL2pY8uW3aE7g";
const ORIGIN = "https://inherit.bio";

const mocks = vi.hoisted(() => ({
  account: null as { user: { id: string }; sessionId: string } | null,
  claims: null as { nonce: string } | null,
  verified: [] as unknown[],
  rpc: [] as Array<[string, Record<string, unknown>]>,
  result: null as unknown,
  error: null as { code?: string; message?: string } | null,
}));

// Only the account context is replaced: `isSameOrigin`, which `originDenied`
// reaches through, lives in this module too and must stay real.
vi.mock("@/lib/account-deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-deletion")>()),
  getSensitiveAccountContext: async () => mocks.account,
}));
vi.mock("@/lib/embryos/operation-token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/embryos/operation-token")>()),
  verifyEmbryoOperation: (token: string, expected: unknown) => {
    mocks.verified.push({ token, expected });
    return mocks.claims;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      mocks.rpc.push([name, args]);
      return { data: mocks.result, error: mocks.error };
    },
  }),
}));

// `originDenied` resolves this deployment's own origin, and `app-origin.ts`
// refuses to guess one. Stubbed before the route is imported.
vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);

const { POST } = await import("./route");

function mint(overrides: Record<string, unknown> = {}) {
  return {
    session: INGEST_SESSION,
    uploadId: "12345678-1234-4234-8234-0000000000d1",
    cookieValue: SECRET,
    challenge: CHALLENGE,
    revision: 1,
    sampleHandles: [{ ordinal: 0, handle: "handle-zero" }],
    expiresAt: "2026-09-22T12:00:00.000Z",
    ...overrides,
  };
}

function cohort(overrides: Record<string, unknown> = {}) {
  return {
    cohort_id: "12345678-1234-4234-8234-0000000000e1",
    embryo_count: 1,
    recipient_set_revision: 3,
    key_revision: 1,
    caller_state: "not_a_card_recipient",
    cards: [],
    ...overrides,
  };
}

const BODY = {
  cohortDraftId: DRAFT,
  insuranceAcknowledgementId: "12345678-1234-4234-8234-0000000000f1",
  futurePersonCharterAcknowledgementId: "12345678-1234-4234-8234-000000000f02",
  nonce: "sealed.token",
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/embryo-cohorts`, {
    method: "POST",
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.account = { user: { id: ACCOUNT }, sessionId: SESSION };
  mocks.claims = { nonce: "server-nonce" };
  mocks.verified = [];
  mocks.rpc = [];
  mocks.result = { cohort: cohort(), ingest: mint() };
  mocks.error = null;
});

/**
 * The entry point of embryo ingest. Every authority decision belongs to the
 * one database transaction; what this route owns is authority in and
 * credentials out, so those are what these cases hold it to.
 */
describe("POST /api/embryo-cohorts", () => {
  it("refuses a request with no account before reading anything", async () => {
    mocks.account = null;
    const response = await POST(post(BODY));
    expect(response.status).toBe(401);
    expect(mocks.rpc).toEqual([]);
  });

  it("refuses a cross-site request", async () => {
    const response = await POST(post(BODY, { origin: "https://elsewhere.example", "sec-fetch-site": "cross-site" }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.rpc).toEqual([]);
  });

  /**
   * The register answers unknown, missing, invalid, stale and ambiguous alike
   * with `resource-not-found-v1`. A 400 here would tell a prober that the
   * shape was right and something else was wrong.
   */
  it("answers a malformed body with the same not-found as a missing draft", async () => {
    const response = await POST(post({ ...BODY, cohortDraftId: "not-a-uuid" }));
    expect(response.status).toBe(404);
    expect(mocks.rpc).toEqual([]);
  });

  it("refuses a body that carries a server-authoritative field", async () => {
    const response = await POST(post({ ...BODY, embryoCount: 4 }));
    expect(response.status).toBe(404);
    expect(mocks.rpc).toEqual([]);
  });

  /**
   * The token must have been minted for this exact account, session,
   * operation and draft. A token good for one draft must not finalize
   * another, which is what binding the target id here is for.
   */
  it("binds the operation token to the acting account, session, operation and draft", async () => {
    await POST(post(BODY));
    expect(mocks.verified).toEqual([
      {
        token: "sealed.token",
        expected: {
          accountId: ACCOUNT,
          sessionId: SESSION,
          operation: "cohort_finalize",
          targetKind: "cohort_draft",
          targetId: DRAFT,
        },
      },
    ]);
  });

  it("answers not-found when the token is not ours", async () => {
    mocks.claims = null;
    const response = await POST(post(BODY));
    expect(response.status).toBe(404);
    expect(mocks.rpc).toEqual([]);
  });

  /** The account and session reach the database from the session, never the body. */
  it("passes the acting identity from the session context, not the request", async () => {
    await POST(post({ ...BODY }));
    const [name, args] = mocks.rpc[0];
    expect(name).toBe("finalize_embryo_cohort_ingest_v1");
    expect(args.p_account_id).toBe(ACCOUNT);
    expect(args.p_auth_session_id).toBe(SESSION);
    expect(args.p_draft_id).toBe(DRAFT);
    expect(args.p_token_nonce).toBe("server-nonce");
    expect(args.p_origin).toBe(ORIGIN);
  });

  it("creates the cohort and answers the register's 201", async () => {
    const response = await POST(post(BODY));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.status).toBe("upload_ready");
    expect(body.embryo_count).toBe(1);
    expect(body.upload_session.transport).toBe("embryo-chunks");
    expect(body.upload_session.session).toBe(INGEST_SESSION);
  });

  /**
   * The one that would be a disclosure. The upload session's secret leaves
   * only inside the cookie and the mapping challenge does not leave at all.
   */
  it("puts the upload secret in an HttpOnly cookie and neither secret in the body", async () => {
    const response = await POST(post(BODY));
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`inherit-ingest-${INGEST_SESSION}=${SECRET}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");

    const text = await response.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(CHALLENGE);
  });

  it("sets no cookie when the result is one it cannot represent", async () => {
    const broken = mint();
    delete (broken as Record<string, unknown>).cookieValue;
    mocks.result = { cohort: cohort(), ingest: broken };
    await expect(POST(post(BODY))).rejects.toThrow();
  });

  it("returns the database's refusal rather than inventing one", async () => {
    mocks.error = { code: "42501", message: "jurisdiction unavailable" };
    const response = await POST(post(BODY));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.rpc).toHaveLength(1);
  });
});
