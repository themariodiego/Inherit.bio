import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "./page";
import { AncestryRegions } from "@/components/results/ancestry/ancestry-regions";
import { InputProvenance } from "@/components/reports/input-provenance";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), own: vi.fn(), shared: vi.fn(), inputs: vi.fn(), count: vi.fn(), preparing: vi.fn() }));
vi.mock("@/lib/family/subject-route", () => ({ resolveSubjectRoute: mocks.resolve }));
vi.mock("@/lib/family/access", () => ({ viewerMaySee: () => true }));
vi.mock("@/lib/family/shared-ancestry-results", () => ({ loadSharedAncestrySnapshot: mocks.shared }));
vi.mock("@/lib/ancestry/own-results", () => ({ loadAncestryResultSnapshot: mocks.own }));
vi.mock("@/lib/genome/input-sources", () => ({ loadInputSources: mocks.inputs }));
vi.mock("@/lib/genome/load", () => ({ getSubjectFileCount: mocks.count, hasFileInPreparation: mocks.preparing }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/ancestry/geometry", () => ({ mapShapes: () => [] }));
vi.mock("@/lib/ancestry/regional-geometry", () => ({ regionalMapShapes: () => [] }));
vi.mock("@/components/results/ancestry/ancestry-regions", () => ({ AncestryRegions: vi.fn(() => null) }));
vi.mock("@/components/results/ancestry/regional-ancestry-regions", () => ({ RegionalAncestryRegions: vi.fn(() => null) }));
vi.mock("@/components/results/ancestry/lineage-card", () => ({ LineageCard: () => null }));
vi.mock("@/components/results/ancestry/neanderthal-card", () => ({ NeanderthalCard: () => null }));
vi.mock("@/components/reports/input-provenance", () => ({ InputProvenance: vi.fn(() => null) }));
vi.mock("@/components/subjects/subject-bar", () => ({ SubjectBar: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not_found"); }, redirect: () => { throw new Error("gate"); } }));
const subjectId = "79130000-0000-4000-8000-000000000001", fileA = "79130000-0000-4000-8000-000000000002", fileB = "79130000-0000-4000-8000-000000000003";
const context = { kind: "ok", user: { id: "viewer" }, subject: { routeSegment: "me", displayLabel: "You" }, dataSubjectId: subjectId,
  person: null as unknown, domain: { label: "My Genome", href: "/genome" } };
const row = (file_id: string) => ({ kind: "admixture", file_id, result: { proportions: { AFR: 0, AMR: 0, EAS: 0, EUR: 1, SAS: 0 }, markersUsed: 168 },
  support_note: "Saved", model_id: "aims-kidd-seldin-168", model_version: "2026-08-28", created_at: "2026-09-15T00:00:00Z" });
const props = { params: Promise.resolve({ subject: "me" }) } as Parameters<typeof Page>[0];
beforeEach(() => {
  vi.clearAllMocks(); mocks.resolve.mockResolvedValue(context); mocks.count.mockResolvedValue(2); mocks.preparing.mockResolvedValue(false);
  mocks.inputs.mockImplementation(async (_db, _subject, ids: string[]) => ids.map(fileId => ({ fileId, fileType: "vcf", processedAt: null, snapshot: null })));
});
it("preserves own selected-row identity when A disappears and older B survives final confirmation", async () => {
  const a = row(fileA), b = row(fileB);
  mocks.own.mockResolvedValue({ rows: [a, b], confirm: async () => [b] });
  renderToStaticMarkup(await Page(props));
  expect(mocks.inputs.mock.calls[0][2]).toEqual([fileA]);
  expect(vi.mocked(AncestryRegions).mock.calls[0][0].result).toBeNull();
  expect(InputProvenance).not.toHaveBeenCalled();
  expect(mocks.shared).not.toHaveBeenCalled();
});
it("renders Family results only from its final capture and uses that capture's exact provenance", async () => {
  mocks.resolve.mockResolvedValue({ ...context, person: { counterpartAccountId: "owner", displayLabel: "Relative" } });
  const b = row(fileB), source = { fileId: fileB, fileType: "vcf", processedAt: null, snapshot: null };
  mocks.shared.mockResolvedValue({ rows: [row(fileA)], confirm: async () => ({ authorized: true, rows: [b], sources: [source], fileCount: 1,
    preparing: false, confirmationRequired: false, preparedUnavailable: false }) });
  renderToStaticMarkup(await Page(props));
  expect(mocks.own).not.toHaveBeenCalled(); expect(mocks.inputs).not.toHaveBeenCalled();
  expect(mocks.count).not.toHaveBeenCalled(); expect(mocks.preparing).not.toHaveBeenCalled();
  expect(vi.mocked(InputProvenance).mock.calls[0][0].sources).toEqual([source]);
});
it("withholds the entire Family surface when final recipient confirmation fails", async () => {
  mocks.resolve.mockResolvedValue({ ...context, person: { counterpartAccountId: "owner", displayLabel: "Relative" } });
  mocks.shared.mockResolvedValue({ rows: [row(fileA)], confirm: async () => ({ authorized: false, rows: [], sources: [] }) });
  await expect(Page(props)).rejects.toThrow("not_found");
  expect(InputProvenance).not.toHaveBeenCalled(); expect(mocks.own).not.toHaveBeenCalled();
});
