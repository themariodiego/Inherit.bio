import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedReportResult } from "@/lib/family/shared-report-results";

/**
 * Copilot for one other adult's record, its chat route (owner decision of
 * 19 November 2026, "G8.5: Copilot for another adult's record opens"), with
 * the database, the readers and the model replaced at their module
 * boundaries. Under test: the route's own order, the register's (the
 * jurisdiction, the local transport, the local provider, the database scope:
 * mitigation decision, copilot.local, report layers; the Tier-2
 * acknowledgement; the intent gate), and that each gate refuses before
 * anything after it runs; that the subject comes only from the token or the
 * chat row; and that the turn is bound to exactly what it read.
 */
const mocks = vi.hoisted(() => ({
  actor: vi.fn(), subject: vi.fn(), prepare: vi.fn(), token: vi.fn(), stream: vi.fn(), providerFetch: vi.fn(),
  target: vi.fn(), scope: vi.fn(), capture: vi.fn(), check: vi.fn(), rpc: vi.fn(), jurisdiction: vi.fn(), chatSubject: vi.fn(),
  localAllowed: vi.fn(), acknowledged: vi.fn(), capturedFetch: null as typeof fetch | null,
}));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("@/lib/subjects", () => ({ resolveSubjectForAccount: mocks.subject }));
vi.mock("@/lib/family/tier2", () => ({ acknowledged: mocks.acknowledged }));
vi.mock("./own-provider-authority", () => ({ prepareOwnCopilotProvider: mocks.prepare }));
vi.mock("./subject-chat-token", () => ({ readSubjectChatToken: mocks.token }));
vi.mock("./own-chat-token", () => ({ snapshotHash: (value: unknown) => JSON.stringify(value) }));
vi.mock("./model-endpoint", () => ({ modelRuntime: () => ({ localAllowed: mocks.localAllowed() }) }));
vi.mock("./family-chat", async () => ({ familyChatHistorySchema: (await import("zod")).z.any() }));
vi.mock("./subject-chat", async () => ({
  resolveSubjectTarget: mocks.target, subjectScope: mocks.scope, captureSubjectReports: mocks.capture, checkSubjectTurn: mocks.check,
  subjectChatRpc: mocks.rpc, subjectChatSubject: mocks.chatSubject, subjectJurisdictionPermits: mocks.jurisdiction,
  subjectMember: (target: { displayLabel: string; handleSegment: string }, authority: { case: string; layers: Array<{ purpose: string }> }) => ({
    authority, ref: "person-1", displayLabel: target.displayLabel, handleSegment: target.handleSegment,
    layers: authority.layers.map(layer => layer.purpose === "reports.monogenic" ? "variant_call" : "estimate"),
    personHref: authority.case === "grantee" ? `/family/${target.handleSegment}` : null }),
}));
vi.mock("@/lib/account-deletion", () => ({ isSameOrigin: (r: Request) => r.headers.get("origin") === "https://inherit.test" }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: (o: { fetch: typeof fetch }) => { mocks.capturedFetch = o.fetch; return () => ({}); } }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: (o: { fetch: typeof fetch }) => { mocks.capturedFetch = o.fetch; return () => ({}); } }));
vi.mock("ai", () => ({ tool: (x: unknown) => x, stepCountIs: () => 8, streamText: mocks.stream,
  toUIMessageStream: ({ stream }: { stream: ReadableStream }) => stream }));
import { isSubjectChatRequest, subjectChatResponse } from "./subject-chat-route";
import { FAMILY_SYSTEM_PROMPT } from "@/copy/copilot/system-prompts";

const accountId = "81000000-0000-4000-8000-000000000001", sessionId = "81000000-0000-4000-8000-000000000002";
const selfId = "81000000-0000-4000-8000-000000000003", chatId = "81000000-0000-4000-8000-000000000004";
const B = "11000000-0000-4000-8000-00000000000b", FILE_B = "21000000-0000-4000-8000-00000000000b";
const OTHER = "11000000-0000-4000-8000-00000000000c";
const HANDLE_B = "s-31000000-0000-4000-8000-00000000000b";
const provider = { accountId, sessionId, subjectId: selfId, providerClass: "local" };
const authority = { case: "grantee", subjectId: B, accountId: "41000000-0000-4000-8000-00000000000b", lifecycleRevision: 1,
  subjectBindingRevision: 1, relationship: { id: "51000000-0000-4000-8000-00000000000b", revision: 1 },
  copilot: { purpose: "copilot.local", grantId: "61000000-0000-4000-8000-00000000000b", grantRevision: 1 },
  layers: [{ purpose: "reports.polygenic", grantId: "91000000-0000-4000-8000-00000000000b", grantRevision: 1 }] };
const target = { case: "grantee", subjectId: B, displayLabel: "Bea", handleSegment: HANDLE_B };
const beeRow: SharedReportResult = { fileId: FILE_B, subjectId: B, purpose: "reports.polygenic", completedAt: "2026-11-20T10:00:00.000Z",
  report: { slug: "fixture-estimate", covered: true, conflictingRsids: [],
    variants: [{ rsid: 4988235, outcome: { status: "genotyped", genotype: "AG", interpretation: "saved", strandFlipped: false } }],
    catalogSnapshot: { schemaVersion: 1, templateSha256: "b".repeat(64), template: { slug: "fixture-estimate", category: "basic-traits",
      title: "Fixture estimate", summary: "Synthetic.", evidence: "emerging",
      variants: [{ rsid: 4988235, gene: "X", chrom: 2, pos38: 135851076, ref: "G", alt: "A", interpretations: { AG: "saved" } }],
      pgs_id: null, citations: [{ pmid: "12345678", label: "Synthetic et al., 2020" }], layer: "estimate", estimate_kind: "single_locus" } } } };
const options = { refusal: (id: string, text: string) => new Response(text, { headers: { "x-copilot-refusal": id } }) };
const request = (body: unknown, origin = "https://inherit.test") => new Request("https://inherit.test/api/chat", { method: "POST",
  headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const first = { contextToken: "subject-context-token-0000", message: "What did Bea share?" };
const next = { chatId, message: "And anything else?" };
type Flow = { system: string; prepareStep: () => Promise<unknown>; tools: Record<string, { execute: (x: unknown) => Promise<unknown> }> };
let run: (flow: Flow) => Promise<string>;
let seen: unknown[] = [];
const commits = () => mocks.rpc.mock.calls.filter(call => call[0] === "commit");
/** Nothing past the named gate ran: no reader, no model, no write. */
function nothingRead() {
  expect(mocks.capture).not.toHaveBeenCalled();
  expect(mocks.stream).not.toHaveBeenCalled();
  expect(commits()).toHaveLength(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  seen = [];
  mocks.capturedFetch = null;
  mocks.actor.mockResolvedValue({ accountId, sessionId });
  mocks.localAllowed.mockReturnValue(true);
  mocks.jurisdiction.mockResolvedValue(true);
  mocks.acknowledged.mockResolvedValue(true);
  mocks.subject.mockResolvedValue({ id: selfId, subjectClass: "self", displayLabel: "You" });
  mocks.prepare.mockResolvedValue({ authority: provider, settings: { provider: "openai_compatible", base_url: "http://127.0.0.1:8127/v1", model: "synthetic" },
    createFetch: (authorize: () => Promise<boolean>) => async (...args: Parameters<typeof fetch>) => {
      if (!await authorize()) throw new Error("unavailable");
      return mocks.providerFetch(...args);
    } });
  mocks.token.mockReturnValue({ accountId, sessionId, scope: "subject", issuingRoute: "copilot.scope", subjectId: B,
    providerHash: JSON.stringify(provider), authorityHash: JSON.stringify(authority), nonce: "n".repeat(32),
    issuedAt: Date.now(), expiresAt: Date.now() + 540000 });
  mocks.target.mockResolvedValue(target);
  mocks.scope.mockResolvedValue({ state: "ready", authority });
  mocks.capture.mockImplementation(async () => ({ rows: new Map([[B, [beeRow]]]), confirm: async () => true }));
  mocks.check.mockResolvedValue(undefined);
  mocks.chatSubject.mockResolvedValue(B);
  mocks.providerFetch.mockResolvedValue(new Response("{}"));
  mocks.rpc.mockImplementation(async (op: string) => op === "commit" ? { chatId }
    : op === "history" ? { chatId, lastOrdinal: 1, messages: [{ role: "user", content: [{ text: "Earlier" }] }, { role: "assistant", content: [{ text: "Earlier answer" }] }] } : true);
  run = async flow => {
    await flow.prepareStep();
    seen.push(await flow.tools.get_report.execute({ slug: "fixture-estimate" }));
    await mocks.capturedFetch!("http://127.0.0.1:8127/v1/chat/completions", { method: "POST" });
    return "Bea's saved estimate report is available.";
  };
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

describe("Copilot for one other adult's record: the chat route", () => {
  it("answers from the person's shared report, names them, and binds the turn to the record and what it read", async () => {
    const response = await subjectChatResponse(request(first), first, options);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ chatId, message: { role: "assistant", content: "Bea's saved estimate report is available.", embryoFindings: [],
      citations: [{ id: `person:${HANDLE_B}`, label: "Shared by Bea", href: `/family/${HANDLE_B}` },
        { id: `report:fixture-estimate:${"b".repeat(64)}:${HANDLE_B}`, label: "Fixture estimate (shared by Bea)", href: `/genome/${HANDLE_B}/reports/fixture-estimate` },
        { id: "pmid:12345678", label: "Synthetic et al., 2020", href: "https://pubmed.ncbi.nlm.nih.gov/12345678/" }] } });
    // The one record the token names, never another.
    expect(mocks.target).toHaveBeenCalledExactlyOnceWith(accountId, B);
    expect(mocks.scope).toHaveBeenCalledExactlyOnceWith({ accountId, sessionId }, B);
    const [, , subject, commitChat, payload] = commits()[0]!;
    expect(subject).toBe(B);
    expect(commitChat).toBeNull();
    expect(payload.authority).toEqual(authority);
    expect(payload.used).toEqual([{ authority, purposes: ["reports.polygenic"], files: [{ fileId: FILE_B, purpose: "reports.polygenic" }] }]);
    expect(payload.provider).toEqual(provider);
    expect(payload.nonceHash).toBe(JSON.stringify("n".repeat(32)));
    // The Family scope's own prompt, naming the one person this thread reads.
    expect(mocks.stream.mock.calls[0]![0].system).toContain(FAMILY_SYSTEM_PROMPT);
    expect(mocks.stream.mock.calls[0]![0].system).toContain("People whose shared reports you may read now: Bea (person-1).");
    // Saved reports only: no genotype, variant, ancestry or raw-data tool.
    expect(Object.keys(mocks.stream.mock.calls[0]![0].tools).sort()).toEqual(["get_report", "list_reports"]);
    // The model is reached only through the pinned transport, after the whole turn is rechecked.
    expect(mocks.providerFetch).toHaveBeenCalledOnce();
    expect(mocks.check.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("an uploader's answer cites the shared reports, with no Family page for the record", async () => {
    const uploader = { ...authority, case: "uploader" };
    mocks.target.mockResolvedValue({ ...target, case: "uploader", handleSegment: `s-${B}` });
    mocks.scope.mockResolvedValue({ state: "ready", authority: uploader });
    mocks.token.mockReturnValue({ ...mocks.token(), authorityHash: JSON.stringify(uploader) });
    const body = await (await subjectChatResponse(request(first), first, options)).json();
    expect(body.message.citations.map((citation: { href: string }) => citation.href))
      .toEqual([`/genome/s-${B}/reports/fixture-estimate`, "https://pubmed.ncbi.nlm.nih.gov/12345678/"]);
  });

  it("gate 1, jurisdiction: a refused asker is answered before the transport, the provider or the record is read", async () => {
    mocks.jurisdiction.mockResolvedValue(false);
    const response = await subjectChatResponse(request(first), first, options);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "copilot_unavailable" });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.target).not.toHaveBeenCalled();
    expect(mocks.scope).not.toHaveBeenCalled();
    nothingRead();
  });

  it("gate 2, transport: off an attested same-host model it is the registered unavailable answer, whatever the provider or consent", async () => {
    mocks.localAllowed.mockReturnValue(false);
    // Even a cloud provider with its own current consent changes nothing.
    mocks.prepare.mockResolvedValue({ authority: { ...provider, providerClass: "cloud", providerGrantId: "a1000000-0000-4000-8000-000000000001" },
      settings: { provider: "anthropic", base_url: null, model: "cloud" }, apiKey: "synthetic", createFetch: () => mocks.providerFetch });
    for (const body of [first, next]) {
      const response = await subjectChatResponse(request(body), body, options);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "local_transport_unavailable", state: "not-covered",
        reason: "local-transport-unavailable", messageCopyId: "copilot.transport.local-unavailable" });
    }
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.target).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.providerFetch).not.toHaveBeenCalled();
    nothingRead();
  });

  it("gate 3, provider: a cloud provider on a local deployment is the same unavailable answer, before the record is read", async () => {
    mocks.prepare.mockResolvedValue({ authority: { ...provider, providerClass: "cloud" },
      settings: { provider: "anthropic", base_url: null, model: "cloud" }, apiKey: "synthetic", createFetch: () => mocks.providerFetch });
    const response = await subjectChatResponse(request(first), first, options);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("local_transport_unavailable");
    expect(mocks.target).not.toHaveBeenCalled();
    expect(mocks.scope).not.toHaveBeenCalled();
    expect(mocks.providerFetch).not.toHaveBeenCalled();
    nothingRead();
  });

  it("gate 4, the mitigation decision: a held record is refused, and an open conversation about it is not found", async () => {
    mocks.scope.mockResolvedValue({ state: "held" });
    expect((await subjectChatResponse(request(first), first, options)).status).toBe(403);
    expect((await subjectChatResponse(request(next), next, options)).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
    nothingRead();
  });

  it("gate 5, copilot.local and the layers: with either missing nothing is read, and a stale page cannot open the scope", async () => {
    mocks.scope.mockResolvedValue({ state: "permission-missing" });
    expect((await subjectChatResponse(request(first), first, options)).status).toBe(403);
    expect((await subjectChatResponse(request(next), next, options)).status).toBe(404);
    nothingRead();
    // The page's authority is not the current one (a layer or the grant changed since).
    mocks.scope.mockResolvedValue({ state: "ready", authority: { ...authority, layers: [{ ...authority.layers[0], grantRevision: 2 }] } });
    expect((await subjectChatResponse(request(first), first, options)).status).toBe(403);
    // A record of another relationship than the address named.
    mocks.scope.mockResolvedValue({ state: "ready", authority: { ...authority, case: "uploader" } });
    expect((await subjectChatResponse(request(first), first, options)).status).toBe(403);
    nothingRead();
  });

  it("gate 6, Tier 2: without the acknowledgement nothing is read", async () => {
    mocks.acknowledged.mockResolvedValue(false);
    expect((await subjectChatResponse(request(first), first, options)).status).toBe(403);
    nothingRead();
  });

  it("gate 7, intent: a refused question reaches no reader and no model, and writes nothing", async () => {
    const response = await subjectChatResponse(request({ ...first, message: "Does Bea have diabetes?" }),
      { ...first, message: "Does Bea have diabetes?" }, options);
    expect(response.headers.get("x-copilot-refusal")).toBe("diagnosis");
    nothingRead();
  });

  it("refuses a body that names a scope or a subject, a foreign or unreadable token, and another account's conversation", async () => {
    // A provider override (a cloud provider, or a claim of a local one) is refused like any unknown field.
    for (const body of [{ ...first, subjectId: OTHER }, { ...first, scope: `s-${OTHER}` }, { ...next, scopeKind: "subject" },
      { contextToken: first.contextToken, chatId, message: "both" }, { ...first, provider: "anthropic" },
      { ...next, providerClass: "local" }, { ...first, model: "cloud-model", baseUrl: "https://model.synthetic.invalid/v1" }]) {
      expect((await subjectChatResponse(request(body), body, options)).status).toBe(400);
    }
    mocks.token.mockReturnValueOnce(null);
    expect((await subjectChatResponse(request(first), first, options)).status).toBe(404);
    mocks.token.mockReturnValueOnce({ ...mocks.token(), accountId: "81000000-0000-4000-8000-0000000000ff" });
    expect((await subjectChatResponse(request(first), first, options)).status).toBe(404);
    mocks.token.mockReturnValueOnce({ ...mocks.token(), sessionId: "81000000-0000-4000-8000-0000000000ff" });
    expect((await subjectChatResponse(request(first), first, options)).status).toBe(404);
    mocks.chatSubject.mockResolvedValueOnce(null);
    expect((await subjectChatResponse(request(next), next, options)).status).toBe(404);
    expect((await subjectChatResponse(request(first, "https://foreign.example"), first, options)).status).toBe(403);
    expect(mocks.target).not.toHaveBeenCalled();
    nothingRead();
  });

  it("reads only the record its token names: no address resolves to another person's record", async () => {
    mocks.target.mockResolvedValueOnce(null);
    expect((await subjectChatResponse(request(first), first, options)).status).toBe(404);
    expect(mocks.target).toHaveBeenCalledWith(accountId, B);
    nothingRead();
  });

  it("a spent context token commits nothing: the database refuses the second presentation", async () => {
    mocks.rpc.mockImplementation(async (op: string) => { if (op === "commit") throw new Error("copilot_unavailable"); return true; });
    const response = await subjectChatResponse(request(first), first, options);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "copilot_unavailable" });
  });

  it("a later turn reads the conversation's own record from the chat row, and its history", async () => {
    mocks.chatSubject.mockResolvedValue(B);
    expect((await subjectChatResponse(request(next), next, options)).status).toBe(200);
    expect(mocks.chatSubject).toHaveBeenCalledWith({ accountId, sessionId }, chatId);
    expect(mocks.rpc.mock.calls.find(call => call[0] === "history")).toEqual(["history", { accountId, sessionId }, B, chatId, { provider }]);
    const [, , , commitChat, payload] = commits()[0]!;
    expect(commitChat).toBe(chatId);
    expect(payload).toMatchObject({ lastOrdinal: 1, nonceHash: null, expiresAt: null });
  });

  it("a permission withdrawn inside the turn fails it closed: no answer, no commit", async () => {
    let calls = 0;
    mocks.check.mockImplementation(async () => { if (++calls > 2) throw new Error("copilot_unavailable"); });
    const response = await subjectChatResponse(request(first), first, options);
    expect(response.status).toBe(403);
    expect(commits()).toHaveLength(0);
  });

  it("is recognised only by its own token domain or by one of this account's subject conversations", async () => {
    expect(await isSubjectChatRequest(first)).toBe(true);
    mocks.token.mockReturnValueOnce(null);
    expect(await isSubjectChatRequest(first)).toBe(false);
    expect(await isSubjectChatRequest(next)).toBe(true);
    mocks.chatSubject.mockResolvedValueOnce(null);
    expect(await isSubjectChatRequest(next)).toBe(false);
    expect(await isSubjectChatRequest({ ...first, subjectId: B })).toBe(false);
  });
});
