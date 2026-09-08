import "server-only";
import { z } from "zod";
import { currentOwnUploadAccount } from "@/lib/uploads/own-upload-context";
import { loadOwnAnalysisCandidateFiles } from "./own-analysis-access";
import type { Db } from "./load";

/** Source pages only. Preparation/store permission is not permission for any analytic result. */
export async function getPreparedSourceFiles(db: Db, subjectId: string) {
  const files = await loadOwnAnalysisCandidateFiles(db, subjectId);
  const legacy = files.filter(f => f.single_logical_sample_verified_at === null && f.status === "annotated");
  const modern = files.filter(f => f.single_logical_sample_verified_at != null);
  if (!modern.length) return legacy;
  const actor = await currentOwnUploadAccount();
  if (!actor) return legacy;
  const allowed = new Set(legacy.map(f => f.id));
  for (let offset = 0; offset < modern.length; offset += 100) {
    const ids = modern.slice(offset, offset + 100).map(f => f.id);
    const { data, error } = await db.rpc("filter_own_prepared_sources_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: subjectId, p_file_ids: ids,
    });
    const parsed = z.array(z.uuid()).max(ids.length).safeParse(data);
    if (error || !parsed.success || new Set(parsed.data).size !== parsed.data.length
      || parsed.data.some(id => !ids.includes(id))) return legacy;
    for (const id of parsed.data) allowed.add(id);
  }
  return files.filter(f => allowed.has(f.id));
}

/** Raw observed letters for the source browser, never a report/estimate/Copilot loader. */
export async function getPreparedSourceGenotypes(db: Db, subjectId: string, rsids: readonly number[]) {
  const files = await getPreparedSourceFiles(db, subjectId);
  const calls: { rsid: number | null; genotype: string; file_id: string }[] = [];
  for (let offset = 0; offset < rsids.length && files.length; offset += 200) {
    for (let fileOffset = 0; fileOffset < files.length; fileOffset += 100) {
      for (let rowOffset = 0; ; rowOffset += 1000) {
        const { data, error } = await db.from("user_variants").select("rsid,genotype,file_id")
          .eq("subject_id", subjectId).in("file_id", files.slice(fileOffset, fileOffset + 100).map(f => f.id))
          .in("rsid", [...rsids.slice(offset, offset + 200)]).order("id").range(rowOffset, rowOffset + 999);
        if (error) return { genotypes: new Map<number, string>(), conflicts: new Set<number>(), inputFileIds: [], checkedFileIds: [] };
        calls.push(...(data ?? []));
        if ((data?.length ?? 0) < 1000) break;
      }
    }
  }
  const stillAllowed = new Set((await getPreparedSourceFiles(db, subjectId)).map(f => f.id));
  const checkedFileIds = files.filter(f => stillAllowed.has(f.id)).map(f => f.id);
  const checked = new Set(checkedFileIds);
  const genotypes = new Map<number, string>();
  const conflicts = new Set<number>();
  const inputFileIds = new Set<string>();
  for (const call of calls) {
    if (!checked.has(call.file_id) || call.rsid === null || !rsids.includes(call.rsid)) continue;
    inputFileIds.add(call.file_id);
    if (conflicts.has(call.rsid)) continue;
    const prior = genotypes.get(call.rsid);
    if (prior === undefined) genotypes.set(call.rsid, call.genotype);
    else if (prior !== call.genotype) { genotypes.delete(call.rsid); conflicts.add(call.rsid); }
  }
  return { genotypes, conflicts, inputFileIds: [...inputFileIds].sort(), checkedFileIds };
}
