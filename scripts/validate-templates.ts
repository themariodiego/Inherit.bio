// Validates every report-template seed file against the schema rules in
// data/templates/SCHEMA.md. Run: pnpm tsx scripts/validate-templates.ts
import fs from "node:fs";
import path from "node:path";
import {
  ESTIMATE_KINDS,
  EVIDENCE_LEVELS,
  LAYERS,
  categoryFor,
} from "../src/lib/genome/taxonomy";
import {
  jargonTermList,
  nakedRelativeFindings,
  titleFindings,
} from "../src/lib/genome/template-prose";

const CATEGORIES = new Set([
  "heart-cardiovascular",
  "cancer-risk",
  "brain-health",
  "neurodegenerative",
  "autoimmune",
  "mental-health",
  "longevity",
  "metabolic-obesity",
  "gastrointestinal",
  "environmental-sensitivity",
  "addiction",
  "reproductive-family",
  "aesthetic-cosmetic",
  "basic-traits",
  "lifestyle-wellness",
]);

const EVIDENCE = new Set<string>(EVIDENCE_LEVELS);
const LAYER_SET = new Set<string>(LAYERS);
const ESTIMATE_KIND_SET = new Set<string>(ESTIMATE_KINDS);

const BANNED_PATTERNS: [RegExp, string][] = [
  [/100%\s*of\s*your\s*DNA/i, "coverage inflation"],
  [/clinical[- ]grade/i, "clinical-grade claim"],
  [/\bdiagnos(e|is|tic)\b/i, "diagnostic language"],
  [/you (have|will develop|are going to)/i, "deterministic claim"],
  [/\bcures?\b|\btreats?\b/i, "treatment claim"],
];

// G3.5: the report title is the first heading on the result page.
const JARGON_TERMS = jargonTermList(
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "jargon.json"), "utf8")),
);

const dir = path.join(process.cwd(), "data", "templates");
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();

const errors: string[] = [];
const slugs = new Set<string>();
let total = 0;
const byCategory = new Map<string, number>();

function genotypeKeys(ref: string, alt: string, chrom: number): string[] {
  if (chrom === 24 || chrom === 25) return [ref, alt];
  const het = [ref, alt].sort().join("");
  return [ref + ref, het, alt + alt];
}

for (const file of files) {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  if (!Array.isArray(raw)) {
    errors.push(`${file}: not an array`);
    continue;
  }
  for (const t of raw) {
    const id = `${file}:${t.slug ?? "?"}`;
    total++;
    if (!t.slug || !/^[a-z0-9-]+$/.test(t.slug)) errors.push(`${id}: bad slug`);
    if (slugs.has(t.slug)) errors.push(`${id}: duplicate slug`);
    slugs.add(t.slug);
    if (!CATEGORIES.has(t.category)) errors.push(`${id}: bad category ${t.category}`);
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + 1);
    if (!t.title) errors.push(`${id}: missing title`);
    if (t.title) {
      for (const finding of titleFindings(t.title, JARGON_TERMS)) {
        errors.push(`${id}: title ${finding.rule}: ${finding.detail} ("${t.title}")`);
      }
    }
    // §2.4: no naked relative figure in summary or interpretations.
    if (typeof t.summary === "string") {
      for (const finding of nakedRelativeFindings(t.summary)) {
        errors.push(`${id}: summary ${finding.rule}: ${finding.detail}`);
      }
    }
    if (!t.summary || t.summary.length < 40) errors.push(`${id}: summary too short`);
    if (!EVIDENCE.has(t.evidence)) errors.push(`${id}: bad evidence ${t.evidence}`);
    // Seeds are always published, and 'insufficient' is never published.
    if (t.evidence === "insufficient")
      errors.push(`${id}: evidence 'insufficient' cannot be seeded (seeds publish)`);
    if (CATEGORIES.has(t.category)) {
      try {
        categoryFor({ slug: t.slug, category: t.category });
      } catch (err) {
        errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Layer / estimate kind: optional in seed files, derived at seed time the
    // same way scripts/seed.ts derives them; mirrors the report_templates
    // CHECK constraints.
    if (t.layer != null && !LAYER_SET.has(t.layer))
      errors.push(`${id}: bad layer ${t.layer}`);
    if (t.estimate_kind != null && !ESTIMATE_KIND_SET.has(t.estimate_kind))
      errors.push(`${id}: bad estimate_kind ${t.estimate_kind}`);
    const layer: string = t.layer ?? "estimate";
    const estimateKind: string | null =
      t.estimate_kind ?? (t.pgs_id != null ? "polygenic_score" : "single_locus");
    if (layer === "estimate" && !ESTIMATE_KIND_SET.has(estimateKind ?? ""))
      errors.push(`${id}: estimate templates need estimate_kind single_locus|polygenic_score`);
    if (layer === "variant_call" && (t.pgs_id != null || (t.variants ?? []).length === 0))
      errors.push(`${id}: variant_call templates need variants and no pgs_id`);
    if (estimateKind === "polygenic_score" && t.pgs_id == null)
      errors.push(`${id}: polygenic_score templates need a pgs_id`);
    if (
      estimateKind === "polygenic_score" &&
      (t.evidence === "preliminary" || t.evidence === "insufficient")
    )
      errors.push(`${id}: a polygenic score cannot be published at ${t.evidence}`);

    const cites = t.citations ?? [];
    if (!Array.isArray(cites) || cites.length === 0)
      errors.push(`${id}: no citations`);
    for (const c of cites) {
      if (!c.pmid && !c.doi) errors.push(`${id}: citation missing pmid/doi`);
      if (c.pmid && !/^\d{6,9}$/.test(String(c.pmid)))
        errors.push(`${id}: bad pmid ${c.pmid}`);
      if (!c.label) errors.push(`${id}: citation missing label`);
    }

    const isPrs = t.pgs_id != null;
    const variants = t.variants ?? [];
    if (!isPrs && variants.length === 0)
      errors.push(`${id}: no variants and no pgs_id`);
    if (isPrs && !/^PGS\d{6}$/.test(t.pgs_id))
      errors.push(`${id}: bad pgs_id ${t.pgs_id}`);

    for (const v of variants) {
      if (typeof v.rsid !== "number") errors.push(`${id}: rsid must be numeric`);
      if (typeof v.chrom !== "number" || v.chrom < 1 || v.chrom > 25)
        errors.push(`${id}: bad chrom`);
      if (typeof v.pos38 !== "number" || v.pos38 < 1)
        errors.push(`${id}: bad pos38`);
      if (!v.gene) errors.push(`${id}: missing gene`);
      if (!/^[ACGT]+$/.test(v.ref ?? "") || !/^[ACGT]+$/.test(v.alt ?? ""))
        errors.push(`${id}: bad ref/alt`);
      const interp = v.interpretations ?? {};
      // Every possible genotype must have an interpretation keyed EXACTLY as
      // reports.ts genotypeKey() produces it (alleles sorted, joined without a
      // separator). This covers indels too — a slash in an indel key is the
      // bug that silently made the CFTR report unreachable.
      for (const key of genotypeKeys(v.ref, v.alt, v.chrom)) {
        if (!interp[key])
          errors.push(`${id}: missing interpretation for genotype key "${key}"`);
      }
      for (const key of Object.keys(interp)) {
        if (key.includes("/"))
          errors.push(`${id}: interpretation key "${key}" contains "/" (reports.ts strips it; use the sorted no-separator form)`);
      }
      for (const [k, text] of Object.entries(interp)) {
        if (typeof text === "string") {
          for (const finding of nakedRelativeFindings(text)) {
            errors.push(`${id}: interpretation ${k} ${finding.rule}: ${finding.detail}`);
          }
        }
        if (typeof text !== "string" || text.length < 20)
          errors.push(`${id}: interpretation ${k} too short`);
      }
    }

    const allText = JSON.stringify(t);
    for (const [re, why] of BANNED_PATTERNS) {
      if (re.test(allText)) errors.push(`${id}: banned language (${why})`);
    }
  }
}

console.log(`templates: ${total} across ${byCategory.size} categories`);
for (const [cat, n] of [...byCategory.entries()].sort()) {
  console.log(`  ${cat}: ${n}`);
}
if (total < 120) errors.push(`only ${total} templates; launch floor is 120`);
if (byCategory.size < 12)
  errors.push(`only ${byCategory.size} categories; floor is 12`);

if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("all template seeds valid");
