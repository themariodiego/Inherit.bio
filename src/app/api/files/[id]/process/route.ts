import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { OBSERVED_CALL_VERSION } from "@/lib/genome/observed-calls";
import { PANEL } from "@/lib/ancestry/panel";
import { measureRunsOfHomozygosity, rohCallsFromParse, rohColumns } from "@/lib/family/roh";
import { AIMS, RELIABLE_FRACTION, estimateAdmixture } from "@/lib/genome/admixture";
import { classify, type HaplogroupCall } from "@/lib/genome/haplogroups";
import { buildLiftover, liftSingleBaseVariant } from "@/lib/genome/liftover";
import { parseArray, type ArrayKind } from "@/lib/genome/parsers/array";
import { computePrs } from "@/lib/genome/prs";
import { ALL_PRS_SCORES } from "@/lib/genome/prs-data";
import { toLines } from "@/lib/genome/parsers/lines";
import { parseVcf } from "@/lib/genome/parsers/vcf";
import type { ParseResult, VariantRecord } from "@/lib/genome/types";
import { enqueueAccountMail } from "@/lib/mail-outbox";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const ARRAY_KINDS = new Set([
  "array_23andme",
  "array_ancestry",
  "array_myheritage",
  "array_ftdna",
]);

// Tier-1 processing: storage -> streaming parse -> (liftover) -> canonical
// variant store -> ancestry results -> report-ready email. Runs entirely
// inside this deployment: user genotypes never leave it.
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/files/[id]/process">,
) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // RLS-scoped read proves ownership.
  const { data: file } = await supabase
    .from("genome_files")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!file) return new Response("Not found", { status: 404 });
  if (file.user_id !== user.id) return new Response("Not found", { status: 404 });
  if (file.tier !== 1) {
    return new Response("Only Tier-1 files are processed serverside", {
      status: 400,
    });
  }
  if (!file.subject_id) {
    return new Response("File subject binding is unavailable", { status: 409 });
  }
  // New objects have server-issued UUID names. Retain the user-prefix form for
  // pre-v2 rows; clients can no longer insert or mutate genome_files directly.
  const serverIssuedPath = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    file.bucket_path,
  );
  if (!serverIssuedPath && !file.bucket_path.startsWith(`${user.id}/`)) {
    return new Response("Invalid file path", { status: 400 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      "This deployment is not fully configured: SUPABASE_SERVICE_ROLE_KEY is missing, so files cannot be processed. Set it in the hosting environment and redeploy (see docs/deployment.md).",
      { status: 503 },
    );
  }

  const admin = createAdminClient();
  // A re-run measures the file again at the end, so a stale measure never
  // outlives the calls it was taken from (the all-null shape is admitted).
  const { error: parsingError } = await admin
    .from("genome_files")
    .update({
      status: "parsing",
      build: null,
      observed_call_sha256: null,
      observed_call_version: null,
      processing_started_at: new Date().toISOString(),
      error: null,
      roh_status: null,
      roh_reason: null,
      roh_total_bases: null,
      roh_covered_bases: null,
      roh_fraction: null,
      roh_measured_at: null,
    })
    .eq("id", id);
  // This state excludes old derivatives from report reads during a rerun.
  // Do not fetch or change derivatives unless that boundary was persisted.
  if (parsingError) {
    return new Response("File processing could not start. Please try again.", { status: 503 });
  }

  try {
    // Stream the object rather than buffering a Blob.
    const objectUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/genomes/${file.bucket_path}`;
    const res = await fetch(objectUrl, {
      headers: {
        authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!res.ok || !res.body) {
      throw new Error(`storage download failed (${res.status})`);
    }

    const sourceHash = createHash("sha256");
    async function* hashedBytes() {
      for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
        sourceHash.update(bytes);
        yield bytes;
      }
    }
    const lines = toLines(hashedBytes());
    let parsed: ParseResult;
    if (ARRAY_KINDS.has(file.file_type)) {
      parsed = await parseArray(lines, file.file_type as ArrayKind);
    } else if (file.file_type === "vcf" || file.file_type === "gvcf") {
      parsed = await parseVcf(lines);
    } else {
      throw new Error(`unsupported tier-1 type ${file.file_type}`);
    }
    const sourceSha256 = sourceHash.digest("hex");

    // Unknown or conflicting coordinates must never be relabelled GRCh38.
    // Invalidate old derivatives from this same file before refusing a rerun;
    // source bytes remain. An error is explicit, never a report-ready state.
    if (parsed.build === "unknown") {
      for (const table of ["user_variants", "ancestry_results", "user_prs", "report_observed_calls"] as const) {
        const { error } = await admin.from(table).delete().eq("file_id", id);
        if (error) throw new Error(`Unknown-build derivative cleanup failed: ${table}`);
      }
      throw new Error("Genome build is unknown or conflicting; a supported reference build is required");
    }

    // Runs of homozygosity, measured once in the file's own coordinates from
    // the variant records and the reference calls the parser kept (chrom,
    // pos, genotype, ref), before any liftover so the two share one build
    // and no call is lost to an unmapped interval; stored with the file
    // below (ADR 0017 §7, D-030, D-040). A fact about this one file.
    const runs = measureRunsOfHomozygosity(rohCallsFromParse(parsed));

    let records = parsed.records;
    let observed = (parsed.observedCalls ?? []).map((source) => ({ source, normalized: { ...source } as VariantRecord }));
    let unmapped = 0;
    if (parsed.build === "GRCh37") {
      const chainGz = await fs.readFile(
        path.join(process.cwd(), "data/ref/chain/GRCh37_to_GRCh38.chain.gz"),
      );
      const lift = buildLiftover(new Uint8Array(chainGz));
      observed = observed.flatMap(({ source }) => {
        // No-call evidence still needs a canonical locus. Lift its literal
        // REF/ALT without converting the missing genotype to a called result.
        const normalized = liftSingleBaseVariant({ ...source, genotype: source.genotype === "--" ? `${source.ref}/${source.ref}` : source.genotype }, lift);
        if (!normalized) return [];
        if (source.genotype === "--") normalized.genotype = "--";
        return [{ source, normalized }];
      });
      const lifted: VariantRecord[] = [];
      for (const r of records) {
        const mapped = liftSingleBaseVariant(r, lift);
        if (mapped) {
          lifted.push(mapped);
        } else {
          unmapped++;
        }
      }
      records = lifted;
    }

    const { error: observedDeleteError } = await admin.from("report_observed_calls").delete().eq("file_id", id);
    if (observedDeleteError) throw new Error("Observed-call replacement failed");
    for (let i = 0; i < observed.length; i += 1000) {
      const rows = observed.slice(i, i + 1000).map(({ source, normalized }) => ({
        file_id: id, user_id: user.id, subject_id: file.subject_id!,
        source_line: source.line, source_sha256: sourceSha256, extraction_version: OBSERVED_CALL_VERSION,
        source_build: parsed.build, source_chrom: source.chrom, source_pos: source.pos,
        source_ref: source.ref!, source_alt: source.alt!, source_gt: source.sourceGt,
        rsid: source.rsid!, chrom: normalized.chrom, pos: normalized.pos,
        ref: normalized.ref!, alt: normalized.alt!, genotype: normalized.genotype,
        site_filter: source.filter, sample_filter: source.sampleFilter,
        genotype_quality: source.genotypeQuality, read_depth: source.depth,
        quality_state: source.quality, usable: source.usable,
      }));
      const { error } = await admin.from("report_observed_calls").insert(rows);
      if (error) throw new Error("Observed-call insert failed");
    }

    const { error: variantDeleteError } = await admin.from("user_variants").delete().eq("file_id", id);
    if (variantDeleteError) throw new Error("Variant replacement failed");
    const BATCH = 10000;
    for (let i = 0; i < records.length; i += BATCH) {
      const rows = records.slice(i, i + BATCH).map((r) => ({
        user_id: user.id,
        subject_id: file.subject_id,
        file_id: id,
        rsid: r.rsid,
        chrom: r.chrom,
        pos: r.pos,
        ref: r.ref,
        alt: r.alt,
        genotype: r.genotype,
      }));
      const { error } = await admin.from("user_variants").insert(rows);
      if (error) throw new Error(`variant insert failed: ${error.code}`);
    }

    // Ancestry, from in-memory lookups.
    const byPos = new Map<string, VariantRecord>();
    for (const r of records) byPos.set(`${r.chrom}:${r.pos}`, r);
    const getGenotype = (chrom: number, pos: number) =>
      byPos.get(`${chrom}:${pos}`)?.genotype ?? null;
    const getBase = (chrom: number, pos: number) => {
      const g = byPos.get(`${chrom}:${pos}`)?.genotype;
      if (!g) return null;
      const alleles = g.split("/");
      return /^[ACGT]$/.test(alleles[0]) ? alleles[0] : null;
    };

    const { error: ancestryDeleteError } = await admin.from("ancestry_results").delete().eq("file_id", id);
    if (ancestryDeleteError) throw new Error("Ancestry replacement failed");
    // One row shape for the whole bulk insert: PostgREST fills a key that
    // some rows omit with null, not the column default, so every row states
    // its state columns explicitly (a null result_state violates NOT NULL).
    type AncestryRow = {
      user_id: string;
      subject_id: string;
      file_id: string;
      kind: "admixture" | "mtdna" | "ydna";
      result: never;
      support_note: string;
      model_id: string | null;
      model_version: string | null;
      coverage: number | null;
      result_state: "available" | "partial" | "not_covered";
    };
    const ancestryRows: AncestryRow[] = [];
    // A lineage row's state: available when a haplogroup was called, partial
    // when markers were tested but no call was supported, not covered when
    // the file has no positions on that chromosome. The haplogroup trees carry
    // no registered model id yet, so those columns stay null (D-019).
    const lineageColumns = (call: HaplogroupCall | null) => ({
      model_id: null,
      model_version: null,
      coverage: call && call.tested > 0 ? call.matched / call.tested : null,
      result_state: call === null ? "not_covered" : call.haplogroup ? "available" : "partial",
    } as const);

    const admix = await estimateAdmixture(getGenotype);
    if (admix) {
      // The panel the estimate was computed against and the state it is in:
      // available once the file supplies the reliable fraction of the panel,
      // partial below it, not covered when it supplies no marker at all. The
      // ancestry page reads the stored result, never these columns.
      const coverage = admix.markersUsed / AIMS.length;
      ancestryRows.push({
        user_id: user.id,
        subject_id: file.subject_id,
        file_id: id,
        kind: "admixture",
        result: admix as never,
        support_note: admix.note,
        model_id: PANEL.id,
        model_version: PANEL.version,
        coverage,
        result_state:
          admix.markersUsed === 0 ? "not_covered" : coverage >= RELIABLE_FRACTION ? "available" : "partial",
      });
    }

    const hasMt = records.some((r) => r.chrom === 25);
    const mt = hasMt ? classify("mtDNA", getBase) : null;
    ancestryRows.push({
      user_id: user.id,
      subject_id: file.subject_id,
      file_id: id,
      kind: "mtdna",
      result: (mt ?? { haplogroup: null }) as never,
      support_note: mt
        ? mt.note
        : "Your file contains no mitochondrial positions, so an mtDNA haplogroup cannot be estimated from it.",
      ...lineageColumns(mt),
    });

    const hasY = records.some((r) => r.chrom === 24);
    const y = hasY ? classify("Y", getBase) : null;
    ancestryRows.push({
      user_id: user.id,
      subject_id: file.subject_id,
      file_id: id,
      kind: "ydna",
      result: (y ?? { haplogroup: null }) as never,
      support_note: y
        ? y.note
        : "Your file contains no Y-chromosome positions (expected for XX genomes and some file types), so no Y haplogroup is estimated.",
      ...lineageColumns(y),
    });

    const { error: ancestryError } = await admin
      .from("ancestry_results")
      .insert(ancestryRows);
    if (ancestryError) {
      throw new Error(`ancestry insert failed: ${ancestryError.code}`);
    }

    // Polygenic scores from the bundled seed data.
    const prsLookup = new Map(
      records.map((r) => [
        `${r.chrom}:${r.pos}`,
        { genotype: r.genotype, ref: r.ref, alt: r.alt },
      ]),
    );
    const { error: prsDeleteError } = await admin.from("user_prs").delete().eq("file_id", id);
    if (prsDeleteError) throw new Error("Polygenic replacement failed");
    const prsRows = ALL_PRS_SCORES.map((score) => {
      const result = computePrs(prsLookup, score);
      return {
        user_id: user.id,
        subject_id: file.subject_id,
        file_id: id,
        pgs_id: score.pgs_id,
        raw_score: result.raw,
        zscore: result.zscore,
        percentile: result.percentile,
        coverage: result.coverage,
        matched: result.matched,
      };
    });
    if (prsRows.length > 0) {
      // An unchecked failure here once hid an FK violation (unseeded
      // prs_scores catalog) — the file showed as processed with no PRS.
      const { error: prsError } = await admin.from("user_prs").insert(prsRows);
      if (prsError) throw new Error(`prs insert failed: ${prsError.code}`);
    }

    const finishedAt = new Date().toISOString();
    const { error: fileError } = await admin
      .from("genome_files")
      .update({
        status: "annotated",
        // genome_files describes the uploaded source; user_variants remains
        // the canonical GRCh38 store. Do not erase the source assembly.
        build: parsed.build,
        observed_call_sha256: parsed.observedCalls ? sourceSha256 : null,
        observed_call_version: parsed.observedCalls ? OBSERVED_CALL_VERSION : null,
        variant_count: records.length,
        processing_finished_at: finishedAt,
        ...rohColumns(runs, finishedAt),
      })
      .eq("id", id);
    if (fileError) throw new Error(`file update failed: ${fileError.code}`);

    const { count: templateCount } = await admin
      .from("report_templates")
      .select("slug", { count: "exact", head: true })
      .eq("status", "published");
    if (user.email) {
      try {
        await enqueueAccountMail({
          accountId: user.id,
          email: user.email,
          mail: {
            id: "report-ready",
            payload: {
              reportCount: templateCount ?? 0,
              dashboardUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/genome/me/reports`,
            },
          },
          purpose: "report.ready",
          targetKind: "genome_file",
          targetId: file.id,
          semanticKey: `annotated:${file.id}`,
        });
      } catch {
        console.error("[mail] report-ready enqueue failed");
      }
    }

    return NextResponse.json({
      status: "annotated",
      variants: records.length,
      skipped: parsed.skipped,
      unmapped,
      sourceBuild: parsed.build,
      normalizedBuild: "GRCh38",
    });
  } catch (err) {
    // Error text must never contain genotype data — only mechanics.
    const message = err instanceof Error ? err.message : "processing failed";
    await admin
      .from("genome_files")
      .update({
        status: "failed",
        error: message.slice(0, 500),
        processing_finished_at: new Date().toISOString(),
      })
      .eq("id", id);
    return new Response(`Processing failed: ${message}`, { status: 500 });
  }
}
