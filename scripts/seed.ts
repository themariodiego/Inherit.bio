// Seeds reference data into a Supabase project: provider directory, report
// templates, PRS scores/weights, and the base ref_variants rows derived from
// template variants. Idempotent (upserts). Requires service-role env:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Run: pnpm seed
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import type {
  EstimateKind,
  EvidenceLevel,
  FindingLayer,
} from "../src/lib/genome/taxonomy";
import type { Database } from "../src/lib/supabase/types";
import { seedLayerAndKind } from "./seed-layer";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example).",
  );
  process.exit(1);
}
const db = createClient<Database>(url, key, {
  auth: { persistSession: false },
});

const root = path.join(__dirname, "..");

async function seedProviders() {
  const providers = JSON.parse(
    fs.readFileSync(path.join(root, "data/providers/providers.json"), "utf8"),
  ) as Record<string, unknown>[];
  const rows = providers.map((p) => ({
    slug: p.slug as string,
    name: p.name as string,
    website: p.website as string,
    checkout_url: p.checkout_url as string,
    privacy_policy_url: (p.privacy_policy_url as string) || null,
    data_practices_note: (p.data_practices_note as string) || null,
    products: p.products as never,
    raw_formats: p.raw_formats as string[],
    ships_to: p.ships_to as string,
    us_state_exclusions: p.us_state_exclusions as string[],
    us_state_exclusion_notes: (p.us_state_exclusion_notes as string[]) ?? [],
    turnaround: (p.turnaround as string) || null,
    gating: (p.gating as string) || null,
    affiliate: Boolean(p.affiliate),
    source_urls: p.source_urls as string[],
    last_verified_at: p.last_verified_at as string,
    status: (p.status as string) ?? "operating",
    shipping: p.shipping as never,
    verification_summary: (p.verification_summary as string) || null,
  }));
  const { error } = await db
    .from("providers")
    .upsert(rows, { onConflict: "slug" });
  if (error) throw new Error(`providers: ${error.message}`);
  console.log(`providers: ${rows.length}`);
}

interface SeedTemplate {
  slug: string;
  category: string;
  title: string;
  summary: string;
  evidence: EvidenceLevel;
  /** Optional in seed files; derived as 'estimate' when absent. */
  layer?: FindingLayer;
  /** Optional in seed files; derived from pgs_id when absent. */
  estimate_kind?: EstimateKind | null;
  variants: {
    rsid: number;
    gene: string;
    chrom: number;
    pos38: number;
    ref: string;
    alt: string;
    interpretations: Record<string, string>;
  }[];
  pgs_id: string | null;
  citations: { pmid?: string; doi?: string; label: string }[];
}

async function seedTemplates() {
  const dir = path.join(root, "data/templates");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  let total = 0;
  const refVariants = new Map<
    number,
    { chrom: number; pos38: number; ref: string; alt: string; gene: string }
  >();
  for (const file of files) {
    const templates = JSON.parse(
      fs.readFileSync(path.join(dir, file), "utf8"),
    ) as SeedTemplate[];
    for (const t of templates) {
      // Seeds always publish, and an 'insufficient' template is never
      // published (the database CHECK would reject it too).
      if (t.evidence === "insufficient") {
        throw new Error(`${file}: ${t.slug} is 'insufficient' and cannot be seeded as published`);
      }
    }
    const rows = templates.map((t) => ({
      slug: t.slug,
      category: t.category,
      title: t.title,
      summary: t.summary,
      status: "published" as const,
      evidence: t.evidence,
      ...seedLayerAndKind(t),
      variants: t.variants as never,
      pgs_id: t.pgs_id,
      citations: t.citations as never,
      published_at: new Date().toISOString(),
    }));
    const { error } = await db
      .from("report_templates")
      .upsert(rows, { onConflict: "slug" });
    if (error) throw new Error(`${file}: ${error.message}`);
    total += rows.length;
    for (const t of templates) {
      for (const v of t.variants) {
        if (!refVariants.has(v.rsid)) {
          refVariants.set(v.rsid, {
            chrom: v.chrom,
            pos38: v.pos38,
            ref: v.ref,
            alt: v.alt,
            gene: v.gene,
          });
        }
      }
    }
  }
  console.log(`templates: ${total} from ${files.length} categories`);

  const refRows = [...refVariants.entries()].map(([rsid, v]) => ({
    rsid,
    chrom: v.chrom,
    pos38: v.pos38,
    ref: v.ref,
    alt: v.alt,
    gene_symbol: v.gene,
    sources: { seeded_from: "report_templates" } as never,
  }));
  for (let i = 0; i < refRows.length; i += 500) {
    const { error } = await db
      .from("ref_variants")
      .upsert(refRows.slice(i, i + 500), {
        onConflict: "rsid",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`ref_variants: ${error.message}`);
  }
  console.log(`ref_variants: ${refRows.length}`);
}

interface SeedPrs {
  pgs_id: string;
  name: string;
  trait: string;
  n_variants: number;
  citation: { pmid?: string; doi?: string; label: string };
  source_url: string;
  license_note: string;
  ancestry_note: string;
  variants: {
    rsid: number | null;
    chrom: number;
    pos38: number;
    effect_allele: string;
    other_allele: string | null;
    weight: number;
    effect_af: number | null;
  }[];
}

async function seedPrs() {
  const dir = path.join(root, "data/prs");
  if (!fs.existsSync(dir)) {
    console.log("prs: no data/prs directory, skipping");
    return;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const score = JSON.parse(
      fs.readFileSync(path.join(dir, file), "utf8"),
    ) as SeedPrs;
    const { error } = await db.from("prs_scores").upsert(
      {
        pgs_id: score.pgs_id,
        name: score.name,
        trait: score.trait,
        n_variants: score.n_variants,
        citation: score.citation as never,
        source_url: score.source_url,
        ancestry_note: score.ancestry_note,
      },
      { onConflict: "pgs_id" },
    );
    if (error) throw new Error(`${file}: ${error.message}`);

    await db.from("prs_weights").delete().eq("pgs_id", score.pgs_id);
    const weightRows = score.variants.map((v) => ({
      pgs_id: score.pgs_id,
      chrom: v.chrom,
      pos38: v.pos38,
      effect_allele: v.effect_allele,
      other_allele: v.other_allele,
      weight: v.weight,
      rsid: v.rsid,
    }));
    for (let i = 0; i < weightRows.length; i += 1000) {
      const { error: wError } = await db
        .from("prs_weights")
        .insert(weightRows.slice(i, i + 1000));
      if (wError) throw new Error(`${file} weights: ${wError.message}`);
    }
    console.log(`prs: ${score.pgs_id} (${weightRows.length} weights)`);
  }
}

async function main() {
  await seedProviders();
  await seedTemplates();
  await seedPrs();
  console.log("seed complete");
}

void main();
