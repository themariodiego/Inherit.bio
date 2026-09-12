import "server-only";
import { z } from "zod";
import type { Db } from "../genome/load";
import { filterOwnAnalysisFiles, loadOwnAnalysisCandidateFiles, type AnalysisFileBoundary } from "../genome/own-analysis-access";
import { currentOwnUploadAccount } from "../uploads/own-upload-context";
import { LINEAGE_NO_BRANCH, LINEAGE_NO_POSITIONS, LINEAGE_UNREADABLE } from "@/copy/ancestry";
import { ownAncestryContentSchema, type OwnAncestryContentV2 } from "../uploads/own-ancestry-content";

export interface AncestryResultRow {
  kind: "admixture" | "mtdna" | "ydna";
  result: unknown;
  support_note: string | null;
  file_id: string;
  model_id: string | null;
  model_version: string | null;
  created_at: string;
}
const captured = z.object({ content: ownAncestryContentSchema,
  completedAt: z.iso.datetime({ offset: true }),
}).strict();
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
type AncestryRpc = (name: "own_ancestry_content_v1", args: {
  p_account_id: string; p_session_id: string; p_file_id: string;
}) => PromiseLike<{ data: unknown; error: unknown }>;

/** The service-only reader checks the live source, grant and completed journal.
 * Return only display fields: hashes, authority revisions and raw calls never
 * become component props. A denied canonical source has no legacy fallback. */
async function readOwnCaptures(db: Db, subjectId: string,
  files: readonly AnalysisFileBoundary[]) {
  const modern = files.filter(file => file.single_logical_sample_verified_at != null);
  if (!modern.length) return { rows: [], confirm: async () => [] as AncestryResultRow[] };
  const actor = await currentOwnUploadAccount();
  if (!actor) return { rows: [], confirm: async () => [] as AncestryResultRow[] };
  const rpc = db.rpc.bind(db) as unknown as AncestryRpc;
  const rows: AncestryResultRow[] = [];
  const receipts = new Map<string, string>();
  for (const fileId of new Set(modern.map(file => file.id))) {
    try {
      const response = await rpc("own_ancestry_content_v1", {
        p_account_id: actor.accountId, p_session_id: actor.sessionId, p_file_id: fileId,
      });
      const parsed = captured.safeParse(response.data);
      if (response.error || !parsed.success || parsed.data.content.source.fileId !== fileId
        || parsed.data.content.source.subjectId !== subjectId) continue;
      const { content, completedAt } = parsed.data;
      receipts.set(fileId, JSON.stringify(parsed.data));
      rows.push({ kind: "admixture", result: content.admixture.result,
        support_note: content.admixture.support_note, file_id: fileId,
        model_id: content.admixture.model_id, model_version: content.admixture.model_version, created_at: completedAt });
      for (const lineage of content.schemaVersion === 2 ? content.lineages : [])
        rows.push({ ...computedLineageRow(lineage), file_id: fileId, created_at: completedAt });
      // Revision 1 captured no lineage at all and must not be dressed up as
      // one: it says so, in the same words it always has.
      for (const lineage of content.schemaVersion === 1 ? content.lineages : [])
        rows.push({ kind: lineage.kind, result: null, support_note: UNCOMPUTED_LINEAGE,
          file_id: fileId, model_id: null, model_version: null, created_at: completedAt });
    } catch { /* One unavailable source does not conceal independently valid results. */ }
  }
  return { rows, confirm: async (allowed?: ReadonlySet<string>) => {
    const current = new Set<string>();
    for (const [fileId, receipt] of receipts) {
      if (allowed && !allowed.has(fileId)) continue;
      try {
        const response = await rpc("own_ancestry_content_v1", {
          p_account_id: actor.accountId, p_session_id: actor.sessionId, p_file_id: fileId,
        });
        const parsed = captured.safeParse(response.data);
        if (!response.error && parsed.success && JSON.stringify(parsed.data) === receipt) current.add(fileId);
      } catch { /* Refusal or a different completion withholds this captured result. */ }
    }
    return rows.filter(row => current.has(row.file_id));
  } };
}

export async function loadOwnAncestryRows(db: Db, subjectId: string,
  files: readonly AnalysisFileBoundary[]): Promise<AncestryResultRow[]> {
  return (await readOwnCaptures(db, subjectId, files)).confirm();
}

/** Compose checked journal results with independently authorized legacy rows.
 * Preserve latest-completion order, including a newly analyzed older file. */
export async function loadAncestryResultSnapshot(db: Db, legacyReader: Db, subjectId: string) {
  const candidates = await loadOwnAnalysisCandidateFiles(db, subjectId);
  // `gateLegacy` since 2026-09-12 (D-097). Without it the legacy branch below
  // kept serving `public.ancestry_results` after the `ancestry` purpose was
  // revoked, because `filterOwnAnalysisFiles` returns legacy files untouched
  // whatever the purpose says. The canonical half has always refused; the
  // operator's answer to D-097 is that the legacy half must match it.
  const allowed = await filterOwnAnalysisFiles(db, subjectId, "ancestry", candidates, { gateLegacy: true });
  const legacyIds = allowed.filter(file => file.single_logical_sample_verified_at === null).map(file => file.id);
  const [canonical, legacy] = await Promise.all([
    readOwnCaptures(db, subjectId, allowed),
    legacyIds.length ? legacyReader.from("ancestry_results")
      .select("kind,result,support_note,file_id,model_id,model_version,created_at")
      .eq("subject_id", subjectId).in("file_id", legacyIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const historical = ((legacy.error ? [] : legacy.data ?? []) as AncestryResultRow[])
    .filter(row => legacyIds.includes(row.file_id));
  const rows = [...canonical.rows, ...historical]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || a.file_id.localeCompare(b.file_id));
  return { rows, confirm: async () => {
    // The recheck carries the same gate: a purpose revoked DURING the read must
    // withhold the legacy rows too, which is the whole point of rechecking.
    const current = new Set((await filterOwnAnalysisFiles(db, subjectId, "ancestry", allowed, { gateLegacy: true })).map(file => file.id));
    // A file ID surviving regrant is insufficient: require the same complete
    // captured content and completion time after all other result/source reads.
    const confirmed = new Set(await canonical.confirm(current));
    for (const row of historical) if (current.has(row.file_id)) confirmed.add(row);
    return rows.filter(row => confirmed.has(row));
  } };
}

export async function loadAncestryResults(db: Db, legacyReader: Db, subjectId: string): Promise<AncestryResultRow[]> {
  return (await loadAncestryResultSnapshot(db, legacyReader, subjectId)).confirm();
}
