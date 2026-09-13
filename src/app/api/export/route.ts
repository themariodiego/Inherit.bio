import { ZipArchive } from "archiver";
import { PassThrough, Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { subjectRecordOf, subjectRecordRowCount } from "@/lib/export/subject-record";
import { assertPreparedMetadataBounds } from "@/lib/genome/prepared-source/canonical-manifest";
import { preparedOriginalDownloadSourceSchema, streamPreparedOriginalDownload } from "@/lib/uploads/prepared-original-download";
import {
  getGenotypesByRsid,
  getProcessedFiles,
  getPublishedTemplates,
  templateRsids,
  type Db,
} from "@/lib/genome/load";
import { resolveTemplate } from "@/lib/genome/reports";
import { loadPrsForExport } from "@/lib/genome/prs-output";
import { EVIDENCE_PUBLIC_LABELS } from "@/lib/genome/taxonomy";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ownSubjectExportContent, renderOwnSubjectReport, type OwnExportRpc, type OwnExportSnapshot } from "@/lib/exports/own-subject-content";
import { ownSubjectPurposeGranted } from "@/lib/genome/own-analysis-access";

/** The two report selections the legacy half of this archive answers to (D-099). */
const REPORT_PURPOSES = ["reports.monogenic", "reports.polygenic"] as const;

export const maxDuration = 300;
const originalStateSchema = z.object({ version: z.literal("own-original-download-state-v1"), fileId: z.uuid(),
  prepared: z.boolean(), retired: z.boolean(), expiresAt: z.iso.datetime({ offset: true }).nullable() }).strict();
const originalReceiptSchema = z.object({ source: preparedOriginalDownloadSourceSchema, originalName: z.string().min(1).max(1024) }).strict();
type OriginalRpc = (name: string, args: Record<string, unknown>) => { abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }> };

// PostgREST caps every response at its configured max-rows (1,000 on a
// default Supabase deployment) regardless of the requested range, so all
// pagination below advances by the number of rows actually returned and
// stops only on an empty page — never on a short one.
const PAGE = 5000;

// E2E fixture report templates are seeded with this prefix and are not the
// user's data; they never belong in an export.
const FIXTURE_SLUG_PREFIX = "auto-e2e-";

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(`export query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    from += data.length;
  }
  return all;
}

/** Write to a stream honoring backpressure so at most ~one page of CSV is
 * ever buffered beyond what the archive has consumed. */
function writeChunk(stream: PassThrough, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stream.destroyed || stream.writableEnded) {
      reject(new Error("export stream closed"));
      return;
    }
    if (stream.write(chunk)) {
      resolve();
      return;
    }
    const cleanup = () => {
      stream.off("drain", onDrain);
      stream.off("error", onError);
      stream.off("close", onClose);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("export stream closed"));
    };
    stream.once("drain", onDrain);
    stream.once("error", onError);
    stream.once("close", onClose);
  });
}

const CSV_HEADER = "rsid,chrom,pos_grch38,ref,alt,genotype\n";

type VariantRow = {
  rsid: number | null;
  chrom: number;
  pos: number;
  ref: string | null;
  alt: string | null;
  genotype: string;
};

function csvChunk(rows: VariantRow[]): string {
  let chunk = "";
  for (const r of rows) {
    chunk += `${r.rsid ? `rs${r.rsid}` : ""},${r.chrom},${r.pos},${r.ref ?? ""},${r.alt ?? ""},${r.genotype}\n`;
  }
  return chunk;
}

/**
 * Streams one file's variants into the archive as CSV, paging until the
 * database returns no more rows (never trusting a short page — see PAGE
 * note above). Returns the number of data rows written; 0 means the file
 * has no variants and no CSV entry was created.
 */
async function appendVariantsCsv(
  admin: ReturnType<typeof createAdminClient>,
  archive: ZipArchive,
  fileId: string,
  makeStream: () => PassThrough,
): Promise<number> {
  const fetchPage = (from: number) =>
    admin
      .from("user_variants")
      .select("rsid, chrom, pos, ref, alt, genotype")
      .eq("file_id", fileId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);

  const first = await fetchPage(0);
  if (first.error) {
    throw new Error(`variants query failed: ${first.error.message}`);
  }
  if (!first.data || first.data.length === 0) return 0;

  const stream = makeStream();
  archive.append(stream, { name: `variants/${fileId}.csv` });

  let total = 0;
  let rows = first.data;
  await writeChunk(stream, CSV_HEADER);
  for (;;) {
    await writeChunk(stream, csvChunk(rows));
    total += rows.length;
    const { data, error } = await fetchPage(total);
    if (error) throw new Error(`variants query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows = data;
  }
  stream.end();
  return total;
}

/** Resolves the report library against each processed file exactly like the
 * /reports pages do (same loaders, same resolver — no reimplementation). */
/**
 * `allowLayer` is D-099, closed 2026-09-13: the legacy half of the archive
 * answers to the same live `reports.monogenic` / `reports.polygenic` grants
 * as the report surfaces, exactly as its ancestry half has since D-097.
 *
 * It gates by LAYER rather than per file, because the two purposes are two
 * separate choices: a reader who selected estimates and revoked variant calls
 * must not receive variant calls in an archive. A file with neither purpose
 * granted is not read at all — it still appears, with no reports, because the
 * archive's file list is not a result and hiding the file would misdescribe
 * what the account holds.
 */
async function buildReports(supabase: Db, legacyIds: Set<string>,
  allowLayer: (fileId: string, layer: string) => boolean) {
  const [processedFiles, allTemplates] = await Promise.all([
    getProcessedFiles(supabase),
    getPublishedTemplates(supabase),
  ]);
  const templates = allTemplates.filter(
    (t) => !t.slug.startsWith(FIXTURE_SLUG_PREFIX),
  );

  const files = [];
  for (const f of processedFiles.filter(file => legacyIds.has(file.id))) {
    const permitted = templates.filter((t) => allowLayer(f.id, t.layer ?? "estimate"));
    if (permitted.length === 0) {
      files.push({ file_id: f.id, original_name: f.original_name, report_count: 0, reports: [] });
      continue;
    }
    const genotypes = await getGenotypesByRsid(
      supabase,
      f.id,
      templateRsids(permitted),
    );
    const reports = permitted
      .map((t) => resolveTemplate(t, (rsid) => genotypes.get(rsid)))
      .filter((r) => r.covered)
      .map((r) => ({
        slug: r.template.slug,
        title: r.template.title,
        category: r.template.category,
        evidence: r.template.evidence,
        summary: r.template.summary,
        pgs_id: r.template.pgs_id,
        variants: r.variants.map(({ variant, outcome }) => ({
          rsid: `rs${variant.rsid}`,
          gene: variant.gene,
          status: outcome.status,
          genotype:
            outcome.status === "genotyped" || outcome.status === "unrecognized"
              ? outcome.genotype
              : null,
          interpretation:
            outcome.status === "genotyped" ? outcome.interpretation : null,
          strand_flipped:
            outcome.status === "genotyped" ? outcome.strandFlipped : false,
        })),
        citations: r.template.citations,
      }));
    files.push({
      file_id: f.id,
      original_name: f.original_name,
      report_count: reports.length,
      reports,
    });
  }
  return files;
}

type ExportReportFile = Awaited<ReturnType<typeof buildReports>>[number]
  | Awaited<ReturnType<ReturnType<typeof ownSubjectExportContent>["reports"]>>;

/** Greedy word-wrap for the plain-text report rendering; every emitted line
 * (including the first) carries the given indent. */
function wrapText(text: string, indent: string, width = 78): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && indent.length + line.length + 1 + word.length > width) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(indent + line);
  return lines.join("\n");
}

const VARIANT_STATUS_TEXT: Record<string, string> = {
  "no-call": "no call in your file",
  "not-covered": "your file does not cover this variant",
  unrecognized: "did not match the known alleles for this variant",
};

/**
 * reports.txt: the same covered reports as reports.json, rendered as plain
 * text a person can print or hand to a doctor — title, category, evidence
 * level, each genotype with its interpretation paragraph, and citations.
 * Generated from the exact same buildReports() data, so the two files can
 * never disagree.
 */
function renderReportsTxt(
  reportFiles: ExportReportFile[],
  accountEmail: string | undefined,
  exportedAt: string,
): string {
  const out: string[] = [];
  out.push("YOUR INHERIT REPORTS");
  out.push("====================");
  out.push("");
  out.push(`Exported: ${exportedAt}`);
  if (accountEmail) out.push(`Account:  ${accountEmail}`);
  out.push("");
  out.push(
    wrapText(
      "This is the human-readable version of reports.json in this archive — " +
        "the same reports, formatted for printing or for sharing with a " +
        "doctor or genetic counselor. Inherit is informational, not a " +
        "medical device: nothing here is a diagnosis. Canonical stored outcomes " +
        "state which generation metadata was not captured.",
      "",
    ),
  );

  for (const file of reportFiles) {
    out.push("");
    out.push("");
    out.push(`FILE: ${file.original_name}`);
    out.push("-".repeat(Math.min(78, 6 + file.original_name.length)));
    if (file.reports.length === 0) {
      out.push("");
      out.push("source_revision" in file ? "No completed reports for this file." : "No covered reports for this file.");
      continue;
    }

    if ("source_revision" in file) out.push(`Source revision: ${file.source_revision}; SHA-256: ${file.source_sha256}`);
    file.reports.forEach((report, i) => {
      if ("provenance_note" in report) { out.push("", `${i + 1}. ${renderOwnSubjectReport(report)}`); return; }
      out.push("");
      out.push(`${i + 1}. ${report.title}`);
      out.push(
        `   Category: ${report.category} — Evidence: ${EVIDENCE_PUBLIC_LABELS[report.evidence] ?? report.evidence}`,
      );
      out.push("");
      out.push(wrapText(report.summary, "   "));
      out.push("");
      out.push("   Your genotypes:");
      // Wrapped entries indent continuation lines by 5 and swap the first
      // line's indent for a same-width "   - " list marker.
      const listItem = (text: string) =>
        wrapText(text, "     ").replace(/^ {5}/, "   - ");
      for (const v of report.variants) {
        if (v.genotype && v.interpretation) {
          const flip = v.strand_flipped
            ? " [reported on the opposite strand; shown as template alleles]"
            : "";
          out.push(
            listItem(
              `${v.rsid} (${v.gene}): ${v.genotype}${flip} — ${v.interpretation}`,
            ),
          );
        } else {
          const statusText =
            v.status === "unrecognized" && v.genotype
              ? `${v.genotype} — ${VARIANT_STATUS_TEXT.unrecognized}`
              : (VARIANT_STATUS_TEXT[v.status] ?? v.status);
          out.push(`   - ${v.rsid} (${v.gene}): ${statusText}`);
        }
      }
      if (report.citations.length > 0) {
        out.push("");
        out.push("   Citations:");
        for (const c of report.citations) {
          const refs = [
            c.pmid ? `PMID ${c.pmid}` : null,
            c.doi ? `doi:${c.doi}` : null,
          ]
            .filter(Boolean)
            .join(", ");
          out.push(listItem(`${c.label}${refs ? ` (${refs})` : ""}`));
        }
      }
    });
  }
  out.push("");
  return out.join("\n");
}

/** Chat history from the chats/chat_messages tables. The current Copilot UI
 * keeps conversations client-side only, so an empty result is stated
 * explicitly rather than shipped as a bare empty list. */
async function buildChats(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
) {
  const chats = await fetchAllRows((from, to) =>
    admin
      .from("chats")
      .select("id, title, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .range(from, to),
  );
  if (chats.length === 0) {
    return {
      note: "Copilot conversations are not stored server-side",
      chats: [],
    };
  }

  const messages = await fetchAllRows((from, to) =>
    admin
      .from("chat_messages")
      .select("chat_id, role, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .range(from, to),
  );
  const byChat = new Map<string, { role: string; content: unknown; created_at: string }[]>();
  for (const m of messages) {
    const list = byChat.get(m.chat_id) ?? [];
    list.push({ role: m.role, content: m.content, created_at: m.created_at });
    byChat.set(m.chat_id, list);
  }
  return {
    chats: chats.map((c) => ({
      id: c.id,
      title: c.title,
      created_at: c.created_at,
      messages: byChat.get(c.id) ?? [],
    })),
  };
}

// Existing synchronous ZIP delivery (not the completed large-export contract): original uploads + normalized variants + computed
// report results + polygenic scores + ancestry + consents + chat history,
// as a ZIP stream. Free, forever — there is deliberately no billing,
// quota, or fee code path here, and never will be (see /terms).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const admin = createAdminClient();
  let stopped = false;
  const exportAbort = new AbortController();
  const assertActive = () => { if (stopped) throw new Error("export unavailable"); };
  const { data: claimsData } = await supabase.auth.getClaims();
  if (claimsData?.claims?.sub !== user.id || typeof claimsData.claims.session_id !== "string") {
    return new Response("Unauthorized", { status: 401 });
  }
  const exportActor = { accountId: user.id, sessionId: claimsData.claims.session_id };
  const ownContent = ownSubjectExportContent(admin.rpc.bind(admin) as unknown as OwnExportRpc,
    exportActor, assertActive, { signal: exportAbort.signal });
  let canonical: OwnExportSnapshot[];
  try { canonical = await ownContent.list(); } catch { return new Response("Export unavailable", { status: 503 }); }

  const [legacyFiles, { data: legacyAncestry, error: ancestryError }, { data: consents },
    subjectRecord] =
    await Promise.all([
      fetchAllRows((from, to) => admin.from("genome_files").select("*").eq("user_id", user.id)
        .is("single_logical_sample_verified_at", null).order("id").range(from, to)),
      admin.from("ancestry_results").select("*").eq("user_id", user.id),
      admin
        .from("consent_grants")
        .select("provider_key, data_classes, granted_at, revoked_at")
        .eq("user_id", user.id),
      subjectRecordOf(admin, user.id),
    ]);
  if (ancestryError) return new Response("Export unavailable", { status: 503 });
  if (subjectRecord === null) return new Response("Export unavailable", { status: 503 });

  const files = [...legacyFiles, ...canonical.map(snapshot => snapshot.file)];
  const legacyIds = new Set(legacyFiles.map(file => file.id));
  const archive = new ZipArchive({ store: true });
  const out = new PassThrough();
  const members = new Set<Readable>();
  const member = () => {
    assertActive();
    const stream = new PassThrough(); members.add(stream);
    stream.once("close", () => members.delete(stream));
    return stream;
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    exportAbort.abort();
    for (const stream of members) stream.destroy();
    archive.abort(); archive.destroy();
  };
  archive.on("error", () => { stop(); out.destroy(new Error("export unavailable")); });
  out.once("close", stop);
  archive.pipe(out);

  void (async () => {
    try {
      const exportedAt = new Date().toISOString();
      const contents: {
        path: string;
        description: string;
        count?: number;
      }[] = [
        {
          path: "manifest.json",
          description:
            "This inventory: every file in the export, with row/record counts.",
        },
      ];

      archive.append(JSON.stringify(consents ?? [], null, 2), {
        name: "consents.json",
      });
      contents.push({
        path: "consents.json",
        description: "Your cloud-LLM consent grant and revocation history.",
        count: (consents ?? []).length,
      });

      archive.append(JSON.stringify(subjectRecord, null, 2), {
        name: "subject-record.json",
      });
      contents.push({
        path: "subject-record.json",
        description:
          "Who the database says you are and what you agreed to: your own subject rows, "
          + "the principals and bindings that connect them to this account, your subject-level "
          + "consent history, and the provider grants recorded against this account. Rows about "
          + "other people are not here, by construction.",
        count: subjectRecordRowCount(subjectRecord),
      });

      const rowCounts = new Map<string, number>();
      const warnings: string[] = [];
      let expiredOriginals = false;
      const canonicalReports: ExportReportFile[] = [];
      const canonicalPrs: Awaited<ReturnType<ReturnType<typeof ownSubjectExportContent>["prs"]>> = [];
      // Verify, consume and release one original before loading the next source.
      for (const snapshot of canonical) {
        const f = snapshot.file;
        // Own-subject originals have opaque per-file names, so two uploads
        // with the same safe display label cannot overwrite each other.
        assertActive();
        const blob = snapshot.preparedSource ? null : await ownContent.original(snapshot, key => admin.storage.from("genomes").download(key));
        assertActive();
        canonicalReports.push(await ownContent.reports(snapshot)); assertActive();
        canonicalPrs.push(...await ownContent.prs(snapshot)); assertActive();
        await ownContent.check(snapshot); assertActive();
        if (snapshot.preparedSource) {
          const records = member();
          archive.append(records, { name: `canonical/${f.id}.jsonl` });
          let wroteHeader = false;
          const counts = await ownContent.preparedRecords(snapshot, async (page, signal, header) => {
            // Recheck after each backpressure pause, immediately before the next
            // bounded delivery chunk. A long codec-valid allele stays one record.
            let lines: string[] = [], bytes = 0;
            const flush = async () => {
              if (!lines.length) return;
              const chunk = lines.join(""); lines = []; bytes = 0;
              await ownContent.check(snapshot); assertActive();
              if (signal.aborted) throw new Error("export unavailable");
              await writeChunk(records, chunk);
            };
            if (!wroteHeader) { const line = `${JSON.stringify(header)}\n`; lines.push(line); bytes += Buffer.byteLength(line); wroteHeader = true; }
            for (const record of page) {
              assertActive(); if (signal.aborted) throw new Error("export unavailable");
              const line = `${JSON.stringify(record)}\n`, size = Buffer.byteLength(line);
              if (bytes && bytes + size > 1_048_576) await flush();
              lines.push(line); bytes += size;
            }
            await flush();
          });
          if (f.variant_count !== null && counts.variantCount !== f.variant_count) throw new Error("export unavailable");
          records.end(); rowCounts.set(f.id, counts.variantCount);
          contents.push({ path: `canonical/${f.id}.jsonl`,
            description: "Source-bound header followed by complete prepared-canonical-v1 records: original source evidence and normalized dispositions, including duplicates and unmapped calls.",
            count: counts.recordCount });
        } else {
        let count = 0;
        const variants = member();
        archive.append(variants, { name: `variants/${f.id}.csv` });
        await writeChunk(variants, CSV_HEADER);
        for await (const page of ownContent.variants(snapshot)) {
          await writeChunk(variants, csvChunk(page)); count += page.length;
        }
        variants.end();
        if (f.variant_count !== null && count !== f.variant_count) throw new Error("export unavailable");
        rowCounts.set(f.id, count);
        contents.push({ path: `variants/${f.id}.csv`, description: "Your normalized GRCh38 variants.", count });
        const observations = member();
        archive.append(observations, { name: `observed/${f.id}.json` });
        await writeChunk(observations, "[");
        let observedCount = 0;
        for await (const page of ownContent.observed(snapshot)) for (const row of page) {
          await writeChunk(observations, `${observedCount++ ? "," : ""}${JSON.stringify(row)}`);
        }
        await writeChunk(observations, "]"); observations.end();
        contents.push({ path: `observed/${f.id}.json`, description: "Literal source records, including reference and no-call observations.", count: observedCount });
        }
        await ownContent.check(snapshot); assertActive();
        let original: Readable;
        if (snapshot.preparedSource) {
          const rpc = admin.rpc.bind(admin) as unknown as OriginalRpc;
          const args = { p_account_id: user.id, p_session_id: claimsData!.claims.session_id, p_file_id: f.id };
          const initialSignal = AbortSignal.any([exportAbort.signal, AbortSignal.timeout(30_000)]);
          const stateResponse = await rpc("own_original_download_state_v1", { p_account_id: user.id, p_file_id: f.id }).abortSignal(initialSignal);
          initialSignal.throwIfAborted();
          if (stateResponse.error) throw new Error("export unavailable");
          assertPreparedMetadataBounds(stateResponse.data, 4096);
          const state = originalStateSchema.parse(stateResponse.data);
          if (state.fileId !== f.id || !state.prepared) throw new Error("export unavailable");
          // A deletion/authority failure must not be mistaken for ordinary original expiry.
          await ownContent.check(snapshot); assertActive();
          if (state.retired) {
            expiredOriginals = true;
            warnings.push(`originals/${f.id} omitted: the original retention period has ended. Prepared records and saved reports remain included.`);
            continue;
          }
          async function authorize(expected: unknown, signal: AbortSignal) {
            const response = await rpc("authorize_own_prepared_original_v1", { ...args, p_expected: expected }).abortSignal(signal);
            signal.throwIfAborted();
            if (response.error) throw new Error("export unavailable");
            assertPreparedMetadataBounds(response.data, 4096);
            const { source } = originalReceiptSchema.parse(response.data);
            if (source.fileId !== f.id || source.manifestId !== snapshot.preparedSource!.manifestId
              || source.sourceRevision !== f.upload_revision || source.rawSha256 !== f.sha256
              || source.sizeBytes !== f.size_bytes || source.objectId !== f.storage_object_id
              || source.objectKey !== f.bucket_path || (expected !== null && !isDeepStrictEqual(source, expected))) throw new Error("export unavailable");
            return source;
          }
          const source = await authorize(null, initialSignal); assertActive();
          original = Readable.from(streamPreparedOriginalDownload({ source, signal: exportAbort.signal,
            check: async (expected, signal) => { await authorize(expected, signal); assertActive(); } }), { objectMode: false, highWaterMark: 1 });
        } else {
          if (!blob) throw new Error("export unavailable");
          original = Readable.fromWeb(blob.stream() as never);
        }
        members.add(original);
        original.once("close", () => members.delete(original));
        archive.append(original, { name: `originals/${f.id}` });
        await finished(original); assertActive();
        contents.push({ path: `originals/${f.id}`, description: "Your original upload, byte-for-byte." });
      }

      // Legacy rows never supply canonical ancestry. The checked reader uses
      // the exact live ancestry grant and completed source journal, not this
      // account-wide table read, and does not generate during export.
      const ancestry = member();
      archive.append(ancestry, { name: "ancestry.json" });
      await writeChunk(ancestry, "[");
      let ancestryCount = 0;
      const writeAncestry = (rows: unknown[]) => {
        if (!rows.length) return Promise.resolve();
        const chunk = `${ancestryCount ? "," : ""}${rows.map(row => JSON.stringify(row)).join(",")}`;
        ancestryCount += rows.length;
        return writeChunk(ancestry, chunk);
      };
      // D-097, resolved 2026-09-12: the legacy half must refuse after the
      // `ancestry` purpose is revoked, exactly as the canonical half already
      // does. This read used to carry NO ancestry check at all — it ran on
      // `raw.export`/`export.share-link` alone — so a revoked ancestry
      // permission still shipped these rows in the archive.
      //
      // The grant is subject-scoped, and one account can hold several legacy
      // files across subjects, so each subject is asked separately and only
      // its own files survive a refusal. Checked immediately before the write
      // and again immediately after, matching what `ownContent.ancestry` does
      // for the canonical half: a revocation landing mid-export must not leave
      // a buffered result in the archive.
      const legacySubjects = [...new Set(legacyFiles.map(file => file.subject_id).filter(
        (id): id is string => typeof id === "string"))];
      const ancestryGranted = async () => {
        const granted = new Set<string>();
        for (const subjectId of legacySubjects) {
          if (await ownSubjectPurposeGranted(admin, exportActor, subjectId, "ancestry")) granted.add(subjectId);
        }
        return granted;
      };
      const grantedSubjects = await ancestryGranted();
      const ancestryFileIds = new Set(legacyFiles
        .filter(file => file.subject_id !== null && grantedSubjects.has(file.subject_id))
        .map(file => file.id));
      await writeAncestry((legacyAncestry ?? [])
        .filter(row => legacyIds.has(row.file_id) && ancestryFileIds.has(row.file_id)));
      assertActive();
      const stillGranted = await ancestryGranted();
      if (grantedSubjects.size !== stillGranted.size
        || [...grantedSubjects].some(id => !stillGranted.has(id))) throw new Error("ancestry_grant_changed");
      for (const snapshot of canonical) {
        const rows = await ownContent.ancestry(snapshot); assertActive();
        // Write synchronously after the final authority check. Do not hold a
        // checked source while awaiting another source or stream backpressure.
        await writeAncestry(rows);
      }
      await writeChunk(ancestry, "]"); ancestry.end();
      contents.push({ path: "ancestry.json", description: "Completed source-bound ancestry estimates and legacy ancestry results.", count: ancestryCount });

      // Stored canonical outcomes and the legacy report resolver.
      //
      // D-099, resolved 2026-09-13: the legacy half must refuse after a report
      // purpose is revoked, exactly as the canonical half and the ancestry
      // half above already do. This read used to carry NO report check at all,
      // so a revoked `reports.monogenic` or `reports.polygenic` still shipped
      // legacy-derived results in the archive.
      //
      // Same shape as the ancestry gate: subject-scoped, asked per subject and
      // per purpose, and asked again immediately after the build so that a
      // revocation landing mid-export cannot leave a buffered result in the
      // archive. The two purposes are held separately because they are two
      // separate selections.
      const reportsGranted = async () => {
        const granted = new Set<string>();
        for (const subjectId of legacySubjects) {
          for (const purpose of REPORT_PURPOSES) {
            if (await ownSubjectPurposeGranted(admin, exportActor, subjectId, purpose)) {
              granted.add(`${subjectId} ${purpose}`);
            }
          }
        }
        return granted;
      };
      const grantedReports = await reportsGranted();
      const subjectOfLegacyFile = new Map(legacyFiles.map(file => [file.id, file.subject_id]));
      const allowReportLayer = (fileId: string, layer: string) => {
        const subjectId = subjectOfLegacyFile.get(fileId);
        return typeof subjectId === "string"
          && grantedReports.has(`${subjectId} ${layer === "variant_call" ? "reports.monogenic" : "reports.polygenic"}`);
      };
      const reportFiles: ExportReportFile[] = [...await buildReports(supabase, legacyIds, allowReportLayer), ...canonicalReports];
      assertActive();
      const stillGrantedReports = await reportsGranted();
      if (grantedReports.size !== stillGrantedReports.size
        || [...grantedReports].some(key => !stillGrantedReports.has(key))) throw new Error("reports_grant_changed");
      const reportCount = reportFiles.reduce((n, f) => n + f.report_count, 0);
      archive.append(JSON.stringify(reportFiles, null, 2), {
        name: "reports.json",
      });
      contents.push({
        path: "reports.json",
        description:
          "Existing completed canonical reports and covered legacy reports (genotype, interpretation, citations).",
        count: reportCount,
      });

      // The same reports as plain, printable text — for a person (or their
      // doctor), not a program. Rendered from the identical data.
      archive.append(
        renderReportsTxt(reportFiles, user.email, exportedAt),
        { name: "reports.txt" },
      );
      contents.push({
        path: "reports.txt",
        description:
          "The same reports as reports.json, formatted as plain text you can print or hand to a doctor.",
        count: reportCount,
      });

      const prs = (await loadPrsForExport(admin, user.id)).filter(row => legacyIds.has(row.file_id));
      assertActive(); prs.push(...canonicalPrs);
      archive.append(JSON.stringify(prs, null, 2), { name: "prs.json" });
      contents.push({
        path: "prs.json",
        description:
          "Score-panel coverage, file provenance and why validated personal scores are unavailable. Unvalidated score numbers are not included.",
        count: prs.length,
      });

      const chats = await buildChats(admin, user.id);
      assertActive();
      archive.append(JSON.stringify(chats, null, 2), { name: "chats.json" });
      contents.push({
        path: "chats.json",
        description:
          "Your chat history (Copilot conversations stored server-side).",
        count: chats.chats.length,
      });

      // Per genome file: normalized variants as CSV (streamed page by page
      // to bound memory) and the original upload byte-for-byte.
      for (const f of legacyFiles) {
        const rowCount = await appendVariantsCsv(admin, archive, f.id, member);
        rowCounts.set(f.id, rowCount);
        if (rowCount > 0) {
          contents.push({
            path: `variants/${f.id}.csv`,
            description: `Normalized GRCh38 variants parsed from ${f.original_name}.`,
            count: rowCount,
          });
        }
        if (f.variant_count != null && rowCount !== f.variant_count) {
          warnings.push(
            `variants/${f.id}.csv has ${rowCount} rows but the file records variant_count=${f.variant_count}`,
          );
        }

        const { data: blob } = await admin.storage
          .from("genomes")
          .download(f.bucket_path);
        assertActive();
        if (blob) {
          archive.append(Readable.fromWeb(blob.stream() as never), {
            name: `originals/${f.original_name}`,
          });
          contents.push({
            path: `originals/${f.original_name}`,
            description: "Your original upload, byte-for-byte.",
          });
        }
      }

      assertActive();
      // Manifest last: by now every variant CSV has been fully written, so
      // per-file row counts are exact and verified against variant_count.
      const manifest = {
        exported_at: exportedAt,
        prs_format: "coverage-only-v1",
        account_email: user.email,
        contents,
        files: (files ?? []).map((f) => ({
          id: f.id,
          // Whose data this file is. Without it an account holding more than
          // its own subject cannot tell the archive's files apart.
          subject_id: f.subject_id,
          original_name: f.original_name,
          file_type: f.file_type,
          tier: f.tier,
          size_bytes: f.size_bytes,
          sha256: f.sha256,
          status: f.status,
          build: f.build,
          created_at: f.created_at,
          variant_count: f.variant_count,
          row_count: rowCounts.get(f.id) ?? 0,
        })),
        ...(warnings.length > 0 ? { warnings } : {}),
        note: "Export is free and always will be. This archive contains "
          + (expiredOriginals ? "your available original uploaded files (expired originals are identified in warnings)" : "your original uploaded files")
          + ", all derived variants, all reports, and your chat history — plus ancestry results, score-panel coverage, and consent history. Unvalidated score numbers are not included. originals/ holds your uploads byte-for-byte; variants/ the normalized GRCh38 variant store; each variants CSV's row count is listed in this manifest and verified against the file's variant_count.",
      };
      archive.append(JSON.stringify(manifest, null, 2), {
        name: "manifest.json",
      });

      await archive.finalize();
    } catch {
      stop();
      out.destroy(new Error("export unavailable"));
    }
  })();

  // Mark cancellation synchronously; the Node close event alone can arrive
  // after an awaited provider read resumes. Pulling keeps ZIP backpressure.
  const iterator = out[Symbol.asyncIterator]();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (cancelled) return;
        if (next.done) controller.close(); else controller.enqueue(next.value);
      } catch {
        if (!cancelled) controller.error(new Error("export unavailable"));
      }
    },
    async cancel() {
      cancelled = true; stop(); out.destroy();
      await iterator.return?.();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="inherit-export-${user.id.slice(0, 8)}.zip"`,
    },
  });
}
