import "server-only";
import type { Db } from "@/lib/genome/load";
import { getSubjectFileCount, hasFileInPreparation } from "@/lib/genome/load";
import { OBSERVED_CALL_VERSION } from "@/lib/genome/observed-calls";
import { filterOwnAnalysisFiles, loadOwnAnalysisCandidateFiles } from "@/lib/genome/own-analysis-access";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { assertionLoci, carrierReference, parseCarrierAssertionRows, type CarrierAssertionRow, type CarrierCall } from "./carrier-assertions";
import { MAX_CLASSIFIED_POSITIONS } from "./carrier-pair";
import { ownCarrierStatus, rowsForBuild, type OwnCarrierCondition } from "./own-carrier-status";

/**
 * `/genome/[subject]/carrier`, read for the account's own `self` record
 * (docs/carrier-importer-design.md; owner decision of 22 October 2026,
 * "Carrier status and carrier-pair arithmetic (G7.4)").
 *
 * The order of the questions is the guarantee:
 *
 *   1. The reviewed rule first. `carrier_assertions_v1` returns only what
 *      `private.carrier_assertion_rule_v1` admits: an active condition a named
 *      reviewer activated through `review_carrier_condition_v1`, in a current
 *      release. Outside the TEST-LOCAL acceptance build every synthetic row is
 *      refused as well (`rowsForBuild`). When nothing is left, the page says
 *      the check is unavailable and is not a negative carrier screen, and no
 *      file of the person is read at all. That is production today.
 *   2. Then the record: no file, a file still being prepared, or prepared
 *      files whose "Observed genetic variants" choice (`reports.monogenic`)
 *      is off. Only metadata is read for these.
 *   3. Only then the person's own calls, and only at the rule's loci, from
 *      the files `filterOwnAnalysisFiles` admits for `reports.monogenic`
 *      under the live grant (legacy files under the subject-level grant).
 *      The same check runs again after the read; a file whose authority
 *      changed in between is not used, and the read is retried once on the
 *      narrower set before the page gives up.
 *
 * Nothing is written. A refused or malformed read is never "no copy".
 */

export type OwnCarrierView =
  | { kind: "unavailable"; fileCount: number }
  | { kind: "no-file"; fileCount: number }
  | { kind: "preparing"; fileCount: number }
  | { kind: "off"; fileCount: number }
  | { kind: "result"; fileCount: number; preparing: boolean; conditions: OwnCarrierCondition[] };

const PAGE = 1000;
const POSITIONS_PER_QUERY = 200;
const FILES_PER_QUERY = 100;

type AssertionsRpc = (name: "carrier_assertions_v1") => PromiseLike<{ data: unknown; error: unknown }>;

/** The rule's rows this build may show, or an empty list for any refusal, malformed answer or failure. */
export async function readOwnCarrierRows(admin: Db, testLocal: boolean = isTestJurisdictionEnabled()):
  Promise<CarrierAssertionRow[]> {
  try {
    const response = await (admin.rpc.bind(admin) as unknown as AssertionsRpc)("carrier_assertions_v1");
    const rows = response.error ? null : parseCarrierAssertionRows(response.data);
    if (!rows || rows.length > MAX_CLASSIFIED_POSITIONS) return [];
    return rowsForBuild(rows, testLocal);
  } catch {
    return [];
  }
}

async function allPages<T>(query: (offset: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[] | null> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await query(offset);
    if (page.error) return null;
    rows.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < PAGE) return rows;
  }
}

interface ReadFile {
  id: string;
  build: string | null;
  sha256: string | null;
  observed_call_sha256: string | null;
  observed_call_version: string | null;
  single_logical_sample_verified_at: string | null;
}

/**
 * Every call the admitted files hold at the rule's loci, from both stores the
 * report readers use: the variant rows, and the VCF observations certified for
 * that exact source (a prepared source by its own SHA-256, a legacy file by its
 * recorded observation digest and version). Null when any page fails.
 */
async function callsAtLoci(admin: Db, subjectId: string, accountId: string, fileIds: readonly string[],
  loci: readonly { chrom: number; pos: number }[]): Promise<CarrierCall[] | null> {
  if (!fileIds.length || !loci.length) return [];
  const { data: fileRows, error } = await admin.from("genome_files")
    .select("id,build,sha256,observed_call_sha256,observed_call_version,single_logical_sample_verified_at")
    .eq("subject_id", subjectId).eq("user_id", accountId).in("id", [...fileIds]);
  if (error || !fileRows || fileRows.length !== fileIds.length) return null;
  const files = new Map((fileRows as ReadFile[]).map((file) => [file.id, file]));
  const wanted = new Set(loci.map((locus) => `${locus.chrom}:${locus.pos}`));
  const chroms = [...new Set(loci.map((locus) => locus.chrom))];
  const positions = [...new Set(loci.map((locus) => locus.pos))].sort((left, right) => left - right);
  const calls: CarrierCall[] = [];
  for (let fileOffset = 0; fileOffset < fileIds.length; fileOffset += FILES_PER_QUERY) {
    const ids = fileIds.slice(fileOffset, fileOffset + FILES_PER_QUERY);
    for (let offset = 0; offset < positions.length; offset += POSITIONS_PER_QUERY) {
      const chunk = positions.slice(offset, offset + POSITIONS_PER_QUERY);
      const [variants, observed] = await Promise.all([
        allPages((from) => admin.from("user_variants").select("id,file_id,chrom,pos,ref,alt,genotype")
          .eq("subject_id", subjectId).eq("user_id", accountId).in("file_id", ids).in("chrom", chroms).in("pos", chunk)
          .order("file_id").order("id").range(from, from + PAGE - 1)),
        allPages((from) => admin.from("report_observed_calls")
          .select("file_id,source_line,chrom,pos,ref,alt,genotype,usable,source_sha256,extraction_version,source_build")
          .eq("subject_id", subjectId).eq("user_id", accountId).in("file_id", ids).in("chrom", chroms).in("pos", chunk)
          .order("file_id").order("source_line").range(from, from + PAGE - 1)),
      ]);
      if (!variants || !observed) return null;
      for (const row of variants) {
        if (!wanted.has(`${row.chrom}:${row.pos}`)) continue;
        calls.push({ chrom: row.chrom, pos: row.pos, ref: row.ref, alt: row.alt, genotype: row.genotype, fileId: row.file_id });
      }
      for (const row of observed) {
        const file = files.get(row.file_id);
        if (!file || !wanted.has(`${row.chrom}:${row.pos}`)) continue;
        const certified = row.extraction_version === OBSERVED_CALL_VERSION && row.source_build === file.build
          && /^[0-9a-f]{64}$/.test(row.source_sha256)
          && (file.single_logical_sample_verified_at !== null
            ? row.source_sha256 === file.sha256
            : file.observed_call_version === OBSERVED_CALL_VERSION && row.source_sha256 === file.observed_call_sha256);
        if (!certified) continue;
        calls.push({ chrom: row.chrom, pos: row.pos, ref: row.ref, alt: row.alt, genotype: row.genotype,
          usable: row.usable, fileId: row.file_id });
      }
    }
  }
  return calls;
}

const sameIds = (left: readonly { id: string }[], right: readonly { id: string }[]) =>
  left.length === right.length && left.every((file, index) => file.id === right[index].id);

/** The whole read for one own `self` record. See the module comment for the order. */
export async function readOwnCarrierView(admin: Db, subjectId: string, accountId: string,
  testLocal: boolean = isTestJurisdictionEnabled()): Promise<OwnCarrierView> {
  const [rows, fileCount, preparing] = await Promise.all([
    readOwnCarrierRows(admin, testLocal),
    getSubjectFileCount(admin, subjectId),
    hasFileInPreparation(admin, subjectId),
  ]);
  if (!rows.length) return { kind: "unavailable", fileCount };
  const candidates = await loadOwnAnalysisCandidateFiles(admin, subjectId);
  if (!candidates.length) return { kind: preparing ? "preparing" : "no-file", fileCount };
  const admit = (files: typeof candidates) =>
    filterOwnAnalysisFiles(admin, subjectId, "reports.monogenic", files, { storedResult: false, gateLegacy: true });
  let authorized = await admit(candidates);
  if (!authorized.length) return { kind: "off", fileCount };
  const loci = assertionLoci(carrierReference(rows).refVariants);
  for (let attempt = 0; attempt < 2; attempt++) {
    const calls = await callsAtLoci(admin, subjectId, accountId, authorized.map((file) => file.id), loci);
    if (!calls) return { kind: "unavailable", fileCount };
    // A withdrawal during the read must not escape as a result.
    const confirmed = await admit(authorized);
    if (!confirmed.length) return { kind: "off", fileCount };
    if (sameIds(confirmed, authorized)) {
      const current = new Set(confirmed.map((file) => file.id));
      return { kind: "result", fileCount, preparing,
        conditions: ownCarrierStatus(rows, calls.filter((call) => call.fileId !== undefined && current.has(call.fileId))) };
    }
    authorized = confirmed;
  }
  return { kind: "unavailable", fileCount };
}
