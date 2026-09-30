import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rows: vi.fn(), gate: vi.fn(), snapshot: vi.fn(), confirm: vi.fn(), candidates: vi.fn(), classified: vi.fn(), carrier: vi.fn(), canonical: vi.fn(), inputs: vi.fn(), preparing: vi.fn() }));
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
vi.mock("@/lib/family/carrier-canonical", () => ({ resolveCanonicalCarrierPair: m.canonical }));
vi.mock("@/lib/genome/input-sources", () => ({ loadInputSources: m.inputs }));
vi.mock("@/lib/genome/load", () => ({ hasFileInPreparation: m.preparing }));
import Page from "@/app/(app)/family/portrait/[pairId]/page";
import { NO_CLASSIFIED_POSITIONS, UNNAMED_PERSON_LABEL } from "@/copy/family/portrait";
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  return isValidElement<{children?: ReactNode}>(node) ? text(node.props.children) : "";
}
const props = () => ({ params: Promise.resolve({ pairId: "pair" }), searchParams: Promise.resolve({}) });
const side = (id: string) => ({ id, displayLabel: "You", subjectClass: "self", lifecycle: "active", subjectAccountId: id, portraitAcknowledgedAt: "now", independentLoginAt: "now" });
const RECEIPT = "f".repeat(64);
const ready = () => ({ kind: "canonical", a: { subjectId: "a", hasPreparedSource: true, hasLegacySource: false, legacyFileIds: [] as string[] }, b: { subjectId: "b", hasPreparedSource: true, hasLegacySource: false, legacyFileIds: [] as string[] } });
beforeEach(() => {
  vi.clearAllMocks();
  m.rows.mockResolvedValue({ viewerAccountId: "a", pair: { id: "pair", subjectAId: "a", subjectBId: "b", status: "current", pairRevision: 1 }, a: side("a"), b: side("b"), paused: false,
    grants: [{ granterAccountId: "a", recipientAccountId: "b", grantId: "ga" }, { granterAccountId: "b", recipientAccountId: "a", grantId: "gb" }] });
  m.gate.mockResolvedValue(true); m.confirm.mockResolvedValue(true);
  m.snapshot.mockResolvedValue({ state: ready(), receipt: RECEIPT, confirm: m.confirm });
  m.candidates.mockResolvedValue([{ id: "old" }]); m.classified.mockResolvedValue([]); m.inputs.mockResolvedValue([]); m.preparing.mockResolvedValue(false);
  m.carrier.mockResolvedValue({ classifiedPositions: 0, positionsBothCover: 0, matches: [], genotypes: { a: new Map(), b: new Map() } });
  m.canonical.mockResolvedValue(null);
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
  it("reads two prepared sources only through the receipt-bound reader, and states unavailable when it answers nothing", async () => {
    expect(text(await Page(props()))).toContain(NO_CLASSIFIED_POSITIONS);
    expect(m.canonical).toHaveBeenCalledOnce();
    expect(m.canonical).toHaveBeenCalledWith(expect.anything(), { pairId: "pair", counterpartAccountId: "b", receipt: RECEIPT },
      { dataSubjectId: "a", displayLabel: "You" }, { dataSubjectId: "b", displayLabel: UNNAMED_PERSON_LABEL }, expect.any(Function));
    expect(m.candidates).not.toHaveBeenCalled(); expect(m.classified).not.toHaveBeenCalled(); expect(m.carrier).not.toHaveBeenCalled(); expect(m.inputs).not.toHaveBeenCalled();
    expect(m.confirm).toHaveBeenCalledOnce();
    expect(m.confirm.mock.invocationCallOrder[0]).toBeGreaterThan(m.canonical.mock.invocationCallOrder[0]);
  });
  it("renders the prepared sources' answer, with no note about older files", async () => {
    m.canonical.mockResolvedValue({ refVariants: [], conditions: [],
      summary: { classifiedPositions: 5, positionsBothCover: 0, matches: [], genotypes: { a: new Map(), b: new Map() },
        checkedFileIds: { a: ["file-a"], b: ["file-b"] }, runsInputFileIds: { a: ["file-a"], b: ["file-b"] } } });
    const rendered = text(await Page(props()));
    expect(rendered).not.toContain(NO_CLASSIFIED_POSITIONS);
    expect(rendered).not.toContain("Clinical results from newer files are not available yet.");
    expect(m.inputs).toHaveBeenCalledWith(expect.anything(), "a", ["file-a", "file-a"]);
    expect(m.carrier).not.toHaveBeenCalled();
    expect(m.confirm.mock.invocationCallOrder[0]).toBeGreaterThan(m.inputs.mock.invocationCallOrder.at(-1)!);
  });
  it("never reads prepared sources without the captured receipt", async () => {
    m.snapshot.mockResolvedValue({ state: ready(), receipt: null, confirm: m.confirm });
    expect(text(await Page(props()))).toContain(NO_CLASSIFIED_POSITIONS);
    expect(m.canonical).not.toHaveBeenCalled(); expect(m.carrier).not.toHaveBeenCalled();
  });
  it("recognizes an independently present legacy counterpart without reinterpreting either source", async () => {
    const state = ready(); state.b.hasPreparedSource = false; state.b.hasLegacySource = true; state.b.legacyFileIds = ["old-b"];
    m.snapshot.mockResolvedValue({ state, receipt: RECEIPT, confirm: m.confirm });
    expect(text(await Page(props()))).toContain(NO_CLASSIFIED_POSITIONS); expect(m.carrier).not.toHaveBeenCalled();
    expect(m.canonical).not.toHaveBeenCalled();
  });
  it.each(["canonical", "legacy-only"])("preserves independently valid legacy-only source behavior under %s grants", async kind => {
    const state = ready(); state.kind = kind; for (const side of [state.a, state.b]) { side.hasPreparedSource = false; side.hasLegacySource = true; side.legacyFileIds = [`old-${side.subjectId}`]; }
    m.snapshot.mockResolvedValue({ state, confirm: m.confirm });
    await Page(props()); expect(m.carrier).toHaveBeenCalledOnce(); expect(m.carrier).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), [], [], { a: ["old-a"], b: ["old-b"] });
    expect(m.confirm.mock.invocationCallOrder[0]).toBeGreaterThan(m.inputs.mock.invocationCallOrder.at(-1)!);
  });
  it("preserves the exact legacy pair when only one side also has a prepared source", async () => {
    const state = ready(); state.b.hasPreparedSource = false;
    for (const side of [state.a, state.b]) { side.hasLegacySource = true; side.legacyFileIds = [`old-${side.subjectId}`]; }
    m.snapshot.mockResolvedValue({ state, receipt: RECEIPT, confirm: m.confirm });
    const tree = await Page(props());
    expect(m.carrier).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), [], [], { a: ["old-a"], b: ["old-b"] });
    expect(m.canonical).not.toHaveBeenCalled();
    expect(text(tree)).toContain("Clinical results from newer files are not available yet.");
    expect(m.confirm.mock.invocationCallOrder[0]).toBeGreaterThan(m.inputs.mock.invocationCallOrder.at(-1)!);
  });
  it("reads both people's current prepared uploads rather than their older files when both have one", async () => {
    const state = ready();
    for (const side of [state.a, state.b]) { side.hasLegacySource = true; side.legacyFileIds = [`old-${side.subjectId}`]; }
    m.snapshot.mockResolvedValue({ state, receipt: RECEIPT, confirm: m.confirm });
    const tree = await Page(props());
    expect(m.canonical).toHaveBeenCalledOnce(); expect(m.carrier).not.toHaveBeenCalled();
    expect(text(tree)).not.toContain("Clinical results from newer files are not available yet.");
  });
  it("says the other adult's file is still being prepared rather than absent, reads no result, and asks only for sides without a source", async () => {
    const state = ready(); state.b.hasPreparedSource = false; m.snapshot.mockResolvedValue({ state, confirm: m.confirm });
    m.preparing.mockImplementation(async (_db: unknown, subjectId: string) => subjectId === "b");
    const rendered = text(await Page(props()));
    expect(rendered).toContain("file is still being prepared. There is nothing to show yet.");
    expect(rendered).not.toContain("hasn’t added a file yet");
    expect(m.preparing).toHaveBeenCalledTimes(1); expect(m.preparing).toHaveBeenCalledWith(expect.anything(), "b");
    expect(m.carrier).not.toHaveBeenCalled(); expect(m.confirm).toHaveBeenCalledOnce();
  });
  it("keeps the absent-file sentence for a side with nothing in flight", async () => {
    const state = ready(); state.b.hasPreparedSource = false; m.snapshot.mockResolvedValue({ state, confirm: m.confirm });
    const rendered = text(await Page(props()));
    expect(rendered).toContain("hasn’t added a file yet"); expect(rendered).not.toContain("still being prepared");
  });
  it("hard denial cannot fall through to legacy readers", async () => {
    m.snapshot.mockResolvedValue({ state: null, confirm: m.confirm });
    await expect(Page(props())).rejects.toThrow("404"); expect(m.candidates).not.toHaveBeenCalled();
  });
  it("withholds the entire prepared page after terminal withdrawal", async () => {
    m.confirm.mockResolvedValue(false); await expect(Page(props())).rejects.toThrow("404"); expect(m.carrier).not.toHaveBeenCalled();
  });
});
