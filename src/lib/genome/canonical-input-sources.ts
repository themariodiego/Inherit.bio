import "server-only";
import { z } from "zod";
import { currentOwnUploadAccount } from "@/lib/uploads/own-upload-context";
import type { Db } from "./load";
import type { InputSourceView } from "./input-sources";

export type InputSourceContext = { kind: "prepared" } | {
  kind: "report"; purpose: "reports.monogenic" | "reports.polygenic" | "ancestry";
};

const count = z.number().int().nonnegative().safe();
const sourceView = z.object({
  fileId: z.uuid(),
  fileType: z.enum(["array_23andme", "array_ancestry", "array_myheritage", "array_ftdna", "vcf", "gvcf"]),
  processedAt: z.iso.datetime({ offset: true }),
  snapshot: z.object({
    sourceBuild: z.enum(["GRCh37", "GRCh38"]),
    buildBasis: z.enum(["source-declared", "format-assumption"]), targetBuild: z.literal("GRCh38"),
    variantRowsMapped: count, variantRowsUnmapped: count,
    counts: z.object({ called: count, noCall: count, unsupported: count, failedFilter: count, blocks: count,
      singleSample: z.boolean(), buildClaim: z.boolean(),
    }).strict().refine(value => Number.isSafeInteger(value.called + value.noCall)),
  }).strict(),
}).strict();

/** Only the RPC can read the private journal; its DTO contains display facts.
 * Every caller explicitly chooses stored-source or exact report-purpose access.
 * Missing authority never falls back to a legacy snapshot for a modern source.
 */
export async function loadCanonicalInputSources(db: Db, subjectId: string, fileIds: readonly string[],
  context: InputSourceContext): Promise<InputSourceView[]> {
  if (!fileIds.length) return [];
  try {
    const actor = await currentOwnUploadAccount();
    if (!actor) return [];
    const sources: InputSourceView[] = [];
    for (let offset = 0; offset < fileIds.length; offset += 100) {
      const selected = fileIds.slice(offset, offset + 100);
      const { data, error } = await db.rpc("read_own_input_sources_v1", {
        p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: subjectId,
        p_file_ids: selected, p_purpose: context.kind === "report" ? context.purpose : null,
      });
      const parsed = z.array(sourceView).max(selected.length).safeParse(data);
      if (error || !parsed.success || new Set(parsed.data.map(source => source.fileId)).size !== parsed.data.length
        || parsed.data.some(source => !selected.includes(source.fileId))) continue;
      sources.push(...parsed.data);
    }
    return sources;
  } catch { return []; }
}
