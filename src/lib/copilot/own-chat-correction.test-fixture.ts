import corrections from "../../../data/report-scientific-corrections.json";
import type { OwnChatProjection, OwnChatReport } from "./own-chat-content";

export const correctionFileId = "80000000-0000-4000-8000-000000000005";
export const correctionProjection: OwnChatProjection = { sources: [{ id: correctionFileId, revision: 1,
  sha256: "a".repeat(64), decodedSha256: "b".repeat(64), objectId: "80000000-0000-4000-8000-000000000006",
  normalizedAt: "2026-09-15T10:00:00Z", build: "GRCh38", completed: [{ purpose: "reports.polygenic", authority: {},
    runId: "80000000-0000-4000-8000-000000000007", completedAt: "2026-09-15T10:01:00Z", resultHash: "c".repeat(64) }] }],
legacySources: [], unavailableSources: [] };
export const correctionBatches = corrections.map(batch => batch.slug);
export function correctionReport(slug = "apoe-e4-alzheimers-risk", field: "summary" | "unused-interpretation" | "outcome" = "summary"): OwnChatReport {
  const batch = corrections.find(item => item.slug === slug)!;
  const entry = batch.fields.find(item => item.field === (field === "summary" ? "summary" : "interpretation"))!;
  const row: OwnChatReport = { file_id: correctionFileId, purpose: "reports.polygenic", completed_at: "2026-09-15T10:01:00Z",
    report: { slug, covered: false, conflictingRsids: [], variants: [], catalogSnapshot: {
      schemaVersion: 1, templateSha256: "d".repeat(64), template: { slug, category: "neurodegenerative", title: "Synthetic captured title",
        summary: field === "summary" ? entry.oldText : "Unrelated captured summary", evidence: "emerging", variants: [],
        pgs_id: null, citations: [], layer: "estimate", estimate_kind: "single_locus" },
    } } };
  if (field === "unused-interpretation") row.report.catalogSnapshot!.template.variants = [{
    rsid: entry.rsid!, gene: "APOE", chrom: 19, pos38: 44908684, ref: "T", alt: "C", interpretations: { [entry.genotype!]: entry.oldText },
  }];
  if (field === "outcome") {
    delete row.report.catalogSnapshot;
    row.report.covered = true;
    row.report.variants = [{ rsid: entry.rsid!, outcome: { status: "genotyped", genotype: entry.genotype!,
      interpretation: entry.oldText, strandFlipped: false } }];
  }
  return row;
}
