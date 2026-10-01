import crypto from "node:crypto";
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getClaims: vi.fn(), codes: vi.fn(), attestation: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: mocks }) }));
vi.mock("@/lib/legal/jurisdictions", async (original) => {
  const actual = await original<typeof import("@/lib/legal/jurisdictions")>();
  return { ...actual, accountCapability: (id: string, capability: string) => mocks.codes(id, capability) };
});
vi.mock("@/lib/legal/jurisdiction-declaration", async (original) => {
  const actual = await original<typeof import("@/lib/legal/jurisdiction-declaration")>();
  return { ...actual, currentJurisdictionAttestation: () => mocks.attestation() };
});

import { hmacSecret } from "@/lib/crypto";
import { legacyContactDigest } from "@/lib/hmac-keyring";
import { mintPublicFormToken } from "@/lib/embryos/operation-token";
import { newRightsSessionSecret, RIGHTS_COOKIE_NAME, rightsSessionHash } from "@/lib/embryos/rights-session";
import { parseArtifactFile } from "@/lib/legal/artifact-file";
import {
  OTHER_ADULT_UPLOAD_STATEMENT_KEYS,
  SUBJECT_ESIGNATURE_STATEMENT_KEYS,
  adultUploadRevisionBody,
  artifactStatements,
  artifactWarning,
  heldFinalizationReceipt,
  isAdultOn,
  isOtherAdultConsentPayload,
  isOtherAdultStatementSet,
  isPathBDraftPayload,
  isPathBInvitationPayload,
  otherAdultConsentBody,
  otherAdultTypedNameIsValid,
  pathBDraftBody,
  pathBInvitationBody,
  pathBAccountConfirmBody,
  pathBSubjectConfirmBody,
} from "./other-adult-upload";
import {
  mintOtherAdultPresentation,
  mintPathBOperation,
  otherAdultUploadAvailable,
  readOtherAdultPresentation,
  verifyPathBOperation,
} from "./other-adult-upload-server";
import { otherAdultUploadConsent } from "./other-adult-consent-route";
import { createPathBDraft, createPathBInvitation } from "./path-b-routes";
import { answerAdultUploadRevision, confirmPathBSubject, confirmPathBSubjectWithAccount } from "./path-b-respond";
import { mintSubjectPresentation, readAdultUploadRevisionResponse } from "./path-b-review";
import { POST as withdrawSession } from "@/app/api/withdraw/session/route";

const NOW = 1_800_000_000_000;
const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const subjectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const recordId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const requestId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const input = { accountId, sessionId, subjectId, artifactVersion: 1, artifactBodySha256: "a".repeat(64) };
const KEYS = [...OTHER_ADULT_UPLOAD_STATEMENT_KEYS];
const SUBJECT_KEYS = [...SUBJECT_ESIGNATURE_STATEMENT_KEYS];
const KEY_2 = crypto.randomBytes(32).toString("base64");
const NETWORK = "192.0.2.44";

/** The address under every held contact revision, never one bare digest. */
function expectContactSet(args: Record<string, unknown>) {
  expect(args.p_contact_hmac).toBeNull();
  const set = args.p_contact_hmac_set as Record<string, string>;
  expect(Object.keys(set)).toEqual(["1", "2"]);
  expect(set["1"]).toBe(legacyContactDigest("relative@e2e.local"));
  expect(set["2"]).toMatch(/^[0-9a-f]{64}$/);
  expect(set["2"]).not.toBe(set["1"]);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  mocks.getUser.mockResolvedValue({ data: { user: { id: accountId } } });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: accountId, session_id: sessionId } } });
  mocks.codes.mockResolvedValue({ status: "permitted" });
  mocks.attestation.mockResolvedValue({ version: 2, sha256: "f".repeat(64), summary: "S", body: "B" });
  mocks.rpc.mockResolvedValue({ data: { recordKind: "artifact_signature", recordId,
    artifactKey: "consent.upload-other-adult", artifactVersion: 1, signedAt: "2026-09-28T12:00:00+00:00" }, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

function sameOrigin(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", body: JSON.stringify(body),
    headers: { origin: "https://inherit.bio", "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers } });
}

describe("the approved uploader artifact's statements", () => {
  const file = parseArtifactFile(fs.readFileSync("content/legal/consent.upload-other-adult/v2.md", "utf8"))!;
  it("reads one statement per published key and the warning from the signed body itself", () => {
    expect(artifactStatements(file.body)).toHaveLength(KEYS.length);
    expect(artifactStatements(file.body)[0]).toBe("The person whose DNA this is is alive and 18 or older.");
    expect(artifactWarning(file.body)).toBe("Signing this when it is not true is a false statement you are making to us and to the person whose DNA this is. It may be a criminal offence where you live, and you agree to cover our costs if it causes harm.");
    expect(artifactWarning("no warning here")).toBeNull();
  });
  it("accepts only the whole published set, in order", () => {
    expect(isOtherAdultStatementSet(KEYS)).toBe(true);
    expect(isOtherAdultStatementSet(KEYS.slice(1))).toBe(false);
    expect(isOtherAdultStatementSet([...KEYS].reverse())).toBe(false);
    expect(isOtherAdultStatementSet([...KEYS, "extra"])).toBe(false);
  });
  it.each([["Ada Lovelace", true], ["  Ada   Lovelace ", true], ["Ada", false], ["A B", false], ["Ada L", false], ["", false]])(
    "checks a typed name of two parts of two or more letters (%j)", (name, valid) => {
      expect(otherAdultTypedNameIsValid(name)).toBe(valid);
    });
  it("keeps the signing body closed", () => {
    const body = { action: "sign-artifact", signatureClass: "tier2", subjectDraftId: subjectId, artifactVersion: 1,
      artifactPresentationToken: "x".repeat(40), affirmed: true, statementKeys: KEYS, typedName: "Ada Lovelace" };
    expect(otherAdultConsentBody.safeParse(body).success).toBe(true);
    expect(isOtherAdultConsentPayload(body)).toBe(true);
    for (const patch of [{ artifactKey: "consent.upload-other-adult" }, { subjectId }, { signerId: accountId },
      { affirmed: false }, { statementKeys: [] }, { typedName: "" }, { cohortDraftId: subjectId }]) {
      expect(otherAdultConsentBody.safeParse({ ...body, ...patch }).success).toBe(false);
    }
    const { subjectDraftId: _draft, ...withoutDraft } = body;
    expect(_draft).toBe(subjectId);
    expect(isOtherAdultConsentPayload({ ...withoutDraft, subjectId })).toBe(false);
  });
});

describe("the register's file-finalize-v1 other-adult receipt", () => {
  it("is exactly an opaque fileId, the quarantined states and the queued notice", () => {
    const receipt = { fileId: subjectId, status: "stored_quarantined", analysisState: "quarantined", noticeState: "queued" };
    expect(heldFinalizationReceipt.safeParse(receipt).success).toBe(true);
    const { noticeState: _notice, ...withoutNotice } = receipt;
    expect(_notice).toBe("queued");
    expect(heldFinalizationReceipt.safeParse(withoutNotice).success).toBe(false);
    for (const patch of [{ uploadId: subjectId }, { noticeState: "sent" }, { analysisState: "ready_for_processing" },
      { next: { routeId: "api.file-process" } }]) {
      expect(heldFinalizationReceipt.safeParse({ ...receipt, ...patch }).success).toBe(false);
    }
  });
});

describe("the Path B draft and request bodies", () => {
  const draft = { kind: "adult", adultFlow: "path-b-subject-esignature", displayName: "Synthetic Relative",
    dateOfBirth: "1980-05-05", contactEmail: "Relative@E2E.local", requestId };
  it("accepts the register's closed body and normalizes the address", () => {
    const parsed = pathBDraftBody.safeParse(draft);
    expect(parsed.success && parsed.data.contactEmail).toBe("relative@e2e.local");
    expect(isPathBDraftPayload(draft)).toBe(true);
    expect(isPathBDraftPayload({ ...draft, adultFlow: "path-a-own-account" })).toBe(false);
    for (const patch of [{ kind: "other_adult" }, { adultFlow: "path-b-reviewed-document" }, { displayName: "A" },
      { displayName: "Bad\u0007Name" }, { dateOfBirth: "05/05/1980" }, { contactEmail: "not-an-address" },
      { note: "hello" }, { ownerId: accountId }]) {
      expect(pathBDraftBody.safeParse({ ...draft, ...patch }).success).toBe(false);
    }
  });
  it("checks 18 or older on the UTC calendar", () => {
    const today = new Date("2026-09-28T12:00:00Z");
    expect(isAdultOn("2008-09-28", today)).toBe(true);
    expect(isAdultOn("2008-09-29", today)).toBe(false);
    expect(isAdultOn("1899-12-31", today)).toBe(false);
    expect(isAdultOn("2001-02-30", today)).toBe(false);
    expect(isAdultOn("", today)).toBe(false);
  });
  it("sends a request only as the draft and the address, nothing else", () => {
    const body = { targetSubjectDraftId: subjectId, contactEmail: "relative@e2e.local" };
    expect(pathBInvitationBody.safeParse(body).success).toBe(true);
    expect(isPathBInvitationPayload(body)).toBe(true);
    expect(isPathBInvitationPayload({ targetCohortDraftId: subjectId, contactEmail: "x@e2e.local" })).toBe(false);
    for (const patch of [{ note: "hi" }, { kind: "adult" }, { targetCohortDraftId: subjectId }]) {
      expect(pathBInvitationBody.safeParse({ ...body, ...patch }).success).toBe(false);
    }
  });
});

describe("the Path B operation token", () => {
  it("binds account, session, operation and target for ten minutes", () => {
    const token = mintPathBOperation(accountId, sessionId, "request-send", subjectId, NOW);
    const expected = { accountId, sessionId, operation: "request-send" as const, targetId: subjectId };
    expect(verifyPathBOperation(token, expected, NOW)).toBe(true);
    expect(verifyPathBOperation(token, expected, NOW + 599_999)).toBe(true);
    expect(verifyPathBOperation(token, expected, NOW + 600_000)).toBe(false);
    expect(verifyPathBOperation(token, { ...expected, operation: "draft-create" }, NOW)).toBe(false);
    expect(verifyPathBOperation(token, { ...expected, targetId: accountId }, NOW)).toBe(false);
    expect(verifyPathBOperation(token, { ...expected, sessionId: accountId }, NOW)).toBe(false);
    expect(verifyPathBOperation(null, expected, NOW)).toBe(false);
    expect(verifyPathBOperation(`${token.split(".")[0]}.${hmacSecret(token.split(".")[0]!, "embryo-operation-v1")}`, expected, NOW)).toBe(false);
  });
});

describe("the uploader's presentation", () => {
  it("binds account, session, person and exact artifact for nine minutes", () => {
    const { token, claims, nonceHash } = mintOtherAdultPresentation(input, NOW);
    expect(readOtherAdultPresentation(token, NOW)).toEqual(claims);
    expect(claims).toMatchObject(input);
    expect(nonceHash).toBe(crypto.createHash("sha256").update(claims.nonce).digest("hex"));
    expect(readOtherAdultPresentation(token, NOW + 539_999)).toEqual(claims);
    expect(readOtherAdultPresentation(token, NOW + 540_000)).toBeNull();
    expect(readOtherAdultPresentation(token, NOW - 1)).toBeNull();
  });
  it("refuses a token sealed for another purpose, or changed", () => {
    const { token, claims } = mintOtherAdultPresentation(input, NOW);
    const payload = Buffer.from(JSON.stringify({ ...claims, subjectId: accountId })).toString("base64url");
    expect(readOtherAdultPresentation(`${payload}.${token.split(".")[1]}`, NOW)).toBeNull();
    expect(readOtherAdultPresentation(`${token.split(".")[0]}.${hmacSecret(token.split(".")[0]!, "own-upload-artifact-presentation-v1")}`, NOW)).toBeNull();
  });
  it("is available only under TEST-LOCAL and a permitting jurisdiction", async () => {
    expect(await otherAdultUploadAvailable(accountId)).toBe(true);
    mocks.codes.mockResolvedValueOnce({ status: "unreviewed" });
    expect(await otherAdultUploadAvailable(accountId)).toBe(false);
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    expect(await otherAdultUploadAvailable(accountId)).toBe(false);
    expect(mocks.codes).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/consents, the uploader's Tier-2 body", () => {
  function signing(overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const { token } = mintOtherAdultPresentation(input, NOW);
    const payload = { action: "sign-artifact", signatureClass: "tier2", subjectDraftId: subjectId, artifactVersion: 1,
      artifactPresentationToken: token, affirmed: true, statementKeys: KEYS, typedName: "Ada Lovelace", ...overrides };
    return otherAdultUploadConsent(sameOrigin("https://inherit.bio/api/consents", payload,
      { "x-inherit-csrf": token, ...headers }), payload);
  }
  it("records the signature with the exact presented artifact, keys and an encrypted name", async () => {
    const response = await signing();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ recordKind: "artifact_signature", recordId });
    const [name, args] = mocks.rpc.mock.calls[0]!;
    expect(name).toBe("sign_other_adult_upload_artifact_v1");
    expect(args).toMatchObject({ p_account_id: accountId, p_session_id: sessionId, p_subject_id: subjectId,
      p_artifact_version: 1, p_artifact_body_sha256: "a".repeat(64), p_statement_keys: KEYS, p_test_jurisdiction: true });
    expect(args.p_signing_name_ciphertext).toMatch(/^\\x[0-9a-f]+$/);
    expect(args.p_signing_name_ciphertext).not.toContain(Buffer.from("Ada Lovelace").toString("hex"));
    expect(args.p_nonce_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("answers nothing outside TEST-LOCAL", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    expect((await signing()).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses another origin and a missing CSRF echo before any read", async () => {
    expect((await signing({}, { origin: "https://foreign.example" })).status).toBe(403);
    expect((await signing({}, { "x-inherit-csrf": "different" })).status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it("refuses a body that disagrees with its presentation", async () => {
    expect((await signing({ subjectDraftId: accountId })).status).toBe(404);
    expect((await signing({ artifactVersion: 2 })).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses a partial statement set and an invalid typed name", async () => {
    expect((await signing({ statementKeys: KEYS.slice(0, 6) })).status).toBe(422);
    expect((await signing({ typedName: "Ada" })).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", "not_found", 404, "not_found"], ["22023", "invalid_request", 422, "invalid_request"],
    ["55000", "consent_artifact_changed", 409, "consent_artifact_changed"], ["55000", "something_else", 409, "state_conflict"],
    ["XX000", "boom", 503, "unavailable"]])("maps a database refusal %s/%s to %i", async (code, message, status, error) => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message } });
    const response = await signing();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });
});

describe("POST /api/subject-drafts, the Path B body", () => {
  const body = { kind: "adult", adultFlow: "path-b-subject-esignature", displayName: "Synthetic Relative",
    dateOfBirth: "1980-05-05", contactEmail: "relative@e2e.local", requestId };
  const receipt = { subjectDraftId: subjectId, state: "awaiting_uploader_artifact", next: "sign_uploader_artifact",
    expiresAt: "2026-10-28T12:00:00+00:00" };
  function draft(overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    const token = mintPathBOperation(accountId, sessionId, "draft-create", accountId);
    const payload = { ...body, ...overrides };
    return createPathBDraft(sameOrigin("https://inherit.bio/api/subject-drafts", payload,
      { "x-inherit-csrf": token, ...headers }), payload);
  }
  it("reserves a draft with an encrypted address keyed under every held revision, and answers the register's receipt", async () => {
    vi.stubEnv("INHERIT_HMAC_KEYRING", `2:${KEY_2}`);
    mocks.rpc.mockResolvedValueOnce({ data: receipt, error: null });
    const response = await draft();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(receipt);
    const [name, args] = mocks.rpc.mock.calls[0]!;
    expect(name).toBe("create_path_b_adult_draft_v1");
    expect(args).toMatchObject({ p_account_id: accountId, p_session_id: sessionId, p_display_name: "Synthetic Relative",
      p_date_of_birth: "1980-05-05", p_test_jurisdiction: true });
    expectContactSet(args);
    expect(args).not.toHaveProperty("p_quota_keys");
    expect(args.p_contact_ciphertext).toMatch(/^\\x[0-9a-f]+$/);
    expect(JSON.stringify(args)).not.toContain("relative@e2e.local");
    expect(args.p_request_key).toMatch(/^[0-9a-f]{64}$/);
  });
  it.each([["keyed digest set incomplete"], ["keyed digest set required"]])(
    "answers 503 when the database refuses the digest set (%s)", async (message) => {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "55000", message } });
      expect((await draft()).status).toBe(503);
    });
  it("refuses a person under 18 before the database", async () => {
    expect((await draft({ dateOfBirth: `${new Date().getUTCFullYear() - 10}-01-01` })).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses without the page's operation token, from another origin, and outside TEST-LOCAL", async () => {
    expect((await draft({}, { "x-inherit-csrf": "nope" })).status).toBe(403);
    expect((await draft({}, { origin: "https://foreign.example" })).status).toBe(403);
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    expect((await draft()).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/invitations, the Path B request", () => {
  function send(headers: Record<string, string> = {}) {
    const token = mintPathBOperation(accountId, sessionId, "request-send", subjectId);
    const payload = { targetSubjectDraftId: subjectId, contactEmail: "relative@e2e.local" };
    return createPathBInvitation(sameOrigin("https://inherit.bio/api/invitations", payload,
      { "x-inherit-csrf": token, "x-real-ip": NETWORK, ...headers }), payload);
  }
  it("sends only to the address the draft holds, keyed, with the same receipt either way", async () => {
    vi.stubEnv("INHERIT_HMAC_KEYRING", `2:${KEY_2}`);
    mocks.rpc.mockResolvedValueOnce({ data: { status: "received" }, error: null });
    const response = await send();
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "received" });
    const [name, args] = mocks.rpc.mock.calls[0]!;
    expect(name).toBe("create_path_b_invitation_v1");
    expect(args).toMatchObject({ p_subject_id: subjectId, p_test_jurisdiction: true });
    expectContactSet(args);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "not_found" } });
    expect(await (await send()).json()).toEqual({ status: "received" });
  });
  it("sends both attempt-quota keys under every held revision, and no account id or network in the clear", async () => {
    vi.stubEnv("INHERIT_HMAC_KEYRING", `2:${KEY_2}`);
    mocks.rpc.mockResolvedValueOnce({ data: { status: "received" }, error: null });
    await send();
    const args = mocks.rpc.mock.calls[0]![1] as Record<string, unknown>;
    const quota = args.p_quota_keys as Record<string, Record<string, string>>;
    expect(Object.keys(quota)).toEqual(["1", "2"]);
    for (const revision of Object.values(quota)) {
      expect(Object.keys(revision).sort()).toEqual(["authenticated-principal", "source-network"]);
      for (const digest of Object.values(revision)) expect(digest).toMatch(/^[0-9a-f]{64}$/);
    }
    const serialized = JSON.stringify(args);
    for (const plain of ["relative@e2e.local", NETWORK, `|${accountId}`]) expect(serialized).not.toContain(plain);
  });
  it("keeps the idempotency key stable when a contact revision is added", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "received" }, error: null });
    vi.stubEnv("INHERIT_HMAC_KEYRING", `2:${KEY_2}`);
    await send();
    vi.stubEnv("INHERIT_HMAC_KEYRING", `2:${KEY_2},3:${crypto.randomBytes(32).toString("base64")}`);
    await send();
    const [first, second] = mocks.rpc.mock.calls.map((call) => (call[1] as { p_idempotency_key: string }).p_idempotency_key);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(second);
  });
  it.each([["keyed digest set incomplete"], ["keyed digest set required"], ["rate limit keys required"]])(
    "answers 503 when the database refuses the keys (%s)", async (message) => {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "55000", message } });
      expect((await send()).status).toBe(503);
    });
  it("refuses a token minted for another target", async () => {
    const token = mintPathBOperation(accountId, sessionId, "request-send", accountId);
    expect((await send({ "x-inherit-csrf": token })).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/withdraw/session, the person's Path B answers", () => {
  const secret = newRightsSessionSecret();
  const hash = rightsSessionHash(secret);
  function rights(body: unknown) {
    return sameOrigin("https://inherit.bio/api/withdraw/session", body, { cookie: `${RIGHTS_COOKIE_NAME}=${secret}` });
  }
  it("dispatches a revision answer only on a revision form, never on the adult-subject form", async () => {
    const revisionForm = mintPublicFormToken("adult-upload-respond", Date.now(), hash);
    const subjectForm = mintPublicFormToken("adult-subject-respond", Date.now(), hash);
    expect(readAdultUploadRevisionResponse(rights({}), revisionForm)).not.toBeNull();
    expect(readAdultUploadRevisionResponse(rights({}), subjectForm)).toBeNull();
    mocks.rpc.mockResolvedValueOnce({ data: "confirmed", error: null });
    const confirmed = await withdrawSession(rights({ operation: "confirm", uploadRevisionAffirmed: true, nonce: revisionForm }));
    expect(confirmed.status).toBe(202);
    expect(await confirmed.json()).toEqual({ status: "accepted", operation: "confirm" });
    // The signed-in account goes with the answer; the database refuses any
    // account other than an account-bound person's own.
    expect(mocks.rpc).toHaveBeenLastCalledWith("respond_adult_upload_revision_v1",
      { p_session_hash: hash, p_nonce: expect.any(String), p_action: "confirm", p_account_id: accountId });
    // A revision confirmation without its affirmation is not a body at all.
    expect((await withdrawSession(rights({ operation: "confirm", nonce: revisionForm }))).status).toBe(404);
  });
  it.each([["refuse", "refused"], ["delete", "deleted"]] as const)("answers %s for one revision", async (operation, result) => {
    mocks.rpc.mockResolvedValueOnce({ data: result, error: null });
    const response = await answerAdultUploadRevision({ sessionHash: hash, nonce: "n".repeat(32) }, operation);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted", operation });
    mocks.rpc.mockResolvedValueOnce({ data: "unavailable", error: null });
    expect((await answerAdultUploadRevision({ sessionHash: hash, nonce: "n".repeat(32) }, operation)).status).toBe(404);
  });
  it("keeps the revision bodies closed", () => {
    expect(adultUploadRevisionBody.safeParse({ operation: "confirm", uploadRevisionAffirmed: true, nonce: "x" }).success).toBe(true);
    expect(adultUploadRevisionBody.safeParse({ operation: "refuse", nonce: "x" }).success).toBe(true);
    for (const body of [{ operation: "confirm", uploadRevisionAffirmed: false, nonce: "x" },
      { operation: "refuse", nonce: "x", fileId: subjectId }, { operation: "refuse", nonce: "x", uploadRevisionId: subjectId }]) {
      expect(adultUploadRevisionBody.safeParse(body).success).toBe(false);
    }
  });
  it("signs a Path B request only with the current artifact, the whole set, a name, a country and the current attestation", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const presentation = mintSubjectPresentation(hash, 1, "b".repeat(64), NOW);
    const body = { operation: "confirm" as const, nonce: "n", subjectArtifact: { artifactVersion: 1,
      artifactPresentationToken: presentation, affirmed: true as const, statementKeys: SUBJECT_KEYS, typedName: "Ada Lovelace" },
      jurisdictionCode: "GB", jurisdictionAttestationVersion: 2, jurisdictionAttestationHash: "f".repeat(64),
      jurisdictionAffirmed: true as const };
    expect(pathBSubjectConfirmBody.safeParse(body).success).toBe(true);
    const authority = { sessionHash: hash, nonce: "n".repeat(32) };
    mocks.rpc.mockResolvedValueOnce({ data: "accepted", error: null });
    const response = await confirmPathBSubject(authority, body);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted", operation: "confirm" });
    const [name, args] = mocks.rpc.mock.calls[0]!;
    expect(name).toBe("confirm_path_b_subject_v1");
    expect(args).toMatchObject({ p_session_hash: hash, p_artifact_version: 1, p_artifact_body_sha256: "b".repeat(64),
      p_statement_keys: SUBJECT_KEYS, p_jurisdiction_code: "GB", p_test_jurisdiction: true });
    expect(args.p_signing_name_ciphertext).toMatch(/^\\x[0-9a-f]+$/);
    mocks.rpc.mockClear();
    for (const patch of [
      { subjectArtifact: { ...body.subjectArtifact, statementKeys: SUBJECT_KEYS.slice(1) } },
      { subjectArtifact: { ...body.subjectArtifact, typedName: "Ada" } },
      { subjectArtifact: { ...body.subjectArtifact, artifactVersion: 2 } },
      { jurisdictionCode: "ZZ" },
      { jurisdictionAttestationVersion: 1 },
      { jurisdictionAttestationHash: "e".repeat(64) },
    ]) {
      expect((await confirmPathBSubject(authority, { ...body, ...patch })).status).toBe(404);
    }
    expect((await confirmPathBSubject({ ...authority, sessionHash: "0".repeat(64) }, body)).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    expect((await confirmPathBSubject(authority, body)).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("answers a file with no account when no one is signed in", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.rpc.mockResolvedValueOnce({ data: "refused", error: null });
    expect((await answerAdultUploadRevision({ sessionHash: hash, nonce: "n".repeat(32) }, "refuse")).status).toBe(202);
    expect(mocks.rpc).toHaveBeenLastCalledWith("respond_adult_upload_revision_v1",
      { p_session_hash: hash, p_nonce: "n".repeat(32), p_action: "refuse", p_account_id: null });
  });
});

describe("Path B's account branch: confirming a request with the signed-in account", () => {
  const secret = newRightsSessionSecret();
  const hash = rightsSessionHash(secret);
  const KEY_2 = crypto.randomBytes(32).toString("base64");
  function body(presentation: string) {
    return { operation: "confirm" as const, nonce: "n", withAccount: true as const, subjectArtifact: { artifactVersion: 1,
      artifactPresentationToken: presentation, affirmed: true as const, statementKeys: SUBJECT_KEYS, typedName: "Ada Lovelace" } };
  }
  beforeEach(() => {
    vi.stubEnv("INHERIT_HMAC_KEYRING", `2:${KEY_2}`);
    mocks.getUser.mockResolvedValue({ data: { user: { id: accountId, email: "Relative@E2E.local",
      email_confirmed_at: "2026-09-01T00:00:00Z" } } });
  });
  it("keeps the account body closed: no country, no account id, and withAccount required", () => {
    const valid = body("p".repeat(40));
    expect(pathBAccountConfirmBody.safeParse(valid).success).toBe(true);
    for (const patch of [{ withAccount: false }, { jurisdictionCode: "GB" }, { accountId }, { withAccount: undefined }]) {
      expect(pathBAccountConfirmBody.safeParse({ ...valid, ...patch }).success).toBe(false);
    }
    // A no-account body is never read as an account body, or the reverse.
    const { withAccount: _flag, ...withoutFlag } = valid;
    expect(_flag).toBe(true);
    expect(pathBAccountConfirmBody.safeParse(withoutFlag).success).toBe(false);
    expect(pathBSubjectConfirmBody.safeParse(valid).success).toBe(false);
  });
  it("sends the account, its own session and its address as digests under every held revision, never bare", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const authority = { sessionHash: hash, nonce: "n".repeat(32) };
    mocks.rpc.mockResolvedValueOnce({ data: "accepted", error: null });
    const response = await confirmPathBSubjectWithAccount(authority, body(mintSubjectPresentation(hash, 1, "b".repeat(64), NOW)));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted", operation: "confirm" });
    const [name, args] = mocks.rpc.mock.calls[0]!;
    expect(name).toBe("confirm_path_b_subject_account_v1");
    expect(args).toMatchObject({ p_session_hash: hash, p_artifact_version: 1, p_artifact_body_sha256: "b".repeat(64),
      p_statement_keys: SUBJECT_KEYS, p_account_id: accountId, p_auth_session_id: sessionId,
      p_account_email_hmac: null, p_test_jurisdiction: true });
    const set = args.p_account_email_hmac_set as Record<string, string>;
    expect(Object.keys(set)).toEqual(["1", "2"]);
    expect(set["1"]).toBe(legacyContactDigest("relative@e2e.local"));
    expect(JSON.stringify(args).toLowerCase()).not.toContain("relative@e2e.local");
    expect(args).not.toHaveProperty("p_jurisdiction_code");
  });
  it("is the same 404 without a signed-in account, an unconfirmed address, a stale form or outside TEST-LOCAL", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const authority = { sessionHash: hash, nonce: "n".repeat(32) };
    const valid = body(mintSubjectPresentation(hash, 1, "b".repeat(64), NOW));
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await confirmPathBSubjectWithAccount(authority, valid)).status).toBe(404);
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: accountId, email: "relative@e2e.local", email_confirmed_at: null } } });
    expect((await confirmPathBSubjectWithAccount(authority, valid)).status).toBe(404);
    expect((await confirmPathBSubjectWithAccount({ ...authority, sessionHash: "0".repeat(64) }, valid)).status).toBe(404);
    expect((await confirmPathBSubjectWithAccount(authority, { ...valid,
      subjectArtifact: { ...valid.subjectArtifact, statementKeys: SUBJECT_KEYS.slice(1) } })).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: "unavailable", error: null });
    expect((await confirmPathBSubjectWithAccount(authority, valid)).status).toBe(404);
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    mocks.rpc.mockClear();
    expect((await confirmPathBSubjectWithAccount(authority, valid)).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("is reached only through the adult-subject form of this session", async () => {
    const subjectForm = mintPublicFormToken("adult-subject-respond", Date.now(), hash);
    const revisionForm = mintPublicFormToken("adult-upload-respond", Date.now(), hash);
    const presentation = mintSubjectPresentation(hash, 1, "b".repeat(64));
    mocks.rpc.mockResolvedValueOnce({ data: "accepted", error: null });
    const request = (nonce: string) => sameOrigin("https://inherit.bio/api/withdraw/session",
      { ...body(presentation), nonce }, { cookie: `${RIGHTS_COOKIE_NAME}=${secret}` });
    expect((await withdrawSession(request(subjectForm))).status).toBe(202);
    expect(mocks.rpc.mock.calls[0]![0]).toBe("confirm_path_b_subject_account_v1");
    mocks.rpc.mockClear();
    expect((await withdrawSession(request(revisionForm))).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
