import { describe, expect, it } from "vitest";
import { resolveStoredSharedReport, selectSharedReport, sharedReportsForSlug, type StoredSharedReport } from "./shared-report-display";

function record(fileId = "first", completedAt = "2026-09-07T10:00:00.000Z"): StoredSharedReport {
  return { fileId, subjectId: "source-subject", completedAt, report: {
    slug: "synthetic-shared-trait", covered: true, conflictingRsids: [],
    variants: [{ rsid: 1, outcome: { status: "genotyped", genotype: "AC", interpretation: "Stored explanation.", strandFlipped: false } }],
    catalogSnapshot: { schemaVersion: 1, templateSha256: "a".repeat(64), template: {
      slug: "synthetic-shared-trait", category: "basic-traits", title: "Shared trait", summary: "Captured summary.",
      evidence: "preliminary", layer: "estimate", estimate_kind: "single_locus", pgs_id: null, citations: [],
      variants: [{ rsid: 1, chrom: 1, pos38: 100, gene: "SYNTHETIC", ref: "A", alt: "C", interpretations: { AC: "Stored explanation." } }],
    } },
  } };
}

describe("stored shared report display", () => {
  it("uses captured outcomes and template without a new interpretation", () => {
    const row = record();
    const result = resolveStoredSharedReport(row)!;
    expect(result.template).toBe(row.report.catalogSnapshot.template);
    expect(result.variants[0].outcome).toBe(row.report.variants[0].outcome);
  });
  it("refuses a result detached from its captured variant or explanation", () => {
    const wrongPosition = record(); wrongPosition.report.variants[0].rsid = 2;
    expect(resolveStoredSharedReport(wrongPosition)).toBeNull();
    const wrongText = record();
    if (wrongText.report.variants[0].outcome.status === "genotyped") wrongText.report.variants[0].outcome.interpretation = "Substituted explanation.";
    expect(resolveStoredSharedReport(wrongText)).toBeNull();
  });
  it("preserves a no-call instead of deriving a result from captured interpretations", () => {
    const row = record(); row.report.covered = false; row.report.variants[0].outcome = { status: "no-call" };
    expect(resolveStoredSharedReport(row)).toMatchObject({ covered: false, variants: [{ outcome: { status: "no-call" } }] });
  });
  it("keeps separate sources and their captured versions addressable", () => {
    const old = record(), next = record("second", "2026-09-07T11:00:00.000Z");
    next.report.catalogSnapshot.template.summary = "Later captured summary.";
    const rows = [old, next];
    expect(sharedReportsForSlug(rows, old.report.slug)).toEqual([next, old]);
    expect(rows).toEqual([old, next]);
    expect(selectSharedReport(rows, old.report.slug)).toBe(next);
    expect(selectSharedReport(rows, old.report.slug, old.fileId)).toBe(old);
    expect(selectSharedReport(rows, old.report.slug, "unshared-source")).toBeNull();
  });
  it("does not borrow another slug or reinterpret conflicts between saved sources", () => {
    const row = record(); row.report.conflictingRsids = [1];
    expect(selectSharedReport([row], "unshared-slug")).toBeNull();
    expect(selectSharedReport([row], row.report.slug)?.report.conflictingRsids).toEqual([1]);
  });
});
