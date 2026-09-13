import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadOwnOverviewReports } from "./own-report-summary";
import type { Db } from "@/lib/genome/load";
import type { ReportTemplate } from "@/lib/genome/reports";

const mocks = vi.hoisted(() => ({ files: vi.fn(), templates: vi.fn(), allow: vi.fn(), calls: vi.fn() }));
vi.mock("@/lib/genome/own-analysis-access", () => ({
  loadOwnAnalysisCandidateFiles: mocks.files, filterOwnAnalysisFiles: mocks.allow,
}));
vi.mock("@/lib/genome/load", () => ({ getPublishedTemplates: mocks.templates }));
vi.mock("@/lib/genome/report-calls", () => ({ getSubjectReportCalls: mocks.calls }));
const file = { id: "file", status: "stored", single_logical_sample_verified_at: "2026-09-06T12:00:00Z" };
const trait = {
  slug: "starter-fixture", title: "Everyday trait", summary: "Public description", category: "basic-traits",
  evidence: "established", layer: "estimate", estimate_kind: "single_locus", pgs_id: null, citations: [],
  variants: [{ rsid: 123, chrom: 1, pos38: 100, ref: "A", alt: "G", gene: "GENE", interpretations: { AG: "Public interpretation" } }],
} as ReportTemplate;
const medicine = { ...trait, slug: "medicine-fixture", title: "Medicine letters", category: "pharmacogenomics", layer: "variant_call" } as ReportTemplate;
const db = {} as Db;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.mockResolvedValue([file]);
  mocks.templates.mockResolvedValue([trait, medicine]);
  mocks.allow.mockResolvedValue([]);
  mocks.calls.mockResolvedValue({ genotypes: new Map([[123, "A/G"]]), conflicts: new Set(), fileCount: 1, checkedFileIds: ["file"], calls: [] });
});
describe("Overview chosen-result summary", () => {
  it("keeps prepared but ungenerated files separate from result readiness", async () => {
    const summary = await loadOwnOverviewReports(db, "subject");
    expect(summary).toMatchObject({ hasPreparedSource: true, hasReports: false, showStarter: false, starter: [] });
    expect(mocks.calls).not.toHaveBeenCalled();
    expect(mocks.allow.mock.calls.map(call => call[2])).toEqual(["reports.polygenic", "reports.monogenic"]);
    // The completed-result default is never overridden to false, and since
    // D-099 every own-record call gates the legacy half on the live grant.
    expect(mocks.allow.mock.calls.map(call => call[4])).toEqual([{ gateLegacy: true }, { gateLegacy: true }]);
  });
  it("populates only selected generated estimate inputs and its existing catalog count", async () => {
    mocks.allow.mockImplementation(async (_db, _subject, purpose, files) => purpose === "reports.polygenic" ? files : []);
    const summary = await loadOwnOverviewReports(db, "subject");
    expect(summary).toMatchObject({ hasReports: true, estimateCount: 1, variantCallCount: 0, showStarter: true });
    expect(summary.starter.map(template => template.slug)).toEqual([trait.slug]);
    expect(mocks.calls).toHaveBeenCalledOnce();
    expect(mocks.calls).toHaveBeenCalledWith(db, "subject", [trait], { gateLegacy: true });
    expect(JSON.stringify(summary)).not.toContain("A/G");
    expect(Object.keys(summary).sort()).toEqual(["estimateCount", "hasPreparedSource", "hasReports", "showStarter", "starter", "variantCallCount"]);
  });
  it("does not claim absent trait results or absent file coverage for Medicines-only selection", async () => {
    mocks.allow.mockImplementation(async (_db, _subject, purpose, files) => purpose === "reports.monogenic" ? files : []);
    expect(await loadOwnOverviewReports(db, "subject")).toMatchObject({ hasReports: true, estimateCount: 0, variantCallCount: 1, showStarter: false, starter: [] });
    expect(mocks.calls).not.toHaveBeenCalled();
  });
  it("removes personalized starters after withdrawal without claiming the source vanished", async () => {
    mocks.allow.mockImplementation(async (_db, _subject, purpose, files) => purpose === "reports.polygenic" ? files : []);
    expect((await loadOwnOverviewReports(db, "subject")).starter).toHaveLength(1);
    mocks.allow.mockResolvedValue([]);
    expect(await loadOwnOverviewReports(db, "subject")).toMatchObject({ hasReports: false, hasPreparedSource: true, starter: [] });
  });
  it("discards inputs if authorization ends during the read", async () => {
    let checks = 0;
    mocks.allow.mockImplementation(async (_db, _subject, purpose, files) => purpose === "reports.polygenic" && ++checks === 1 ? files : []);
    expect(await loadOwnOverviewReports(db, "subject")).toMatchObject({ hasReports: false, showStarter: false, starter: [] });
  });
  it.each([new Map(), new Map([[123, "--"]])])("does not pad starters with conflicts or no-calls", async genotypes => {
    mocks.allow.mockImplementation(async (_db, _subject, purpose, files) => purpose === "reports.polygenic" ? files : []);
    mocks.calls.mockResolvedValue({ genotypes, conflicts: new Set([123]), fileCount: 1, checkedFileIds: ["file"], calls: [] });
    expect(await loadOwnOverviewReports(db, "subject")).toMatchObject({ hasReports: true, showStarter: true, starter: [] });
  });
  it("keeps independently authorized legacy inputs when a new source is denied", async () => {
    const legacy = { id: "legacy", status: "annotated", single_logical_sample_verified_at: null };
    mocks.files.mockResolvedValue([file, legacy]);
    mocks.allow.mockResolvedValue([legacy]);
    mocks.calls.mockResolvedValue({ genotypes: new Map([[123, "A/G"]]), conflicts: new Set(), fileCount: 1, checkedFileIds: ["legacy"], calls: [] });
    expect((await loadOwnOverviewReports(db, "subject")).starter).toHaveLength(1);
  });
  it("withholds stale-source starter inputs absent from the final exact allowlist", async () => {
    mocks.allow.mockResolvedValue([file]);
    mocks.calls.mockResolvedValue({ genotypes: new Map([[123, "A/G"]]), conflicts: new Set(), fileCount: 1, checkedFileIds: ["different-source"], calls: [] });
    expect(await loadOwnOverviewReports(db, "subject")).toMatchObject({ hasReports: true, showStarter: false, starter: [] });
  });
});
