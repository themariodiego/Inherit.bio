import { beforeEach, describe, expect, it, vi } from "vitest";
import { filterOwnAnalysisFiles, loadOwnReportCallPage } from "./own-analysis-access";
import type { Db } from "./load";

const mocks = vi.hoisted(() => ({ actor: vi.fn() }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
const id = "77700000-0000-4000-8000-000000000001";
const foreign = "77700000-0000-4000-8000-000000000002";
const modern = { id, status: "stored", single_logical_sample_verified_at: "2026-09-06T10:00:00Z" };
const legacy = { id: "old", status: "annotated", single_logical_sample_verified_at: null };
const actor = { accountId: "owner", sessionId: "session" };
function database(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const from = vi.fn(() => { throw new Error("No direct genetic table reads"); });
  return { db: { rpc, from } as unknown as Db, rpc, from };
}
beforeEach(() => { vi.clearAllMocks(); mocks.actor.mockResolvedValue(actor); });

describe("new own-result access boundary", () => {
  it("requires explicit legacy NULL; missing metadata is not historical authorization", async () => {
    const { db, rpc } = database([]);
    expect(await filterOwnAnalysisFiles(db, "subject", null, [legacy, modern, { id: "missing" }])).toEqual([legacy]);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("uses exact purpose, subject and session with completed generation required by default", async () => {
    const { db, rpc, from } = database([id]);
    expect(await filterOwnAnalysisFiles(db, "subject", "reports.polygenic", [modern, legacy])).toEqual([modern, legacy]);
    expect(rpc).toHaveBeenCalledWith("filter_own_analysis_files_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: "subject",
      p_purpose: "reports.polygenic", p_file_ids: [id], p_stored_result: true,
    });
    expect(from).not.toHaveBeenCalled();
  });
  it.each([null, [foreign], [id, id], { ids: [id] }, ["invalid"]])("fails closed on malformed/foreign authority %j", async data => {
    const { db } = database(data);
    expect(await filterOwnAnalysisFiles(db, "subject", "reports.monogenic", [legacy, modern])).toEqual([legacy]);
  });
  it("preserves historical files while excluding revoked/new unselected data", async () => {
    const { db, rpc } = database([id]);
    expect(await filterOwnAnalysisFiles(db, "subject", "reports.polygenic", [modern, legacy])).toEqual([modern, legacy]);
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await filterOwnAnalysisFiles(db, "subject", "reports.polygenic", [modern, legacy])).toEqual([legacy]);
    expect(mocks.actor).toHaveBeenCalledTimes(2);
  });
  it("does not read new results without verified current account/session", async () => {
    mocks.actor.mockResolvedValue(null);
    const { db, rpc } = database([id]);
    expect(await filterOwnAnalysisFiles(db, "subject", "ancestry", [modern, legacy])).toEqual([legacy]);
    expect(rpc).not.toHaveBeenCalled();
    expect(await loadOwnReportCallPage(db, id, "reports.polygenic", [123], 0)).toEqual({ data: null, error: "unavailable" });
  });
  it("reads bounded exact report inputs through the locked completed-result RPC only", async () => {
    const call = { file_id: id, rsid: 123, chrom: 1, pos: 100, ref: "A", alt: "G", genotype: "A/G", usable: true };
    const { db, rpc, from } = database([call]);
    expect(await loadOwnReportCallPage(db, id, "reports.polygenic", [123], 1000)).toEqual({ data: [call], error: null });
    expect(rpc).toHaveBeenCalledWith("read_own_report_calls_v1", {
      p_account_id: "owner", p_session_id: "session", p_file_id: id, p_purpose: "reports.polygenic", p_rsids: [123], p_offset: 1000,
    });
    expect(from).not.toHaveBeenCalled();
    for (const changed of [{ file_id: foreign }, { rsid: 124 }, { private_field: "not allowed" }, { genotype: "x".repeat(65) }]) {
      rpc.mockResolvedValue({ data: [{ ...call, ...changed }], error: null });
      expect(await loadOwnReportCallPage(db, id, "reports.polygenic", [123], 0)).toEqual({ data: null, error: "unavailable" });
    }
  });
});
