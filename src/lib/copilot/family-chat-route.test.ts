import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedReportResult } from "@/lib/family/shared-report-results";

/**
 * The Family group scope's chat route, with the database, the Family reader
 * and the model replaced at their module boundaries. What is under test is
 * the route's own order and its fail-closed rules: every turn resolves the
 * group again, a member who withdraws is gone from the next turn, and a
 * withdrawal inside a turn writes nothing.
 */
const mocks = vi.hoisted(() => ({
  actor: vi.fn(), subject: vi.fn(), prepare: vi.fn(), token: vi.fn(), stream: vi.fn(), providerFetch: vi.fn(),
  members: vi.fn(), capture: vi.fn(), check: vi.fn(), rpc: vi.fn(), jurisdiction: vi.fn(), isChat: vi.fn(),
  localAllowed: vi.fn(), built: vi.fn(), capturedFetch: null as typeof fetch | null,
}));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("@/lib/subjects", () => ({ resolveSubjectForAccount: mocks.subject }));
vi.mock("./own-provider-authority", () => ({ prepareOwnCopilotProvider: mocks.prepare }));
vi.mock("./family-chat-token", () => ({ readFamilyChatToken: mocks.token }));
vi.mock("./own-chat-token", () => ({ snapshotHash: (value: unknown) => JSON.stringify(value) }));
vi.mock("./model-endpoint", () => ({ modelRuntime: () => ({ localAllowed: mocks.localAllowed() }) }));
vi.mock("./group-scopes", () => ({ copilotGroupScopes: () => ({ family: mocks.built(), cohort: false }) }));
vi.mock("./family-chat", async () => {
  const { z } = await import("zod");
  return { resolveFamilyMembers: mocks.members, captureFamilyReports: mocks.capture, checkFamilyTurn: mocks.check,
    familyChatRpc: mocks.rpc, familyJurisdictionPermits: mocks.jurisdiction, isFamilyGroupChat: mocks.isChat,
    familyMembersHash: (members: Array<{ authority: unknown }>) => JSON.stringify(members.map(m => m.authority)),
    familyChatHistorySchema: z.any() };
});
vi.mock("@/lib/account-deletion", () => ({ isSameOrigin: (r: Request) => r.headers.get("origin") === "https://inherit.test" }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: (o: { fetch: typeof fetch }) => { mocks.capturedFetch = o.fetch; return () => ({}); } }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: (o: { fetch: typeof fetch }) => { mocks.capturedFetch = o.fetch; return () => ({}); } }));
vi.mock("ai", () => ({ tool: (x: unknown) => x, stepCountIs: () => 8, streamText: mocks.stream,
  toUIMessageStream: ({ stream }: { stream: ReadableStream }) => stream }));
import { familyChatResponse, FAMILY_SYSTEM_PROMPT } from "./family-chat-route";
import { familyMemberAuthoritySchema, type FamilyScopeMember } from "./family-chat-content";

const accountId = "80000000-0000-4000-8000-000000000001", sessionId = "80000000-0000-4000-8000-000000000002";
const selfId = "80000000-0000-4000-8000-000000000003", chatId = "80000000-0000-4000-8000-000000000004";
const B = "10000000-0000-4000-8000-00000000000b", FILE_B = "20000000-0000-4000-8000-00000000000b";
const HANDLE_B = "s-30000000-0000-4000-8000-00000000000b";
const provider = { accountId, sessionId, subjectId: selfId, providerClass: "local" };
const bee: FamilyScopeMember = { ref: "person-1", displayLabel: "Bea", handleSegment: HANDLE_B, layers: ["estimate"],
  authority: familyMemberAuthoritySchema.parse({ subjectId: B, accountId: "40000000-0000-4000-8000-00000000000b", lifecycleRevision: 1,
    relationship: { id: "50000000-0000-4000-8000-00000000000b", revision: 1 },
    copilot: { purpose: "copilot.local", grantId: "60000000-0000-4000-8000-00000000000b", grantRevision: 1 },
    heritability: { purpose: "family.heritability", grantId: "70000000-0000-4000-8000-00000000000b", grantRevision: 1 },
    layers: [{ purpose: "reports.polygenic", grantId: "90000000-0000-4000-8000-00000000000b", grantRevision: 1 }] }) };
const beeRow: SharedReportResult = { fileId: FILE_B, subjectId: B, purpose: "reports.polygenic", completedAt: "2026-09-20T10:00:00.000Z",
  report: { slug: "fixture-estimate", covered: true, conflictingRsids: [],
    variants: [{ rsid: 4988235, outcome: { status: "genotyped", genotype: "AG", interpretation: "saved", strandFlipped: false } }],
    catalogSnapshot: { schemaVersion: 1, templateSha256: "b".repeat(64), template: { slug: "fixture-estimate", category: "basic-traits",
      title: "Fixture estimate", summary: "Synthetic.", evidence: "emerging",
      variants: [{ rsid: 4988235, gene: "X", chrom: 2, pos38: 135851076, ref: "G", alt: "A", interpretations: { AG: "saved" } }],
      pgs_id: null, citations: [{ pmid: "12345678", label: "Synthetic et al., 2020" }], layer: "estimate", estimate_kind: "single_locus" } } } };
const options = { refusal: (id: string, text: string) => new Response(text, { headers: { "x-copilot-refusal": id } }) };
const request = (body: unknown) => new Request("https://inherit.test/api/chat", { method: "POST",
  headers: { origin: "https://inherit.test", "Content-Type": "application/json" }, body: JSON.stringify(body) });
const first = { contextToken: "family-context-token", message: "What did Bea share?" };
type Flow = { system: string; messages: unknown[]; prepareStep: () => Promise<unknown>;
  tools: Record<string, { execute: (x: unknown) => Promise<unknown> }> };
let run: (flow: Flow) => Promise<string>;
let seen: unknown[] = [];
const commits = () => mocks.rpc.mock.calls.filter(call => call[0] === "commit");

beforeEach(() => {
  vi.clearAllMocks();
  seen = [];
  mocks.capturedFetch = null;
  mocks.actor.mockResolvedValue({ accountId, sessionId });
  mocks.built.mockReturnValue(true);
  mocks.localAllowed.mockReturnValue(true);
  mocks.jurisdiction.mockResolvedValue(true);
  mocks.subject.mockResolvedValue({ id: selfId, subjectClass: "self", displayLabel: "You" });
  mocks.prepare.mockResolvedValue({ authority: provider, settings: { provider: "openai_compatible", base_url: "http://127.0.0.1:8127/v1", model: "synthetic" },
    createFetch: (authorize: () => Promise<boolean>) => async (...args: Parameters<typeof fetch>) => {
      if (!await authorize()) throw new Error("unavailable");
      return mocks.providerFetch(...args);
    } });
  mocks.token.mockReturnValue({ accountId, sessionId, scope: "family", issuingRoute: "copilot.scope", providerHash: JSON.stringify(provider),
    membersHash: JSON.stringify([bee.authority]), nonce: "n".repeat(32), issuedAt: Date.now(), expiresAt: Date.now() + 540000 });
  mocks.members.mockResolvedValue([bee]);
  mocks.capture.mockImplementation(async (members: FamilyScopeMember[]) => ({ members,
    rows: new Map(members.map(member => [member.authority.subjectId, member.authority.subjectId === B ? [beeRow] : []])),
    confirm: async () => true }));
  mocks.check.mockResolvedValue(undefined);
  mocks.isChat.mockResolvedValue(true);
  mocks.providerFetch.mockResolvedValue(new Response("{}"));
  mocks.rpc.mockImplementation(async (op: string) => op === "commit" ? { chatId }
    : op === "history" ? { chatId, lastOrdinal: 1, messages: [{ role: "user", content: [{ text: "Earlier" }] }, { role: "assistant", content: [{ text: "Earlier answer" }] }] } : true);
  run = async flow => {
    await flow.prepareStep();
    seen.push(await flow.tools.get_report.execute({ slug: "fixture-estimate" }));
    await mocks.capturedFetch!("https://provider.test/v1/chat/completions", { method: "POST" });
    return "Bea's saved estimate report is available.";
  };
  // Each tool result the turn produced reaches the fold as the SDK delivers
  // it, so the output guard and the answer's sources read the real tool JSON.
  mocks.stream.mockImplementation((flow: Flow) => ({ stream: new ReadableStream({ async start(controller) {
    try {
      const before = seen.length;
      const text = await run(flow);
      for (const [index, output] of seen.slice(before).entries())
        controller.enqueue({ type: "tool-output-available", toolCallId: `call-${index}`, output });
      controller.enqueue({ type: "text-delta", id: "answer", delta: text });
      controller.close();
    } catch { controller.error(new Error("private provider details")); }
  } }) }));
});

describe("the Family group scope's chat route", () => {
  it("answers from each person's shared report, names them, and binds the turn to exactly whose data it used", async () => {
    const response = await familyChatResponse(request(first), first, options);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ chatId, message: { role: "assistant", content: "Bea's saved estimate report is available.", embryoFindings: [],
      citations: [{ id: `person:${HANDLE_B}`, label: "Shared by Bea", href: `/family/${HANDLE_B}` },
        { id: `report:fixture-estimate:${"b".repeat(64)}:${HANDLE_B}`, label: "Fixture estimate (shared by Bea)", href: `/genome/${HANDLE_B}/reports/fixture-estimate` },
        { id: "pmid:12345678", label: "Synthetic et al., 2020", href: "https://pubmed.ncbi.nlm.nih.gov/12345678/" }] } });
    const [, , commitChat, payload] = commits()[0];
    expect(commitChat).toBeNull();
    expect(payload.used).toEqual([{ authority: bee.authority, purposes: ["reports.polygenic"], files: [{ fileId: FILE_B, purpose: "reports.polygenic" }] }]);
    expect(payload.provider).toEqual(provider);
    expect(payload.nonceHash).toBe(JSON.stringify("n".repeat(32)));
    expect(mocks.stream.mock.calls[0][0].system).toContain(FAMILY_SYSTEM_PROMPT);
    expect(mocks.stream.mock.calls[0][0].system).toContain("Bea (person-1)");
    // No genotype or variant search tool exists in this scope.
    expect(Object.keys(mocks.stream.mock.calls[0][0].tools).sort()).toEqual(["get_report", "list_reports"]);
  });

  it("cuts a withdrawn member off on the next turn of the same conversation", async () => {
    expect((await familyChatResponse(request(first), first, options)).status).toBe(200);
    expect(JSON.stringify(seen[0])).toContain("Bea");
    // Bea withdraws between turns: the database no longer returns her.
    mocks.members.mockResolvedValue([]);
    run = async flow => {
      seen.push(await flow.tools.get_report.execute({ slug: "fixture-estimate" }));
      seen.push(await flow.tools.list_reports.execute({}));
      return "Nobody in this view shares that report.";
    };
    const next = { chatId, message: "And now?" };
    const response = await familyChatResponse(request(next), next, options);
    expect(response.status).toBe(200);
    expect(JSON.stringify(seen.slice(1))).not.toContain("Bea");
    expect(JSON.stringify(seen.slice(1))).not.toContain("AG");
    expect(mocks.stream.mock.calls[1][0].system).toContain("may read now: nobody");
    const [, , commitChat, payload] = commits()[1];
    expect(commitChat).toBe(chatId);
    expect(payload.used).toEqual([]);
    expect((await response.json()).message.citations).toEqual([]);
    // The group is resolved again for every turn, never carried over.
    expect(mocks.members).toHaveBeenCalledTimes(2);
  });

  it("writes nothing when the member withdraws inside the turn, after the tool read and before the model call", async () => {
    run = async flow => {
      seen.push(await flow.tools.get_report.execute({ slug: "fixture-estimate" }));
      mocks.check.mockRejectedValue(new Error("withdrawn"));
      await mocks.capturedFetch!("https://provider.test/v1/chat/completions", { method: "POST" });
      return "hidden";
    };
    const response = await familyChatResponse(request(first), first, options);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "copilot_unavailable" });
    expect(mocks.providerFetch).not.toHaveBeenCalled();
    expect(commits()).toEqual([]);
  });

  it("refuses the tool read itself once the member has withdrawn", async () => {
    run = async flow => { mocks.check.mockRejectedValue(new Error("withdrawn")); await flow.tools.get_report.execute({ slug: "fixture-estimate" }); return "hidden"; };
    expect((await familyChatResponse(request(first), first, options)).status).toBe(403);
    expect(commits()).toEqual([]);
  });

  it("discards a finished answer if permission changed after the model replied", async () => {
    run = async () => { mocks.check.mockRejectedValue(new Error("withdrawn")); return "Bea has a saved estimate."; };
    const response = await familyChatResponse(request(first), first, options);
    expect(await response.json()).toEqual({ error: "copilot_unavailable" });
    expect(commits()).toEqual([]);
  });

  it("needs a fresh page when the group changed after the page showed it", async () => {
    mocks.members.mockResolvedValue([{ ...bee, authority: { ...bee.authority, lifecycleRevision: 2 } }]);
    expect((await familyChatResponse(request(first), first, options)).status).toBe(403);
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("answers another account's or session's context as not found, reading nothing", async () => {
    mocks.token.mockReturnValue({ ...mocks.token(), accountId: "80000000-0000-4000-8000-0000000000ff" });
    expect((await familyChatResponse(request(first), first, options)).status).toBe(404);
    mocks.token.mockReturnValue({ ...mocks.token(), accountId, sessionId: "80000000-0000-4000-8000-0000000000fe" });
    expect((await familyChatResponse(request(first), first, options)).status).toBe(404);
    expect(mocks.members).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("answers a chat that is not this account's family group chat as not found", async () => {
    mocks.isChat.mockResolvedValue(false);
    const next = { chatId, message: "Hi" };
    expect((await familyChatResponse(request(next), next, options)).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers not found when the conversation's history is no longer current", async () => {
    mocks.rpc.mockImplementation(async (op: string) => op === "history" ? null : true);
    const next = { chatId, message: "Hi" };
    expect((await familyChatResponse(request(next), next, options)).status).toBe(404);
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("returns the registered transport refusal before any read on a deployment without a local model", async () => {
    mocks.localAllowed.mockReturnValue(false);
    const response = await familyChatResponse(request(first), first, options);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "local_transport_unavailable", state: "not-covered",
      reason: "local-transport-unavailable", messageCopyId: "copilot.transport.local-unavailable" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.members).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("never sends another adult's results to a cloud model", async () => {
    mocks.prepare.mockResolvedValue({ ...(await mocks.prepare()), authority: { ...provider, providerClass: "cloud" } });
    const response = await familyChatResponse(request(first), first, options);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("local_transport_unavailable");
    expect(mocks.members).not.toHaveBeenCalled();
  });

  it("refuses outside the Family jurisdiction before the provider or the group is read", async () => {
    mocks.jurisdiction.mockResolvedValue(false);
    expect((await familyChatResponse(request(first), first, options)).status).toBe(403);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.members).not.toHaveBeenCalled();
  });

  it("serves nothing where the scope is not built", async () => {
    mocks.built.mockReturnValue(false);
    expect((await familyChatResponse(request(first), first, options)).status).toBe(404);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it.each([
    ["What dosage of vitamin D should Bea take?", "treatment"],
    ["Does Bea have diabetes?", "diagnosis"],
    ["Which of our embryos should we choose?", "selection-advice"],
    ["Will Invited adult get cancer?", "prognosis"],
  ])("refuses %j with its fixed refusal and no result read, model call or write", async (message, refusal) => {
    mocks.members.mockResolvedValue([bee, { ...bee, displayLabel: "Invited adult", ref: "person-2" }]);
    const body = { contextToken: "family-context-token", message };
    const response = await familyChatResponse(request(body), body, options);
    expect(response.headers.get("x-copilot-refusal")).toBe(refusal);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("allows a plain question about what a named person shared", async () => {
    const body = { contextToken: "family-context-token", message: "Does Bea have the lactase variant?" };
    const response = await familyChatResponse(request(body), body, options);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-copilot-refusal")).toBeNull();
  });

  it("replaces an answer that diagnoses a named person, exactly as it would one that diagnoses you", async () => {
    run = async flow => { seen.push(await flow.tools.get_report.execute({ slug: "fixture-estimate" })); return "Bea has diabetes."; };
    const response = await familyChatResponse(request(first), first, options);
    expect(response.headers.get("x-copilot-refusal")).toBe("diagnosis");
    expect((await response.json()).message.content).not.toContain("Bea has diabetes");
  });

  it("replaces a diagnosing answer whole and still records whose data the model read", async () => {
    run = async flow => { seen.push(await flow.tools.get_report.execute({ slug: "fixture-estimate" })); return "You have diabetes."; };
    const response = await familyChatResponse(request(first), first, options);
    const body = await response.json();
    expect(response.headers.get("x-copilot-refusal")).toBe("diagnosis");
    expect(body.message.content).not.toContain("You have diabetes");
    expect(body.message.citations).toEqual([]);
    expect(commits()[0][3].answer).toBe(body.message.content);
    expect(commits()[0][3].used.map((u: { authority: { subjectId: string } }) => u.authority.subjectId)).toEqual([B]);
  });

  it.each([{ contextToken: "family-context-token", message: "Hi", scope: "family" }, { chatId, message: "Hi", subjectId: B }, { message: "Hi" }])(
    "refuses a client-chosen scope or history before anything else", async body => {
      expect((await familyChatResponse(request(body), body, options)).status).toBe(400);
      expect(mocks.prepare).not.toHaveBeenCalled();
    });
});
