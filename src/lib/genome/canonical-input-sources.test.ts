import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "./load";
const mocks = vi.hoisted(() => ({ actor: vi.fn() }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
import { loadCanonicalInputSources } from "./canonical-input-sources";

const id = "76900000-0000-4000-8000-000000000040";
const foreign = "76900000-0000-4000-8000-000000000041";
const source = { fileId: id, fileType: "vcf", processedAt: "2026-09-06T15:00:00+00:00", snapshot: {
  sourceBuild: "GRCh37", targetBuild: "GRCh38", buildBasis: "source-declared", variantRowsMapped: 1, variantRowsUnmapped: 0,
  counts: { called: 1, noCall: 1, unsupported: 0, failedFilter: 0, blocks: 0, singleSample: true, buildClaim: true },
} };
function database(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { db: { rpc } as unknown as Db, rpc };
}
beforeEach(() => { vi.clearAllMocks(); mocks.actor.mockResolvedValue({ accountId: "owner", sessionId: "session" }); });

describe("canonical input display facts", () => {
  it("reads exact chosen purpose with the current account/session and preserves the 1/2 conversion facts", async () => {
    const { db, rpc } = database([source]);
    expect(await loadCanonicalInputSources(db, "subject", [id], { kind: "report", purpose: "reports.polygenic" })).toEqual([source]);
    expect(rpc).toHaveBeenCalledWith("read_own_input_sources_v1", { p_account_id: "owner", p_session_id: "session",
      p_subject_id: "subject", p_file_ids: [id], p_purpose: "reports.polygenic" });
  });
  it("explicitly requests prepared-source access without an analytic purpose", async () => {
    const { db, rpc } = database([source]);
    expect(await loadCanonicalInputSources(db, "subject", [id], { kind: "prepared" })).toEqual([source]);
    expect(rpc.mock.calls[0][1].p_purpose).toBeNull();
  });
  it.each([null, [source, source], [{ ...source, fileId: foreign }], [{ ...source, sourceSha256: "private" }],
    [{ ...source, snapshot: { ...source.snapshot, chainSha256: "private" } }],
    [{ ...source, snapshot: { ...source.snapshot, counts: { ...source.snapshot.counts, called: -1 } } }],
    [{ ...source, snapshot: { ...source.snapshot, counts: { ...source.snapshot.counts, called: Number.MAX_SAFE_INTEGER } } }],
    [{ ...source, processedAt: "invalid" }],
  ])("refuses malformed, foreign or unsanitized provider output %j", async data => {
    const { db } = database(data);
    expect(await loadCanonicalInputSources(db, "subject", [id], { kind: "prepared" })).toEqual([]);
  });
  it("never reads facts without the current actor or for an empty file list", async () => {
    const { db, rpc } = database([source]);
    expect(await loadCanonicalInputSources(db, "subject", [], { kind: "prepared" })).toEqual([]);
    mocks.actor.mockResolvedValue(null);
    expect(await loadCanonicalInputSources(db, "subject", [id], { kind: "prepared" })).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not publish data returned alongside an error", async () => {
    const { db } = database([source], { code: "denied" });
    expect(await loadCanonicalInputSources(db, "subject", [id], { kind: "prepared" })).toEqual([]);
  });
  it("batches exact IDs and preserves successful siblings after a later RPC failure", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `76900000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const { db, rpc } = database([]);
    rpc.mockResolvedValueOnce({ data: ids.slice(0, 100).map(fileId => ({ ...source, fileId })), error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "unavailable" } });
    const result = await loadCanonicalInputSources(db, "subject", ids, { kind: "prepared" });
    expect(result.map(row => row.fileId)).toEqual(ids.slice(0, 100));
    expect(rpc.mock.calls.map(call => call[1].p_file_ids)).toEqual([ids.slice(0, 100), ids.slice(100)]);
  });
});
