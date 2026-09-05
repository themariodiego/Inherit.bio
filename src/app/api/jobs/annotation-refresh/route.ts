import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bindEnsemblFrequencies, type EnsemblVariation } from "@/lib/genome/reference-evidence";

export const maxDuration = 300;

// Scheduled enrichment of the reference store (ADR-0005). Fetches ClinVar
// allele-bound population frequencies for the rsIDs in OUR OWN template
// catalog from Ensembl REST — identical requests regardless of which users
// exist, so outbound traffic cannot encode any user's genotype set. Runs in
// batches of 200 stale rows; repeated runs converge.
const BATCH = 200;
const STALE_DAYS = 7;

function authorized(request: Request): boolean {
  const auth = request.headers.get("authorization");
  for (const secret of [process.env.JOBS_SECRET, process.env.CRON_SECRET]) {
    if (secret && auth === `Bearer ${secret}`) return true;
  }
  return false;
}

async function runRefresh() {
  const admin = createAdminClient();
  const staleBefore = new Date(
    Date.now() - STALE_DAYS * 24 * 3600 * 1000,
  ).toISOString();

  const { data: stale, error: readError } = await admin
    .from("ref_variants")
    .select("rsid, chrom, pos38, ref, alt, sources")
    .lt("updated_at", staleBefore)
    .order("updated_at", { ascending: true })
    .limit(BATCH);
  if (readError) return new Response("Reference read failed", { status: 503 });
  if (!stale || stale.length === 0) {
    return NextResponse.json({ enriched: 0, note: "reference store fresh" });
  }

  const ids = stale.map((r) => `rs${r.rsid}`);
  const res = await fetch("https://rest.ensembl.org/variation/homo_sapiens?pops=1", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    return new Response(`Ensembl ${res.status}`, { status: 502 });
  }
  const byId = (await res.json()) as Record<string, EnsemblVariation>;

  let enriched = 0;
  const now = new Date().toISOString();
  for (const row of stale) {
    const v = byId[`rs${row.rsid}`];
    const bound = bindEnsemblFrequencies(row, v);
    const sources = row.sources && typeof row.sources === "object" && !Array.isArray(row.sources) ? row.sources : {};
    const { error: updateError } = await admin
      .from("ref_variants")
      .update({
        // Legacy rsID-wide labels have no allele-specific provenance. Clear
        // them, including when the source no longer returns the rsID.
        clinvar_significance: null,
        clinvar_review_status: null,
        gnomad_af: bound.gnomad_af,
        gnomad_af_by_pop: bound.gnomad_af_by_pop,
        sources: {
          ...sources,
          enriched_via: "ensembl-rest",
          frequency_binding: bound.frequency_binding,
          clinical_binding: "unavailable-rsid-only",
          enriched_at: now,
        } as never,
        updated_at: now,
      })
      .eq("rsid", row.rsid);
    if (updateError) return new Response("Reference update failed", { status: 503 });
    enriched++;
  }

  return NextResponse.json({ enriched, batch: stale.length });
}

export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  return runRefresh();
}

export async function POST(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  return runRefresh();
}
