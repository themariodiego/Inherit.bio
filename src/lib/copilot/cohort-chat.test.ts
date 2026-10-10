import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cohort scope's server module: the page's order of states, the turn
 * recheck and the history reader. The database, the cohort graph, the
 * jurisdiction readers, the Tier-2 cookie and the input facts are replaced at
 * their module boundaries; the state resolver, the projection and the closed
 * context builder are real.
 */
const mocks = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn(), from: vi.fn(), cohorts: vi.fn(), viewerCap: vi.fn(),
  cohortCap: vi.fn(), acknowledged: vi.fn(), facts: vi.fn(), subject: vi.fn(), prepare: vi.fn(), assert: vi.fn(),
  localAllowed: vi.fn(), built: vi.fn() }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/embryos/cohorts", async () => ({ ...await vi.importActual<object>("@/lib/embryos/cohorts"),
  listCohortsForAccount: mocks.cohorts }));
vi.mock("@/lib/embryos/access", async () => ({ ...await vi.importActual<object>("@/lib/embryos/access"),
  embryoCapability: mocks.viewerCap, cohortCapability: mocks.cohortCap }));
vi.mock("@/lib/embryos/tier2", () => ({ acknowledged: mocks.acknowledged }));
vi.mock("@/lib/embryos/input-facts-load", () => ({ loadEmbryoInputFacts: mocks.facts }));
vi.mock("@/lib/subjects", () => ({ resolveSubjectForAccount: mocks.subject }));
vi.mock("./own-provider-authority", async () => ({ ...await vi.importActual<object>("./own-provider-authority"),
  assertOwnCopilotAuthority: mocks.assert, prepareOwnCopilotProvider: mocks.prepare }));
vi.mock("./model-endpoint", () => ({ modelRuntime: () => ({ localAllowed: mocks.localAllowed() }) }));
vi.mock("./group-scopes", () => ({ copilotGroupScopes: () => ({ family: true, cohort: mocks.built() }) }));
vi.mock("./cohort-chat-token", () => ({ mintCohortChatToken: (claims: unknown) => `minted:${JSON.stringify(claims)}` }));
import { checkCohortTurn, prepareCohortCopilotChat, readCohortChatHistory } from "./cohort-chat";
import type { CohortAuthority } from "./cohort-chat-content";

const accountId = "80000000-0000-4000-8000-000000000001", sessionId = "80000000-0000-4000-8000-000000000002";
const selfId = "80000000-0000-4000-8000-000000000003";
const actor = { accountId, sessionId };
const cohortId = "c0000000-0000-4000-8000-000000000001";
const E = ["e0000000-0000-4000-8000-000000000001", "e0000000-0000-4000-8000-000000000002"];
const S = ["d0000000-0000-4000-8000-000000000001", "d0000000-0000-4000-8000-000000000002"];
const cohort = { id: cohortId, status: "active", createdAt: "2026-09-20T10:00:00.000Z", embryoCount: 2,
  viewerRole: "required_upload_principal", requiredUploadPrincipalAccountIds: [accountId], requiredUploadPrincipalsWithoutAccount: 0,
  analysisGranted: true, viewerAnalysisGranted: true, analysisGrantsMissing: 0, retentionExpiresAt: "2028-09-20T10:00:00.000Z",
  embryos: [{ id: E[0], subjectId: S[0], sampleOrdinal: 0, displayLabel: "Embryo 1", status: "qc_pass" },
    { id: E[1], subjectId: S[1], sampleOrdinal: 1, displayLabel: "Embryo 2", status: "qc_fail" }] };
const authority: CohortAuthority = { cohortId, role: "required_upload_principal", publicationRevision: 1, basisCase: "true_two_parent",
  basisRevision: 1, participantSetRevision: 1, cohortRevision: 1, donorAttributionRevision: 1, donorClassification: "donor-neutral",
  grants: [{ principalId: "a0000000-0000-4000-8000-000000000001", grantId: "b0000000-0000-4000-8000-000000000001", grantRevision: 1 }],
  embryos: [{ embryoId: E[0], subjectId: S[0], lifecycleRevision: 1 }, { embryoId: E[1], subjectId: S[1], lifecycleRevision: 1 }] };
const qcRow = (embryoId: string, callRate: number, verdict: string) => ({ embryo_id: embryoId, sites_expected: 10,
  sites_called: callRate * 10, call_rate: callRate, autosomal_het_rate: null, mean_depth: null, parent_a_concordance: null,
  parent_b_concordance: null, allelic_dropout_estimate: null, allelic_dropout_interval_low: null, allelic_dropout_interval_high: null,
  allelic_dropout_method: null, amplification_method: null, source_laboratory: null, source_assay: null, imputation_performed: false,
  imputation_panel: null, contamination_estimate: null, qc_verdict: verdict, qc_reasons: verdict === "pass" ? [] : ["embryo_call_rate"],
  computed_at: "2026-09-28T10:00:00.000Z" });
const provider = { accountId, sessionId, subjectId: selfId, providerClass: "local" };
const permitted = { status: "permitted", userFacingCopy: "" };
const operations = () => mocks.rpc.mock.calls.map(call => (call[1] as { p_operation: string }).p_operation);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue(actor);
  mocks.localAllowed.mockReturnValue(true);
  mocks.built.mockReturnValue(true);
  mocks.viewerCap.mockResolvedValue(permitted);
  mocks.cohortCap.mockResolvedValue(permitted);
  mocks.acknowledged.mockResolvedValue(true);
  mocks.cohorts.mockResolvedValue([cohort]);
  mocks.facts.mockResolvedValue({ coordinate_conversion: "not-needed", source_origin: "external-unverified", source_imputation: "not-recorded", call_observation: "not-recorded" });
  mocks.assert.mockResolvedValue(true);
  mocks.subject.mockResolvedValue({ id: selfId });
  mocks.prepare.mockResolvedValue({ authority: provider, settings: { provider: "openai_compatible", base_url: "http://127.0.0.1:8127/v1", model: "synthetic" } });
  mocks.rpc.mockImplementation(async (_name: string, args: { p_operation: string }) =>
    ({ data: args.p_operation === "authority" ? authority : args.p_operation === "list" ? [] : null, error: null }));
  mocks.from.mockImplementation(() => ({ select: () => ({ in: async () => ({ data: [qcRow(E[0], 1, "pass"), qcRow(E[1], 0.7, "fail")], error: null }) }) }));
});

describe("the cohort page's states, in order", () => {
  it("answers a cohort this account cannot read, or a refused embryo jurisdiction, as 404 before anything else", async () => {
    mocks.cohorts.mockResolvedValue([]);
    expect(await prepareCohortCopilotChat(cohortId)).toBeNull();
    mocks.cohorts.mockResolvedValue([cohort]);
    mocks.viewerCap.mockResolvedValue({ status: "unreviewed", userFacingCopy: "No." });
    expect(await prepareCohortCopilotChat(cohortId)).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("renders the registered unavailable page on a deployment without a local model, or where the scope is not built, reading nothing else", async () => {
    for (const setup of [() => mocks.localAllowed.mockReturnValue(false), () => mocks.built.mockReturnValue(false)]) {
      mocks.localAllowed.mockReturnValue(true);
      mocks.built.mockReturnValue(true);
      setup();
      expect(await prepareCohortCopilotChat(cohortId)).toEqual({ kind: "transport_unavailable" });
    }
    expect(mocks.cohortCap).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("states the cohort's jurisdiction refusal, for the viewer or any parent, before the model or the cohort's data", async () => {
    mocks.cohortCap.mockResolvedValue({ status: "unreviewed", userFacingCopy: "Embryo analysis is not available here." });
    expect(await prepareCohortCopilotChat(cohortId)).toEqual({ kind: "jurisdiction_unavailable", copy: "Embryo analysis is not available here." });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("uses the embryos pages' own states: files still checked, a missing grant, then the Tier-2 gate", async () => {
    mocks.cohorts.mockResolvedValue([{ ...cohort, status: "ingesting" }]);
    expect(await prepareCohortCopilotChat(cohortId)).toMatchObject({ kind: "blocked", state: "processing" });
    mocks.cohorts.mockResolvedValue([{ ...cohort, analysisGranted: false, viewerAnalysisGranted: true, analysisGrantsMissing: 1 }]);
    expect(await prepareCohortCopilotChat(cohortId)).toMatchObject({ kind: "blocked", state: "consent-required", grantsMissing: 1 });
    mocks.cohorts.mockResolvedValue([cohort]);
    mocks.acknowledged.mockResolvedValue(false);
    expect(await prepareCohortCopilotChat(cohortId)).toMatchObject({ kind: "blocked", state: "gated" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("asks for a local model and its permission before reading the cohort's data", async () => {
    mocks.prepare.mockResolvedValue(null);
    expect(await prepareCohortCopilotChat(cohortId)).toMatchObject({ kind: "provider_required" });
    mocks.prepare.mockResolvedValue({ authority: { ...provider, providerClass: "cloud" }, settings: {} });
    expect(await prepareCohortCopilotChat(cohortId)).toMatchObject({ kind: "provider_required" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("says the files are still being checked while the database holds no published cohort for this account", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await prepareCohortCopilotChat(cohortId)).toMatchObject({ kind: "blocked", state: "processing" });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("mints a context bound to the authority and shows only labels, status words and the standing statement", async () => {
    const ready = await prepareCohortCopilotChat(cohortId);
    expect(ready).toMatchObject({ kind: "ready", cohortId, embryos: [{ label: "Embryo 1", status: "Ready" },
      { label: "Embryo 2", status: "Quality check not passed" }] });
    const minted = JSON.parse((ready as { contextToken: string }).contextToken.slice("minted:".length));
    expect(minted).toMatchObject({ accountId, sessionId, cohortId });
    expect(minted.authorityHash).toMatch(/^[0-9a-f]{64}$/);
    expect(operations()).toEqual(["authority", "list"]);
    expect(JSON.stringify({ ...ready, contextToken: null })).not.toMatch(/call_rate|d0000000/);
  });
});

describe("the turn recheck", () => {
  it("passes while everything is current", async () => {
    await expect(checkCohortTurn(actor, cohortId, selfId, provider as never, authority)).resolves.toBeUndefined();
  });
  it("fails closed on a changed authority, a lost jurisdiction, another session, a cloud model or a withdrawn Copilot permission", async () => {
    const cases: Array<() => void> = [
      () => mocks.rpc.mockResolvedValue({ data: { ...authority, participantSetRevision: 2 }, error: null }),
      () => mocks.rpc.mockResolvedValue({ data: null, error: null }),
      () => mocks.cohortCap.mockResolvedValue({ status: "unreviewed", userFacingCopy: "" }),
      () => mocks.cohorts.mockResolvedValue([]),
      () => mocks.actor.mockResolvedValue({ accountId, sessionId: "80000000-0000-4000-8000-0000000000ff" }),
      () => mocks.assert.mockResolvedValue(false),
      () => mocks.localAllowed.mockReturnValue(false),
      () => mocks.built.mockReturnValue(false),
    ];
    for (const [index, setup] of cases.entries()) {
      vi.clearAllMocks();
      mocks.actor.mockResolvedValue(actor);
      mocks.localAllowed.mockReturnValue(true);
      mocks.built.mockReturnValue(true);
      mocks.viewerCap.mockResolvedValue(permitted);
      mocks.cohortCap.mockResolvedValue(permitted);
      mocks.cohorts.mockResolvedValue([cohort]);
      mocks.assert.mockResolvedValue(true);
      mocks.rpc.mockResolvedValue({ data: authority, error: null });
      setup();
      await expect(checkCohortTurn(actor, cohortId, selfId, provider as never, authority), `case ${index}`).rejects.toThrow("copilot_unavailable");
    }
    await expect(checkCohortTurn(actor, cohortId, selfId, { ...provider, providerClass: "cloud" } as never, authority)).rejects.toThrow();
  });
});

describe("history", () => {
  const chatId = "80000000-0000-4000-8000-000000000009";
  const row = (data: unknown) => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) }) });
  it("reads nothing for a chat that is not a cohort chat, or when the scope cannot run here", async () => {
    mocks.from.mockReturnValue(row({ scope_kind: "family", cohort_id: null, legacy_unverified: false }));
    expect(await readCohortChatHistory(chatId)).toBeNull();
    mocks.from.mockReturnValue(row({ scope_kind: "cohort", cohort_id: cohortId, legacy_unverified: false }));
    mocks.localAllowed.mockReturnValue(false);
    expect(await readCohortChatHistory(chatId)).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("answers null, the route's 404, once the database finds the conversation no longer current, and asks under the current provider", async () => {
    mocks.from.mockReturnValue(row({ scope_kind: "cohort", cohort_id: cohortId, legacy_unverified: false }));
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await readCohortChatHistory(chatId)).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledWith("cohort_copilot_chat_v1", expect.objectContaining({ p_operation: "history",
      p_chat_id: chatId, p_cohort_id: cohortId, p_payload: { provider } }));
  });
  it("projects copilotCohortHistoryResponse: the cohort's safe label, messages, citations, no findings", async () => {
    mocks.from.mockReturnValue(row({ scope_kind: "cohort", cohort_id: cohortId, legacy_unverified: false }));
    const message = (id: string, role: string) => ({ id, role, content: [{ type: "text", text: role }], turn_ordinal: 1,
      citations: role === "assistant" ? [{ id: `cohort:${cohortId}`, label: "Compare embryos", href: `/embryos/compare?cohort=${cohortId}` }] : [],
      embryo_findings: [], created_at: "2026-09-28T10:00:00+00:00" });
    mocks.rpc.mockResolvedValue({ data: { chatId, lastOrdinal: 1, messages: [message("90000000-0000-4000-8000-000000000001", "user"),
      message("90000000-0000-4000-8000-000000000002", "assistant")] }, error: null });
    const history = await readCohortChatHistory(chatId);
    expect(history).toMatchObject({ chatId, scope: { kind: "cohort", displayLabel: "Embryos added on 20 September 2026" } });
    expect(Object.keys(history!.messages[1]).sort()).toEqual(["citations", "content", "createdAt", "embryoFindings", "id", "role"]);
    expect(history!.messages[1].embryoFindings).toEqual([]);
  });
});
