import { describe, expect, it, vi } from "vitest";
import type { createAdminClient } from "../supabase/admin";
import { drainOwnNormalizationCleanup } from "./normalization-cleanup";
describe("interrupted preparation cleanup", () => {
  it("drains only database-selected expired runs through one finite call", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null });
    expect(await drainOwnNormalizationCleanup({ rpc } as unknown as ReturnType<typeof createAdminClient>))
      .toEqual({ processed: 2, failed: 0 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("reap_expired_own_normalizations_v1");
  });
  it.each([null, -1, 6, 0.5, "2", {}, []])("refuses an invalid cleanup acknowledgement %j", async data => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    expect(await drainOwnNormalizationCleanup({ rpc } as unknown as ReturnType<typeof createAdminClient>))
      .toEqual({ processed: 0, failed: 1 });
  });
  it("reports provider failure without retrying or exposing database details", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("private provider response"));
    expect(await drainOwnNormalizationCleanup({ rpc } as unknown as ReturnType<typeof createAdminClient>))
      .toEqual({ processed: 0, failed: 1 }); expect(rpc).toHaveBeenCalledTimes(1);
  });
});
