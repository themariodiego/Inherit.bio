import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "./page";
import { AncestryAbsent } from "@/components/results/ancestry/ancestry-absent";
import { AncestryRegions } from "@/components/results/ancestry/ancestry-regions";
import { RegionalAncestryRegions } from "@/components/results/ancestry/regional-ancestry-regions";
import { LineageCard } from "@/components/results/ancestry/lineage-card";
import { NeanderthalCard } from "@/components/results/ancestry/neanderthal-card";
import { InputProvenance } from "@/components/reports/input-provenance";
import type { OwnReportChoicesPanel } from "@/lib/uploads/own-report-purpose";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), own: vi.fn(), shared: vi.fn(), inputs: vi.fn(), count: vi.fn(), preparing: vi.fn(), choices: vi.fn() }));
vi.mock("@/lib/family/subject-route", () => ({ resolveSubjectRoute: mocks.resolve }));
vi.mock("@/lib/family/access", () => ({ viewerMaySee: () => true }));
vi.mock("@/lib/family/shared-ancestry-results", () => ({ loadSharedAncestrySnapshot: mocks.shared }));
vi.mock("@/lib/ancestry/own-results", () => ({ loadAncestryResultSnapshot: mocks.own }));
vi.mock("@/lib/genome/input-sources", () => ({ loadInputSources: mocks.inputs }));
vi.mock("@/lib/genome/load", () => ({ getSubjectFileCount: mocks.count, hasFileInPreparation: mocks.preparing }));
vi.mock("@/lib/uploads/prepare-own-report-choices", () => ({ loadOwnReportChoicesPanel: mocks.choices }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/ancestry/geometry", () => ({ mapShapes: () => [] }));
vi.mock("@/lib/ancestry/regional-geometry", () => ({ regionalMapShapes: () => [] }));
vi.mock("@/components/results/ancestry/ancestry-absent", () => ({ AncestryAbsent: vi.fn(() => null) }));
vi.mock("@/components/results/ancestry/ancestry-regions", () => ({ AncestryRegions: vi.fn(() => null) }));
vi.mock("@/components/results/ancestry/regional-ancestry-regions", () => ({ RegionalAncestryRegions: vi.fn(() => null) }));
vi.mock("@/components/results/ancestry/lineage-card", () => ({ LineageCard: vi.fn(() => null) }));
vi.mock("@/components/results/ancestry/neanderthal-card", () => ({ NeanderthalCard: vi.fn(() => null) }));
vi.mock("@/components/reports/input-provenance", () => ({ InputProvenance: vi.fn(() => null) }));
vi.mock("@/components/subjects/subject-bar", () => ({ SubjectBar: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not_found"); }, redirect: () => { throw new Error("gate"); } }));
const subjectId = "79130000-0000-4000-8000-000000000001", fileA = "79130000-0000-4000-8000-000000000002", fileB = "79130000-0000-4000-8000-000000000003";
const context = { kind: "ok", user: { id: "viewer" }, subject: { routeSegment: "me", displayLabel: "You" }, dataSubjectId: subjectId,
  person: null as unknown, domain: { label: "My Genome", href: "/genome" } };
const row = (file_id: string) => ({ kind: "admixture", file_id, basis: "modelled" as const, result: { proportions: { AFR: 0, AMR: 0, EAS: 0, EUR: 1, SAS: 0 }, markersUsed: 168 },
  support_note: "Saved", model_id: "aims-kidd-seldin-168", model_version: "2026-08-28", created_at: "2026-09-15T00:00:00Z" });
const props = { params: Promise.resolve({ subject: "me" }) } as Parameters<typeof Page>[0];
/** The Reports page's "Choose your reports" section, with the Ancestry choice on or off. */
function choicesPanel(ancestryGranted: boolean): OwnReportChoicesPanel {
  const choice = (purposeKey: "reports.monogenic" | "reports.polygenic" | "ancestry", granted: boolean) => ({
    purposeKey, label: purposeKey, description: "", granted, grantId: granted ? subjectId : null, revokeNonce: granted ? "revoke-nonce" : null,
    artifact: { key: `consent.${purposeKey}`, version: 1, body: "" }, token: "token", statementKeys: [], reconsent: null });
  return { kind: "ready", files: [{ id: fileA, label: "File 1" }], view: { kind: "ready", subjectId, choices: [
    choice("reports.monogenic", false), choice("reports.polygenic", true), choice("ancestry", ancestryGranted)] } };
}
const lineageProps = () => vi.mocked(LineageCard).mock.calls.map(([card]) => ({
  parent: card.parent, absence: card.absence, reportsHref: card.reportsHref }));
beforeEach(() => {
  // Production (the Neanderthal estimate off) unless a case sets the TEST-LOCAL
  // flag itself; the process environment never decides.
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
  vi.clearAllMocks(); mocks.resolve.mockResolvedValue(context); mocks.count.mockResolvedValue(2); mocks.preparing.mockResolvedValue(false);
  mocks.choices.mockResolvedValue(choicesPanel(true));
  mocks.inputs.mockImplementation(async (_db, _subject, ids: string[]) => ids.map(fileId => ({ fileId, fileType: "vcf", processedAt: null, snapshot: null })));
});
afterEach(() => { vi.unstubAllEnvs(); });
it("preserves own selected-row identity when A disappears and older B survives final confirmation", async () => {
  const a = row(fileA), b = row(fileB);
  mocks.own.mockResolvedValue({ rows: [a, b], confirm: async () => [b] });
  renderToStaticMarkup(await Page(props));
  expect(mocks.inputs.mock.calls[0][2]).toEqual([fileA]);
  // A withdrawn row leaves nothing to show: never a stale result, never an
  // older file's result swapped in, and never "Ancestry is off" while the
  // choice is on. With it on, the page points at the generate step, which is
  // what makes a result again.
  expect(AncestryRegions).not.toHaveBeenCalled();
  expect(vi.mocked(AncestryAbsent).mock.calls[0][0]).toMatchObject({ absence: "not-generated" });
  expect(InputProvenance).not.toHaveBeenCalled();
  expect(mocks.shared).not.toHaveBeenCalled();
});
it("no file processed: every ancestry panel says nothing has been read, on the current map", async () => {
  mocks.own.mockResolvedValue({ rows: [], confirm: async () => [] });
  mocks.count.mockResolvedValue(0);
  // No prepared file, so the Reports page shows no "Choose your reports" at all.
  mocks.choices.mockResolvedValue({ kind: "hidden" });
  renderToStaticMarkup(await Page(props));
  expect(mocks.choices).toHaveBeenCalledExactlyOnceWith("me");
  expect(vi.mocked(AncestryAbsent).mock.calls[0][0]).toMatchObject({ absence: "nothing-read", reportsHref: "/genome/me/reports" });
  expect(AncestryRegions).not.toHaveBeenCalled(); expect(RegionalAncestryRegions).not.toHaveBeenCalled();
  expect(lineageProps()).toEqual([
    { parent: "mother", absence: "nothing-read", reportsHref: "/genome/me/reports" },
    { parent: "father", absence: "nothing-read", reportsHref: "/genome/me/reports" },
  ]);
});
it("file processed but Ancestry off: every ancestry panel says so and links to this subject's Reports page", async () => {
  mocks.own.mockResolvedValue({ rows: [], confirm: async () => [] });
  mocks.choices.mockResolvedValue(choicesPanel(false));
  mocks.resolve.mockResolvedValue({ ...context, subject: { routeSegment: `s-${subjectId}`, displayLabel: "Other" } });
  renderToStaticMarkup(await Page(props));
  expect(mocks.choices).toHaveBeenCalledExactlyOnceWith(`s-${subjectId}`);
  const href = `/genome/s-${subjectId}/reports`;
  expect(vi.mocked(AncestryAbsent).mock.calls[0][0]).toMatchObject({ absence: "permission-off", reportsHref: href });
  expect(AncestryRegions).not.toHaveBeenCalled(); expect(RegionalAncestryRegions).not.toHaveBeenCalled();
  expect(lineageProps()).toEqual([
    { parent: "mother", absence: "permission-off", reportsHref: href },
    { parent: "father", absence: "permission-off", reportsHref: href },
  ]);
});
it("file processed, Ancestry on, no stored result: every panel says the result follows the generate step, with the link", async () => {
  mocks.own.mockResolvedValue({ rows: [], confirm: async () => [] });
  mocks.choices.mockResolvedValue(choicesPanel(true));
  renderToStaticMarkup(await Page(props));
  expect(mocks.choices).toHaveBeenCalledExactlyOnceWith("me");
  expect(vi.mocked(AncestryAbsent).mock.calls[0][0]).toMatchObject({ absence: "not-generated", reportsHref: "/genome/me/reports" });
  expect(AncestryRegions).not.toHaveBeenCalled(); expect(RegionalAncestryRegions).not.toHaveBeenCalled();
  expect(lineageProps()).toEqual([
    { parent: "mother", absence: "not-generated", reportsHref: "/genome/me/reports" },
    { parent: "father", absence: "not-generated", reportsHref: "/genome/me/reports" },
  ]);
});
it("keeps nothing-read when the choices section is absent or could not load, rather than naming a step", async () => {
  mocks.own.mockResolvedValue({ rows: [], confirm: async () => [] });
  for (const panel of [{ kind: "files-unavailable" }, { kind: "hidden" }] as const) {
    vi.mocked(AncestryAbsent).mockClear(); mocks.choices.mockResolvedValue(panel);
    renderToStaticMarkup(await Page(props));
    expect(vi.mocked(AncestryAbsent).mock.calls[0][0].absence).toBe("nothing-read");
  }
});
it("result present: renders the stored result and never asks whether Ancestry is off", async () => {
  const a = row(fileA);
  mocks.own.mockResolvedValue({ rows: [a], confirm: async () => [a] });
  mocks.choices.mockResolvedValue(choicesPanel(false));
  renderToStaticMarkup(await Page(props));
  expect(mocks.choices).not.toHaveBeenCalled();
  expect(AncestryAbsent).not.toHaveBeenCalled();
  expect(vi.mocked(AncestryRegions).mock.calls[0][0].result).not.toBeNull();
  expect(lineageProps().map(card => card.absence)).toEqual(["nothing-read", "nothing-read"]);
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
it("never reads the viewer's own report choices for a Family record with nothing shared", async () => {
  mocks.resolve.mockResolvedValue({ ...context, person: { counterpartAccountId: "owner", displayLabel: "Relative" } });
  mocks.shared.mockResolvedValue({ rows: [], confirm: async () => ({ authorized: true, rows: [], sources: [], fileCount: 1,
    preparing: false, confirmationRequired: false, preparedUnavailable: false }) });
  renderToStaticMarkup(await Page(props));
  expect(mocks.choices).not.toHaveBeenCalled();
  expect(vi.mocked(AncestryAbsent).mock.calls[0][0].absence).toBe("nothing-read");
});
it("withholds the entire Family surface when final recipient confirmation fails", async () => {
  mocks.resolve.mockResolvedValue({ ...context, person: { counterpartAccountId: "owner", displayLabel: "Relative" } });
  mocks.shared.mockResolvedValue({ rows: [row(fileA)], confirm: async () => ({ authorized: false, rows: [], sources: [] }) });
  await expect(Page(props)).rejects.toThrow("not_found");
  expect(InputProvenance).not.toHaveBeenCalled(); expect(mocks.own).not.toHaveBeenCalled();
});


it("withholds only unclassified historical numbers and preserves their record context", async () => {
  const saved = { ...row(fileA), basis: undefined };
  mocks.own.mockResolvedValue({ rows: [saved], confirm: async () => [saved] });
  const html = renderToStaticMarkup(await Page(props));
  expect(html).toContain('data-slot="ancestry-unclassified-result"');
  expect(html).toContain("Its record does not say how they were made.");
  expect(AncestryRegions).not.toHaveBeenCalled();
  expect(RegionalAncestryRegions).not.toHaveBeenCalled();
  expect(AncestryAbsent).not.toHaveBeenCalled();
  expect(vi.mocked(InputProvenance).mock.calls[0][0]).toMatchObject({ sources: [{ fileId: fileA }] });
  expect(html).toContain("2026-08-28");
});

/**
 * The Neanderthal card's inputs, in both states of the TEST-LOCAL flag. The
 * loader (`loadAncestryResultSnapshot`) always returns a `neanderthal` array:
 * one row per confirmed revision-5 capture and none for anything older, so a
 * revision-4 capture or a legacy row reaches the page as `neanderthal: []`
 * (pinned in `src/lib/ancestry/own-results.test.ts`). These doubles return
 * that shape.
 */
const neanderthalProps = () => vi.mocked(NeanderthalCard).mock.calls.map(([card]) => card);
const estimateRow = (file_id: string) => ({ file_id, created_at: "2026-10-22T00:01:00Z", panelId: "panel", panelVersion: "panel-v1",
  panelSites: 3110, coveredSites: 180, archaicSites: 73, estimate: 73 / 180, interval: { low: 0.333, high: 0.461 }, basis: "modelled" as const });
it("TEST-LOCAL: a historical unclassified record still renders its record context, and the Neanderthal card gets no estimate", async () => {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  const saved = { ...row(fileA), basis: undefined };
  mocks.own.mockResolvedValue({ rows: [saved], neanderthal: [], confirm: async () => [saved] });
  const html = renderToStaticMarkup(await Page(props));
  expect(html).toContain('data-slot="ancestry-unclassified-result"');
  expect(html).toContain("Its record does not say how they were made.");
  expect(AncestryRegions).not.toHaveBeenCalled();
  expect(AncestryAbsent).not.toHaveBeenCalled();
  expect(vi.mocked(InputProvenance).mock.calls[0][0]).toMatchObject({ sources: [{ fileId: fileA }] });
  expect(html).toContain("2026-08-28");
  expect(neanderthalProps()).toEqual([{ built: true, estimate: null, absence: "nothing-read", reportsHref: "/genome/me/reports" }]);
});
it("TEST-LOCAL: the card shows the estimate captured with the confirmed file, and nothing for a withdrawn or other file", async () => {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  const a = row(fileA);
  mocks.own.mockResolvedValue({ rows: [a], neanderthal: [estimateRow(fileA)], confirm: async () => [a] });
  renderToStaticMarkup(await Page(props));
  expect(neanderthalProps()).toEqual([{ built: true, absence: "nothing-read", reportsHref: "/genome/me/reports", estimate: {
    subjectId, share: 73 / 180, interval: { low: 0.333, high: 0.461 }, coveredSites: 180, panelSites: 3110, panelVersion: "panel-v1" } }]);
  // Withdrawn between the read and the final confirmation: no estimate either.
  vi.mocked(NeanderthalCard).mockClear();
  mocks.own.mockResolvedValue({ rows: [a], neanderthal: [estimateRow(fileA)], confirm: async () => [] });
  renderToStaticMarkup(await Page(props));
  expect(neanderthalProps()).toEqual([{ built: true, estimate: null, absence: "not-generated", reportsHref: "/genome/me/reports" }]);
  // An estimate captured with a file whose rows are not the ones shown is not shown.
  vi.mocked(NeanderthalCard).mockClear();
  mocks.own.mockResolvedValue({ rows: [a], neanderthal: [estimateRow(fileB)], confirm: async () => [a] });
  renderToStaticMarkup(await Page(props));
  expect(neanderthalProps()[0]).toMatchObject({ built: true, estimate: null });
});
it("production: the card is not built and receives no estimate, even when a revision-5 capture holds one", async () => {
  const a = row(fileA);
  mocks.own.mockResolvedValue({ rows: [a], neanderthal: [estimateRow(fileA)], confirm: async () => [a] });
  renderToStaticMarkup(await Page(props));
  expect(neanderthalProps()).toEqual([{ built: false, estimate: null, absence: "nothing-read", reportsHref: "/genome/me/reports" }]);
});
it("TEST-LOCAL: a Family record never reads or shows the estimate", async () => {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  mocks.resolve.mockResolvedValue({ ...context, person: { counterpartAccountId: "owner", displayLabel: "Relative" } });
  const b = row(fileB), source = { fileId: fileB, fileType: "vcf", processedAt: null, snapshot: null };
  mocks.shared.mockResolvedValue({ rows: [b], confirm: async () => ({ authorized: true, rows: [b], sources: [source], fileCount: 1,
    preparing: false, confirmationRequired: false, preparedUnavailable: false }) });
  renderToStaticMarkup(await Page(props));
  expect(mocks.own).not.toHaveBeenCalled();
  expect(neanderthalProps()).toEqual([{ built: true, estimate: null, absence: "nothing-read", reportsHref: "/genome/me/reports" }]);
});
/** The four ancestry panels' state in each no-result state, in both flag states. What each renders is in `page-panels.test.ts`. */
it.each([
  { flag: "", built: false }, { flag: "1", built: true },
])("every ancestry panel is given the same absence in each no-result state (flag $flag)", async ({ flag, built }) => {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", flag);
  mocks.own.mockResolvedValue({ rows: [], neanderthal: [], confirm: async () => [] });
  for (const [panel, absence] of [[{ kind: "hidden" }, "nothing-read"], [choicesPanel(false), "permission-off"], [choicesPanel(true), "not-generated"]] as const) {
    vi.mocked(AncestryAbsent).mockClear(); vi.mocked(LineageCard).mockClear(); vi.mocked(NeanderthalCard).mockClear();
    mocks.choices.mockResolvedValue(panel);
    renderToStaticMarkup(await Page(props));
    expect(vi.mocked(AncestryAbsent).mock.calls.map(([regions]) => regions.absence)).toEqual([absence]);
    expect(lineageProps().map(card => card.absence)).toEqual([absence, absence]);
    expect(neanderthalProps()).toEqual([{ built, estimate: null, absence, reportsHref: "/genome/me/reports" }]);
  }
});
