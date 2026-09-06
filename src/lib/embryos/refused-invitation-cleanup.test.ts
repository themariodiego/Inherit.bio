import { describe, expect, it, vi } from "vitest";
import type { createAdminClient } from "@/lib/supabase/admin";
import { drainRefusedInvitationCleanup } from "./refused-invitation-cleanup";

const object = { objectId: "9a000000-0000-4000-8000-0000000000f1",
  bucketId: "legal-evidence", objectName: "synthetic-private-evidence", ordinal: 1 };
function fixture(objects: unknown = [object], fail?: string) {
  let claimed = false;
  const remove = vi.fn().mockResolvedValue({ error: fail === "storage" ? new Error("private evidence path") : null });
  const from = vi.fn(() => ({ remove }));
  const rpc = vi.fn(async (...args: [name: string, parameters?: Record<string, unknown>]) => {
    const [name] = args;
    if (name === fail) return { error: new Error("private database detail"), data: null };
    if (name === "authorize_refused_invitation_storage_v1") return { data: fail !== "authority_false", error: null };
    if (name === "claim_refused_invitation_draft_purge_v1") {
      if (claimed) return { data: [], error: null };
      claimed = true;
      return { data: [{ manifest_id: "manifest", storage_objects: objects }], error: null };
    }
    return { data: null, error: null };
  });
  return { rpc, remove, from, admin: { rpc, storage: { from } } as unknown as ReturnType<typeof createAdminClient> };
}
describe("refused invitation cleanup worker", () => {
  it("deletes only frozen objects then records storage and database completion", async () => {
    const f = fixture();
    expect(await drainRefusedInvitationCleanup(f.admin)).toEqual({ processed: 1, failed: 0 });
    expect(f.from).toHaveBeenCalledExactlyOnceWith("legal-evidence");
    expect(f.remove).toHaveBeenCalledExactlyOnceWith([object.objectName]);
    const claim = f.rpc.mock.calls[0][1];
    expect(claim).toEqual({ p_claim_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/u) });
    expect(f.rpc).toHaveBeenCalledWith("complete_refused_invitation_storage_v1", {
      ...claim, p_manifest_id: "manifest", p_ordinals: [1],
    });
    expect(f.rpc).toHaveBeenCalledWith("finish_refused_invitation_draft_purge_v1", {
      ...claim, p_manifest_id: "manifest",
    });
    expect(f.rpc.mock.invocationCallOrder[1]).toBeLessThan(f.remove.mock.invocationCallOrder[0]);
    expect(f.remove.mock.invocationCallOrder[0]).toBeLessThan(f.rpc.mock.invocationCallOrder[2]);
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_refused_invitation_draft_purge_v1", "authorize_refused_invitation_storage_v1", "complete_refused_invitation_storage_v1",
      "finish_refused_invitation_draft_purge_v1", "claim_refused_invitation_draft_purge_v1",
    ]);
  });
  it("respects the provider's 1000-object batch limit", async () => {
    const objects = Array.from({ length: 1001 }, (_, i) => ({ ...object, objectName: `evidence-${i}`, ordinal: i + 1 }));
    const f = fixture(objects);
    expect(await drainRefusedInvitationCleanup(f.admin)).toEqual({ processed: 1, failed: 0 });
    expect(f.remove.mock.calls.map(([paths]) => paths.length)).toEqual([1000, 1]);
    expect(f.rpc.mock.calls.filter(([name]) => name === "complete_refused_invitation_storage_v1")).toHaveLength(2);
    expect(f.rpc.mock.calls.filter(([name]) => name === "authorize_refused_invitation_storage_v1")).toHaveLength(2);
  });
  it.each(["authority_false", "authorize_refused_invitation_storage_v1", "storage", "complete_refused_invitation_storage_v1", "finish_refused_invitation_draft_purge_v1"])(
    "keeps cleanup retryable after %s failure without exposing details", async failure => {
      const f = fixture([object], failure);
      const log = vi.spyOn(console, "error");
      expect(await drainRefusedInvitationCleanup(f.admin)).toEqual({ processed: 0, failed: 1 });
      expect(f.rpc).toHaveBeenCalledWith("fail_refused_invitation_draft_purge_v1", {
        p_manifest_id: "manifest", p_claim_token_hash: expect.any(String),
      });
      expect(f.rpc.mock.calls.filter(([name]) => name === "claim_refused_invitation_draft_purge_v1")).toHaveLength(1);
      if (failure !== "finish_refused_invitation_draft_purge_v1") {
        expect(f.rpc.mock.calls.some(([name]) => name === "finish_refused_invitation_draft_purge_v1")).toBe(false);
      }
      expect(log).not.toHaveBeenCalled();
      if (failure === "authorize_refused_invitation_storage_v1" || failure === "authority_false") expect(f.remove).not.toHaveBeenCalled();
      log.mockRestore();
    },
  );
  it.each([[{ ...object, bucketId: "genomes" }], [{ ...object, unexpected: "field" }], [{}]])(
    "rejects a malformed manifest before a storage call", async entry => {
      const f = fixture([entry]);
      expect(await drainRefusedInvitationCleanup(f.admin)).toEqual({ processed: 0, failed: 1 });
      expect(f.remove).not.toHaveBeenCalled();
    },
  );
  it("finishes already-absent evidence without a storage call", async () => {
    const f = fixture([]);
    expect(await drainRefusedInvitationCleanup(f.admin)).toEqual({ processed: 1, failed: 0 });
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.rpc.mock.calls.some(([name]) => name === "finish_refused_invitation_draft_purge_v1")).toBe(true);
  });
});
