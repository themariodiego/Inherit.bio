import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), remove: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/genome/prepared-source/cleanup-integration", async (load) => ({
  ...await load<typeof import("@/lib/genome/prepared-source/cleanup-integration")>(), prepareFileCleanup: mocks.prepare,
}));

const { drainSubjectFileDeletions, SUBJECT_FILE_DRAIN_LIMIT } = await import("./file-drain");

const OWNER = { accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
const file = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const token = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const admin = { rpc: mocks.rpc, storage: { from: mocks.from } } as never;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.from.mockReturnValue({ remove: mocks.remove });
  mocks.prepare.mockImplementation(async (_admin: unknown, args: { p_file_id: string }) => {
    const n = Number(args.p_file_id.slice(0, 8));
    return { error: null, complete: true, original: { token: token(n), bucket: "genomes", name: `${OWNER.accountId}/file-${n}` } };
  });
  mocks.remove.mockResolvedValue({ data: [{}], error: null });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});

describe("drainSubjectFileDeletions", () => {
  it("finishes each prepared file as the file route does: prepare, remove the exact object, then finish", async () => {
    const result = await drainSubjectFileDeletions(admin, OWNER, [file(1), file(2)]);
    expect(result).toEqual({ finished: 2, deferred: 0 });
    expect(mocks.prepare.mock.calls.map(c => c[1])).toEqual([1, 2].map(n => ({
      p_account_id: OWNER.accountId, p_session_id: OWNER.sessionId, p_file_id: file(n) })));
    expect(mocks.from).toHaveBeenCalledWith("genomes");
    expect(mocks.remove.mock.calls).toEqual([[[`${OWNER.accountId}/file-1`]], [[`${OWNER.accountId}/file-2`]]]);
    expect(mocks.rpc.mock.calls).toEqual([1, 2].map(n => ["finish_genome_file_deletion_v1", {
      p_account_id: OWNER.accountId, p_session_id: OWNER.sessionId, p_file_id: file(n), p_token: token(n) }]));
  });

  it("accepts Storage's empty list as the idempotent answer for an object already removed", async () => {
    mocks.remove.mockResolvedValue({ data: [], error: null });
    expect(await drainSubjectFileDeletions(admin, OWNER, [file(1)])).toEqual({ finished: 1, deferred: 0 });
  });

  it("leaves a file it cannot finish for the backstop and carries on with the next", async () => {
    mocks.prepare.mockImplementationOnce(async () => ({ error: { code: "55000" }, complete: false, original: null }));
    mocks.prepare.mockImplementationOnce(async () => ({ error: null, complete: false, original: null }));
    mocks.prepare.mockImplementationOnce(async () => ({ error: null, complete: true, original: { token: "x", bucket: "genomes", name: "n" } }));
    mocks.prepare.mockImplementationOnce(async () => { throw new Error("prepared_cleanup_unavailable"); });
    const result = await drainSubjectFileDeletions(admin, OWNER, [file(1), file(2), file(3), file(4), file(5)]);
    expect(result).toEqual({ finished: 1, deferred: 4 });
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("never finishes a file whose object Storage did not remove", async () => {
    mocks.remove.mockResolvedValueOnce({ data: null, error: { message: "unavailable" } });
    mocks.remove.mockResolvedValueOnce({ data: null, error: null });
    expect(await drainSubjectFileDeletions(admin, OWNER, [file(1), file(2)])).toEqual({ finished: 0, deferred: 2 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not count a finish the database refused", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "file_delete_storage_incomplete" } });
    expect(await drainSubjectFileDeletions(admin, OWNER, [file(1)])).toEqual({ finished: 0, deferred: 1 });
  });

  it("is bounded: past the limit, or once aborted, the rest wait for the backstop", async () => {
    const many = Array.from({ length: SUBJECT_FILE_DRAIN_LIMIT + 4 }, (_, i) => file(i + 1));
    expect(await drainSubjectFileDeletions(admin, OWNER, many)).toEqual({ finished: SUBJECT_FILE_DRAIN_LIMIT, deferred: 4 });
    expect(mocks.prepare).toHaveBeenCalledTimes(SUBJECT_FILE_DRAIN_LIMIT);
    mocks.prepare.mockClear();
    const aborted = new AbortController();
    aborted.abort();
    expect(await drainSubjectFileDeletions(admin, OWNER, [file(1)], aborted.signal)).toEqual({ finished: 0, deferred: 1 });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
