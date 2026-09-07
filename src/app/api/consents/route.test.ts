import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), rpc: vi.fn(), copilot: vi.fn(), revokeCopilot: vi.fn(), report: vi.fn(), upload: vi.fn(), embryo: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
// Keep the actual signed-token discriminators. Only the delegated handlers are
// spied: a missing import/dispatch must exercise the real legacy fallback.
vi.mock("@/lib/copilot/own-consent", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/copilot/own-consent")>(), ownCopilotConsent: mocks.copilot, revokeOwnCopilotConsent: mocks.revokeCopilot }));
vi.mock("@/lib/uploads/own-report-consent-route", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/uploads/own-report-consent-route")>(), ownReportConsent: mocks.report }));
vi.mock("@/lib/uploads/own-consent-route", () => ({ ownUploadConsent: mocks.upload }));
vi.mock("@/lib/embryos/consents", () => ({ embryoConsent: mocks.embryo }));
vi.mock("@/lib/account-deletion", () => ({ isSameOrigin: () => true }));
import { POST } from "./route";
import { POST as revoke } from "./[id]/revoke/route";
import { mintOwnCopilotConsent } from "@/lib/copilot/own-consent";
import { mintOwnReportPresentation } from "@/lib/uploads/own-report-token";
import { mintGrantPresentation, SHARE_WITH_ADULT_ARTIFACT, SHARE_WITH_ADULT_STATEMENT_KEYS } from "@/lib/family/grant-token";
const accountId = "77900000-0000-4000-8000-000000000001", subjectId = "77900000-0000-4000-8000-000000000002", grantId = "77900000-0000-4000-8000-000000000003";
const snapshot = { accountRevision: 1, authSessionRevision: 1, jurisdictionRevision: 1, subjectBindingRevision: 1, accountBindingRevision: 1, uploadConsentId: grantId, subjectLifecycleRevision: 1, originatingSessionRevision: 1, principalId: grantId, principalRevision: 1 };
const artifact = { artifact_key: SHARE_WITH_ADULT_ARTIFACT, version: 1, body_sha256: "b".repeat(64) };
function request(payload: unknown) { return new Request("https://inherit.test/api/consents", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://inherit.test" }, body: JSON.stringify(payload) }); }
function row(data: unknown) { const q = { select: () => q, eq: () => q, is: () => q, maybeSingle: async () => ({ data, error: null }) }; return q; }
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 31).toString("base64"));
  mocks.getUser.mockResolvedValue({ data: { user: { id: accountId } } });
  mocks.from.mockImplementation((table: string) => row(table === "consent_artifacts" ? artifact : null));
  mocks.rpc.mockResolvedValue({ data: grantId, error: null });
  mocks.copilot.mockResolvedValue(Response.json({ granted: true }, { status: 201 }));
  mocks.report.mockResolvedValue(Response.json({ recordKind: "purpose_grant" }, { status: 201 }));
  mocks.upload.mockResolvedValue(Response.json({ signed: true }, { status: 201 }));
  mocks.embryo.mockResolvedValue(Response.json({ signed: true }, { status: 201 }));
  mocks.revokeCopilot.mockResolvedValue(Response.json({ revoked: true }));
});
afterEach(() => vi.unstubAllEnvs());
describe("actual consent POST dispatcher", () => {
  it.each(["local", "cloud"] as const)("dispatches signed canonical %s permission exclusively to its own handler", async providerClass => {
    const token = mintOwnCopilotConsent({ snapshot: { accountId, sessionId: accountId, subjectId, context: snapshot, settingsRevision: 1, recipientRevision: 1, providerClass, runtimeAttestationRevision: 1, runtimeAttestationFingerprint: "a".repeat(64) }, artifacts: [{ key: `consent.own-copilot-${providerClass}`, version: 1, body: "Synthetic permission", sha256: "b".repeat(64) }] });
    const payload = { action: "grant-purpose", subjectId, purposeKey: `copilot.${providerClass}`, artifactVersion: 1, artifactPresentationToken: token, affirmed: true, statementKeys: ["model-named", "data-classes-named", "raw-file-excluded", "revocable"] };
    const req = request(payload); const response = await POST(req);
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ granted: true });
    expect(mocks.copilot).toHaveBeenCalledExactlyOnceWith(req, payload);
    expect(mocks.report).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("retains signed own-report dispatch", async () => {
    const { token } = mintOwnReportPresentation({ accountId, sessionId: accountId, subjectId, snapshot, purpose: "reports.polygenic", artifactKey: "consent.own-polygenic", artifactVersion: 1, artifactBodySha256: "b".repeat(64) });
    const payload = { action: "grant-purpose", subjectId, purposeKey: "reports.polygenic", artifactVersion: 1, artifactPresentationToken: token, affirmed: true, statementKeys: ["make-this-result-for-me"] };
    const req = request(payload); expect((await POST(req)).status).toBe(201);
    expect(mocks.report).toHaveBeenCalledExactlyOnceWith(req, payload); expect(mocks.copilot).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("retains the signed adult grant and its exact legacy RPC", async () => {
    const token = mintGrantPresentation({ accountId, dataSubjectId: subjectId, subjectBindingRevision: 1, recipientPrincipalId: grantId, recipientAccountId: grantId, purpose: "copilot.local", artifactKey: artifact.artifact_key, artifactVersion: 1, artifactBodySha256: artifact.body_sha256, jurisdictionRevision: 1 });
    const payload = { action: "grant-purpose", subjectId, purposeKey: "copilot.local", artifactVersion: 1, artifactPresentationToken: token, affirmed: true, statementKeys: [...SHARE_WITH_ADULT_STATEMENT_KEYS] };
    expect((await POST(request(payload))).status).toBe(201); expect(mocks.copilot).not.toHaveBeenCalled(); expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("grant_directional_purpose_v1", expect.objectContaining({ p_account_id: accountId, p_data_subject_id: subjectId, p_purpose: "copilot.local" }));
  });
  it.each([{ signatureClass: "tier1-self" }, { action: "grant-purpose", cohortId: subjectId }])("retains the existing target-specific dispatch", async payload => {
    const req = request(payload); expect((await POST(req)).status).toBe(201);
    expect("signatureClass" in payload ? mocks.upload : mocks.embryo).toHaveBeenCalledExactlyOnceWith(req, payload); expect(mocks.copilot).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("authenticates before any consent dispatch", async () => { mocks.getUser.mockResolvedValue({ data: { user: null } }); expect((await POST(request({ signatureClass: "tier1-self" }))).status).toBe(401); expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.copilot).not.toHaveBeenCalled(); });
});
describe("actual revoke POST dispatcher", () => {
  it("already sends a canonical recipient-bound purpose to its own revoker", async () => {
    mocks.from.mockImplementation((table: string) => row(table === "purpose_grants" ? { grant_id: grantId, target_id: subjectId, copilot_recipient_revision: 1 } : null));
    const req = request({}); expect((await revoke(req, { params: Promise.resolve({ id: grantId }) })).status).toBe(200);
    expect(mocks.revokeCopilot).toHaveBeenCalledExactlyOnceWith(req, grantId, subjectId); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps a noncanonical adult purpose on the existing revocation RPC", async () => {
    mocks.from.mockImplementation((table: string) => row(table === "purpose_grants" ? { grant_id: grantId, target_id: subjectId, copilot_recipient_revision: null } : null));
    mocks.rpc.mockResolvedValue({ data: "2026-09-07T10:00:00+00:00", error: null });
    expect((await revoke(request({}), { params: Promise.resolve({ id: grantId }) })).status).toBe(200);
    expect(mocks.revokeCopilot).not.toHaveBeenCalled(); expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("revoke_directional_purpose_v1", { p_account_id: accountId, p_grant_id: grantId });
  });
});
