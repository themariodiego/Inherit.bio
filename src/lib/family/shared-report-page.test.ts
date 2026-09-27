import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredSharedReport } from "./shared-report-display";
import neurodegenerative from "../../../data/templates/neurodegenerative.json";
import { reportCatalogTemplateSchema } from "../genome/report-catalog-snapshot";
import { ScientificCorrectionNotice } from "@/components/reports/scientific-correction-notice";
import { ReportLibrary, type LibraryGroup } from "@/components/reports/report-library";

const mocks = vi.hoisted(() => ({ context: vi.fn(), ownSnapshot: vi.fn(), snapshot: vi.fn(), confirm: vi.fn(),
  candidates: vi.fn(), calls: vi.fn(), inputs: vi.fn(), admin: vi.fn(), template: null as unknown, gate: vi.fn(), legacyCount: 0 }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); }, redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/lib/family/subject-route", () => ({ resolveSubjectRoute: mocks.context }));
vi.mock("@/lib/genome/own-stored-report", () => ({ loadOwnStoredReportSnapshot: mocks.ownSnapshot }));
vi.mock("@/lib/family/shared-report-results", () => ({ loadSharedReportSnapshot: mocks.snapshot }));
vi.mock("@/lib/family/access", () => ({ grantedLayers: () => ["variant_call", "estimate"], viewerMaySee: () => true,
  permits: () => true, personCapability: async () => ({}),
  LAYER_PURPOSES: { estimate: "reports.polygenic", variant_call: "reports.monogenic" } }));
vi.mock("@/lib/genome/own-analysis-access", () => ({ loadOwnAnalysisCandidateFiles: mocks.candidates,
  filterOwnAnalysisFiles: async (_db: unknown, _subject: unknown, _purpose: unknown, files: unknown[]) => files }));
vi.mock("@/lib/genome/report-calls", () => ({ getSubjectReportCalls: mocks.calls }));
vi.mock("@/lib/genome/input-sources", () => ({ loadInputSources: mocks.inputs }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/family/tier2", () => ({ acknowledged: mocks.gate }));
vi.mock("@/lib/family/graph", () => ({ resolveFamilyPerson: async () => ({ dataSubjectId: "source", counterpartAccountId: "owner", displayLabel: "Shared adult", handle: { id: "handle", routeSegment: "person" }, sharing: "active" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "viewer" } } }) } }) }));
// `hasFileInPreparation` is false throughout. These cases fix the file count
// at zero, so the page takes its no-file branch and never reaches the
// preparing sentence; the mock only has to exist for the read to resolve.
vi.mock("@/lib/genome/load", () => ({ getPublishedTemplates: async () => [mocks.template], getSubjectFileCount: async () => 0, hasFileInPreparation: async () => false }));
import ReportsPage from "@/app/(app)/genome/[subject]/reports/page";
import FamilyPersonPage from "@/app/(app)/family/[person]/page";
import ReportPage, { generateMetadata } from "@/app/(app)/genome/[subject]/reports/[slug]/page";

function saved(fileId = "first", completedAt = "2026-09-07T10:00:00Z"): StoredSharedReport {
  return { fileId, subjectId: "source", completedAt, report: { slug: "shared-trait", covered: true,
    conflictingRsids: [], variants: [{ rsid: 1, outcome: { status: "genotyped", genotype: "AC", interpretation: "Captured explanation.", strandFlipped: false } }],
    catalogSnapshot: { schemaVersion: 1, templateSha256: "a".repeat(64), template: {
      slug: "shared-trait", title: "Captured trait", summary: "Captured summary.", category: "basic-traits",
      evidence: "preliminary", layer: "estimate", estimate_kind: "single_locus", pgs_id: null, citations: [],
      variants: [{ rsid: 1, chrom: 1, pos38: 100, gene: "SYNTHETIC", ref: "A", alt: "C", interpretations: { AC: "Captured explanation." } }],
    } },
  } };
}
function props(query: Record<string, string | string[]> = {}) {
  return { params: Promise.resolve({ subject: "person", slug: "shared-trait" }), searchParams: Promise.resolve(query) };
}
function elements(node: ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Object.values(node.props).flatMap(value => elements(value as ReactNode))];
}
function renderedProps(node: ReactNode): string {
  // Inspect serializable element props without walking React module/type objects.
  return JSON.stringify(node, (_key, value) => isValidElement(value) ? value.props : value);
}
function capture(rows = [saved()]) {
  const state = { authorized: true, reports: rows, access: [{ purpose: "reports.polygenic", kind: "canonical" }],
    sources: rows.map(row => ({ fileId: row.fileId, fileType: "vcf", processedAt: row.completedAt })), unavailableReports: [] };
  mocks.snapshot.mockResolvedValue({ ...state, confirm: mocks.confirm });
  mocks.confirm.mockResolvedValue(state);
}
const oldTrem2Interpretation = "Two copies of R47H. This result is extremely rare and has been reported only a few times. An array call this rare is likely to be a test error. Confirm it with clinical-quality sequencing before trying to interpret it.";
function correctedReport(historical: boolean): StoredSharedReport {
  const template = reportCatalogTemplateSchema.parse({
    ...neurodegenerative.find(row => row.slug === "trem2-r47h-alzheimers"),
    layer: "estimate", estimate_kind: "single_locus",
  });
  if (historical) template.variants[0].interpretations.TT = oldTrem2Interpretation;
  const row = saved();
  row.report.slug = template.slug;
  row.report.catalogSnapshot.template = template;
  row.report.variants = [{ rsid: 75932628, outcome: { status: "genotyped", genotype: "TT",
    interpretation: template.variants[0].interpretations.TT, strandFlipped: false } }];
  return row;
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.gate.mockResolvedValue(true); mocks.legacyCount = 0;
  mocks.context.mockResolvedValue({ kind: "ok", user: { id: "viewer" },
    subject: { id: "handle", routeSegment: "person", displayLabel: "Shared adult" },
    dataSubjectId: "source", person: { counterpartAccountId: "owner" },
    domain: { label: "Family", href: "/family" }, displayLabel: "Shared adult" });
  mocks.candidates.mockResolvedValue([]);
  mocks.calls.mockResolvedValue({ genotypes: new Map([[1, "AC"]]), conflicts: new Set(), fileCount: 0, calls: [], checkedFileIds: [] });
  mocks.inputs.mockResolvedValue([]);
  mocks.template = saved().report.catalogSnapshot.template;
  mocks.admin.mockImplementation(() => ({ from: () => {
    const q = { select: () => q, eq: () => q, is: () => q,
      maybeSingle: async () => ({ data: mocks.template }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count: mocks.legacyCount }).then(resolve) };
    return q;
  } }));
  capture();
});
describe("Family saved report page boundaries", () => {
  it.each([false, true])("labels only exact superseded templates before reveal without serializing the selected result (historical=%s)", async historical => {
    const row = correctedReport(historical); capture([row]);
    const query = { params: Promise.resolve({ subject: "person", slug: row.report.slug }),
      searchParams: Promise.resolve({ source: row.fileId }) };
    const tree = await ReportPage(query), nodes = elements(tree);
    expect(nodes.some(node => node.type === ScientificCorrectionNotice)).toBe(historical);
    expect(nodes.some(node => node.props.outcome !== undefined)).toBe(false);
    expect(renderedProps(tree)).not.toContain(row.report.variants[0].outcome.status === "genotyped"
      ? row.report.variants[0].outcome.interpretation : "unexpected outcome");
    expect(nodes.some(node => typeof node.props.revealHref === "string" && node.props.revealHref.includes("source=first"))).toBe(true);
    expect(mocks.calls).not.toHaveBeenCalled(); expect(mocks.confirm).toHaveBeenCalledOnce();
  });
  it("keeps the old captured outcome and source unchanged after reveal, alongside the correction notice", async () => {
    const row = correctedReport(true), original = structuredClone(row); capture([row]);
    const tree = await ReportPage({ params: Promise.resolve({ subject: "person", slug: row.report.slug }),
      searchParams: Promise.resolve({ source: row.fileId, reveal: "1" }) });
    const nodes = elements(tree);
    expect(nodes.some(node => node.type === ScientificCorrectionNotice)).toBe(true);
    expect(nodes.find(node => node.props.outcome)?.props.outcome).toEqual(original.report.variants[0].outcome);
    expect(visibleText(tree)).toContain("2026-09-07");
    expect(row).toEqual(original);
    expect(mocks.calls).not.toHaveBeenCalled(); expect(mocks.inputs).not.toHaveBeenCalled();
  });
  it("reaches Tier-2 before reading any shared result or database", async () => {
    mocks.context.mockResolvedValue({ kind: "gate", personSegment: "person" });
    await expect(ReportPage(props())).rejects.toThrow("redirect");
    expect(mocks.snapshot).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("shows the selected older snapshot without reading or interpreting live genotypes", async () => {
    const old = saved(), recent = saved("second", "2026-09-07T11:00:00Z");
    recent.report.catalogSnapshot.template.summary = "Newer summary."; capture([recent, old]);
    const tree = await ReportPage(props({ source: "first" }));
    const nodes = elements(tree);
    expect(nodes.some(node => node.props.text === "Captured summary.")).toBe(true);
    expect(nodes.some(node => node.props.text === "Newer summary.")).toBe(false);
    expect(nodes.some(node => (node.props.outcome as { interpretation?: string })?.interpretation === "Captured explanation.")).toBe(true);
    expect(nodes.some(node => node.type === ScientificCorrectionNotice)).toBe(false);
    expect(mocks.calls).not.toHaveBeenCalled(); expect(mocks.inputs).not.toHaveBeenCalled();
    expect(mocks.confirm).toHaveBeenCalledOnce();
  });
  it.each(["unknown", "", ["first", "second"]])("rejects explicit invalid source %j without substitution", async source => {
    await expect(ReportPage(props({ source }))).rejects.toThrow("404");
    expect(await generateMetadata(props({ source }))).toEqual({ title: "Report" });
    expect(mocks.calls).not.toHaveBeenCalled();
  });
  it("keeps an independently available legacy view selectable alongside saved results", async () => {
    mocks.candidates.mockResolvedValue([{ id: "legacy-file", file_type: "vcf", status: "annotated", single_logical_sample_verified_at: null }]);
    const current = elements(await ReportPage(props()));
    expect(current.some(node => node.props.href === "/genome/person/reports/shared-trait?source=legacy")).toBe(true);
    await ReportPage(props({ source: "legacy" }));
    expect(mocks.calls).toHaveBeenCalledOnce();
    expect(mocks.candidates).toHaveBeenCalledWith(expect.anything(), "source", { legacyOnly: true });
  });
  it("cannot select the legacy view when no legacy source exists", async () => {
    await expect(ReportPage(props({ source: "legacy" }))).rejects.toThrow("404");
    expect(mocks.calls).not.toHaveBeenCalled();
  });
  it("withholds both page and personal metadata when final confirmation denies access", async () => {
    mocks.confirm.mockResolvedValue({ authorized: false });
    await expect(ReportPage(props())).rejects.toThrow("404");
    expect(await generateMetadata(props())).toEqual({ title: "Report" });
  });
  it("withholds result props behind the sensitive gate and preserves the selected source on reveal", async () => {
    const row = saved(); row.report.catalogSnapshot.template.category = "cancer-risk"; capture([row]);
    const nodes = elements(await ReportPage(props({ source: "first" })));
    expect(nodes.some(node => node.props.outcome !== undefined)).toBe(false);
    expect(nodes.some(node => typeof node.props.revealHref === "string" && node.props.revealHref.includes("source=first"))).toBe(true);
    expect(mocks.calls).not.toHaveBeenCalled();
  });
});

function visibleText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join(" ");
  return isValidElement<{ children?: ReactNode }>(node) ? visibleText(node.props.children) : "";
}
const personProps = () => ({ params: Promise.resolve({ person: "person" }), searchParams: Promise.resolve({}) });
describe("Family person completion states", () => {
  it("reads no result content before acknowledgement", async () => {
    mocks.gate.mockResolvedValue(false);
    await FamilyPersonPage(personProps());
    expect(mocks.snapshot).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("does not describe a canonical grant awaiting completion as a missing upload", async () => {
    capture([]);
    const tree = await FamilyPersonPage(personProps());
    expect(visibleText(tree)).toContain("No completed result is shared yet.");
    expect(visibleText(tree)).not.toContain("has not added a file");
  });
  it("does not use a completed estimate to describe the other unfinished layer as uncovered", async () => {
    const row = { ...saved(), purpose: "reports.polygenic" }; capture([row]);
    const tree = await FamilyPersonPage(personProps());
    const variantSection = elements(tree).find(node => node.props["data-layer"] === "variant_call");
    expect(visibleText(variantSection)).toContain("No completed result is shared for this result type yet.");
    expect(visibleText(variantSection)).not.toContain("None");
  });
  it("withholds captured result links after final withdrawal", async () => {
    mocks.confirm.mockResolvedValue({ authorized: false });
    await expect(FamilyPersonPage(personProps())).rejects.toThrow("404");
  });
});

describe("Family report library completion states", () => {
  const libraryProps = () => ({ params: Promise.resolve({ subject: "person" }), searchParams: Promise.resolve({}) });
  it.each([false, true])("passes only a public correction flag with the exact captured card (historical=%s)", async historical => {
    const row = correctedReport(historical), original = structuredClone(row); capture([row]);
    mocks.template = correctedReport(false).report.catalogSnapshot.template;
    const nodes = elements(await ReportsPage(libraryProps()));
    const groups = nodes.find(node => node.type === ReportLibrary)?.props.groups as LibraryGroup[];
    const card = groups.flatMap(group => group.cards).find(card => card.slug === row.report.slug);
    expect(card).toMatchObject({ title: original.report.catalogSnapshot.template.title,
      summary: original.report.catalogSnapshot.template.summary, scientificCorrection: historical });
    expect(JSON.stringify(card)).not.toContain(oldTrem2Interpretation);
    expect(card).not.toHaveProperty("variants"); expect(card).not.toHaveProperty("corrections");
    expect(row).toEqual(original); expect(mocks.confirm).toHaveBeenCalledOnce();
  });
  it("offers awaiting-result copy rather than an upload prompt for canonical sharing", async () => {
    capture([]);
    const tree = await ReportsPage(libraryProps());
    expect(visibleText(tree)).toContain("No completed result is shared yet.");
    expect(visibleText(tree)).not.toContain("Add a file");
  });
  it("rejects a captured library when the final authority check fails", async () => {
    mocks.confirm.mockResolvedValue({ authorized: false });
    await expect(ReportsPage(libraryProps())).rejects.toThrow("404");
  });
});


describe("Own exact-source report detail", () => {
  const ownProps = (source?: string | string[]) => ({ params: Promise.resolve({ subject: "me", slug: "shared-trait" }),
    searchParams: Promise.resolve(source === undefined ? {} : { source }) });
  function ownCapture(savedRow = saved("79410000-0000-4000-8000-000000000004")) {
    const row = { ...savedRow, purpose: "reports.polygenic" };
    const state = { authorized: true, reports: [row], access: [{ purpose: "reports.polygenic", kind: "canonical" }],
      sources: [{ fileId: row.fileId, fileType: "vcf", processedAt: row.completedAt }], unavailableReports: [] };
    mocks.context.mockResolvedValue({ kind: "ok", user: { id: "owner" }, subject: { id: "source", routeSegment: "me", displayLabel: "My genome" },
      dataSubjectId: "source", person: null, domain: { label: "My Genome", href: "/genome/me" }, displayLabel: "My genome" });
    mocks.ownSnapshot.mockResolvedValue({ ...state, confirm: mocks.confirm }); mocks.confirm.mockResolvedValue(state);
    return row;
  }
  it.each([false, true])("keeps own saved corrections behind the same result boundary (reveal=%s)", async reveal => {
    const historical = correctedReport(true); historical.fileId = "79410000-0000-4000-8000-000000000004";
    const row = ownCapture(historical), original = structuredClone(row);
    const tree = await ReportPage({ params: Promise.resolve({ subject: "me", slug: row.report.slug }),
      searchParams: Promise.resolve({ source: row.fileId, ...(reveal ? { reveal: "1" } : {}) }) });
    const nodes = elements(tree);
    expect(nodes.some(node => node.type === ScientificCorrectionNotice)).toBe(true);
    expect(nodes.some(node => node.props.outcome !== undefined)).toBe(reveal);
    if (reveal) expect(nodes.find(node => node.props.outcome)?.props.outcome).toEqual(original.report.variants[0].outcome);
    else expect(renderedProps(tree)).not.toContain(oldTrem2Interpretation);
    expect(row).toEqual(original); expect(mocks.calls).not.toHaveBeenCalled();
    expect(mocks.ownSnapshot).toHaveBeenCalledExactlyOnceWith(expect.anything(),
      { subjectId: "source", fileId: row.fileId, slug: row.report.slug });
    expect(mocks.confirm).toHaveBeenCalledOnce();
  });
  it("renders exact captured own source and catalog, never current-template or genotype recomputation", async () => {
    const row = ownCapture(); mocks.template = { ...row.report.catalogSnapshot.template, summary: "Changed current science" };
    const tree = await ReportPage(ownProps(row.fileId));
    expect(elements(tree).some(n => n.props.text === "Captured summary.")).toBe(true);
    expect(elements(tree).some(n => n.props.text === "Changed current science")).toBe(false);
    expect(mocks.ownSnapshot).toHaveBeenCalledExactlyOnceWith(expect.anything(), { subjectId: "source", fileId: row.fileId, slug: "shared-trait" });
    expect(mocks.snapshot).not.toHaveBeenCalled(); expect(mocks.calls).not.toHaveBeenCalled(); expect(mocks.inputs).not.toHaveBeenCalled();
    expect(mocks.candidates).not.toHaveBeenCalled();
  });
  it("keeps an unrecognized saved observation recorded without inventing interpretation", async () => {
    const row = ownCapture(); row.report.variants[0].outcome = { status: "unrecognized", genotype: "TT" };
    const tree = await ReportPage(ownProps(row.fileId));
    expect(elements(tree).some(n => n.props.state === "recorded")).toBe(true);
    expect(elements(tree).some(n => n.props.text === "Captured explanation.")).toBe(false);
  });
  it("withholds missing explicit own source without current-template fallback", async () => {
    ownCapture(); mocks.ownSnapshot.mockResolvedValue({ authorized: false, reports: [] });
    await expect(ReportPage(ownProps("79410000-0000-4000-8000-000000000099"))).rejects.toThrow("404");
    expect(mocks.calls).not.toHaveBeenCalled(); expect(mocks.candidates).not.toHaveBeenCalled();
  });
  it("rejects duplicate source query parameters before own result loading", async () => {
    ownCapture(); await expect(ReportPage(ownProps(["first", "second"]))).rejects.toThrow("404");
    expect(mocks.ownSnapshot).not.toHaveBeenCalled();
  });
  it("checks exact authority at the final render and metadata boundary", async () => {
    const row = ownCapture(); mocks.confirm.mockResolvedValue({ authorized: false });
    await expect(ReportPage(ownProps(row.fileId))).rejects.toThrow("404");
    expect(await generateMetadata(ownProps(row.fileId))).toEqual({ title: "Report" });
  });
  it("keeps no-query own compatibility on its existing loader", async () => {
    ownCapture(); await ReportPage(ownProps()); expect(mocks.ownSnapshot).not.toHaveBeenCalled();
    expect(mocks.candidates).toHaveBeenCalled();
  });
});
