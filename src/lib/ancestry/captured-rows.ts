import type { OwnAncestryContentV2 } from "../uploads/own-ancestry-content";
import type { OwnAncestryCapturedContent } from "../uploads/own-ancestry-captured-content";
import { LINEAGE_NO_BRANCH, LINEAGE_NO_POSITIONS, LINEAGE_UNREADABLE } from "@/copy/ancestry";

export interface AncestryResultRow {
  kind: "admixture" | "mtdna" | "ydna";
  result: unknown;
  support_note: string | null;
  file_id: string;
  model_id: string | null;
  model_version: string | null;
  created_at: string;
}
export const UNCOMPUTED_LINEAGE = "Lineage has not been computed from this file.";

/**
 * One captured revision-2 lineage, as the card wants it.
 *
 * A read line becomes the stored `HaplogroupCall` the card already renders.
 * An unread one becomes `{ haplogroup: null }` — the same shape the legacy
 * process route writes — so the card's existing no-call branch, its Y lead and
 * its XX gloss all keep working rather than being reimplemented beside them.
 *
 * The tree is named in both states, because it is what was consulted either
 * way, and a reader deserves to know which tree failed to match as much as
 * which one matched.
 */
function computedLineageRow(lineage: OwnAncestryContentV2["lineages"][number]) {
  const parent = lineage.kind === "mtdna" ? "mother" : "father";
  const model = { model_id: lineage.tree.id, model_version: lineage.tree.version };
  if (lineage.state === "available" && lineage.call !== null) {
    return { kind: lineage.kind, result: lineage.call, support_note: lineage.call.note, ...model };
  }
  const support_note = lineage.reason === "no_supplied_positions" ? LINEAGE_NO_POSITIONS[parent]
    : lineage.reason === "no_readable_genotypes" ? LINEAGE_UNREADABLE : LINEAGE_NO_BRANCH;
  return { kind: lineage.kind, result: { haplogroup: null }, support_note, ...model };
}

/** Display projection only. Callers separately own all read and confirmation authority. */
export function capturedAncestryRows(content: OwnAncestryCapturedContent, completedAt: string): AncestryResultRow[] {
  const fileId = content.source.fileId;
  const rows: AncestryResultRow[] = [];
      rows.push({ kind: "admixture", result: content.admixture.result,
        support_note: content.admixture.support_note, file_id: fileId,
        model_id: content.admixture.model_id, model_version: content.admixture.model_version, created_at: completedAt });
      for (const lineage of content.schemaVersion !== 1 ? content.lineages : [])
        rows.push({ ...computedLineageRow(lineage), file_id: fileId, created_at: completedAt });
      // Revision 1 captured no lineage at all and must not be dressed up as
      // one: it says so, in the same words it always has.
      for (const lineage of content.schemaVersion === 1 ? content.lineages : [])
        rows.push({ kind: lineage.kind, result: null, support_note: UNCOMPUTED_LINEAGE,
          file_id: fileId, model_id: null, model_version: null, created_at: completedAt });
  return rows;
}
