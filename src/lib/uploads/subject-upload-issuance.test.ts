import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getClaims: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: mocks }) }));
import { issueSubjectUpload } from "./subject-upload-issuance";
import { declaredSubjectFormat, directUploadReceipt, SUBJECT_UPLOAD_FORMATS, uploadSessionBody } from "./subject-upload-contract";

const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const uploadId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const jti = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const stagingKey = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const body = { subjectId: "me", declaredFormat: "VCF", sizeBytes: 123, sha256: null };
const now = Date.parse("2026-09-06T12:00:00Z");
const authorization = { accountId, sessionId, accountAuthSessionRevision: 3, uploadId, jti, stagingKey,
  maximumBytes: body.sizeBytes, expiresAt: new Date(now + 1_800_000).toISOString() };
let publicKey: crypto.KeyObject;
function request(input: unknown = body, headers: Record<string, string> = {}) {
  return new Request("https://inherit.bio/api/files/upload-session", { method: "POST", body: JSON.stringify(input),
    headers: { origin: "https://inherit.bio", "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers } });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  const pair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }); publicKey = pair.publicKey;
  vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK", JSON.stringify({ ...pair.privateKey.export({ format: "jwk" }), kid: jti }));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.example.test");
  mocks.getUser.mockResolvedValue({ data: { user: { id: accountId } } });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: accountId, session_id: sessionId } } });
  mocks.rpc.mockResolvedValue({ data: authorization, error: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("closed subject upload declaration", () => {
  it.each(SUBJECT_UPLOAD_FORMATS)("accepts the canonical format %s without browser authority fields", declaredFormat => {
    expect(uploadSessionBody.safeParse({ ...body, declaredFormat }).success).toBe(true);
  });
  it.each([
    { filename: "name.vcf" }, { fileType: "vcf" }, { tier: 1 }, { role: "authenticated" },
    { cohortId: uploadId }, { sizeBytes: 0 }, { sizeBytes: 1.5 }, { sizeBytes: Number.MAX_SAFE_INTEGER + 1 },
    { sha256: "A".repeat(64) }, { sha256: "" }, { subjectId: "s-" + accountId }, { declaredFormat: "BAM" },
    { declaredFormat: "CRAM" }, { declaredFormat: "pgt_table" },
  ])("refuses extra or incompatible declaration fields (%j)", patch => {
    expect(uploadSessionBody.safeParse({ ...body, ...patch }).success).toBe(false);
  });
  it("maps only supported parser identities, never BAM or CRAM", () => {
    expect(declaredSubjectFormat("vcf", true)).toBe("VCF.GZ");
    expect(declaredSubjectFormat("vcf", false)).toBe("VCF");
    expect(declaredSubjectFormat("array_23andme", false)).toBe("consumer-array-text-v1");
    expect(declaredSubjectFormat("array_ancestry", false)).toBe("consumer-array-text-v2");
    expect(declaredSubjectFormat("array_myheritage", false)).toBe("consumer-array-text-v3");
    expect(declaredSubjectFormat("array_ftdna", false)).toBe("consumer-array-text-v4");
    expect(declaredSubjectFormat("bam", false)).toBeNull(); expect(declaredSubjectFormat("cram", false)).toBeNull();
  });
});

describe("canonical upload issuance", () => {
  it("uses verified account/session authority and returns the exact receipt with a real ES256 bearer", async () => {
    const response = await issueSubjectUpload(request());
    expect(response.status).toBe(201); const result = await response.json();
    expect(directUploadReceipt.safeParse(result).success).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("issue_own_storage_upload_v1", {
      p_account_id: accountId, p_session_id: sessionId, p_subject_id: null,
      p_declared_format: "VCF", p_size_bytes: 123, p_sha256: null,
    });
    const [header, payload, signature] = result.uploadToken.split(".");
    expect(crypto.verify("sha256", Buffer.from(header + "." + payload),
      { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(true);
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims).toMatchObject({ role: "inherit_upload_only", sub: accountId, session_id: sessionId,
      staging_key: stagingKey, maximum_bytes: 123, aud: "inherit-storage-upload" });
    expect(result.authorizationHeader).toBe("Bearer {uploadToken}");
    expect(Date.parse(result.expiresAt)).toBe(claims.exp * 1000);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("passes explicit subject UUIDs to the atomic authority resolver", async () => {
    expect((await issueSubjectUpload(request({ ...body, subjectId: accountId, sha256: "a".repeat(64) }))).status).toBe(201);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_subject_id: accountId, p_sha256: "a".repeat(64) });
  });
  it.each([71_999, 7_200_000])("reports exactly the signed expiry for a database ceiling of %s ms", async offset => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...authorization, expiresAt: new Date(now + offset).toISOString() }, error: null });
    const result = await (await issueSubjectUpload(request())).json();
    const claims = JSON.parse(Buffer.from(result.uploadToken.split(".")[1], "base64url").toString());
    expect(Date.parse(result.expiresAt)).toBe(claims.exp * 1000);
    expect(claims.exp * 1000).toBeLessThanOrEqual(now + Math.min(offset, 1_800_000));
  });
  it.each(["", "not-json", "{}"])("creates no lease when signer configuration is invalid (%j)", async key => {
    vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK", key);
    const response = await issueSubjectUpload(request()); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" }); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not misroute a cohort request through ordinary-subject issuance", async () => {
    const declaration = { declaredFormat: body.declaredFormat, sizeBytes: body.sizeBytes, sha256: body.sha256 };
    expect((await issueSubjectUpload(request({ ...declaration, cohortId: uploadId }))).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["origin", "sec-fetch-site"])("requires a same-origin %s signal", async name => {
    expect((await issueSubjectUpload(request(body, { [name]: "cross-origin" }))).status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects an oversized streaming body before reading identity or calling the database", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4097)); }, cancel });
    const init = { method: "POST", headers: request().headers, body: stream, duplex: "half" };
    expect((await issueSubjectUpload(new Request(request().url, init))).status).toBe(422);
    expect(cancel).toHaveBeenCalledOnce(); expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it.each(["{", "null", "[1]", "", "\"text\""])("rejects malformed or non-object JSON %j", async input => {
    const req = new Request(request().url, { method: "POST", body: input, headers: request().headers });
    expect((await issueSubjectUpload(req)).status).toBe(422); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects extra fields and incorrect content types", async () => {
    expect((await issueSubjectUpload(request({ ...body, role: "service_role" }))).status).toBe(422);
    expect((await issueSubjectUpload(request(body, { "content-type": "text/plain" }))).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects mismatched authentication claims and handles auth outages without leaking details", async () => {
    mocks.getClaims.mockResolvedValueOnce({ data: { claims: { sub: uploadId, session_id: sessionId } } });
    expect((await issueSubjectUpload(request())).status).toBe(401);
    mocks.getUser.mockRejectedValueOnce(new Error("private detail"));
    const response = await issueSubjectUpload(request()); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" }); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", 404], ["22023", 413], ["55000", 409], ["XX000", 503]])("normalizes database code %s", async (code, status) => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message: "private detail" } });
    const response = await issueSubjectUpload(request()); expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("private detail");
  });
  it.each([{ accountId: uploadId }, { sessionId: uploadId }, { maximumBytes: 124 }, { filename: "private" },
    { expiresAt: new Date(now).toISOString() }])("refuses an inconsistent or expired authorization (%j)", async patch => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...authorization, ...patch }, error: null });
    const response = await issueSubjectUpload(request()); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });
});
