import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADULT_SUBJECT_STATEMENTS } from "@/copy/family/adult-subject-statements";
import { decryptSecret } from "@/lib/crypto";
import { legacyContactDigest } from "@/lib/hmac-keyring";
import { POST as ACCEPT } from "@/app/api/invitations/accept/route";
import { POST as WITHDRAW } from "@/app/api/withdraw/session/route";
import {
  ADULT_SUBJECT_STATEMENT_KEYS,
  ADULT_SUBJECT_STATEMENTS_SHA256,
  adultSubjectStatementsDigest,
  loadAdultSubjectReview,
  mintAdultSubjectPresentation,
  readAdultSubjectPresentation,
} from "./adult-subject-review";
import { mintEmbryoOperation, mintPublicFormToken, readEmbryoOperation } from "./operation-token";
import { newRightsSessionSecret, RIGHTS_COOKIE_NAME, rightsSessionHash } from "./rights-session";

/**
 * D-103, Path A, accepted through the person's own account on the route the
 * register names, api.invitation-accept (owner decisions of 23 October 2026:
 * "D-103: Path A acceptance includes a typed name", and G8.5's code to the
 * register). The body names the five server-published statement keys, each
 * ticked, with the presentation the page was served and the person's typed
 * name. The route finds the session, the account and the offer first, then
 * holds the body to the offer; every fault is the register's opaque 404
 * (unknownMissingInvalidStaleOrKindMismatch) before any database write. The
 * name reaches the database only as Path B's ciphertext and is never logged
 * or returned. api.withdraw no longer confirms Path A: a confirm sent there
 * on a Path A session is invalid-request-v1, with no account read and no
 * write; refusing and deleting stay there unchanged.
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
vi.mock("@/lib/account-deletion", () => ({ getSensitiveAccountContext: mocks.account, isSameOrigin: () => true }));
// The one-time X-Inherit-CSRF gate passes through here; it is tested on both
// routes, through the same handlers, in src/lib/security/session-csrf-routes.test.ts.
vi.mock("@/lib/security/session-csrf", async (importOriginal) =>
  (await import("@/lib/security/session-csrf.test-support")).admitEverySessionCsrf(await importOriginal()));

type RegisterBody = Record<string, unknown> & { subjectArtifact?: Record<string, unknown> };
const register = JSON.parse(readFileSync("docs/route-register.json", "utf8")) as {
  routes: { id: string; requestContract?: { oneOfClosedBodies?: RegisterBody[] } & Record<string, unknown> }[];
  policyContracts: Record<string, { modes?: Record<string, { route?: string; noAccountRoute?: string }> }>;
  responseContracts: Record<string, { status: number; oneOfClosedBodies?: Record<string, unknown>[] }>;
  responseContractBindings: { routes: Record<string, string[]> };
};
const route = (id: string) => register.routes.find(entry => entry.id === id)!;

const secret = newRightsSessionSecret();
const hash = rightsSessionHash(secret);
const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AUTH_SESSION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INVITER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUBJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const INVITED = "invited-person@example.invalid";
const BODY_SHA = "d".repeat(64);
const KEYS = ADULT_SUBJECT_STATEMENT_KEYS;
/** A synthetic name; the suite proves it never leaves the route as text. */
const NAME = "Synthetic Invitee";

const account = (overrides: Partial<{ id: string; email: string | undefined; email_confirmed_at: string | null }> = {}) => ({
  user: { id: ACCOUNT, email: "Invited-Person@Example.invalid", email_confirmed_at: "2026-09-01T00:00:00Z", ...overrides },
  sessionId: AUTH_SESSION,
});

/** The rows a pending Path A invitation reads back as, table by table. */
function offerRows(flow = "path-a-own-account", purpose = "adult-subject-invitation") {
  return (table: string, columns: string) => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    switch (table) {
      case "rights_sessions": return { token_hash_id: "token-hash-id", purpose,
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

const acceptNonce = (overrides: Partial<Parameters<typeof mintEmbryoOperation>[0]> = {}, now = Date.now()) =>
  mintEmbryoOperation({ accountId: ACCOUNT, sessionId: AUTH_SESSION, operation: "invitation_accept",
    targetKind: "rights_session", targetId: hash, ...overrides }, now);

function acceptBody(artifact: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    nonce: acceptNonce(),
    subjectArtifact: {
      artifactKey: "consent.subject-adult", artifactVersion: 1, artifactPresentationToken: presentation(),
      affirmed: true, statementKeys: [...KEYS], typedName: NAME, ...artifact,
    },
    ...extra,
  };
}

function request(path: string, body: unknown) {
  return new Request(`https://inherit.bio${path}`, {
    method: "POST",
    headers: { origin: "https://inherit.bio", "sec-fetch-site": "same-origin", "content-type": "application/json",
      cookie: `${RIGHTS_COOKIE_NAME}=${secret}` },
    body: JSON.stringify(body),
  });
}
const accept = (body: unknown) => ACCEPT(request("/api/invitations/accept", body));
const withdraw = (body: unknown) => WITHDRAW(request("/api/withdraw/session", body));

const logged = vi.fn();
beforeEach(() => {
  vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
  vi.stubEnv("INHERIT_HMAC_KEYRING", "");
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
  vi.clearAllMocks();
  mocks.reads.length = 0;
  mocks.rpc.mockReset().mockResolvedValue({ data: SUBJECT, error: null });
  mocks.account.mockReset().mockResolvedValue(account());
  mocks.rows.mockReset().mockImplementation(offerRows());
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logged(...args); });
  }
  logged.mockClear();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function expectOpaque(response: Promise<Response>) {
  const answer = await response;
  expect(answer.status).toBe(register.responseContracts["resource-not-found-v1"]!.status);
  expect(await answer.json()).toEqual({ error: "not_found" });
  expect(mocks.rpc).not.toHaveBeenCalled();
}

/** The one RPC call's arguments, after checking it is the account door. */
function acceptArgs(): Record<string, unknown> {
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.rpc.mock.calls[0]![0]).toBe("accept_adult_subject_invitation_v1");
  return mocks.rpc.mock.calls[0]![1] as Record<string, unknown>;
}

describe("the register this confirmation answers to", () => {
  it("puts Path A's account confirmation on api.invitation-accept, with a typed name, and refuses it on the no-account route", () => {
    const pathA = register.policyContracts["adult-subject-confirmation-v1"]!.modes!["path-a-account-required"]!;
    expect(pathA.route).toBe("api.invitation-accept");
    expect(pathA.noAccountRoute).toBe("absolute-deny");
    const adult = route("api.invitation-accept").requestContract!.oneOfClosedBodies!
      .find(body => body.subjectArtifact?.artifactKey !== undefined)!;
    expect(adult.subjectArtifact).toMatchObject({
      artifactKey: { const: "consent.subject-adult" },
      affirmed: { const: true },
      statementKeys: "exact-server-published-nonempty-array-with-every-item-individually-actuated",
      typedName: "at-least-two-whitespace-separated-tokens-of-at-least-two-characters",
    });
    expect(route("api.invitation-accept").requestContract!.unknownMissingInvalidStaleOrKindMismatch).toBe("resource-not-found-v1");
    expect(register.responseContractBindings.routes["api.invitation-accept"])
      .toEqual(expect.arrayContaining(["invitation-accepted-v1", "resource-not-found-v1"]));
  });

  it("words api.withdraw's confirm list for any exact published list, D-103's five and Path B's own", () => {
    const withdrawEntry = route("api.withdraw");
    const confirms = withdrawEntry.requestContract!.oneOfClosedBodies!.filter(body => "subjectArtifact" in body);
    expect(confirms).toHaveLength(2);
    for (const body of confirms) {
      expect(body.subjectArtifact!.statementKeys).toBe("exact-server-published-nonempty-array-with-every-item-individually-actuated");
    }
    expect(JSON.stringify(withdrawEntry)).not.toContain("four-item-array");
    expect(withdrawEntry.requestContract!.unknownMissingInvalidOrAmbiguous).toBe("invalid-request-v1");
  });

  it("answers acceptance with the adult body of invitation-accepted-v1", () => {
    const contract = register.responseContracts["invitation-accepted-v1"]!;
    expect(contract.status).toBe(200);
    expect(contract.oneOfClosedBodies).toContainEqual({ invitationKind: { const: "adult_subject" }, status: { const: "accepted" },
      subjectId: "opaque-server-owned-subject-id", subjectAccountBound: { const: true },
      accountOrigin: { const: "existing_account" }, activationBlock: { const: "pending_exact_purpose" } });
  });

  it("publishes the five signed keys and their sentences under one digest", () => {
    expect(KEYS).toEqual(["age-18-plus", "mailbox-control", "no-inviter-access", "identity-not-verified", "revocable"]);
    expect(adultSubjectStatementsDigest(ADULT_SUBJECT_STATEMENTS)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the page publishes the statements, a presentation and the accept nonce only to the account that may accept", () => {
  it("serves the five sentences, a presentation bound to this session, and a nonce bound to this account and session", async () => {
    const review = await loadAdultSubjectReview(request("/withdraw/session", {}));
    expect(review?.acceptanceBlockedBy).toBeNull();
    expect(review?.confirmation?.statements).toEqual(ADULT_SUBJECT_STATEMENTS.map(({ key, text }) => ({ key, text })));
    expect(readAdultSubjectPresentation(review!.confirmation!.presentationToken)).toMatchObject({
      sessionHash: hash, artifactKey: "consent.subject-adult", artifactVersion: 1, artifactBodySha256: BODY_SHA,
      statementsSha256: ADULT_SUBJECT_STATEMENTS_SHA256 });
    expect(readEmbryoOperation(review!.confirmation!.nonce)).toMatchObject({
      accountId: ACCOUNT, sessionId: AUTH_SESSION, operation: "invitation_accept", targetKind: "rights_session", targetId: hash });
    // What the page served is what the accept takes.
    const response = await accept({ nonce: review!.confirmation!.nonce, subjectArtifact: {
      artifactKey: "consent.subject-adult", artifactVersion: review!.artifact.version,
      artifactPresentationToken: review!.confirmation!.presentationToken, affirmed: true,
      statementKeys: review!.confirmation!.statements.map(statement => statement.key), typedName: NAME } });
    expect(response.status).toBe(200);
  });

  it("serves neither to a signed-out reader, another address or the inviter", async () => {
    for (const [context, blocked] of [[null, "sign-in"], [account({ email: "someone-else@example.invalid" }), "other-account"],
      [account({ id: INVITER }), "other-account"], [account({ email_confirmed_at: null }), "other-account"]] as const) {
      mocks.account.mockResolvedValue(context);
      const review = await loadAdultSubjectReview(request("/withdraw/session", {}));
      expect(review?.acceptanceBlockedBy).toBe(blocked);
      expect(review?.confirmation).toBeNull();
    }
  });
});

describe("POST /api/invitations/accept, Path A with the five statements and a typed name", () => {
  it("accepts the exact published list and a valid name, and answers the registered adult body", async () => {
    const body = acceptBody();
    const response = await accept(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ invitationKind: "adult_subject", status: "accepted", subjectId: SUBJECT,
      subjectAccountBound: true, accountOrigin: "existing_account", activationBlock: "pending_exact_purpose" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    const args = acceptArgs();
    expect(Object.keys(args).sort()).toEqual(["p_account_email_hmac_set", "p_account_id", "p_auth_session_id", "p_nonce",
      "p_session_hash", "p_signing_name_ciphertext"]);
    expect(args).toMatchObject({ p_session_hash: hash, p_account_id: ACCOUNT, p_auth_session_id: AUTH_SESSION,
      p_nonce: readEmbryoOperation(body.nonce)!.nonce,
      p_account_email_hmac_set: expect.objectContaining({ 1: legacyContactDigest(INVITED) }) });
    expect(mocks.reads).toContain("consent_artifacts");
  });

  it("stores the name the way Path B does: trimmed, encrypted, and never as text", async () => {
    const response = await accept(acceptBody({ typedName: `  ${NAME}  ` }));
    expect(response.status).toBe(200);
    const ciphertext = acceptArgs().p_signing_name_ciphertext as string;
    expect(ciphertext).toMatch(/^\\x[0-9a-f]+$/);
    expect(Buffer.from(ciphertext.slice(2), "hex").length).toBeGreaterThanOrEqual(16);
    expect(decryptSecret(Buffer.from(ciphertext.slice(2), "hex"))).toBe(NAME);
    const sent = JSON.stringify(mocks.rpc.mock.calls);
    for (const plain of [NAME, "Synthetic", "Invitee", INVITED]) expect(sent).not.toContain(plain);
  });

  it("never returns or logs the name, on success or refusal", async () => {
    const success = await accept(acceptBody());
    expect(await success.text()).not.toContain("Synthetic");
    mocks.rpc.mockReset().mockResolvedValue({ data: null, error: { message: "private" } });
    const refused = await accept(acceptBody());
    expect(refused.status).toBe(404);
    expect(await refused.text()).not.toContain("Synthetic");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("Synthetic");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["one token", "Synthetic"],
    ["a second token of one character", "Synthetic I"],
    ["two tokens of one character", "S I"],
    ["over 200 characters", `Synthetic ${"I".repeat(200)}`],
    ["not a string", 42],
  ])("requires a valid typed name: refuses one that is %s", async (_case, typedName) => {
    const artifact: Record<string, unknown> = { ...acceptBody().subjectArtifact, typedName };
    if (typedName === undefined) delete artifact.typedName;
    await expectOpaque(accept({ nonce: acceptNonce(), subjectArtifact: artifact }));
  });

  it("takes any name of two tokens of two characters, in any script", async () => {
    for (const typedName of ["Ab Cd", "Synthetic  Middle  Invitee", "Zoë Ńame", "名前 名字"]) {
      mocks.rpc.mockClear();
      expect((await accept(acceptBody({ typedName }))).status, typedName).toBe(200);
    }
  });

  it.each(KEYS.map((key, index) => [key, index] as const))("refuses the list without %s", async (_key, index) => {
    await expectOpaque(accept(acceptBody({ statementKeys: KEYS.filter((_, at) => at !== index) })));
  });

  it("refuses an extra key, a reordered list and a repeated key, because the register says exact", async () => {
    for (const statementKeys of [[...KEYS, "extra-statement"], [KEYS[1], KEYS[0], ...KEYS.slice(2)],
      [...KEYS.slice(0, 4), KEYS[0]], [...KEYS, KEYS[4]], [], [1, 2, 3, 4, 5]]) {
      await expectOpaque(accept(acceptBody({ statementKeys })));
    }
  });

  it("refuses a page served under a stale published list, even when the keys are the current five", async () => {
    const september = ADULT_SUBJECT_STATEMENTS.map(statement => statement.key !== "revocable" ? statement
      : { key: statement.key, text: "I can take this back at any time, and Inherit deletes what was built from my file on the deadlines it publishes." });
    await expectOpaque(accept(acceptBody({ artifactPresentationToken: presentation({ statementsSha256: adultSubjectStatementsDigest(september) }) })));
    const four = presentation({ statementsSha256: adultSubjectStatementsDigest(ADULT_SUBJECT_STATEMENTS.slice(0, 4)) });
    await expectOpaque(accept(acceptBody({ artifactPresentationToken: four, statementKeys: KEYS.slice(0, 4) })));
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
    ]) await expectOpaque(accept(acceptBody({ artifactPresentationToken: token })));
  });

  it("refuses a nonce that is not this account's, auth session's, operation's or rights session's, or is old", async () => {
    for (const nonce of [
      acceptNonce({ accountId: INVITER }),
      acceptNonce({ sessionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }),
      acceptNonce({ operation: "artifact_sign" }),
      acceptNonce({ targetId: rightsSessionHash(newRightsSessionSecret()) }),
      acceptNonce({}, Date.now() - 600_001),
      mintPublicFormToken("adult-subject-respond", Date.now(), hash),
    ]) await expectOpaque(accept({ ...acceptBody(), nonce }));
  });

  it("refuses every other body: the old api.withdraw body, a wrong key, an unaffirmed one and extra fields", async () => {
    await expectOpaque(accept({ operation: "confirm", nonce: acceptNonce(), subjectArtifact: { artifactVersion: 1,
      artifactPresentationToken: presentation(), affirmed: true, statementKeys: [...KEYS] } }));
    await expectOpaque(accept(acceptBody({ artifactKey: "consent.subject-adult-esignature" })));
    const withoutKey: Record<string, unknown> = { ...acceptBody().subjectArtifact };
    delete withoutKey.artifactKey;
    await expectOpaque(accept({ nonce: acceptNonce(), subjectArtifact: withoutKey }));
    await expectOpaque(accept(acceptBody({ affirmed: false })));
    await expectOpaque(accept(acceptBody({ artifactVersion: 2 })));
    await expectOpaque(accept(acceptBody({}, { jurisdictionCode: "GB" })));
    await expectOpaque(accept(acceptBody({}, { accountId: ACCOUNT })));
    await expectOpaque(accept(acceptBody({}, { withAccount: true })));
  });

  it("answers the opaque 404 before judging any field when the target is not this account's to accept", async () => {
    const broken = acceptBody({ statementKeys: ["extra-statement"], typedName: "x" });
    mocks.account.mockResolvedValue(account({ email_confirmed_at: null }));
    await expectOpaque(accept(broken));
    mocks.account.mockResolvedValue(account({ email: "someone-else@example.invalid" }));
    await expectOpaque(accept(broken));
    mocks.account.mockResolvedValue(account({ id: INVITER }));
    await expectOpaque(accept(broken));
    mocks.account.mockResolvedValue(account());
    mocks.rows.mockImplementation(offerRows("path-b-subject-esignature"));
    await expectOpaque(accept(broken));
    // A co-parent session's cookie: the stored kind is not this body's.
    mocks.rows.mockImplementation(offerRows("path-a-own-account", "co-parent-invitation"));
    await expectOpaque(accept(acceptBody()));
    mocks.rows.mockImplementation(() => null);
    await expectOpaque(accept(acceptBody()));
  });

  it("is the existing 401 for a signed-out request, before any offer is read", async () => {
    mocks.account.mockResolvedValue(null);
    const response = await accept(acceptBody());
    expect(response.status).toBe(401);
    expect(mocks.reads).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reports no acceptance the database did not make", async () => {
    for (const outcome of [{ data: null, error: null }, { data: "dddddddd-0000-4000-8000-000000000000", error: null },
      { data: SUBJECT, error: { message: "private" } }]) {
      mocks.rpc.mockReset().mockResolvedValue(outcome);
      const response = await accept(acceptBody());
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  });
});

describe("POST /api/withdraw/session no longer confirms Path A", () => {
  const formNonce = () => mintPublicFormToken("adult-subject-respond", Date.now(), hash);
  const oldBody = (extra: Record<string, unknown> = {}) => ({ operation: "confirm", nonce: formNonce(), subjectArtifact: {
    artifactVersion: 1, artifactPresentationToken: presentation(), affirmed: true, statementKeys: [...KEYS], ...extra } });

  it("answers the old Path A confirm, with or without a name, with invalid-request-v1 and writes nothing", async () => {
    for (const body of [oldBody(), oldBody({ typedName: NAME }), { operation: "confirm", nonce: formNonce() }]) {
      const response = await withdraw(body);
      expect(response.status).toBe(register.responseContracts["invalid-request-v1"]!.status);
      expect(await response.json()).toEqual({ error: "invalid_request", issues: ["operation"] });
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.account).not.toHaveBeenCalled();
  });

  it("answers the opaque 404 when the session offers no Path A invitation, or the form is not this session's", async () => {
    mocks.rows.mockImplementation(() => null);
    await expectOpaque(withdraw(oldBody()));
    mocks.rows.mockImplementation(offerRows());
    for (const nonce of [
      mintPublicFormToken("invitation-refuse", Date.now(), hash),
      mintPublicFormToken("adult-subject-respond", Date.now(), rightsSessionHash(newRightsSessionSecret())),
      mintPublicFormToken("adult-subject-respond", Date.now() - 600_001, hash),
    ]) await expectOpaque(withdraw({ ...oldBody(), nonce }));
    expect(mocks.account).not.toHaveBeenCalled();
  });

  it("keeps refusing and deleting to the operation and nonce, with no account and no statements", async () => {
    mocks.rpc.mockResolvedValue({ data: "refused", error: null });
    const response = await withdraw({ operation: "refuse", nonce: formNonce() });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted", operation: "refuse" });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("respond_adult_subject_invitation_session_v1",
      { p_session_hash: hash, p_nonce: expect.any(String), p_action: "refuse" });
    expect(mocks.account).not.toHaveBeenCalled();
    mocks.rpc.mockClear();
    await expectOpaque(withdraw({ operation: "refuse", nonce: formNonce(), subjectArtifact: oldBody().subjectArtifact }));
  });
});
