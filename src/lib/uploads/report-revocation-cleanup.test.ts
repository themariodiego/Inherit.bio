import { describe, expect, it, vi } from "vitest";
import type { createAdminClient } from "../supabase/admin";
import { drainOwnReportRevocations } from "./report-revocation-cleanup";
const admin = (rpc: ReturnType<typeof vi.fn>) => ({ rpc } as unknown as ReturnType<typeof createAdminClient>);
describe("own report revocation worker", () => {
  it("counts only real completion after historical job supersession", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { outcome: "superseded", deletedRows: 0 }, error: null })
      .mockResolvedValueOnce({ data: { outcome: "complete", deletedRows: 2 }, error: null })
      .mockResolvedValue({ data: null, error: null });
    expect(await drainOwnReportRevocations(admin(rpc))).toEqual({ processed: 1, failed: 0 });
    expect(rpc.mock.calls).toEqual(Array(3).fill(["run_own_report_purge_v1"]));
  });
  it("reports blocked and retryable work alongside a later successful purge", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { outcome: "blocked", deletedRows: 0 }, error: null })
      .mockResolvedValueOnce({ data: { outcome: "retry", deletedRows: 0 }, error: null })
      .mockResolvedValueOnce({ data: { outcome: "complete", deletedRows: 1 }, error: null })
      .mockResolvedValue({ data: null, error: null });
    expect(await drainOwnReportRevocations(admin(rpc))).toEqual({ processed: 1, failed: 2 });
    expect(rpc).toHaveBeenCalledTimes(4);
  });
  it("bounds one drain to five database-selected steps", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: "complete", deletedRows: 0 }, error: null });
    expect(await drainOwnReportRevocations(admin(rpc))).toEqual({ processed: 5, failed: 0 });
    expect(rpc).toHaveBeenCalledTimes(5);
  });
  it.each([{}, [], { outcome: "done", deletedRows: 0 }, { outcome: "complete", deletedRows: -1 },
    { outcome: "superseded", deletedRows: 1 }, { outcome: "complete", deletedRows: 0, private: true }])
    ("stops on an invalid or misleading acknowledgement %j", async data => {
      const rpc = vi.fn().mockResolvedValue({ data, error: null });
      expect(await drainOwnReportRevocations(admin(rpc))).toEqual({ processed: 0, failed: 1 });
      expect(rpc).toHaveBeenCalledTimes(1);
    });
  it("does not retry a provider failure or return its private detail", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("private provider detail"));
    expect(await drainOwnReportRevocations(admin(rpc))).toEqual({ processed: 0, failed: 1 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
