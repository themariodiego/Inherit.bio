import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rows: vi.fn(), gate: vi.fn(), snapshot: vi.fn(), confirm: vi.fn(), candidates: vi.fn(), classified: vi.fn(), carrier: vi.fn(), inputs: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); }, redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "a" } } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/family/independent-login", () => ({ markIndependentLogin: async () => undefined }));
vi.mock("@/lib/family/portrait", async original => ({ ...await original<object>(), readPortraitPairRows: m.rows }));
vi.mock("@/lib/family/graph", () => ({ listFamilyPeople: async () => [] }));
vi.mock("@/lib/family/access", () => ({ familyCapability: async () => ({ status: "permitted" }), permits: () => true }));
vi.mock("@/lib/family/tier2", () => ({ acknowledged: m.gate }));
vi.mock("@/lib/family/portrait-source-readiness", () => ({ loadPortraitSourceReadiness: m.snapshot }));
vi.mock("@/lib/genome/own-analysis-access", () => ({ loadOwnAnalysisCandidateFiles: m.candidates }));
vi.mock("@/lib/family/carrier-pair", async original => ({ ...await original<object>(), readClassifiedVariants: m.classified, readCarrierConditions: async () => [], resolveCarrierPair: m.carrier }));
vi.mock("@/lib/genome/input-sources", () => ({ loadInputSources: m.inputs }));
import Page from "@/app/(app)/family/portrait/[pairId]/page";
import { NO_CLASSIFIED_POSITIONS } from "@/copy/family/portrait";
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  return isValidElement<{children?: ReactNode}>(node) ? text(node.props.children) : "";
}
const props = () => ({ params: Promise.resolve({ pairId: "pair" }), searchParams: Promise.resolve({}) });
const side = (id: string) => ({ id, displayLabel: "You", subjectClass: "self", lifecycle: "active", subjectAccountId: id, portraitAcknowledgedAt: "now", independentLoginAt: "now" });
const ready = () => ({ kind: "canonical", a: { subjectId: "a", hasPreparedSource: true, hasLegacySource: false, legacyFileIds: [] as string[] }, b: { subjectId: "b", hasPreparedSource: true, hasLegacySource: false, legacyFileIds: [] as string[] } });
beforeEach(() => {
  vi.clearAllMocks();
  m.rows.mockResolvedValue({ viewerAccountId: "a", pair: { id: "pair", subjectAId: "a", subjectBId: "b", status: "current", pairRevision: 1 }, a: side("a"), b: side("b"), paused: false,
    grants: [{ granterAccountId: "a", recipientAccountId: "b", grantId: "ga" }, { granterAccountId: "b", recipientAccountId: "a", grantId: "gb" }] });
  m.gate.mockResolvedValue(true); m.confirm.mockResolvedValue(true);
  m.snapshot.mockResolvedValue({ state: ready(), confirm: m.confirm });
  m.candidates.mockResolvedValue([{ id: "old" }]); m.classified.mockResolvedValue([]); m.inputs.mockResolvedValue([]);
  m.carrier.mockResolvedValue({ classifiedPositions: 0, positionsBothCover: 0, matches: [], genotypes: { a: new Map(), b: new Map() } });
});
describe("Portrait canonical metadata composition", () => {
  it("reads no source metadata or genetics before the session gate", async () => {
    m.gate.mockResolvedValue(false); await Page(props());
    expect(m.snapshot).not.toHaveBeenCalled(); expect(m.candidates).not.toHaveBeenCalled(); expect(m.carrier).not.toHaveBeenCalled();
  });
  it("reads no source when either adult still has a prerequisite", async () => {
    const rows = await m.rows(); rows.b.portraitAcknowledgedAt = null; await Page(props());
    expect(m.snapshot).not.toHaveBeenCalled(); expect(m.classified).not.toHaveBeenCalled();
  });
  it("shows the honest unavailable clinical result for prepared canonical sources without reading calls", async () => {
    expect(text(await Page(props()))).toContain(NO_CLASSIFIED_POSITIONS);
    expect(m.candidates).not.toHaveBeenCalled(); expect(m.classified).not.toHaveBeenCalled(); expect(m.carrier).not.toHaveBeenCalled(); expect(m.inputs).not.toHaveBeenCalled(); expect(m.confirm).toHaveBeenCalledOnce();
  });
  it("recognizes an independently present legacy counterpart without reinterpreting either source", async () => {
    const state = ready(); state.b.hasPreparedSource = false; state.b.hasLegacySource = true; state.b.legacyFileIds = ["old-b"];
    m.snapshot.mockResolvedValue({ state, confirm: m.confirm });
    expect(text(await Page(props()))).toContain(NO_CLASSIFIED_POSITIONS); expect(m.carrier).not.toHaveBeenCalled();
  });
  it.each(["canonical", "legacy-only"])("preserves independently valid legacy-only source behavior under %s grants", async kind => {
    const state = ready(); state.kind = kind; for (const side of [state.a, state.b]) { side.hasPreparedSource = false; side.hasLegacySource = true; side.legacyFileIds = [`old-${side.subjectId}`]; }
    m.snapshot.mockResolvedValue({ state, confirm: m.confirm });
    await Page(props()); expect(m.carrier).toHaveBeenCalledOnce(); expect(m.carrier).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), [], [], { a: ["old-a"], b: ["old-b"] });
    expect(m.confirm.mock.invocationCallOrder[0]).toBeGreaterThan(m.inputs.mock.invocationCallOrder.at(-1)!);
  });
  it.each(["one", "both"])("preserves the exact legacy pair when %s sides also have canonical sources", async canonical => {
    const state = ready(); state.b.hasPreparedSource = canonical === "both";
    for (const side of [state.a, state.b]) { side.hasLegacySource = true; side.legacyFileIds = [`old-${side.subjectId}`]; }
    m.snapshot.mockResolvedValue({ state, confirm: m.confirm });
    const tree = await Page(props());
    expect(m.carrier).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), [], [], { a: ["old-a"], b: ["old-b"] });
    expect(text(tree)).toContain("Clinical results from newer files are not available yet.");
    expect(m.confirm.mock.invocationCallOrder[0]).toBeGreaterThan(m.inputs.mock.invocationCallOrder.at(-1)!);
  });
  it("hard denial cannot fall through to legacy readers", async () => {
    m.snapshot.mockResolvedValue({ state: null, confirm: m.confirm });
    await expect(Page(props())).rejects.toThrow("404"); expect(m.candidates).not.toHaveBeenCalled();
  });
  it("withholds the entire prepared page after terminal withdrawal", async () => {
    m.confirm.mockResolvedValue(false); await expect(Page(props())).rejects.toThrow("404"); expect(m.carrier).not.toHaveBeenCalled();
  });
});
