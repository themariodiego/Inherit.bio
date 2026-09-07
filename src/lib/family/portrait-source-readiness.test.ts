import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), capability: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("./access", () => ({ familyCapability: mocks.capability }));
import { loadPortraitSourceReadiness, preparePortraitGrant } from "./portrait-source-readiness";
import type { Db } from "../genome/load";
const id = (n: number) => `79600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = { accountId: id(1), sessionId: id(2) };
const options = { pairId: id(3), counterpartAccountId: id(4), subjectAId: id(5), subjectBId: id(6) };
const value = () => ({ kind: "canonical", receipt: "a".repeat(64),
  a: { subjectId: id(5), hasPreparedSource: true, hasLegacySource: false, legacyFileIds: [] },
  b: { subjectId: id(6), hasPreparedSource: true, hasLegacySource: false, legacyFileIds: [] } });
const db = { rpc: mocks.rpc, from: mocks.from } as unknown as Db;
beforeEach(() => { vi.resetAllMocks(); mocks.actor.mockResolvedValue(actor); mocks.capability.mockResolvedValue({ status: "permitted" }); mocks.rpc.mockImplementation(async () => ({ data: value(), error: null })); });
describe("Portrait source metadata", () => {
  it("exposes only source-presence booleans and confirms the exact captured receipt last", async () => {
    const snapshot = await loadPortraitSourceReadiness(db, options);
    expect(snapshot.state).toEqual({ kind: "canonical", a: value().a, b: value().b });
    expect(await snapshot.confirm()).toBe(true);
    expect(mocks.rpc).toHaveBeenLastCalledWith("family_portrait_source_readiness_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId, p_pair_id: options.pairId,
      p_counterpart_account_id: options.counterpartAccountId, p_expected: "a".repeat(64),
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.invocationCallOrder.at(-1)).toBeGreaterThan(mocks.capability.mock.invocationCallOrder.at(-1)!);
  });
  it.each(["withdrawal", "source change", "session", "jurisdiction"])("closes permanently after %s", async reason => {
    const snapshot = await loadPortraitSourceReadiness(db, options);
    if (reason === "session") mocks.actor.mockResolvedValue({ ...actor, sessionId: id(9) });
    else if (reason === "jurisdiction") mocks.capability.mockResolvedValue({ status: "prohibited" });
    else mocks.rpc.mockResolvedValue({ data: reason === "withdrawal" ? null : { ...value(), receipt: "b".repeat(64) }, error: null });
    expect(await snapshot.confirm()).toBe(false);
    mocks.actor.mockResolvedValue(actor); mocks.capability.mockResolvedValue({ status: "permitted" }); mocks.rpc.mockResolvedValue({ data: value(), error: null });
    expect(await snapshot.confirm()).toBe(false);
  });
  it.each([
    { ...value(), a: { ...value().a, subjectId: id(9) } },
    { ...value(), genotype: "AG" },
    { ...value(), kind: "legacy-only" },
    { ...value(), a: { ...value().a, hasLegacySource: true, legacyFileIds: [] } },
    { ...value(), a: { ...value().a, hasLegacySource: true, legacyFileIds: [id(7), id(7)] } },
    { ...value(), a: { ...value().a, hasLegacySource: true, legacyFileIds: [id(7)] }, b: { ...value().b, hasLegacySource: true, legacyFileIds: [id(7)] } },
  ])("refuses mismatched or widened metadata payloads", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    const snapshot = await loadPortraitSourceReadiness(db, options);
    expect(snapshot.state).toBeNull(); expect(await snapshot.confirm()).toBe(false);
  });
  it("retains explicit legacy-only access without canonical source authority", async () => {
    const data = { ...value(), kind: "legacy-only", a: { ...value().a, hasPreparedSource: false, hasLegacySource: true, legacyFileIds: [id(7)] }, b: { ...value().b, hasPreparedSource: false, hasLegacySource: true, legacyFileIds: [id(8)] } };
    mocks.rpc.mockResolvedValue({ data, error: null });
    const snapshot = await loadPortraitSourceReadiness(db, options);
    expect(snapshot.state?.kind).toBe("legacy-only"); expect(await snapshot.confirm()).toBe(true);
  });
  it("withholds metadata before authority resolution", async () => {
    mocks.actor.mockResolvedValue(null);
    expect((await loadPortraitSourceReadiness(db, options)).state).toBeNull(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("prepares only a permitted current Portrait presentation", async () => {
    mocks.rpc.mockResolvedValue({ data: "b".repeat(64), error: null });
    expect(await preparePortraitGrant(db, options.subjectAId, options.counterpartAccountId)).toBe("b".repeat(64));
    mocks.capability.mockResolvedValue({ status: "unreviewed" }); mocks.rpc.mockClear();
    expect(await preparePortraitGrant(db, options.subjectAId, options.counterpartAccountId)).toBeNull(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
