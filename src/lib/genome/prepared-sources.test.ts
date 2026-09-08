import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPreparedSourceFiles, getPreparedSourceGenotypes } from "./prepared-sources";
import type { Db } from "./load";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), files: vi.fn() }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("./own-analysis-access", () => ({ loadOwnAnalysisCandidateFiles: mocks.files }));
const id = "77a00000-0000-4000-8000-000000000001";
const second = "77a00000-0000-4000-8000-000000000002";
const modern = { id, status: "stored", single_logical_sample_verified_at: "2026-09-06T12:00:00Z" };
const legacy = { id: "old", status: "annotated", single_logical_sample_verified_at: null };
function database(allowed: unknown = [id]) {
  const rpc = vi.fn().mockResolvedValue({ data: allowed, error: null });
  const rows = vi.fn().mockResolvedValue({ data: [{ file_id: id, rsid: 123, genotype: "A/G" }], error: null });
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: rows };
  const from = vi.fn(() => query);
  return { db: { rpc, from } as unknown as Db, rpc, from, query, rows };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ accountId: "account", sessionId: "session" });
  mocks.files.mockResolvedValue([modern, legacy]);
});

describe("prepared canonical source browser boundary", () => {
  it("requires only live store/source proof, never an analytic choice or generation", async () => {
    const { db, rpc, from } = database();
    expect(await getPreparedSourceFiles(db, "subject")).toEqual([modern, legacy]);
    expect(rpc).toHaveBeenCalledWith("filter_own_prepared_sources_v1", {
      p_account_id: "account", p_session_id: "session", p_subject_id: "subject", p_file_ids: [id],
    });
    expect(from).not.toHaveBeenCalled();
  });
  it.each([[], null, [second], [id, id], ["invalid"]])("excludes new sources on denied/malformed store authority %j", async allowed => {
    expect(await getPreparedSourceFiles(database(allowed).db, "subject")).toEqual([legacy]);
  });
  it("does not mistake missing structural metadata for a legacy file", async () => {
    mocks.files.mockResolvedValue([{ id: "missing", status: "annotated" }, { ...legacy, status: "stored" }]);
    expect(await getPreparedSourceFiles(database().db, "subject")).toEqual([]);
  });
  it("reads raw letters only for the exact subject and source allowlist", async () => {
    const { db, from, query } = database();
    const result = await getPreparedSourceGenotypes(db, "subject", [123]);
    expect(result.genotypes.get(123)).toBe("A/G");
    expect(result.inputFileIds).toEqual([id]);
    expect(from).toHaveBeenCalledWith("user_variants");
    expect(query.eq).toHaveBeenCalledWith("subject_id", "subject");
    expect(query.in).toHaveBeenCalledWith("file_id", [id, "old"]);
    expect(query.in).toHaveBeenCalledWith("rsid", [123]);
    expect(query.range).toHaveBeenCalledWith(0, 999);
  });
  it("drops new calls if store authority ends during the source read", async () => {
    const { db, rpc } = database();
    rpc.mockResolvedValueOnce({ data: [id], error: null }).mockResolvedValue({ data: [], error: null });
    const result = await getPreparedSourceGenotypes(db, "subject", [123]);
    expect(result.genotypes.size).toBe(0);
    expect(result.checkedFileIds).toEqual(["old"]);
  });
  it("does not hide conflicting calls after the first source page", async () => {
    const { db, rows } = database();
    rows.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, () => ({ file_id: id, rsid: 123, genotype: "A/G" })) })
      .mockResolvedValueOnce({ data: [{ file_id: "old", rsid: 123, genotype: "A/A" }] });
    const result = await getPreparedSourceGenotypes(db, "subject", [123]);
    expect(result.genotypes.size).toBe(0);
    expect([...result.conflicts]).toEqual([123]);
    expect(rows).toHaveBeenLastCalledWith(1000, 1999);
  });
});
