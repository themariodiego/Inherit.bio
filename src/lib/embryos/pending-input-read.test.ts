import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { EmbryoReadError } from "./cohorts";
import { readPendingEmbryoInput } from "./pending-input-read";
import { untouchedPending } from "./pending-input-fixture.test-support";

const row = untouchedPending(), scope = { accountId: row.accountId, cohortId: row.cohortId, embryoId: row.embryoId, subjectId: row.subjectId };
function client(rpc: ReturnType<typeof vi.fn>) { return { rpc } as unknown as SupabaseClient<Database>; }
describe("atomic pending input reader", () => {
  it("uses one exact native service read, bound to all selected identities", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: row, error: null });
    expect(await readPendingEmbryoInput(client(rpc), scope)).toEqual(row);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_pending_embryo_input_v1", {
      p_account: row.accountId, p_cohort: row.cohortId, p_embryo: row.embryoId,
    });
  });
  for (const result of [{ data: row, error: { message: "private native error" } },
    { data: null, error: null }, { data: {}, error: null },
    { data: { ...row, subjectId: "ffffffff-ffff-4fff-8fff-ffffffffffff" }, error: null }]) {
    it("refuses incomplete/foreign results as error, never empty or processing evidence", async () => {
      const rpc = vi.fn().mockResolvedValue(result);
      await expect(readPendingEmbryoInput(client(rpc), scope)).rejects.toBeInstanceOf(EmbryoReadError);
    });
  }
  it("does not expose a thrown native message", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("private native error"));
    await expect(readPendingEmbryoInput(client(rpc), scope)).rejects.toThrow("pending input unavailable");
  });
  it("refuses malformed scope before a native read", async () => {
    const rpc = vi.fn(); await expect(readPendingEmbryoInput(client(rpc), { ...scope, embryoId: "unknown" })).rejects.toBeInstanceOf(EmbryoReadError);
    expect(rpc).not.toHaveBeenCalled();
  });
});
