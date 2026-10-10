import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cohort scope's chat route, with the database, the embryo readers and
 * the model replaced at their module boundaries. Under test: the route's own
 * order (the target, then the transport, then the capabilities and grants,
 * then the intent gate, all before the authority or any context is read), the
 * binding of each turn to the exact authority the page read under, the
 * fail-closed rechecks around the model and the commit, and ADR 0034's
 * refusals in both gates.
 */
const mocks = vi.hoisted(() => ({
  actor: vi.fn(), subject: vi.fn(), prepare: vi.fn(), token: vi.fn(), stream: vi.fn(), providerFetch: vi.fn(),
  readable: vi.fn(), authority: vi.fn(), check: vi.fn(), rpc: vi.fn(), target: vi.fn(), context: vi.fn(),
  capability: vi.fn(), acknowledged: vi.fn(), localAllowed: vi.fn(), built: vi.fn(), answer: vi.fn(),
  capturedFetch: null as typeof fetch | null, system: "",
}));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("@/lib/subjects", () => ({ resolveSubjectForAccount: mocks.subject }));
vi.mock("./own-provider-authority", () => ({ prepareOwnCopilotProvider: mocks.prepare }));
vi.mock("./cohort-chat-token", () => ({ readCohortChatToken: mocks.token }));
vi.mock("./own-chat-token", () => ({ snapshotHash: (value: unknown) => JSON.stringify(value) }));
vi.mock("./model-endpoint", () => ({ modelRuntime: () => ({ localAllowed: mocks.localAllowed() }) }));
vi.mock("./group-scopes", () => ({ copilotGroupScopes: () => ({ family: true, cohort: mocks.built() }) }));
vi.mock("@/lib/embryos/access", () => ({ EMBRYO_ANALYSIS: "embryo_analysis", cohortCapability: mocks.capability,
  permits: (decision: { status: string }) => decision.status === "permitted" }));
vi.mock("@/lib/embryos/tier2", () => ({ acknowledged: mocks.acknowledged }));
vi.mock("./cohort-chat", async () => {
  const { z } = await import("zod");
  return { readableCohort: mocks.readable, cohortAuthority: mocks.authority, checkCohortTurn: mocks.check,
    cohortChatRpc: mocks.rpc, cohortChatTarget: mocks.target, loadCohortContext: mocks.context,
    authorityHash: (value: unknown) => JSON.stringify(value), cohortChatHistorySchema: z.any() };
});
vi.mock("@/lib/account-deletion", () => ({ isSameOrigin: (r: Request) => r.headers.get("origin") === "https://inherit.test" }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: (o: { fetch: typeof fetch }) => { mocks.capturedFetch = o.fetch; return () => ({}); } }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: (o: { fetch: typeof fetch }) => { mocks.capturedFetch = o.fetch; return () => ({}); } }));
vi.mock("ai", () => ({ streamText: mocks.stream, toUIMessageStream: ({ stream }: { stream: ReadableStream }) => stream }));
import { cohortChatResponse } from "./cohort-chat-route";
import type { CohortAuthority, CopilotCohortContext } from "./cohort-chat-content";

const accountId = "80000000-0000-4000-8000-000000000001", sessionId = "80000000-0000-4000-8000-000000000002";
const selfId = "80000000-0000-4000-8000-000000000003", chatId = "80000000-0000-4000-8000-000000000004";
const cohortId = "c0000000-0000-4000-8000-000000000001";
const E1 = "e0000000-0000-4000-8000-000000000001", E2 = "e0000000-0000-4000-8000-000000000002";
const provider = { accountId, sessionId, subjectId: selfId, providerClass: "local" };
const authority: CohortAuthority = { cohortId, role: "required_upload_principal", publicationRevision: 1, basisCase: "true_two_parent",
  basisRevision: 1, participantSetRevision: 1, cohortRevision: 1, donorAttributionRevision: 1, donorClassification: "donor-neutral",
  grants: [{ principalId: "a0000000-0000-4000-8000-000000000001", grantId: "b0000000-0000-4000-8000-000000000001", grantRevision: 1 },
    { principalId: "a0000000-0000-4000-8000-000000000002", grantId: "b0000000-0000-4000-8000-000000000002", grantRevision: 1 }],
  embryos: [{ embryoId: E1, subjectId: "d0000000-0000-4000-8000-000000000001", lifecycleRevision: 1 },
    { embryoId: E2, subjectId: "d0000000-0000-4000-8000-000000000002", lifecycleRevision: 1 }] };
const qc = (callRate: number, verdict: "pass" | "fail") => ({ sites_expected: 10, sites_called: callRate * 10, call_rate: callRate,
  qc_verdict: verdict, qc_reasons: verdict === "pass" ? [] : ["embryo_call_rate"] });
const context = { cohort_id: cohortId, findings: [], authorized_parent_carrier_reports: [],
  standing_statement: "No child anywhere has been born and followed up after embryos were compared this way.",
  embryos: [
    { id: E1, cohort_id: cohortId, sample_ordinal: 0, display_label: "Embryo 1", status: "qc_pass", qc: qc(0.97, "pass"), findings: [], sanitized_variant_file_ids: [] },
    { id: E2, cohort_id: cohortId, sample_ordinal: 1, display_label: "Embryo 2", status: "qc_fail", qc: qc(0.7, "fail"), findings: [], sanitized_variant_file_ids: [] },
  ] } as unknown as CopilotCohortContext;
const cohort = { id: cohortId, createdAt: "2026-09-20T10:00:00.000Z", embryoCount: 2, analysisGranted: true };
const options = { refusal: (id: string, text: string) => new Response(text, { headers: { "x-copilot-refusal": id } }) };
const request = (body: unknown) => new Request("https://inherit.test/api/chat", { method: "POST",
  headers: { origin: "https://inherit.test", "Content-Type": "application/json" }, body: JSON.stringify(body) });
const first = { contextToken: "cohort-context-token", message: "What was each embryo's call rate?" };
const commits = () => mocks.rpc.mock.calls.filter(call => call[0] === "commit");
const reads = () => mocks.authority.mock.calls.length + mocks.context.mock.calls.length + mocks.rpc.mock.calls.length;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.capturedFetch = null;
  mocks.system = "";
  mocks.actor.mockResolvedValue({ accountId, sessionId });
  mocks.built.mockReturnValue(true);
  mocks.localAllowed.mockReturnValue(true);
  mocks.capability.mockResolvedValue({ status: "permitted" });
  mocks.acknowledged.mockResolvedValue(true);
  mocks.readable.mockResolvedValue(cohort);
  mocks.authority.mockResolvedValue(authority);
  mocks.context.mockResolvedValue(context);
  mocks.check.mockResolvedValue(undefined);
  mocks.target.mockResolvedValue(cohortId);
  mocks.subject.mockResolvedValue({ id: selfId, subjectClass: "self", displayLabel: "You" });
  mocks.prepare.mockResolvedValue({ authority: provider, settings: { provider: "openai_compatible", base_url: "http://127.0.0.1:8127/v1", model: "synthetic" },
    createFetch: (authorize: () => Promise<boolean>) => async (...args: Parameters<typeof fetch>) => {
      if (!await authorize()) throw new Error("unavailable");
      return mocks.providerFetch(...args);
    } });
  mocks.token.mockReturnValue({ accountId, sessionId, scope: "cohort", cohortId, issuingRoute: "copilot.scope",
    providerHash: JSON.stringify(provider), authorityHash: JSON.stringify(authority), nonce: "n".repeat(32),
    issuedAt: Date.now(), expiresAt: Date.now() + 540000 });
  mocks.providerFetch.mockResolvedValue(new Response("{}"));
  mocks.answer.mockReturnValue("Embryo 1 had a call rate of 0.97 and Embryo 2 had 0.7.");
  mocks.rpc.mockImplementation(async (op: string) => op === "commit" ? { chatId }
    : op === "history" ? { chatId, lastOrdinal: 1, messages: [{ role: "user", content: [{ text: "Earlier" }] }, { role: "assistant", content: [{ text: "Earlier answer" }] }] } : null);
  mocks.stream.mockImplementation((flow: { system: string }) => ({ stream: new ReadableStream({ async start(controller) {
    try {
      mocks.system = flow.system;
      await mocks.capturedFetch!("https://provider.test/v1/chat/completions", { method: "POST" });
      controller.enqueue({ type: "text-delta", id: "answer", delta: mocks.answer() });
      controller.close();
    } catch { controller.error(new Error("private provider details")); }
  } }) }));
});

describe("the cohort scope's chat route", () => {
  it("answers from the closed cohort context and binds the turn to the exact authority it read under", async () => {
    const response = await cohortChatResponse(request(first), first, options);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ chatId, message: { role: "assistant", content: "Embryo 1 had a call rate of 0.97 and Embryo 2 had 0.7.",
      citations: [
        { id: `cohort:${cohortId}`, label: "Compare embryos", href: `/embryos/compare?cohort=${cohortId}` },
        { id: `embryo:${E1}`, label: "Embryo 1", href: `/embryos/${E1}` },
        { id: `embryo:${E2}`, label: "Embryo 2", href: `/embryos/${E2}` },
      ], embryoFindings: [] } });
    const [op, , cohortArg, chatArg, payload] = commits()[0];
    expect([op, cohortArg, chatArg]).toEqual(["commit", cohortId, null]);
    expect(payload).toMatchObject({ authority, provider, lastOrdinal: 0, nonceHash: JSON.stringify("n".repeat(32)) });
    // The model's whole context is the closed one, with its rules first.
    expect(mocks.system).toContain(JSON.stringify(context));
    expect(mocks.system).toMatch(/Never rank, order, choose or recommend embryos/);
    expect(mocks.system).toMatch(/Never state, guess or discuss an embryo's sex/);
    // Rechecked before the model call (inside the pinned connection), after it and around the commit.
    expect(mocks.check.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("returns the registered transport refusal before reading anything about the cohort on a deployment without a local model", async () => {
    mocks.localAllowed.mockReturnValue(false);
    const response = await cohortChatResponse(request(first), first, options);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "local_transport_unavailable", state: "not-covered",
      reason: "local-transport-unavailable", messageCopyId: "copilot.transport.local-unavailable" });
    expect(reads()).toBe(0);
    expect(mocks.capability).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("is not built outside TEST-LOCAL: the same transport refusal, nothing read", async () => {
    mocks.built.mockReturnValue(false);
    const response = await cohortChatResponse(request(first), first, options);
    expect((await response.json()).error).toBe("local_transport_unavailable");
    expect(reads()).toBe(0);
  });

  it("answers a cohort this account cannot read as not found, before the transport or anything else", async () => {
    mocks.readable.mockResolvedValue(null);
    const response = await cohortChatResponse(request(first), first, options);
    expect(response.status).toBe(404);
    expect(reads()).toBe(0);
  });

  it("answers another account's or session's context as not found", async () => {
    mocks.token.mockReturnValue({ ...mocks.token(), accountId: "80000000-0000-4000-8000-0000000000ff" });
    expect((await cohortChatResponse(request(first), first, options)).status).toBe(404);
    expect(mocks.readable).not.toHaveBeenCalled();
  });

  it("answers a chat that is not this account's cohort chat as not found", async () => {
    mocks.target.mockResolvedValue(null);
    const body = { chatId, message: "More?" };
    expect((await cohortChatResponse(request(body), body, options)).status).toBe(404);
    expect(reads()).toBe(0);
  });

  it("refuses when the cohort's jurisdiction, a parent's analysis grant or the Tier-2 gate is missing, before any read", async () => {
    for (const setup of [
      () => mocks.capability.mockResolvedValue({ status: "unreviewed" }),
      () => mocks.readable.mockResolvedValue({ ...cohort, analysisGranted: false }),
      () => mocks.acknowledged.mockResolvedValue(false),
    ]) {
      vi.clearAllMocks();
      mocks.readable.mockResolvedValue(cohort);
      mocks.capability.mockResolvedValue({ status: "permitted" });
      mocks.acknowledged.mockResolvedValue(true);
      setup();
      expect((await cohortChatResponse(request(first), first, options)).status).toBe(403);
      expect(reads()).toBe(0);
      expect(mocks.stream).not.toHaveBeenCalled();
    }
  });

  it("never sends embryo data to a cloud model", async () => {
    mocks.prepare.mockResolvedValue({ ...(await mocks.prepare()), authority: { ...provider, providerClass: "cloud" } });
    const response = await cohortChatResponse(request(first), first, options);
    expect((await response.json()).error).toBe("local_transport_unavailable");
    expect(reads()).toBe(0);
  });

  it("refuses a ranking, selection or sex question at the gate, with no read and no model call", async () => {
    for (const message of ["Which embryo is the best?", "Rank the embryos for me.", "Which embryo should we transfer?", "Is embryo 2 a boy or a girl?"]) {
      const body = { contextToken: "cohort-context-token", message };
      const response = await cohortChatResponse(request(body), body, options);
      expect(response.headers.get("x-copilot-refusal"), message).toMatch(/selection-advice|sex-disclosure/);
    }
    expect(reads()).toBe(0);
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("needs a fresh page when the cohort's authority changed after the page read it", async () => {
    mocks.authority.mockResolvedValue({ ...authority, participantSetRevision: 2 });
    expect((await cohortChatResponse(request(first), first, options)).status).toBe(403);
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(commits()).toHaveLength(0);
  });

  it("answers not found once the database finds the cohort no longer readable", async () => {
    mocks.authority.mockResolvedValue(null);
    expect((await cohortChatResponse(request(first), first, options)).status).toBe(404);
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("writes nothing when a parent withdraws inside the turn, before the model call", async () => {
    mocks.check.mockResolvedValueOnce(undefined).mockRejectedValue(new Error("copilot_unavailable"));
    expect((await cohortChatResponse(request(first), first, options)).status).toBe(403);
    expect(mocks.providerFetch).not.toHaveBeenCalled();
    expect(commits()).toHaveLength(0);
  });

  it("discards a finished answer if the authority changed after the model replied", async () => {
    let calls = 0;
    mocks.check.mockImplementation(async () => { calls += 1; if (calls >= 3) throw new Error("copilot_unavailable"); });
    expect((await cohortChatResponse(request(first), first, options)).status).toBe(403);
    expect(mocks.providerFetch).toHaveBeenCalledTimes(1);
    expect(commits()).toHaveLength(0);
  });

  it("replaces an answer that ranks embryos or states a number outside the context, and cites nothing", async () => {
    for (const answer of ["Embryo 1 is the best embryo to transfer.", "Embryo 1 had a call rate of 0.42."]) {
      mocks.answer.mockReturnValue(answer);
      const response = await cohortChatResponse(request(first), first, options);
      expect(response.status, answer).toBe(200);
      expect(response.headers.get("x-copilot-refusal"), answer).toMatch(/selection-advice|unsupported-number/);
      const body = await response.json();
      expect(body.message.content).not.toContain(answer);
      expect(body.message.citations).toEqual([]);
    }
  });

  it("continues a conversation only while the database still reads it", async () => {
    const body = { chatId, message: "And the second embryo?" };
    expect((await cohortChatResponse(request(body), body, options)).status).toBe(200);
    expect(commits()[0][4]).toMatchObject({ lastOrdinal: 1, nonceHash: null, expiresAt: null });
    mocks.rpc.mockImplementation(async (op: string) => op === "history" ? null : { chatId });
    expect((await cohortChatResponse(request(body), body, options)).status).toBe(404);
  });

  it("answers not found when the commit finds the conversation no longer current", async () => {
    mocks.rpc.mockImplementation(async () => null);
    expect((await cohortChatResponse(request(first), first, options)).status).toBe(404);
  });

  it("refuses a cross-origin request or any query string before anything else", async () => {
    const crossOrigin = new Request("https://inherit.test/api/chat", { method: "POST", headers: { origin: "https://evil.test" }, body: "{}" });
    expect((await cohortChatResponse(crossOrigin, first, options)).status).toBe(403);
    const query = new Request("https://inherit.test/api/chat?x=1", { method: "POST", headers: { origin: "https://inherit.test" }, body: "{}" });
    expect((await cohortChatResponse(query, first, options)).status).toBe(403);
    expect(mocks.actor).not.toHaveBeenCalled();
  });
});
