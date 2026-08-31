import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { sendReportReady } from "@/lib/email";
import { estimateAdmixture } from "@/lib/genome/admixture";
import { classify } from "@/lib/genome/haplogroups";
import { buildLiftover } from "@/lib/genome/liftover";
import { parseArray, type ArrayKind } from "@/lib/genome/parsers/array";
import { computePrs } from "@/lib/genome/prs";
import { ALL_PRS_SCORES } from "@/lib/genome/prs-data";
import { toLines } from "@/lib/genome/parsers/lines";
import { parseVcf } from "@/lib/genome/parsers/vcf";
import type { ParseResult, VariantRecord } from "@/lib/genome/types";
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
  if (file.tier !== 1) {
    return new Response("Only Tier-1 files are processed serverside", {
      status: 400,
    });
  }
  if (!file.subject_id) {
    return new Response("File subject binding is unavailable", { status: 409 });
  }
  // Defense in depth: the object is fetched below with the service-role key,
  // which bypasses storage RLS. bucket_path is client-set, so refuse any path
  // not under this user's own prefix — otherwise a user could point their row
  // at another user's object and have its variants loaded into their account.
  if (!file.bucket_path.startsWith(`${user.id}/`)) {
    return new Response("Invalid file path", { status: 400 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      "This deployment is not fully configured: SUPABASE_SERVICE_ROLE_KEY is missing, so files cannot be processed. Set it in the hosting environment and redeploy (see docs/deployment.md).",
      { status: 503 },
    );
  }

  const admin = createAdminClient();
  await admin
    .from("genome_files")
    .update({ status: "parsing", processing_started_at: new Date().toISOString(), error: null })
    .eq("id", id);

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

    const lines = toLines(res.body);
    let parsed: ParseResult;
    if (ARRAY_KINDS.has(file.file_type)) {
      parsed = await parseArray(lines, file.file_type as ArrayKind);
    } else if (file.file_type === "vcf" || file.file_type === "gvcf") {
      parsed = await parseVcf(lines);
    } else {
      throw new Error(`unsupported tier-1 type ${file.file_type}`);
    }

    let records = parsed.records;
    let unmapped = 0;
    if (parsed.build === "GRCh37") {
      const chainGz = await fs.readFile(
        path.join(process.cwd(), "data/ref/chain/GRCh37_to_GRCh38.chain.gz"),
      );
      const lift = buildLiftover(new Uint8Array(chainGz));
      const lifted: VariantRecord[] = [];
      for (const r of records) {
        const mapped = lift(r.chrom, r.pos);
        if (mapped) {
          lifted.push({ ...r, chrom: mapped.chrom, pos: mapped.pos });
        } else {
          unmapped++;
        }
      }
      records = lifted;
    }

    await admin.from("user_variants").delete().eq("file_id", id);
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

    await admin.from("ancestry_results").delete().eq("file_id", id);
    const ancestryRows = [];

    const admix = await estimateAdmixture(getGenotype);
    if (admix) {
      ancestryRows.push({
        user_id: user.id,
        subject_id: file.subject_id,
        file_id: id,
        kind: "admixture",
        result: admix as never,
        support_note: admix.note,
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
    await admin.from("user_prs").delete().eq("file_id", id);
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

    await admin
      .from("genome_files")
      .update({
        status: "annotated",
        build: "GRCh38",
        variant_count: records.length,
        processing_finished_at: new Date().toISOString(),
      })
      .eq("id", id);

    const { count: templateCount } = await admin
      .from("report_templates")
      .select("slug", { count: "exact", head: true })
      .eq("status", "published");
    if (user.email) {
      await sendReportReady(user.email, {
        fileName: file.original_name,
        reportCount: templateCount ?? 0,
        dashboardUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/genome/me/reports`,
      }, `report-ready-${file.id}`);
    }

    return NextResponse.json({
      status: "annotated",
      variants: records.length,
      skipped: parsed.skipped,
      unmapped,
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
