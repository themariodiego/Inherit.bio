import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), subject: vi.fn(), prepare: vi.fn(), check: vi.fn(), rpc: vi.fn(),
  token: vi.fn(), stream: vi.fn(), from: vi.fn(), prepared: vi.fn() }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("@/lib/subjects", () => ({ resolveSubjectForAccount: mocks.subject }));
vi.mock("./own-provider-authority", () => ({ prepareOwnCopilotProvider: mocks.prepare }));
vi.mock("./own-chat", async () => { const { z } = await import("zod"); return {
  checkOwnChat: mocks.check, ownChatRpc: mocks.rpc, ownChatSubject: mocks.subject, ownChatHistorySchema: z.any(),
}; });
vi.mock("./own-chat-token", () => ({ readOwnChatToken: mocks.token, snapshotHash: (value: unknown) => JSON.stringify(value) }));
vi.mock("@/lib/account-deletion", () => ({ isSameOrigin: () => true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: () => () => ({}) }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: () => () => ({}) }));
vi.mock("./own-prepared-calls", async original => ({ ...await original<typeof import("./own-prepared-calls")>(), readOwnPreparedCopilotCalls: mocks.prepared }));
vi.mock("ai", () => ({ tool: (value: unknown) => value, stepCountIs: () => 8, streamText: mocks.stream,
  toUIMessageStream: ({ stream }: { stream: ReadableStream }) => stream }));
import { ownChatResponse } from "./own-chat-route";
import { PreparedCopilotReadError } from "./own-prepared-calls";
const accountId = "80000000-0000-4000-8000-000000000001", sessionId = "80000000-0000-4000-8000-000000000002";
const subjectId = "80000000-0000-4000-8000-000000000003", fileId = "80000000-0000-4000-8000-000000000005";
const authority = { accountId, sessionId, subjectId, providerClass: "local" };
const preparedSource = { version: "own-prepared-report-source-v1", backend: "prepared-object-v1",
  manifestId: "80000000-0000-4000-8000-000000000006", membershipSha256: "c".repeat(64),
  rootArtifactId: "80000000-0000-4000-8000-000000000007", rootSha256: "d".repeat(64) };
const projection = { sources: [{ id: fileId, revision: 1, sha256: "a".repeat(64), decodedSha256: "b".repeat(64),
  objectId: "80000000-0000-4000-8000-000000000008", normalizedAt: "2026-09-15T10:00:00Z", build: "GRCh38", completed: [], preparedSource }],
legacySources: [], unavailableSources: [] };
type Flow = { tools: Record<string, { execute: (value: unknown) => Promise<unknown> }> };
let result: unknown;
beforeEach(() => {
  vi.clearAllMocks(); result = undefined;
  mocks.actor.mockResolvedValue({ accountId, sessionId }); mocks.subject.mockResolvedValue({ id: subjectId, subjectClass: "self", displayLabel: "You" });
  mocks.prepare.mockResolvedValue({ authority, settings: { provider: "openai_compatible", base_url: "http://localhost:8123/v1", model: "synthetic" }, createFetch: () => vi.fn() });
  mocks.token.mockReturnValue({ authority, projectionHash: JSON.stringify(projection), nonce: "nonce", expiresAt: Date.now() + 500000 });
  mocks.check.mockResolvedValue(undefined);
  mocks.rpc.mockImplementation(async operation => operation === "prepare" ? projection : operation === "begin" ? true : operation === "commit"
    ? { chatId: "80000000-0000-4000-8000-000000000004" } : []);
  mocks.from.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) });
  mocks.prepared.mockImplementation(async (_actor, _selection, _rsids, options) => {
    options.consumeEvidence(1, 300);
    return [{ file_id: fileId, rsid: 762551, chrom: 15, pos: 74749576, ref: "C", alt: "A", genotype: "A/C", usable: true }];
  });
  mocks.stream.mockImplementation((flow: Flow) => ({ stream: new ReadableStream({ async start(controller) {
    try {
      expect(Object.keys(flow.tools).sort()).toEqual(["get_genotype", "get_prs", "get_report", "list_reports", "search_variants"]);
      result = await flow.tools.get_genotype.execute({ rsid: "rs762551" });
      controller.enqueue({ type: "text-delta", id: "answer", delta: "Your file includes this position." }); controller.close();
    } catch { controller.error(new Error("synthetic tool refusal")); }
  } }) }));
});
async function response() {
  const body = { contextToken: "valid-context-token", message: "What does my file say at rs762551?" };
  return ownChatResponse(new Request("https://inherit.test/api/chat", { method: "POST", body: JSON.stringify(body) }), body,
    { systemPrompt: "Answer from tools.", refusal: (_id, text) => new Response(text) });
}
describe("prepared source through the existing own-chat route", () => {
  it("reads the exact prepared genotype instead of dropping the source or reporting false absence", async () => {
    expect((await response()).status).toBe(200);
    expect(result).toMatchObject({ rsid: "rs762551", covered: true, status: "called", genotype: "A/C" });
    expect(result).not.toMatchObject({ status: "not-covered" });
    expect(mocks.prepared).toHaveBeenCalledWith({ accountId, sessionId }, expect.objectContaining({ fileId, subjectId, preparedSource }), [762551], expect.any(Object));
    expect(mocks.rpc.mock.calls.some(call => call[0] === "calls")).toBe(false);
  });
  it("returns explicit source unavailability for unnormalized evidence after a final projection check", async () => {
    mocks.prepared.mockRejectedValue(new PreparedCopilotReadError("source_unavailable"));
    expect((await response()).status).toBe(200);
    expect(result).toMatchObject({ error: "source_unavailable" }); expect(result).not.toHaveProperty("covered");
    expect(mocks.check.mock.invocationCallOrder.at(-1)).toBeGreaterThan(mocks.prepared.mock.invocationCallOrder[0]);
  });
  it("does not emit source-unavailable or persist a pair after that final projection is revoked", async () => {
    mocks.prepared.mockImplementation(async () => { mocks.check.mockRejectedValue(new Error("synthetic revoked")); throw new PreparedCopilotReadError("source_unavailable"); });
    expect((await response()).status).toBe(403); expect(result).toBeUndefined();
    expect(mocks.rpc.mock.calls.some(call => call[0] === "commit")).toBe(false);
  });
  it("discards prepared results on late whole-projection failure", async () => {
    const original = mocks.prepared.getMockImplementation()!;
    mocks.prepared.mockImplementation(async (...args) => { const rows = await original(...args); mocks.check.mockRejectedValue(new Error("synthetic changed")); return rows; });
    expect((await response()).status).toBe(403); expect(result).toBeUndefined();
    expect(mocks.rpc.mock.calls.some(call => call[0] === "commit")).toBe(false);
  });
});
