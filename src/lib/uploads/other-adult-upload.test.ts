import crypto from "node:crypto";
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getClaims: vi.fn(), codes: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: mocks }) }));
vi.mock("@/lib/legal/jurisdictions", async (original) => {
  const actual = await original<typeof import("@/lib/legal/jurisdictions")>();
  return { ...actual, accountCapability: (id: string, capability: string) => mocks.codes(id, capability) };
});

import { hmacSecret } from "@/lib/crypto";
import { parseArtifactFile } from "@/lib/legal/artifact-file";
import {
  OTHER_ADULT_UPLOAD_STATEMENT_KEYS,
  artifactStatements,
  artifactWarning,
  heldFinalizationReceipt,
  isOtherAdultConsentPayload,
  isOtherAdultStatementSet,
  otherAdultConsentBody,
  otherAdultTypedNameIsValid,
} from "./other-adult-upload";
import { mintOtherAdultPresentation, otherAdultUploadAvailable, readOtherAdultPresentation } from "./other-adult-upload-server";
import { otherAdultUploadConsent } from "./other-adult-consent-route";

const NOW = 1_800_000_000_000;
const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const subjectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const recordId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const input = { accountId, sessionId, subjectId, artifactVersion: 1, artifactBodySha256: "a".repeat(64) };
const KEYS = [...OTHER_ADULT_UPLOAD_STATEMENT_KEYS];

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  mocks.getUser.mockResolvedValue({ data: { user: { id: accountId } } });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: accountId, session_id: sessionId } } });
  mocks.codes.mockResolvedValue({ status: "permitted" });
  mocks.rpc.mockResolvedValue({ data: { recordKind: "artifact_signature", recordId,
    artifactKey: "consent.upload-other-adult", artifactVersion: 1, signedAt: "2026-09-28T12:00:00+00:00" }, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("the draft artifact's statements", () => {
  const file = parseArtifactFile(fs.readFileSync("content/legal/consent.upload-other-adult/v1.md", "utf8"))!;
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
  it("keeps the held receipt free of any file identity", () => {
    expect(heldFinalizationReceipt.safeParse({ uploadId: subjectId, status: "stored_quarantined", analysisState: "quarantined" }).success).toBe(true);
    expect(heldFinalizationReceipt.safeParse({ uploadId: subjectId, status: "stored_quarantined", analysisState: "quarantined",
      fileId: subjectId }).success).toBe(false);
  });
});

describe("the uploader's presentation", () => {
  it("binds account, session, reservation and exact artifact for nine minutes", () => {
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
    expect(readOtherAdultPresentation(`${token.split(".")[0]}.${hmacSecret(token.split(".")[0], "own-upload-artifact-presentation-v1")}`, NOW)).toBeNull();
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
    const request = new Request("https://inherit.bio/api/consents", { method: "POST", body: JSON.stringify(payload),
      headers: { origin: "https://inherit.bio", "sec-fetch-site": "same-origin", "x-inherit-csrf": token, ...headers } });
    return otherAdultUploadConsent(request, payload);
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
    ["55000", "recipient_reviewing", 409, "recipient_reviewing"], ["55000", "something_else", 409, "state_conflict"],
    ["XX000", "boom", 503, "unavailable"]])("maps a database refusal %s/%s to %i", async (code, message, status, error) => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message } });
    const response = await signing();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });
});
