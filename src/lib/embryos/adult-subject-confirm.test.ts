import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADULT_SUBJECT_STATEMENTS } from "@/copy/family/adult-subject-statements";
import { legacyContactDigest } from "@/lib/hmac-keyring";
import { POST } from "@/app/api/withdraw/session/route";
import {
  ADULT_SUBJECT_STATEMENT_KEYS,
  ADULT_SUBJECT_STATEMENTS_SHA256,
  adultSubjectStatementsDigest,
  loadAdultSubjectReview,
  mintAdultSubjectPresentation,
  readAdultSubjectPresentation,
} from "./adult-subject-review";
import { mintPublicFormToken } from "./operation-token";
import { newRightsSessionSecret, RIGHTS_COOKIE_NAME, rightsSessionHash } from "./rights-session";

/**
 * D-103, the Path A confirm on api.withdraw: the body names the five
 * server-published statement keys, each ticked, with the presentation the
 * page was served. The route finds the session, the form and the account
 * first (an unreadable target is the opaque 404), then holds the body to the
 * offer and answers every fault with invalid-request-v1, the register's
 * answer, before any database write.
 */

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), account: vi.fn(), rows: vi.fn(), reads: [] as string[] }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      let columns = "";
      const builder = {
        select(selected: string) { columns = selected; return builder; },
        eq() { return builder; },
        is() { return builder; },
        gt() { return builder; },
        maybeSingle: async () => {
          mocks.reads.push(table);
          return { data: mocks.rows(table, columns) ?? null, error: null };
        },
      };
      return builder;
    },
  }),
}));
vi.mock("@/lib/account-deletion", () => ({ getSensitiveAccountContext: mocks.account, isSameOrigin: vi.fn() }));

const register = JSON.parse(readFileSync("docs/route-register.json", "utf8")) as {
  routes: { id: string; requestContract?: { oneOfClosedBodies?: Record<string, unknown>[] } }[];
  responseContracts: Record<string, { status: number }>;
  responseContractBindings: { routes: Record<string, string[]> };
};

const secret = newRightsSessionSecret();
const hash = rightsSessionHash(secret);
const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INVITER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUBJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const INVITED = "invited-person@example.invalid";
const BODY_SHA = "d".repeat(64);
const KEYS = ADULT_SUBJECT_STATEMENT_KEYS;

const account = (overrides: Partial<{ id: string; email: string | undefined; email_confirmed_at: string | null }> = {}) => ({
  user: { id: ACCOUNT, email: "Invited-Person@Example.invalid", email_confirmed_at: "2026-09-01T00:00:00Z", ...overrides },
  sessionId: "auth-session",
});

/** The rows a pending Path A invitation reads back as, table by table. */
function offerRows(flow = "path-a-own-account") {
  return (table: string, columns: string) => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    switch (table) {
      case "rights_sessions": return { token_hash_id: "token-hash-id", purpose: "adult-subject-invitation",
        target_kind: "subject", target_id: SUBJECT, principal_id: "principal", authority_revision: 1,
        status: "active", expires_at: future };
      case "token_hashes": return { candidate_id: "candidate", token_hash: "e".repeat(64), token_revision: 1 };
      case "token_candidates": return { target_id: "invitation" };
      case "subject_invitations": return { id: "invitation", email_hmac: legacyContactDigest(INVITED) };
      case "adult_subject_drafts": return columns === "adult_flow" ? { adult_flow: flow } : { id: "draft", owner_account_id: INVITER };
      case "subject_principals": return { id: "principal" };
      case "consent_artifacts": return { version: 1, effective_on: "2026-09-01", summary_markdown: "Summary.",
        body_markdown: "Body.", body_sha256: BODY_SHA };
      default: return null;
    }
  };
}

const presentation = (overrides: Partial<Parameters<typeof mintAdultSubjectPresentation>[0]> = {}, now = Date.now()) =>
  mintAdultSubjectPresentation({ sessionHash: hash, artifactVersion: 1, artifactBodySha256: BODY_SHA, ...overrides }, now);

function confirmBody(artifact: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    operation: "confirm",
    nonce: mintPublicFormToken("adult-subject-respond", Date.now(), hash),
    subjectArtifact: {
      artifactVersion: 1, artifactPresentationToken: presentation(), affirmed: true, statementKeys: [...KEYS], ...artifact,
    },
    ...extra,
  };
}

function request(body: unknown) {
  return new Request("https://inherit.bio/api/withdraw/session", {
    method: "POST",
    headers: { origin: "https://inherit.bio", "sec-fetch-site": "same-origin", "content-type": "application/json",
      cookie: `${RIGHTS_COOKIE_NAME}=${secret}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
  vi.stubEnv("INHERIT_HMAC_KEYRING", "");
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
  vi.clearAllMocks();
  mocks.reads.length = 0;
  mocks.rpc.mockReset().mockResolvedValue({ data: "accepted", error: null });
  mocks.account.mockReset().mockResolvedValue(account());
  mocks.rows.mockReset().mockImplementation(offerRows());
});
afterEach(() => vi.unstubAllEnvs());

async function expectInvalid(body: unknown, issues: string[]) {
  const response = await POST(request(body));
  expect(response.status).toBe(register.responseContracts["invalid-request-v1"]!.status);
  expect(await response.json()).toEqual({ error: "invalid_request", issues });
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(mocks.rpc).not.toHaveBeenCalled();
}

async function expectOpaque(body: unknown) {
  const response = await POST(request(body));
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
  expect(mocks.rpc).not.toHaveBeenCalled();
}

describe("the register this confirm answers to", () => {
  it("asks for exact, server-published, individually actuated statement keys and answers faults with invalid-request-v1", () => {
    const withdraw = register.routes.find(route => route.id === "api.withdraw")!;
    const confirm = withdraw.requestContract!.oneOfClosedBodies!
      .find(body => "subjectArtifact" in body) as { subjectArtifact: { statementKeys: string } };
    expect(confirm.subjectArtifact.statementKeys).toMatch(/^exact-server-published-.*-with-every-item-individually-actuated$/);
    expect((withdraw.requestContract as { unknownMissingInvalidOrAmbiguous?: string }).unknownMissingInvalidOrAmbiguous)
      .toBe("invalid-request-v1");
    expect(register.responseContractBindings.routes["api.withdraw"]).toEqual(expect.arrayContaining(
      ["invalid-request-v1", "resource-not-found-v1", "rights-operation-accepted-v1"]));
  });

  it("publishes the five signed keys and their sentences under one digest", () => {
    expect(KEYS).toEqual(["age-18-plus", "mailbox-control", "no-inviter-access", "identity-not-verified", "revocable"]);
    expect(adultSubjectStatementsDigest(ADULT_SUBJECT_STATEMENTS)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the page publishes the statements, and a presentation the confirm accepts, only to the account that may accept", () => {
  it("serves the five sentences and a presentation bound to this session, artifact and list", async () => {
    const review = await loadAdultSubjectReview(request({}));
    expect(review?.acceptanceBlockedBy).toBeNull();
    expect(review?.confirmation?.statements).toEqual(ADULT_SUBJECT_STATEMENTS.map(({ key, text }) => ({ key, text })));
    expect(readAdultSubjectPresentation(review!.confirmation!.presentationToken)).toMatchObject({
      sessionHash: hash, artifactKey: "consent.subject-adult", artifactVersion: 1, artifactBodySha256: BODY_SHA,
      statementsSha256: ADULT_SUBJECT_STATEMENTS_SHA256 });
    // What the page served is what the confirm takes.
    const response = await POST(request({ operation: "confirm", nonce: review!.nonce, subjectArtifact: {
      artifactVersion: review!.artifact.version, artifactPresentationToken: review!.confirmation!.presentationToken,
      affirmed: true, statementKeys: review!.confirmation!.statements.map(statement => statement.key) } }));
    expect(response.status).toBe(202);
  });

  it("serves neither to a signed-out reader, another address or the inviter", async () => {
    for (const [context, blocked] of [[null, "sign-in"], [account({ email: "someone-else@example.invalid" }), "other-account"],
      [account({ id: INVITER }), "other-account"], [account({ email_confirmed_at: null }), "other-account"]] as const) {
      mocks.account.mockResolvedValue(context);
      const review = await loadAdultSubjectReview(request({}));
      expect(review?.acceptanceBlockedBy).toBe(blocked);
      expect(review?.confirmation).toBeNull();
    }
  });
});

describe("POST /api/withdraw/session, Path A confirm with the five statements (D-103)", () => {
  it("accepts the exact published list and hands the database the account, never the keys' text", async () => {
    const body = confirmBody();
    const response = await POST(request(body));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted", operation: "confirm" });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("respond_adult_subject_invitation_session_v1", {
      p_session_hash: hash, p_action: "confirm", p_nonce: expect.any(String), p_account_id: ACCOUNT,
      p_account_email_hmac_set: expect.objectContaining({ 1: legacyContactDigest(INVITED) }),
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(INVITED);
    expect(mocks.reads).toContain("consent_artifacts");
  });

  it.each(KEYS.map((key, index) => [key, index] as const))("refuses the list without %s", async (_key, index) => {
    await expectInvalid(confirmBody({ statementKeys: KEYS.filter((_, at) => at !== index) }), ["subjectArtifact.statementKeys"]);
  });

  it("refuses an extra key, a reordered list and a repeated key, because the register says exact", async () => {
    await expectInvalid(confirmBody({ statementKeys: [...KEYS, "extra-statement"] }), ["subjectArtifact.statementKeys"]);
    await expectInvalid(confirmBody({ statementKeys: [KEYS[1], KEYS[0], ...KEYS.slice(2)] }), ["subjectArtifact.statementKeys"]);
    await expectInvalid(confirmBody({ statementKeys: [...KEYS.slice(0, 4), KEYS[0]] }), ["subjectArtifact.statementKeys"]);
    await expectInvalid(confirmBody({ statementKeys: [...KEYS, KEYS[4]] }), ["subjectArtifact.statementKeys"]);
    await expectInvalid(confirmBody({ statementKeys: [] }), ["subjectArtifact.statementKeys"]);
    await expectInvalid(confirmBody({ statementKeys: [1, 2, 3, 4, 5] }), ["subjectArtifact.statementKeys"]);
  });

  it("refuses a page served under a stale published list, even when the keys are the current five", async () => {
    const september = ADULT_SUBJECT_STATEMENTS.map(statement => statement.key !== "revocable" ? statement
      : { key: statement.key, text: "I can take this back at any time, and Inherit deletes what was built from my file on the deadlines it publishes." });
    const stale = presentation({ statementsSha256: adultSubjectStatementsDigest(september) });
    await expectInvalid(confirmBody({ artifactPresentationToken: stale }), ["subjectArtifact.artifactPresentationToken"]);
    // The register's four-item reading of the same body is a stale list too.
    const four = presentation({ statementsSha256: adultSubjectStatementsDigest(ADULT_SUBJECT_STATEMENTS.slice(0, 4)) });
    await expectInvalid(confirmBody({ artifactPresentationToken: four, statementKeys: KEYS.slice(0, 4) }),
      ["subjectArtifact.artifactPresentationToken", "subjectArtifact.statementKeys"]);
  });

  it("refuses a presentation that is not this page's: another session, artifact, body, an old or a forged one", async () => {
    const other = rightsSessionHash(newRightsSessionSecret());
    for (const token of [
      presentation({ sessionHash: other }),
      presentation({ artifactVersion: 2 }),
      presentation({ artifactBodySha256: "0".repeat(64) }),
      presentation({}, Date.now() - 9 * 60 * 1000 - 1),
      `${presentation().split(".")[0]}.${"0".repeat(64)}`,
      "x".repeat(40),
    ]) await expectInvalid(confirmBody({ artifactPresentationToken: token }), ["subjectArtifact.artifactPresentationToken"]);
  });

  it("refuses the old bare confirm and every other body that is not the registered one", async () => {
    const nonce = mintPublicFormToken("adult-subject-respond", Date.now(), hash);
    await expectInvalid({ operation: "confirm", nonce }, ["subjectArtifact"]);
    await expectInvalid(confirmBody({ affirmed: false }), ["subjectArtifact.affirmed"]);
    await expectInvalid(confirmBody({ artifactVersion: 2 }), ["subjectArtifact.artifactVersion"]);
    await expectInvalid(confirmBody({ typedName: "Synthetic Person" }), ["subjectArtifact"]);
    await expectInvalid(confirmBody({}, { jurisdictionCode: "GB" }), ["body"]);
    await expectInvalid(confirmBody({}, { accountId: ACCOUNT }), ["body"]);
    const withoutKeys: Record<string, unknown> = { ...confirmBody().subjectArtifact };
    delete withoutKeys.statementKeys;
    await expectInvalid({ ...confirmBody(), subjectArtifact: withoutKeys }, ["subjectArtifact.statementKeys"]);
  });

  it("answers the opaque 404 before judging any field when the target is not this account's to accept", async () => {
    const broken = confirmBody({ statementKeys: ["extra-statement"] });
    mocks.account.mockResolvedValue(null);
    await expectOpaque(broken);
    mocks.account.mockResolvedValue(account({ email_confirmed_at: null }));
    await expectOpaque(broken);
    mocks.account.mockResolvedValue(account({ email: "someone-else@example.invalid" }));
    await expectOpaque(broken);
    mocks.account.mockResolvedValue(account({ id: INVITER }));
    await expectOpaque(broken);
    mocks.account.mockResolvedValue(account());
    mocks.rows.mockImplementation(offerRows("path-b-subject-esignature"));
    await expectOpaque(broken);
    mocks.rows.mockImplementation(() => null);
    await expectOpaque(broken);
  });

  it("never reads an account or the offer for a form this session was not served", async () => {
    for (const nonce of [
      mintPublicFormToken("invitation-refuse", Date.now(), hash),
      mintPublicFormToken("adult-subject-respond", Date.now(), rightsSessionHash(newRightsSessionSecret())),
      mintPublicFormToken("adult-subject-respond", Date.now() - 600_001, hash),
    ]) await expectOpaque({ ...confirmBody({ statementKeys: [] }), nonce });
    expect(mocks.account).not.toHaveBeenCalled();
    expect(mocks.reads).toEqual([]);
  });

  it("reports no acceptance the database did not make", async () => {
    for (const outcome of [{ data: "unavailable", error: null }, { data: "accepted", error: { message: "private" } }]) {
      mocks.rpc.mockReset().mockResolvedValue(outcome);
      const response = await POST(request(confirmBody()));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  });

  it("keeps refusing and deleting to the operation and nonce, with no account and no statements", async () => {
    mocks.rpc.mockResolvedValue({ data: "refused", error: null });
    const nonce = mintPublicFormToken("adult-subject-respond", Date.now(), hash);
    const response = await POST(request({ operation: "refuse", nonce }));
    expect(response.status).toBe(202);
    expect(mocks.account).not.toHaveBeenCalled();
    mocks.rpc.mockClear();
    await expectOpaque({ operation: "refuse", nonce, subjectArtifact: confirmBody().subjectArtifact });
  });
});
