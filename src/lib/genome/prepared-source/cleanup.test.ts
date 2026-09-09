import { beforeEach, describe, expect, it, vi } from "vitest";
import { drainOwnPreparedCleanup } from "./cleanup";
import type { createAdminClient } from "../../supabase/admin";
import { tombstonePreparedR2 } from "./r2-transport";
vi.mock("./r2-transport", () => ({ tombstonePreparedR2: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const entry = { artifactId: "22222222-2222-4222-8222-222222222222", sequence: 0,
  locator: { provider: "r2", bucket: "inherit-prepared-test", objectKey: "prepared/33333333-3333-4333-8333-333333333333",
    byteCount: 8, sha256: "a".repeat(64), providerVersion: null, etag: null } };
const evidence = { disposition: "payload-tombstoned", providerVersion: "b".repeat(32),
  etag: "d41d8cd98f00b204e9800998ecf8427e", byteCount: 0,
  sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" };
function claim() { return { version: "own-prepared-cleanup-claim-v1", cleanupId: id, mode: "file",
  claimExpiresAt: new Date(Date.now() + 29000).toISOString(), cleanupDeadline: new Date(Date.now() + 3600000).toISOString(),
  writeFenceAt: new Date(Date.now() + 30000).toISOString(), entries: [structuredClone(entry)] }; }
function fixture(overrides: Record<string, unknown> = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const values: Record<string, unknown> = { claim_own_prepared_cleanup_v1: claim(),
    check_own_prepared_cleanup_entry_v1: entry, ack_own_prepared_cleanup_entry_v1: true,
    finish_own_prepared_cleanup_v1: true, release_own_prepared_cleanup_v1: null, ...overrides };
  const admin = { rpc(name: string, args: Record<string, unknown>) { calls.push({ name, args });
    return { abortSignal: async (signal: AbortSignal) => { signal.throwIfAborted();
      const value = values[name]; if (value instanceof Error) return { data: null, error: value };
      return { data: structuredClone(value), error: null }; } }; } } as unknown as ReturnType<typeof createAdminClient>;
  return { admin, calls };
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(tombstonePreparedR2).mockResolvedValue(evidence as Awaited<ReturnType<typeof tombstonePreparedR2>>); });
describe("prepared payload cleanup", () => {
  it("checks the exact registered entry, verifies a tombstone then acknowledges before finish", async () => {
    const f = fixture(); expect(await drainOwnPreparedCleanup(f.admin, { cleanupId: id })).toEqual({ processed: 1, completed: true, pending: false, failed: false, unresolved: false });
    expect(f.calls.map(c => c.name)).toEqual(["claim_own_prepared_cleanup_v1", "check_own_prepared_cleanup_entry_v1", "ack_own_prepared_cleanup_entry_v1", "finish_own_prepared_cleanup_v1"]);
    expect(tombstonePreparedR2).toHaveBeenCalledExactlyOnceWith(entry.locator, expect.any(String), expect.any(AbortSignal));
    expect(f.calls[2].args.p_expected).toEqual(entry); expect(f.calls[2].args.p_evidence).toEqual(evidence);
  });
  it("releases a partially completed page without claiming all artifacts are done", async () => {
    const f = fixture({ finish_own_prepared_cleanup_v1: false });
    expect(await drainOwnPreparedCleanup(f.admin)).toMatchObject({ processed: 1, completed: false, pending: true, failed: false });
    expect(f.calls.at(-1)?.name).toBe("release_own_prepared_cleanup_v1");
  });
  it("does not repeat a provider write after an uncertain database acknowledgement", async () => {
    const f = fixture({ ack_own_prepared_cleanup_entry_v1: new Error("private transport detail") });
    expect(await drainOwnPreparedCleanup(f.admin)).toMatchObject({ processed: 0, failed: true, pending: true });
    expect(tombstonePreparedR2).toHaveBeenCalledTimes(1); expect(f.calls.some(c => c.name === "finish_own_prepared_cleanup_v1")).toBe(false);
  });
  it("retains unresolved Supabase physical evidence without a provider call", async () => {
    const legacy = { ...entry, locator: { provider: "supabase", bucket: "genomes", objectKey: entry.locator.objectKey,
      byteCount: 8, sha256: entry.locator.sha256, storageObjectId: null, storageVersion: null } };
    const f = fixture({ claim_own_prepared_cleanup_v1: { ...claim(), entries: [legacy] }, check_own_prepared_cleanup_entry_v1: legacy });
    expect(await drainOwnPreparedCleanup(f.admin)).toMatchObject({ unresolved: true, completed: false, failed: false });
    expect(tombstonePreparedR2).not.toHaveBeenCalled();
  });
  it.each([null, { ...entry, sequence: 1 }, { ...entry, extra: true }])("refuses a changed current member before provider action: %j", async current => {
    const f = fixture({ check_own_prepared_cleanup_entry_v1: current });
    expect(await drainOwnPreparedCleanup(f.admin)).toMatchObject({ failed: true }); expect(tombstonePreparedR2).not.toHaveBeenCalled();
  });
  it.each([null, { ...evidence, byteCount: 8 }, { ...evidence, extra: true }])("refuses incomplete provider evidence: %j", async value => {
    vi.mocked(tombstonePreparedR2).mockResolvedValue(value as unknown as Awaited<ReturnType<typeof tombstonePreparedR2>>);
    const f = fixture(); expect(await drainOwnPreparedCleanup(f.admin)).toMatchObject({ failed: true });
    expect(f.calls.some(c => c.name === "ack_own_prepared_cleanup_entry_v1")).toBe(false);
  });
  it("refuses duplicate entries and oversized receipt metadata before provider calls", async () => {
    for (const raw of [{ ...claim(), entries: [entry, entry] }, { ...claim(), extra: "a".repeat(65537) }]) {
      const f = fixture({ claim_own_prepared_cleanup_v1: raw }); expect(await drainOwnPreparedCleanup(f.admin)).toMatchObject({ failed: true });
    }
    expect(tombstonePreparedR2).not.toHaveBeenCalled();
  });
  it("empty exact disposition still requires database finish, while no claim is not completion", async () => {
    const empty = fixture({ claim_own_prepared_cleanup_v1: { ...claim(), entries: [] } });
    expect(await drainOwnPreparedCleanup(empty.admin)).toMatchObject({ completed: true, processed: 0 });
    const none = fixture({ claim_own_prepared_cleanup_v1: null });
    expect(await drainOwnPreparedCleanup(none.admin, { cleanupId: id })).toMatchObject({ completed: false, pending: true });
  });
  it("propagates cancellation and never ACKs a provider response arriving after abort", async () => {
    const controller = new AbortController();
    vi.mocked(tombstonePreparedR2).mockImplementation(async () => { controller.abort(); return evidence as Awaited<ReturnType<typeof tombstonePreparedR2>>; });
    const f = fixture(); expect(await drainOwnPreparedCleanup(f.admin, { signal: controller.signal })).toMatchObject({ failed: true });
    expect(f.calls.some(c => c.name === "ack_own_prepared_cleanup_entry_v1")).toBe(false);
  });
});
