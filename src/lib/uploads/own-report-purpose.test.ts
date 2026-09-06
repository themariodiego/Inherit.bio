import crypto from "node:crypto";
import fs from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getClaims: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: mocks }) }));
import { hmacSecret } from "@/lib/crypto";
import { OWN_REPORT_CHOICES, OWN_REPORT_PURPOSES, ownReportPurposeBody } from "./own-report-purpose";
import { isOwnReportConsentPayload, ownReportConsent } from "./own-report-consent-route";
import { mintOwnReportPresentation, readOwnReportPresentation } from "./own-report-token";
vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
afterAll(() => vi.unstubAllEnvs());
const input = {
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  subjectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  snapshot: { accountRevision: 1, authSessionRevision: 2, jurisdictionRevision: 3, subjectBindingRevision: 4,
    accountBindingRevision: 5, uploadConsentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", subjectLifecycleRevision: 6,
    originatingSessionRevision: 7, principalId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", principalRevision: 8 },
  purpose: "reports.monogenic" as const, artifactKey: "consent.own-monogenic", artifactVersion: 1, artifactBodySha256: "a".repeat(64),
};
const receipt = { recordKind: "purpose_grant", recordId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  artifactKey: input.artifactKey, artifactVersion: 1, purposeKey: input.purpose, signedAt: "2026-09-06T10:00:00+00:00" };
function fixture(claims = input) {
  const { token } = mintOwnReportPresentation(claims);
  return { body: { action: "grant-purpose", subjectId: input.subjectId, purposeKey: input.purpose,
    artifactVersion: 1, artifactPresentationToken: token, affirmed: true, statementKeys: ["make-this-result-for-me"] },
  headers: { origin: "https://inherit.bio", "sec-fetch-site": "same-origin", "x-inherit-csrf": token } };
}
function send(body: unknown, headers: Record<string, string>) {
  return ownReportConsent(new Request("https://inherit.bio/api/consents", { method: "POST", headers }), body);
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: receipt, error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: input.accountId } } });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: input.accountId, session_id: input.sessionId } } });
});
describe("independent own-report choices", () => {
  it("binds the complete own direction and stays below the database's ten-minute ceiling", () => {
    const { token, claims } = mintOwnReportPresentation(input, 1_800_000_000_000);
    expect(readOwnReportPresentation(token, claims.issuedAt)).toEqual(claims);
    expect(claims.expiresAt - claims.issuedAt).toBe(9 * 60 * 1000);
    expect(readOwnReportPresentation(token, claims.expiresAt)).toBeNull();
    expect(readOwnReportPresentation(token, claims.issuedAt - 1)).toBeNull();
    expect(readOwnReportPresentation(token + ".extra", claims.issuedAt)).toBeNull();
  });
  it.each([
    { recipientAccountId: input.accountId }, { purpose: "copilot.cloud" }, { artifactKey: "consent.upload-self" },
    { snapshot: { ...input.snapshot, principalRevision: 0 } }, { expiresAt: 1_800_000_600_001 },
  ])("rejects correctly signed extra or inconsistent claims", (patch) => {
    const { claims } = mintOwnReportPresentation(input, 1_800_000_000_000);
    const payload = Buffer.from(JSON.stringify({ ...claims, ...patch })).toString("base64url");
    expect(readOwnReportPresentation(`${payload}.${hmacSecret(payload, "own-report-purpose-presentation-v1")}`, claims.issuedAt)).toBeNull();
  });
  it("dispatches only an authenticated own-purpose context", () => {
    const { body } = fixture(); expect(isOwnReportConsentPayload(body)).toBe(true);
    expect(isOwnReportConsentPayload({ ...body, artifactPresentationToken: "foreign-token" })).toBe(false);
    expect(isOwnReportConsentPayload({ ...body, action: "sign-artifact" })).toBe(false);
  });
  it("writes only the selected purpose with server-authenticated endpoints and revisions", async () => {
    const { body, headers } = fixture(); const res = await send(body, headers);
    expect(res.status).toBe(201); expect(await res.json()).toEqual(receipt);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc.mock.calls[0]).toEqual(["grant_own_report_purpose_v1", expect.objectContaining({
      p_account_id: input.accountId, p_session_id: input.sessionId, p_subject_id: input.subjectId,
      p_snapshot: input.snapshot, p_purpose: "reports.monogenic", p_nonce_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })]);
  });
  it.each(["origin", "sec-fetch-site", "x-inherit-csrf"])("requires %s", async key => {
    const { body, headers } = fixture(); const changed: Record<string, string> = { ...headers }; delete changed[key];
    expect((await send(body, changed)).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["accountId", "sessionId", "subjectId"] as const)("refuses a foreign %s", async key => {
    const { body, headers } = fixture({ ...input, [key]: receipt.recordId });
    expect((await send(body, headers)).status).toBe(404); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not accept client endpoint, purpose-list, artifact or affirmation overrides", async () => {
    const { body, headers } = fixture();
    for (const patch of [{ recipientId: input.accountId }, { purposes: ["ancestry"] }, { artifactKey: input.artifactKey },
      { affirmed: false }, { typedName: "Synthetic user" }, { statementKeys: ["all-purposes"] }]) {
      expect(ownReportPurposeBody.safeParse({ ...body, ...patch }).success).toBe(false);
      expect((await send({ ...body, ...patch }, headers)).status).toBe(422);
    }
    expect((await send({ ...body, purposeKey: "ancestry" }, headers)).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([null, { ...receipt, purposeKey: "ancestry" }, { ...receipt, secret: "private" }])("refuses an inconsistent or open receipt", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null }); const { body, headers } = fixture();
    expect((await send(body, headers)).status).toBe(503);
  });
  it.each(OWN_REPORT_PURPOSES)("%s has a short independent artifact with exact file/seed/hash", purpose => {
    const key = OWN_REPORT_CHOICES[purpose].artifactKey;
    const file = fs.readFileSync(`content/legal/${key}/v1.md`, "utf8");
    const body = file.split("</section>")[1].trim();
    const hash = crypto.createHash("sha256").update(body).digest("hex");
    const sql = fs.readFileSync("supabase/migrations/20260906134652_own_report_purposes.sql", "utf8");
    expect(file).toContain(`body_sha256: ${hash}`); expect(sql).toContain(hash); expect(sql).toContain(`$artifact$${body}$artifact$`);
    expect(body).toContain("Other results, sharing, research and outside AI remain separate choices.");
    expect(body).not.toMatch(/criminal|typed name|typed date/i);
  });
  it.each(["monogenic", "polygenic"])("%s v2 preserves history and names the actual result layer", suffix => {
    const key = `consent.own-${suffix}`;
    const file = fs.readFileSync(`content/legal/${key}/v2.md`, "utf8");
    const body = file.split("</section>")[1].trim();
    const hash = crypto.createHash("sha256").update(body).digest("hex");
    const sql = fs.readFileSync("supabase/migrations/20260906135854_own_report_layer_language.sql", "utf8");
    expect(file).toContain(`body_sha256: ${hash}`); expect(sql).toContain(hash); expect(sql).toContain(`$artifact$${body}$artifact$`);
    expect(body).toContain(suffix === "polygenic" ? "individual variants or many variants" : "does not promise a health interpretation");
    expect(body).toContain("Other results, sharing, research and outside AI remain separate choices.");
    expect(fs.existsSync(`content/legal/${key}/v1.md`)).toBe(true);
  });
});
