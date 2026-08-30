import { ZipArchive } from "archiver";
import { PassThrough, Readable } from "node:stream";
import {
  getGenotypesByRsid,
  getProcessedFiles,
  getPublishedTemplates,
  templateRsids,
  type Db,
} from "@/lib/genome/load";
import { resolveTemplate } from "@/lib/genome/reports";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

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

  const stream = new PassThrough();
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
async function buildReports(supabase: Db) {
  const [processedFiles, allTemplates] = await Promise.all([
    getProcessedFiles(supabase),
    getPublishedTemplates(supabase),
  ]);
  const templates = allTemplates.filter(
    (t) => !t.slug.startsWith(FIXTURE_SLUG_PREFIX),
  );

  const files = [];
  for (const f of processedFiles) {
    const genotypes = await getGenotypesByRsid(
      supabase,
      f.id,
      templateRsids(templates),
    );
    const reports = templates
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
  reportFiles: Awaited<ReturnType<typeof buildReports>>,
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
        "medical device: nothing here is a diagnosis. Every report states " +
        "its evidence level and cites its sources.",
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
      out.push("No covered reports for this file.");
      continue;
    }

    file.reports.forEach((report, i) => {
      out.push("");
      out.push(`${i + 1}. ${report.title}`);
      out.push(`   Category: ${report.category} — Evidence: ${report.evidence}`);
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

/** The user's polygenic score results joined with score metadata. */
async function buildPrs(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
) {
  const rows = await fetchAllRows((from, to) =>
    admin
      .from("user_prs")
      .select(
        "pgs_id, file_id, raw_score, zscore, percentile, coverage, matched, computed_at",
      )
      .eq("user_id", userId)
      .order("computed_at", { ascending: true })
      .range(from, to),
  );
  if (rows.length === 0) return [];

  const pgsIds = [...new Set(rows.map((r) => r.pgs_id))];
  const { data: metas, error } = await admin
    .from("prs_scores")
    .select("pgs_id, name, trait, ancestry_note")
    .in("pgs_id", pgsIds);
  if (error) throw new Error(`prs_scores query failed: ${error.message}`);
  const metaById = new Map((metas ?? []).map((m) => [m.pgs_id, m]));

  return rows.map((r) => {
    const meta = metaById.get(r.pgs_id);
    return {
      pgs_id: r.pgs_id,
      name: meta?.name ?? null,
      trait: meta?.trait ?? null,
      raw_score: r.raw_score,
      zscore: r.zscore,
      percentile: r.percentile,
      coverage: r.coverage,
      matched: r.matched,
      ancestry_note: meta?.ancestry_note ?? null,
      file_id: r.file_id,
      computed_at: r.computed_at,
    };
  });
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

// One-click full export: original uploads + normalized variants + computed
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

  const [{ data: files }, { data: ancestry }, { data: consents }] =
    await Promise.all([
      admin.from("genome_files").select("*").eq("user_id", user.id),
      admin.from("ancestry_results").select("*").eq("user_id", user.id),
      admin
        .from("consent_grants")
        .select("provider_key, data_classes, granted_at, revoked_at")
        .eq("user_id", user.id),
    ]);

  const archive = new ZipArchive({ store: true });
  const out = new PassThrough();
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

      archive.append(JSON.stringify(ancestry ?? [], null, 2), {
        name: "ancestry.json",
      });
      contents.push({
        path: "ancestry.json",
        description: "Your derived ancestry composition results.",
        count: (ancestry ?? []).length,
      });

      archive.append(JSON.stringify(consents ?? [], null, 2), {
        name: "consents.json",
      });
      contents.push({
        path: "consents.json",
        description: "Your cloud-LLM consent grant and revocation history.",
        count: (consents ?? []).length,
      });

      // Report results, resolved the same way the /reports pages render them.
      const reportFiles = await buildReports(supabase);
      const reportCount = reportFiles.reduce((n, f) => n + f.report_count, 0);
      archive.append(JSON.stringify(reportFiles, null, 2), {
        name: "reports.json",
      });
      contents.push({
        path: "reports.json",
        description:
          "All reports: every covered report resolved against each processed file (genotype, interpretation, citations).",
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

      const prs = await buildPrs(admin, user.id);
      archive.append(JSON.stringify(prs, null, 2), { name: "prs.json" });
      contents.push({
        path: "prs.json",
        description:
          "Your polygenic score results with score metadata and ancestry-portability notes.",
        count: prs.length,
      });

      const chats = await buildChats(admin, user.id);
      archive.append(JSON.stringify(chats, null, 2), { name: "chats.json" });
      contents.push({
        path: "chats.json",
        description:
          "Your chat history (Copilot conversations stored server-side).",
        count: chats.chats.length,
      });

      // Per genome file: normalized variants as CSV (streamed page by page
      // to bound memory) and the original upload byte-for-byte.
      const rowCounts = new Map<string, number>();
      const warnings: string[] = [];
      for (const f of files ?? []) {
        const rowCount = await appendVariantsCsv(admin, archive, f.id);
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

      // Manifest last: by now every variant CSV has been fully written, so
      // per-file row counts are exact and verified against variant_count.
      const manifest = {
        exported_at: exportedAt,
        account_email: user.email,
        contents,
        files: (files ?? []).map((f) => ({
          id: f.id,
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
        note: "Export is free and always will be. This archive contains your original uploaded files, all derived variants, all reports, and your chat history — plus ancestry results, polygenic scores, and consent history. originals/ holds your uploads byte-for-byte; variants/ the normalized GRCh38 variant store; each variants CSV's row count is listed in this manifest and verified against the file's variant_count.",
      };
      archive.append(JSON.stringify(manifest, null, 2), {
        name: "manifest.json",
      });

      await archive.finalize();
    } catch (err) {
      archive.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return new Response(Readable.toWeb(out) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="inherit-export-${user.id.slice(0, 8)}.zip"`,
    },
  });
}
