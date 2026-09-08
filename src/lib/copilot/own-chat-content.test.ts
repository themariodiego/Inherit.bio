import { describe, expect, it } from "vitest";
import { ownGenotypeResult, capturedReportResult, capturedPrsResult, capturedChatCitations, ownChatReportSchema, type OwnChatCall, type OwnChatReport } from "./own-chat-content";
const file = "80000000-0000-4000-8000-000000000001";
const call: OwnChatCall = { file_id: file, rsid: 762551, chrom: 15, pos: 74749576, ref: "A", alt: "C", genotype: "A/C", usable: true };
const reference = { rsid: call.rsid, chrom: call.chrom, pos38: call.pos, ref: "A", alt: "C" };
const report: OwnChatReport = { file_id: file, purpose: "reports.polygenic", completed_at: "2026-09-07T10:00:00Z", report: { slug: "caffeine", covered: true, conflictingRsids: [], variants: [{ rsid: 762551, outcome: { status: "genotyped", genotype: "A/C", interpretation: "Captured outcome", strandFlipped: false } }] } };
describe("canonical Copilot content fidelity", () => {
    it("distinguishes VCF omission, explicit no-call, and actual reference observation", () => {
        expect(ownGenotypeResult(call.rsid, [], reference)).toMatchObject({ status: "not-covered", covered: false });
        expect(ownGenotypeResult(call.rsid, [{ ...call, genotype: "--", usable: false }], reference)).toMatchObject({ status: "no-call", covered: false });
        expect(ownGenotypeResult(call.rsid, [{ ...call, genotype: "A/A" }], reference)).toMatchObject({ status: "called", covered: true, genotype: "A/A" });
    });
    it("unions agreeing observations without choosing a newer file", () => {
        expect(ownGenotypeResult(call.rsid, [call, { ...call, file_id: "80000000-0000-4000-8000-000000000002", genotype: "C/A" }], reference)).toMatchObject({ status: "called", genotype: "A/C" });
    });
    it.each([
        { ...call, genotype: "C/C" }, { ...call, pos: call.pos + 1 }, { ...call, ref: "T" }, { ...call, alt: "G" }, { ...call, genotype: "invalid" },
    ])("withholds a conflicting genotype across sources", other => {
        const result = ownGenotypeResult(call.rsid, [call, other], reference);
        expect(result).toMatchObject({ status: "conflict", covered: false });
        expect(result).not.toHaveProperty("genotype");
    });
    it("never upgrades an unusable matching call into a confident call", () => {
        expect(ownGenotypeResult(call.rsid, [call, { ...call, usable: false }], reference)).toMatchObject({ status: "no-call", covered: false });
    });
    it("source-only returns no report, not a generated negative finding", () => {
        expect(capturedReportResult([], "caffeine")).toEqual({ error: "report_not_generated", note: "No completed report for this topic is currently available under your selected purposes." });
        expect(capturedReportResult([], "caffeine", "caffeine")).toEqual({ slug: "caffeine", error: "report_not_generated", note: "No completed report for this topic is currently available under your selected purposes." });
        expect(capturedReportResult([], "invented37.5percent", "caffeine")).not.toHaveProperty("slug");
        expect(capturedReportResult([], "auto-e2e-hidden", "auto-e2e-hidden")).not.toHaveProperty("slug");
    });
    it("retains captured all-conflict and ordinary uncovered outcomes without current metadata", () => {
        const rows = [{ ...report, report: { ...report.report, covered: false, conflictingRsids: [762551], variants: [{ rsid: 762551, outcome: { status: "not-covered" as const } }] } },
            { ...report, file_id: "80000000-0000-4000-8000-000000000002", report: { ...report.report, covered: false, variants: [{ rsid: 762551, outcome: { status: "no-call" as const } }] } }];
        const result = capturedReportResult(rows, "caffeine");
        expect(result).toMatchObject({ sources: [{ provenance_note: expect.stringContaining("did not capture"), covered: false, conflictingRsids: [762551], variants: [{ outcome: { status: "conflict" } }] }, { covered: false, variants: [{ outcome: { status: "no-call" } }] }] });
        expect(result).not.toHaveProperty("citations");
        expect(result).not.toHaveProperty("summary");
    });
    it("preserves the existing library fixture exclusion", () => {
        expect(capturedReportResult([{ ...report, report: { ...report.report, slug: "auto-e2e-hidden" } }], "auto-e2e-hidden")).toHaveProperty("error", "report_not_generated");
    });
    it("accepts only the captured report contract", () => {
        expect(ownChatReportSchema.safeParse(report).success).toBe(true);
        expect(ownChatReportSchema.safeParse({ ...report, report: { ...report.report, diagnosis: "invented" } }).success).toBe(false);
    });
    it("emits score-panel coverage without numeric personal scores or risk", () => {
        const result = capturedPrsResult([{ file_id: file, pgs_id: "PGS000001", matched: 4, computed_at: report.completed_at, n_variants: 8 }], "PGS000001");
        const serialized = JSON.stringify(result);
        expect(serialized).toContain('"matched":4');
        for (const key of ['"score":', '"percentile":', '"rank":', '"risk":'])
            expect(serialized).not.toContain(key);
    });
});
it("uses only the captured scientific template for a completed report", () => {
    const captured = { schemaVersion: 1 as const, templateSha256: "a".repeat(64), template: { slug: "caffeine", category: "lifestyle-wellness", title: "Captured caffeine report", summary: "Captured reference summary", evidence: "emerging" as const, variants: [], pgs_id: null, citations: [{ pmid: "12345678", label: "Synthetic captured reference" }], layer: "estimate" as const, estimate_kind: "polygenic_score" as const } };
    const row = { ...report, report: { ...report.report, catalogSnapshot: captured } };
    expect(ownChatReportSchema.safeParse(row).success).toBe(true);
    const result = capturedReportResult([row], "caffeine");
    expect(result).toMatchObject({ sources: [{ title: captured.template.title, summary: captured.template.summary, citations: captured.template.citations, catalogSnapshot: captured }] });
    expect(ownChatReportSchema.safeParse({ ...row, report: { ...row.report, slug: "another-topic" } }).success).toBe(false);
    expect(capturedChatCitations([result])).toContainEqual({ id: "pmid:12345678", label: "Synthetic captured reference", href: "https://pubmed.ncbi.nlm.nih.gov/12345678/" });
    expect(capturedChatCitations([{ citations: [{ url: "https://model-invented.invalid" }] }])).toEqual([]);
});
