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

/**
 * D-097. Until 2026-09-12 a legacy file passed this function untouched
 * whatever `purpose` said, so revoking `ancestry` withheld nothing derived
 * from a legacy source. `gateLegacy` is the opt-in that fixes it for the
 * ancestry readers; these tests fail if it stops asking, stops failing closed,
 * or starts asking on the paths that did not opt in.
 */
describe("the legacy purpose gate (D-097)", () => {
  const grantRpc = (granted: boolean | null, error: unknown = null) => {
    const rpc = vi.fn().mockImplementation((name: string) =>
      name === "own_subject_purpose_granted_v1"
        ? Promise.resolve({ data: granted, error })
        : Promise.resolve({ data: [id], error: null }));
    return { db: { rpc, from: vi.fn() } as unknown as Db, rpc };
  };

  it("keeps legacy files when the subject-level ancestry grant is live", async () => {
    const { db, rpc } = grantRpc(true);
    expect(await filterOwnAnalysisFiles(db, "subject", "ancestry", [legacy], { gateLegacy: true }))
      .toEqual([legacy]);
    expect(rpc).toHaveBeenCalledWith("own_subject_purpose_granted_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId,
      p_subject_id: "subject", p_purpose: "ancestry",
    });
  });

  it("drops legacy files once that grant is gone", async () => {
    const { db } = grantRpc(false);
    expect(await filterOwnAnalysisFiles(db, "subject", "ancestry", [legacy], { gateLegacy: true }))
      .toEqual([]);
  });

  it.each([
    ["an error", null, { code: "42501" }],
    ["a non-boolean answer", "yes" as unknown as boolean, null],
    ["a null answer", null, null],
  ])("fails closed on %s", async (_label, data, error) => {
    const { db } = grantRpc(data as boolean | null, error);
    expect(await filterOwnAnalysisFiles(db, "subject", "ancestry", [legacy], { gateLegacy: true }))
      .toEqual([]);
  });

  it("fails closed when the RPC throws rather than returning", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("transport"));
    const db = { rpc, from: vi.fn() } as unknown as Db;
    expect(await filterOwnAnalysisFiles(db, "subject", "ancestry", [legacy], { gateLegacy: true }))
      .toEqual([]);
  });

  it("fails closed with no current account, without asking the database", async () => {
    mocks.actor.mockResolvedValue(null);
    const { db, rpc } = grantRpc(true);
    expect(await filterOwnAnalysisFiles(db, "subject", "ancestry", [legacy], { gateLegacy: true }))
      .toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks nothing and keeps legacy files when the caller did not opt in", async () => {
    // Not a softer setting: the Family surfaces read a relative's record,
    // where the reader holds no own-subject grant and the authority is the
    // counterpart's Family permission, checked before this call.
    const { db, rpc } = grantRpc(false);
    expect(await filterOwnAnalysisFiles(db, "subject", "ancestry", [legacy])).toEqual([legacy]);
    expect(rpc).not.toHaveBeenCalled();
  });

  // D-099, closed 2026-09-13. The report purposes are gated the same way and
  // ask for themselves: a live `reports.polygenic` grant must not release a
  // result the reader chose under `reports.monogenic`, or the two selections
  // would be one.
  it.each(["reports.monogenic", "reports.polygenic"] as const)(
    "gates the legacy half on a live %s grant and names that purpose", async (purpose) => {
      const { db, rpc } = grantRpc(true);
      expect(await filterOwnAnalysisFiles(db, "subject", purpose, [legacy], { gateLegacy: true }))
        .toEqual([legacy]);
      expect(rpc).toHaveBeenCalledWith("own_subject_purpose_granted_v1", {
        p_account_id: actor.accountId, p_session_id: actor.sessionId,
        p_subject_id: "subject", p_purpose: purpose,
      });
    });

  it.each(["reports.monogenic", "reports.polygenic"] as const)(
    "drops the legacy half once %s is revoked", async (purpose) => {
      const { db } = grantRpc(false);
      expect(await filterOwnAnalysisFiles(db, "subject", purpose, [legacy], { gateLegacy: true }))
        .toEqual([]);
    });

  it("does not ask when there is no legacy file to gate", async () => {
    const { db, rpc } = grantRpc(true);
    await filterOwnAnalysisFiles(db, "subject", "ancestry", [modern], { gateLegacy: true });
    expect(rpc.mock.calls.map(call => call[0])).not.toContain("own_subject_purpose_granted_v1");
  });
});
