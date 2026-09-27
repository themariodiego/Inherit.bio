import { z } from "zod";
import { capturedAncestryRows } from "@/lib/ancestry/captured-rows";
import { presentShares } from "@/lib/ancestry/present";
import { presentRegionalShares } from "@/lib/ancestry/regional-present";
import { regionsView, type RegionRowView } from "@/lib/ancestry/view";
import { ownAncestryCapturedContentSchema } from "@/lib/uploads/own-ancestry-captured-content";

/** Outside the published template slug grammar; collisions still fail closed. */
export const OWN_ANCESTRY_REPORT = "inherit:ancestry";
export const OWN_ANCESTRY_TITLE = "Your captured ancestry result";
export const OWN_ANCESTRY_HREF = "/genome/me/ancestry";
export const ownChatAncestryReceiptSchema = z.object({
  fileId: z.uuid(), runId: z.uuid(), resultHash: z.string().regex(/^[0-9a-f]{64}$/),
  completedAt: z.iso.datetime({ offset: true }), content: ownAncestryCapturedContentSchema,
}).strict();
export type OwnChatAncestryReceipt = z.infer<typeof ownChatAncestryReceiptSchema>;
export const ownChatAncestrySnapshotSchema = ownChatAncestryReceiptSchema.omit({ content: true });

function displayedRegion(row: RegionRowView) {
  return { code: row.code, name: row.name, percent: Math.round(row.share * 1000) / 10,
    range: "unavailable" in row.range ? { unavailable: true } : {
      lowPercent: row.range.low * 100, highPercent: row.range.high * 100,
    }, band: row.band, shownByDefault: row.wellSupported };
}

/** The page's display arithmetic, applied only to its captured result. No fit runs here. */
export function capturedAncestryResult(receipt: OwnChatAncestryReceipt) {
  const { content, ...ancestrySnapshot } = receipt;
  const available = content.admixture.result_state === "available";
  const presentation = !available ? { rows: [], split: [] }
    : content.schemaVersion === 3 ? presentRegionalShares(content.admixture.result)
    : { rows: regionsView(presentShares(content.admixture.result, { ranges: content.admixture.result.ranges })).rows, split: [] };
  return {
    file_id: receipt.fileId, purpose: "ancestry" as const, completed_at: receipt.completedAt,
    title: OWN_ANCESTRY_TITLE, status: content.admixture.result_state,
    basis: content.admixture.basis, resolution: content.admixture.resolution,
    markersRead: content.admixture.result.markersUsed, markersRequired: content.panel.minimumMarkers,
    regions: presentation.rows.map(displayedRegion), split: presentation.split.map(displayedRegion),
    note: content.admixture.support_note,
    ...(content.schemaVersion === 3 ? { reportingCaveat: content.admixture.result.reporting.caveat,
      merged: content.admixture.result.reporting.merged } : {}),
    ...(!available ? { limitation: "Too few usable markers were read for a supported regional result. Missing coverage is not a result about your ancestry." } : {}),
    lineages: capturedAncestryRows(content, receipt.completedAt).filter(row => row.kind !== "admixture")
      .map(row => ({ kind: row.kind, result: row.result, note: row.support_note })),
    ancestrySnapshot,
    citations: [{ label: OWN_ANCESTRY_TITLE, url: OWN_ANCESTRY_HREF }],
  };
}

export function capturedAncestryCitation(receipt: z.infer<typeof ownChatAncestrySnapshotSchema>) {
  return { id: `ancestry:${receipt.fileId}:${receipt.runId}:${receipt.resultHash}`,
    label: OWN_ANCESTRY_TITLE, href: OWN_ANCESTRY_HREF };
}
