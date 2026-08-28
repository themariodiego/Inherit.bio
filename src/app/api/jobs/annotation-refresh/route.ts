import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

// Scheduled enrichment of the reference store (ADR-0005). Fetches ClinVar
// significance and population frequencies for the rsIDs in OUR OWN template
// catalog from Ensembl REST — identical requests regardless of which users
// exist, so outbound traffic cannot encode any user's genotype set. Runs in
// batches of 200 stale rows; repeated runs converge.
const BATCH = 200;
const STALE_DAYS = 7;

interface EnsemblVariation {
  name?: string;
  MAF?: number | null;
  minor_allele_freq?: number | null;
  clinical_significance?: string[];
  mappings?: { assembly_name: string; seq_region_name: string; start: number }[];
  populations?: { population: string; allele: string; frequency: number }[];
}

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

  const { data: stale } = await admin
    .from("ref_variants")
    .select("rsid")
    .lt("updated_at", staleBefore)
    .order("updated_at", { ascending: true })
    .limit(BATCH);
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
    if (!v) {
      // Mark checked so unknown rsIDs don't wedge the batch cursor.
      await admin
        .from("ref_variants")
        .update({ updated_at: now })
        .eq("rsid", row.rsid);
      continue;
    }
    const gnomad = (v.populations ?? []).filter((p) =>
      p.population.startsWith("gnomADg:ALL") || p.population.startsWith("gnomADe:ALL"),
    );
    const byPop: Record<string, number> = {};
    for (const p of v.populations ?? []) {
      const m = /^gnomADg:(\w+)$/.exec(p.population);
      if (m && m[1] !== "ALL") byPop[m[1]] = p.frequency;
    }
    await admin
      .from("ref_variants")
      .update({
        clinvar_significance: v.clinical_significance?.length
          ? v.clinical_significance.join(", ")
          : null,
        gnomad_af: gnomad.length > 0 ? gnomad[0].frequency : null,
        gnomad_af_by_pop: Object.keys(byPop).length > 0 ? byPop : null,
        sources: {
          enriched_via: "ensembl-rest",
          ensembl_maf: v.minor_allele_freq ?? v.MAF ?? null,
          enriched_at: now,
        } as never,
        updated_at: now,
      })
      .eq("rsid", row.rsid);
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
