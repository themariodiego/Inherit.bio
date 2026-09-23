import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/genome/load";
import type { SubjectSummary } from "@/lib/subjects";
import type { FamilyPerson } from "./graph";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), capability: vi.fn(), rpc: vi.fn(), from: vi.fn(), filters: [] as unknown[], rows: [] as unknown[], queryError: null as unknown }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
vi.mock("./access", async original => ({ ...await original<object>(), familyCapability: mocks.capability }));
import { loadOverviewPortraitTarget } from "./overview-portrait-target";

const id = (n: number) => `77300000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = { accountId: id(1), sessionId: id(2) };
const self: SubjectSummary = { id: id(3), subjectClass: "self", lifecycle: "active", lifecycleRevision: 1,
  ownerAccountId: id(1), subjectAccountId: id(1), displayLabel: "You", routeSegment: "me", dataSubjectId: id(3) };
function person(): FamilyPerson { return { handle: { ...self, id: id(4), subjectAccountId: id(5) },
  dataSubjectId: id(4), counterpartAccountId: id(5), displayLabel: "Adult", origin: "invited-by-me",
  sharing: "active", grantsToViewer: new Set(["family.portrait"]), grantsFromViewer: new Set(["family.portrait"]) }; }
const pair = () => ({ id: id(6), subject_a_id: id(3), subject_b_id: id(4), status: "current" });
const snapshot = () => ({ pairId: id(6), subjectAId: id(3), subjectBId: id(4), counterpartAccountId: id(5), receipt: "a".repeat(64) });
const db = { from: mocks.from, rpc: mocks.rpc } as unknown as Db;
beforeEach(() => {
  vi.resetAllMocks(); mocks.filters = []; mocks.rows = [pair()]; mocks.queryError = null;
  mocks.actor.mockResolvedValue(actor); mocks.capability.mockResolvedValue({ status: "permitted" });
  mocks.rpc.mockResolvedValue({ data: snapshot(), error: null });
  mocks.from.mockImplementation((table: string) => {
    if (table !== "family_pairs") throw new Error("unexpected_data_read");
    const query = Object.fromEntries(["select", "eq", "or", "order", "limit"].map(method => [method, (...args: unknown[]) => { mocks.filters.push([method, ...args]); return query; }]));
    return Object.assign(query, { then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: mocks.rows, error: mocks.queryError }).then(resolve) });
  });
});

describe("Overview Portrait metadata target", () => {
  it("returns only the pair after a final exact authority confirmation, without source or result reads", async () => {
    const target = await loadOverviewPortraitTarget(db, actor.accountId, self, [person()]);
    expect(Object.keys(target)).toEqual(["confirm"]);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(await target.confirm()).toBe(id(6));
    expect(mocks.from.mock.calls).toEqual([["family_pairs"]]);
    expect(mocks.filters).toEqual([["select", "id, subject_a_id, subject_b_id, status"], ["eq", "status", "current"],
      ["or", `subject_a_id.eq.${id(3)},subject_b_id.eq.${id(3)}`], ["order", "id", { ascending: true }], ["limit", 50]]);
    expect(mocks.rpc).toHaveBeenLastCalledWith("family_portrait_navigation_v1", {
      p_account_id: id(1), p_session_id: id(2), p_pair_id: id(6), p_counterpart_account_id: id(5), p_expected: "a".repeat(64),
    });
    expect(mocks.rpc.mock.invocationCallOrder.at(-1)).toBeGreaterThan(mocks.capability.mock.invocationCallOrder.at(-1)!);
    expect(mocks.rpc.mock.calls.every(([name]) => name === "family_portrait_navigation_v1")).toBe(true);
  });
  it("keeps the pair's actual ordering when the viewer is its second subject", async () => {
    mocks.rows = [{ ...pair(), subject_a_id: id(4), subject_b_id: id(3) }];
    mocks.rpc.mockResolvedValue({ data: { ...snapshot(), subjectAId: id(4), subjectBId: id(3) }, error: null });
    expect(await (await loadOverviewPortraitTarget(db, actor.accountId, self, [person()])).confirm()).toBe(id(6));
  });
  it.each(["absent", "wrong owner", "inactive", "not self", "malformed"])("does not enumerate pairs for a %s self", async reason => {
    const invalid = reason === "absent" ? null : { ...self,
      ...(reason === "wrong owner" ? { subjectAccountId: id(8) } : {}), ...(reason === "inactive" ? { lifecycle: "withdrawn" as const } : {}),
      ...(reason === "not self" ? { subjectClass: "other_adult" as const } : {}), ...(reason === "malformed" ? { id: "not-an-id" } : {}) };
    expect(await (await loadOverviewPortraitTarget(db, actor.accountId, invalid, [person()])).confirm()).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["paused", "outbound missing", "inbound missing", "reports only"])("does not infer Portrait eligibility from %s", async reason => {
    const p = person();
    if (reason === "paused") p.sharing = "paused";
    if (reason === "outbound missing") p.grantsFromViewer = new Set();
    if (reason === "inbound missing") p.grantsToViewer = new Set();
    if (reason === "reports only") { p.grantsToViewer = new Set(["reports.monogenic"]); p.grantsFromViewer = new Set(["reports.monogenic"]); }
    expect(await (await loadOverviewPortraitTarget(db, actor.accountId, self, [p])).confirm()).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects a session for a different viewer before pair discovery", async () => {
    mocks.actor.mockResolvedValue({ ...actor, accountId: id(9) });
    expect(await (await loadOverviewPortraitTarget(db, actor.accountId, self, [person()])).confirm()).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each(["foreign pair", "unlisted counterpart", "pending pair", "malformed row", "query error", "over bound"])("withholds a %s without submitting an arbitrary pair", async reason => {
    if (reason === "foreign pair") mocks.rows = [{ ...pair(), subject_a_id: id(9) }];
    if (reason === "unlisted counterpart") mocks.rows = [{ ...pair(), subject_b_id: id(9) }];
    if (reason === "pending pair") mocks.rows = [{ ...pair(), status: "pending" }];
    if (reason === "malformed row") mocks.rows = [{ ...pair(), genotype: "CC" }];
    if (reason === "query error") mocks.queryError = {};
    if (reason === "over bound") mocks.rows = Array.from({ length: 51 }, pair);
    expect(await (await loadOverviewPortraitTarget(db, actor.accountId, self, [person()])).confirm()).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["first", "second"])("refuses a prohibited %s capability before authority capture", async position => {
    mocks.capability.mockResolvedValueOnce({ status: position === "first" ? "prohibited" : "permitted" }).mockResolvedValueOnce({ status: "unreviewed" });
    expect(await (await loadOverviewPortraitTarget(db, actor.accountId, self, [person()])).confirm()).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([null, { ...snapshot(), pairId: id(9) }, { ...snapshot(), subjectAId: id(9) },
    { ...snapshot(), counterpartAccountId: id(9) }, { ...snapshot(), source: "unexpected" },
    { ...snapshot(), receipt: "not-a-receipt" }])("refuses denied or mismatched metadata", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect(await (await loadOverviewPortraitTarget(db, actor.accountId, self, [person()])).confirm()).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it.each(["actor throws", "query throws", "capability throws", "capture throws", "capture error"])("keeps the safe fallback when %s", async reason => {
    if (reason === "actor throws") mocks.actor.mockRejectedValue(new Error("unavailable"));
    if (reason === "query throws") mocks.from.mockImplementation(() => { throw new Error("unavailable"); });
    if (reason === "capability throws") mocks.capability.mockRejectedValue(new Error("unavailable"));
    if (reason === "capture throws") mocks.rpc.mockRejectedValue(new Error("unavailable"));
    if (reason === "capture error") mocks.rpc.mockResolvedValue({ data: snapshot(), error: {} });
    const target = await loadOverviewPortraitTarget(db, actor.accountId, self, [person()]);
    expect(Object.keys(target)).toEqual(["confirm"]);
    expect(await target.confirm()).toBeNull();
  });
  it.each(["actor throws", "capability throws", "confirmation throws", "confirmation error"])("closes after %s without leaking the captured pair", async reason => {
    const target = await loadOverviewPortraitTarget(db, actor.accountId, self, [person()]);
    if (reason === "actor throws") mocks.actor.mockRejectedValue(new Error("unavailable"));
    if (reason === "capability throws") mocks.capability.mockRejectedValue(new Error("unavailable"));
    if (reason === "confirmation throws") mocks.rpc.mockRejectedValue(new Error("unavailable"));
    if (reason === "confirmation error") mocks.rpc.mockResolvedValue({ data: snapshot(), error: {} });
    expect(await target.confirm()).toBeNull();
    mocks.actor.mockResolvedValue(actor); mocks.capability.mockResolvedValue({ status: "permitted" }); mocks.rpc.mockResolvedValue({ data: snapshot(), error: null });
    expect(await target.confirm()).toBeNull();
  });
  it.each(["revoked", "expired", "stale revision", "missing readiness", "account", "session", "jurisdiction"])("permanently closes after final %s refusal", async reason => {
    const target = await loadOverviewPortraitTarget(db, actor.accountId, self, [person()]);
    if (reason === "account") mocks.actor.mockResolvedValue({ ...actor, accountId: id(9) });
    else if (reason === "session") mocks.actor.mockResolvedValue({ ...actor, sessionId: id(9) });
    else if (reason === "jurisdiction") mocks.capability.mockResolvedValue({ status: "prohibited" });
    else mocks.rpc.mockResolvedValue({ data: reason === "stale revision" ? { ...snapshot(), receipt: "b".repeat(64) } : null, error: null });
    expect(await target.confirm()).toBeNull();
    mocks.actor.mockResolvedValue(actor); mocks.capability.mockResolvedValue({ status: "permitted" }); mocks.rpc.mockResolvedValue({ data: snapshot(), error: null });
    expect(await target.confirm()).toBeNull();
  });
  it("tries the next actual candidate after an authoritative denial without exposing the rejected pair", async () => {
    mocks.rows = [{ ...pair(), id: id(7) }, pair()];
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    const target = await loadOverviewPortraitTarget(db, actor.accountId, self, [person()]);
    expect(await target.confirm()).toBe(id(6));
    expect(mocks.rpc.mock.calls.map(([, args]) => args.p_pair_id)).toEqual([id(7), id(6), id(6)]);
  });
});
