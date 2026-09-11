import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../genome/load";
import { computeOwnAncestryContent, CURRENT_OWN_ANCESTRY_PANEL } from "../uploads/own-ancestry-content";
import { LINEAGE_NO_POSITIONS } from "@/copy/ancestry";
import { loadAncestryResults, loadOwnAncestryRows, UNCOMPUTED_LINEAGE } from "./own-results";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn(), candidates: vi.fn(), filter: vi.fn() }));
vi.mock("../uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("../genome/own-analysis-access", () => ({
  loadOwnAnalysisCandidateFiles: mocks.candidates, filterOwnAnalysisFiles: mocks.filter,
}));
const fileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", siblingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const subjectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const file = { id: fileId, single_logical_sample_verified_at: "2026-09-07T00:00:00Z" };
const sibling = { ...file, id: siblingId };
const db = { rpc: mocks.rpc } as unknown as Db;
const content = (id = fileId) => computeOwnAncestryContent({ source: {
  fileId: id, subjectId, callEncoding: "vcf-literal", normalizedBuild: "GRCh38",
  sourceRevision: 1, sourceSha256: "a".repeat(64), normalizedAt: "2026-09-07T00:00:00Z",
}, calls: [], panel: CURRENT_OWN_ANCESTRY_PANEL });
const receipt = (id = fileId) => ({ content: content(id), completedAt: "2026-09-07T01:00:00Z" });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor.mockResolvedValue({ accountId: "account", sessionId: "session" });
  mocks.rpc.mockResolvedValue({ data: receipt(), error: null });
  mocks.candidates.mockResolvedValue([file]);
  mocks.filter.mockImplementation(async (_db, _subject, _purpose, files) => files);
});

describe("checked own ancestry result projection", () => {
  it("uses the actual account/session and strips private source facts from display rows", async () => {
    const rows = await loadOwnAncestryRows(db, subjectId, [file]);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenLastCalledWith("own_ancestry_content_v1", {
      p_account_id: "account", p_session_id: "session", p_file_id: fileId,
    });
    expect(rows.map(row => row.kind)).toEqual(["admixture", "mtdna", "ydna"]);
    expect(rows[0].created_at).toBe("2026-09-07T01:00:00Z");
    expect(rows[0].result).toEqual(content().admixture.result);
    // No lineage rows were read for this file, so both lines say which of the
    // three reasons applies and neither pretends to a call. The tree is still
    // named: it is what was consulted either way.
    expect(rows.slice(1).map(row => [row.kind, row.result, row.support_note, row.model_id])).toEqual([
      ["mtdna", { haplogroup: null }, LINEAGE_NO_POSITIONS.mother, "inherit-mtdna-curated-subset"],
      ["ydna", { haplogroup: null }, LINEAGE_NO_POSITIONS.father, "inherit-ydna-curated-subset"],
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/sourceSha256|sourceRevision|callEncoding|observedPositions|no_supplied_positions/);
  });

  it("still reads a revision-1 capture, and does not dress it up as a lineage", async () => {
    // This reader also serves content captured before lineages were computed.
    // Such a row is a real result whose admixture half is unchanged; its
    // lineages were never computed and must keep saying exactly that.
    const v1 = { ...content(), schemaVersion: 1, computationRevision: "own-ancestry-content-v1",
      lineages: [{ kind: "mtdna", state: "unavailable", reason: "no_supplied_positions", observedPositions: 0 },
        { kind: "ydna", state: "unavailable", reason: "no_supplied_positions", observedPositions: 0 }] };
    mocks.rpc.mockResolvedValue({ data: { content: v1, completedAt: "2026-09-07T01:00:00Z" }, error: null });
    const rows = await loadOwnAncestryRows(db, subjectId, [file]);
    expect(rows.map(row => row.kind)).toEqual(["admixture", "mtdna", "ydna"]);
    expect(rows[0].result).toEqual(content().admixture.result);
    expect(rows.slice(1).every(row => row.result === null && row.support_note === UNCOMPUTED_LINEAGE
      && row.model_id === null && row.model_version === null)).toBe(true);
  });

  it("never queries legacy files through the canonical reader", async () => {
    expect(await loadOwnAncestryRows(db, subjectId, [{ id: fileId, single_logical_sample_verified_at: null }])).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not read without a current account", async () => {
    mocks.actor.mockResolvedValue(null);
    expect(await loadOwnAncestryRows(db, subjectId, [file])).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["file", "subject", "schema", "timestamp", "rpc"])("withholds a %s mismatch without legacy fallback", async fault => {
    const value = receipt();
    if (fault === "file") value.content.source.fileId = siblingId;
    if (fault === "subject") value.content.source.subjectId = siblingId;
    if (fault === "schema") value.content.panel.markerCount = 99;
    if (fault === "timestamp") value.completedAt = "unknown";
    mocks.rpc.mockResolvedValue({ data: value, error: fault === "rpc" ? { code: "42501" } : null });
    expect(await loadOwnAncestryRows(db, subjectId, [file])).toEqual([]);
  });

  it("retains a valid sibling after one reader refuses", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("not_found")).mockResolvedValue({ data: receipt(siblingId), error: null });
    const rows = await loadOwnAncestryRows(db, subjectId, [file, sibling]);
    expect(rows).toHaveLength(3);
    expect(rows.every(row => row.file_id === siblingId)).toBe(true);
  });

  it("removes a source withdrawn after the result read", async () => {
    mocks.filter.mockResolvedValueOnce([file]).mockResolvedValueOnce([]);
    expect(await loadAncestryResults(db, db, subjectId)).toEqual([]);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("withholds an earlier completion even when regrant leaves the file ID allowed", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: receipt(), error: null })
      .mockResolvedValueOnce({ data: { ...receipt(), completedAt: "2026-09-07T02:00:00Z" }, error: null });
    expect(await loadAncestryResults(db, db, subjectId)).toEqual([]);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("queries only allowed legacy file IDs and sorts by result completion", async () => {
    const legacy = { id: siblingId, single_logical_sample_verified_at: null };
    mocks.candidates.mockResolvedValue([file, legacy]);
    const table = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn() };
    table.select.mockReturnValue(table); table.eq.mockReturnValue(table); table.in.mockReturnValue(table);
    table.order.mockResolvedValue({ data: [
      { kind: "admixture", file_id: siblingId, created_at: "2026-09-07T00:30:00Z", result: {} },
      { kind: "admixture", file_id: fileId, created_at: "2026-09-08T00:00:00Z", result: { unexpected: true } },
    ], error: null });
    const reader = { from: vi.fn().mockReturnValue(table) } as unknown as Db;
    const rows = await loadAncestryResults(db, reader, subjectId);
    expect(table.in).toHaveBeenCalledExactlyOnceWith("file_id", [siblingId]);
    expect(rows).toHaveLength(4);
    expect(rows[0].file_id).toBe(fileId);
    expect(rows.at(-1)?.file_id).toBe(siblingId);
    expect(JSON.stringify(rows)).not.toContain("unexpected");
  });
});
