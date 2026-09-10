import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), target: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("./own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("@/lib/subjects", () => ({ resolveSubjectForAccount: mocks.target }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
import { prepareOwnReportChoices } from "./prepare-own-report-choices";
import { OWN_REPORT_CHOICES, OWN_REPORT_PURPOSES } from "./own-report-purpose";
import { readOwnReportPresentation } from "./own-report-token";
vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
afterAll(() => vi.unstubAllEnvs());
const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const subjectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const principalId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const snapshot = { accountRevision: 1, authSessionRevision: 2, jurisdictionRevision: 3, subjectBindingRevision: 4,
  accountBindingRevision: 5, uploadConsentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", subjectLifecycleRevision: 6,
  originatingSessionRevision: 7, principalId, principalRevision: 8 };
const body = "Synthetic own-purpose artifact";
const artifacts = OWN_REPORT_PURPOSES.map(p => ({ artifact_key: OWN_REPORT_CHOICES[p].artifactKey, version: 1,
  body_markdown: body, body_sha256: crypto.createHash("sha256").update(body).digest("hex") }));
let results: Record<string, { data: unknown; error: unknown }>;
let calls: Array<[string, string, ...unknown[]]>;
beforeEach(() => {
  vi.clearAllMocks(); calls = [];
  mocks.actor.mockResolvedValue({ accountId, sessionId });
  mocks.target.mockResolvedValue({ id: subjectId, subjectAccountId: accountId, subjectClass: "self" });
  mocks.rpc.mockResolvedValue({ data: snapshot, error: null });
  results = { consent_artifacts: { data: artifacts, error: null }, purpose_grants: { data: [], error: null },
    directional_grants: { data: [], error: null }, consent_artifact_changes: { data: [], error: null } };
  mocks.from.mockImplementation((table: string) => {
    const query: Record<string, unknown> = {};
    const used: string[] = [];
    for (const method of ["select", "eq", "in", "is", "lte", "or", "gt"]) query[method] = (...args: unknown[]) => {
      used.push(method); calls.push([table, method, ...args]); return query;
    };
    // Two reads hit consent_artifacts: the live documents, and the superseding
    // versions whose change summaries explain a re-consent. Only the second
    // narrows with gt("version", 1), so that is what tells them apart here.
    query.then = (resolve: (v: unknown) => unknown) => Promise.resolve(
      results[table === "consent_artifacts" && used.includes("gt") ? "consent_artifact_changes" : table],
    ).then(resolve);
    return query;
  });
});
describe("own report choices presentation", () => {
  it("shows three independent off choices with no nonce/grant/processing write", async () => {
    const view = await prepareOwnReportChoices(); expect(view.kind).toBe("ready");
    if (view.kind !== "ready") throw Error("expected ready");
    expect(view.choices.map(c => c.purposeKey)).toEqual(OWN_REPORT_PURPOSES);
    expect(view.choices.every(c => !c.granted && c.grantId === null)).toBe(true);
    for (const choice of view.choices) {
      expect(readOwnReportPresentation(choice.token)).toMatchObject({ accountId, sessionId, subjectId, snapshot, purpose: choice.purposeKey });
    }
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("own_report_context_v1", {
      p_account_id: accountId, p_session_id: sessionId, p_subject_id: subjectId,
    });
    expect(calls).toContainEqual(["directional_grants", "eq", "recipient_account_id", accountId]);
    expect(calls).toContainEqual(["directional_grants", "eq", "recipient_principal_id", principalId]);
    expect(calls).toContainEqual(["directional_grants", "eq", "self_principal_revision", 8]);
  });
  it("marks only the same-revision base-plus-direction pair current", async () => {
    results.purpose_grants.data = [{ grant_id: subjectId, grant_revision: 2, purpose: "reports.monogenic",
      artifact_key: artifacts[0].artifact_key, artifact_version: 1, artifact_body_sha256: artifacts[0].body_sha256 }];
    results.directional_grants.data = [{ grant_id: subjectId, grant_revision: 1 }];
    let view = await prepareOwnReportChoices();
    expect(view.kind === "ready" && view.choices[0].granted).toBe(false);
    results.directional_grants.data = [{ grant_id: subjectId, grant_revision: 2 }];
    view = await prepareOwnReportChoices();
    expect(view.kind === "ready" && view.choices.map(c => c.granted)).toEqual([true, false, false]);
    expect(view.kind === "ready" && view.choices[0].grantId).toBe(subjectId);
  });
  it.each(["consent_artifacts", "purpose_grants", "directional_grants", "consent_artifact_changes"])("does not present false defaults when %s fails", async table => {
    results[table] = { data: null, error: { message: "private detail" } };
    expect(await prepareOwnReportChoices()).toEqual({ kind: "unavailable" });
  });
  it("rejects artifact content drift", async () => {
    results.consent_artifacts.data = artifacts.map((a, i) => i === 0 ? { ...a, body_markdown: "Changed after publication" } : a);
    expect(await prepareOwnReportChoices()).toEqual({ kind: "unavailable" });
  });
  it.each([null, { id: subjectId, subjectAccountId: sessionId, subjectClass: "self" },
    { id: subjectId, subjectAccountId: accountId, subjectClass: "embryo" }])("rejects a foreign or unsupported target before admin access", async target => {
    mocks.target.mockResolvedValue(target); expect(await prepareOwnReportChoices()).toEqual({ kind: "unavailable" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  /**
   * G5.2's re-consent half. The signature that no longer resolves is invisible
   * to the `granted` lookup, which matches on the current version — so this is
   * derived from the same grant rows by looking for a lower version.
   */
  describe("a signature left behind by a superseded document", () => {
    /** Monogenic moves to v2; the other two stay at v1 and must be unaffected. */
    function supersedeMonogenic(signedVersion: number, changes: Array<{ version: number; summary: string }>) {
      results.consent_artifacts.data = artifacts.map((a, i) => i === 0 ? { ...a, version: 2 } : a);
      results.purpose_grants.data = [{ grant_id: subjectId, grant_revision: 1, purpose: "reports.monogenic",
        artifact_key: artifacts[0].artifact_key, artifact_version: signedVersion, artifact_body_sha256: artifacts[0].body_sha256 }];
      results.directional_grants.data = [{ grant_id: subjectId, grant_revision: 1 }];
      results.consent_artifact_changes.data = changes.map(change => ({
        artifact_key: artifacts[0].artifact_key, version: change.version, summary_of_changes: change.summary }));
    }
    it("reports the version signed and the changes since, and leaves the choice off", async () => {
      supersedeMonogenic(1, [{ version: 2, summary: "Clarifies the scope." }]);
      const view = await prepareOwnReportChoices();
      if (view.kind !== "ready") throw Error("expected ready");
      expect(view.choices[0].granted).toBe(false);
      expect(view.choices[0].reconsent).toEqual({ signedVersion: 1, changes: [{ version: 2, summary: "Clarifies the scope." }] });
      // The purposes whose document did not move must not claim a change.
      expect(view.choices.slice(1).map(c => c.reconsent)).toEqual([null, null]);
    });
    it("carries every version after the one signed, in order, and nothing at or below it", async () => {
      results.consent_artifacts.data = artifacts.map((a, i) => i === 0 ? { ...a, version: 4 } : a);
      results.purpose_grants.data = [{ grant_id: subjectId, grant_revision: 1, purpose: "reports.monogenic",
        artifact_key: artifacts[0].artifact_key, artifact_version: 2, artifact_body_sha256: artifacts[0].body_sha256 }];
      results.directional_grants.data = [{ grant_id: subjectId, grant_revision: 1 }];
      results.consent_artifact_changes.data = [
        { artifact_key: artifacts[0].artifact_key, version: 4, summary_of_changes: "Fourth" },
        { artifact_key: artifacts[0].artifact_key, version: 2, summary_of_changes: "Second — already agreed to" },
        { artifact_key: artifacts[0].artifact_key, version: 3, summary_of_changes: "Third" },
        { artifact_key: artifacts[1].artifact_key, version: 3, summary_of_changes: "A different document" },
      ];
      const view = await prepareOwnReportChoices();
      if (view.kind !== "ready") throw Error("expected ready");
      expect(view.choices[0].reconsent?.changes).toEqual([
        { version: 3, summary: "Third" }, { version: 4, summary: "Fourth" }]);
    });
    it("says nothing about a change when the current version is the one signed", async () => {
      supersedeMonogenic(2, [{ version: 2, summary: "Clarifies the scope." }]);
      const view = await prepareOwnReportChoices();
      if (view.kind !== "ready") throw Error("expected ready");
      expect(view.choices[0].granted).toBe(true);
      expect(view.choices.map(c => c.reconsent)).toEqual([null, null, null]);
    });
    it("says nothing to someone who never agreed", async () => {
      const view = await prepareOwnReportChoices();
      if (view.kind !== "ready") throw Error("expected ready");
      expect(view.choices.map(c => c.reconsent)).toEqual([null, null, null]);
    });
    it("reads only superseding versions, never version 1, which introduces a document", async () => {
      await prepareOwnReportChoices();
      expect(calls).toContainEqual(["consent_artifacts", "gt", "version", 1]);
    });
  });
});
