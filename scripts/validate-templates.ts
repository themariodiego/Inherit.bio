// Validates every report-template seed file against the schema rules in
// data/templates/SCHEMA.md. Run: pnpm tsx scripts/validate-templates.ts
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
import { readabilitySentences, wordCount } from "./readability";
import { studyContextFindings, readStudyContext } from "../src/lib/genome/study-context";

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
  // ADR 0021: the Medicines category’s per-position reports.
  "pharmacogenomics",
]);

/** Legacy slug of the Medicines category (ADR 0021). */
export const MEDICINES_CATEGORY = "pharmacogenomics";

/** An ISO calendar date, the only form an access date takes in a seed file. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const EVIDENCE = new Set<string>(EVIDENCE_LEVELS);
const LAYER_SET = new Set<string>(LAYERS);
const ESTIMATE_KIND_SET = new Set<string>(ESTIMATE_KINDS);

/**
 * Banned language, matched against the whole serialised template. The last
 * entry is the §6.4 blocklist’s treatment-advice row (brief line 913):
 * `we recommend you take`, `\bdosage\b` and `\bsupplement\b` are banned
 * outside a refusal string, because Inherit gives information, not
 * treatment advice. Template prose is never a refusal string.
 */
export const BANNED_PATTERNS: readonly [RegExp, string][] = [
  [/100%\s*of\s*your\s*DNA/i, "coverage inflation"],
  [/clinical[- ]grade/i, "clinical-grade claim"],
  [/\bdiagnos(e|is|tic)\b/i, "diagnostic language"],
  [/you (have|will develop|are going to)/i, "deterministic claim"],
  [/\bcures?\b|\btreats?\b/i, "treatment claim"],
  [/\bdosage\b|\bsupplement\b|we recommend you take/i, "treatment advice (§6.4)"],
];

/** The label of every banned pattern the text matches, in pattern order. */
export function bannedLanguage(text: string): string[] {
  return BANNED_PATTERNS.filter(([re]) => re.test(text)).map(([, why]) => why);
}

/**
 * Rows for the Medicines category only (ADR 0021), matched against the whole
 * serialised template. A Medicines report says which letters the file shows
 * at a position a prescribing guideline names, which named forms carry that
 * letter, and what the position cannot tell the reader — never a metabolizer
 * phenotype, a response, a dose direction or a drug choice, because none of
 * those follows from one position of an unphased file.
 */
export const MEDICINES_BANNED_PATTERNS: readonly [RegExp, string][] = [
  [/\bmetaboli[sz]er(s)?\b/i, "phenotype word (ADR 0021)"],
  [/\b(?:poor|intermediate|normal|rapid|ultrarapid|extensive)\b/i, "phenotype word (ADR 0021)"],
  [/\b(?:no|decreased|reduced|normal|increased)\s+function\b/i, "function label (ADR 0021)"],
  [/\brespon(?:d|ds|ded|ding|se|ses|sive)\b/i, "response language (ADR 0021)"],
  [/\b(?:higher|lower|reduced|increased|standard|starting|adjusted)\s+(?:dose|amount)\b/i, "dose direction (ADR 0021)"],
  [/\b(?:lower|raise|reduce|increase|adjust)\s+(?:the|your|a|this)?\s*(?:dose|amount)\b/i, "dose direction (ADR 0021)"],
  [/\bdosing\b/i, "dose language (ADR 0021)"],
  [/\b(?:take|start|stop|avoid|switch|choose|prescribe)\s+(?:this|that|the|a|an|your)?\s*(?:medicine|medicines|drug|drugs|dose)\b/i, "drug choice (ADR 0021)"],
  [/\bavoid\b|\bstop taking\b|\bstart taking\b|\bswitch(?:ing|ed)?\b|\binstead of\b|\balternatives?\b/i, "drug choice (ADR 0021)"],
  [/\bshould\b[^.]*\b(?:take|use)\b/i, "should-take language (ADR 0021)"],
];

/** The label of every Medicines-only row the text matches, in pattern order. */
export function medicinesBannedLanguage(text: string): string[] {
  return MEDICINES_BANNED_PATTERNS.filter(([re]) => re.test(text)).map(([, why]) => why);
}

/**
 * The prose fields of a template, the ones a reader sees as Inherit's own
 * words: the title, the summary and every interpretation. A citation label
 * is the cited work's own title (a CPIC guideline is called a "dosing"
 * guideline by its authors) and is exempt from the Medicines rows for that
 * reason and no other; every other field is checked.
 */
export function templateProseFields(t: {
  title?: unknown;
  summary?: unknown;
  variants?: { interpretations?: Record<string, unknown> }[];
  citations?: unknown[];
}): string[] {
  const fields: unknown[] = [t.title, t.summary];
  for (const v of t.variants ?? []) fields.push(...Object.values(v.interpretations ?? {}));
  for (const citation of t.citations ?? []) {
    const context = readStudyContext(citation);
    if (context) fields.push(...Object.values(context).map((entry) => entry?.text));
  }
  return fields.filter((field): field is string => typeof field === "string");
}

/** Medicines sentences a reader sees are capped at 25 words, on the readability gate's own splitter. */
export const MEDICINES_SENTENCE_CAP = 25;

export function overlongSentences(text: string): string[] {
  return readabilitySentences(text).filter((sentence) => wordCount(sentence) > MEDICINES_SENTENCE_CAP);
}

/**
 * Optional seed-file provenance (`source`): one entry per outside source the
 * template’s facts were read from, each with a name, an https URL and the
 * ISO date it was read. Not seeded into the database; kept in the file so
 * the currency of a template can be checked against its sources.
 */
export function sourceFindings(source: unknown): string[] {
  if (source == null) return [];
  if (typeof source !== "object" || Array.isArray(source)) return ["source must be an object"];
  const findings: string[] = [];
  for (const [key, entry] of Object.entries(source as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      findings.push(`source.${key} must be an object`);
      continue;
    }
    const { name, url, accessedOn, licence, version, versionNote } = entry as Record<string, unknown>;
    if (typeof name !== "string" || name.trim() === "") findings.push(`source.${key}: missing name`);
    if (typeof url !== "string" || !/^https:\/\/\S+$/.test(url)) findings.push(`source.${key}: url must be https`);
    if (typeof accessedOn !== "string" || !ISO_DATE.test(accessedOn))
      findings.push(`source.${key}: accessedOn must be an ISO date (YYYY-MM-DD)`);
    if (licence !== undefined && (typeof licence !== "string" || licence.trim() === ""))
      findings.push(`source.${key}: licence must be a non-empty string when present`);
    // A source's version is recorded when its endpoint exposes one and is
    // null with a note when it does not; it is never invented.
    if (version !== undefined && version !== null && (typeof version !== "string" || version.trim() === ""))
      findings.push(`source.${key}: version must be a non-empty string or null`);
    if (version === null && (typeof versionNote !== "string" || versionNote.trim() === ""))
      findings.push(`source.${key}: a null version needs a versionNote saying why`);
  }
  return findings;
}

function genotypeKeys(ref: string, alt: string, chrom: number): string[] {
  if (chrom === 24 || chrom === 25) return [ref, alt];
  const het = [ref, alt].sort().join("");
  return [ref + ref, het, alt + alt];
}

function main() {
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
        for (const finding of studyContextFindings(c)) errors.push(`${id}: ${finding}`);
        for (const entry of Object.values(readStudyContext(c) ?? {})) {
          if (!entry) continue;
          for (const finding of nakedRelativeFindings(entry.text))
            errors.push(`${id}: study context ${finding.rule}: ${finding.detail}`);
        }
        if (!c.pmid && !c.doi) errors.push(`${id}: citation missing pmid/doi`);
        if (c.pmid && !/^\d{6,9}$/.test(String(c.pmid)))
          errors.push(`${id}: bad pmid ${c.pmid}`);
        if (!c.label) errors.push(`${id}: citation missing label`);
        // G4.7: an access date, when carried, is an ISO date; Medicines
        // templates must carry one on every citation (ADR 0021).
        if (c.accessedOn !== undefined && !(typeof c.accessedOn === "string" && ISO_DATE.test(c.accessedOn)))
          errors.push(`${id}: citation accessedOn must be an ISO date (YYYY-MM-DD)`);
        if (t.category === MEDICINES_CATEGORY && c.accessedOn === undefined)
          errors.push(`${id}: Medicines citations need accessedOn (ADR 0021)`);
      }
      for (const finding of sourceFindings(t.source)) errors.push(`${id}: ${finding}`);

      // ADR 0021: a Medicines template is a variant_call over positions, with
      // its sources and their access dates in the file, and none of the
      // phenotype, response, dose or drug-choice language its rows forbid.
      if (t.category === MEDICINES_CATEGORY) {
        if (layer !== "variant_call")
          errors.push(`${id}: Medicines templates are variant_call (ADR 0021)`);
        if (t.estimate_kind != null)
          errors.push(`${id}: Medicines templates carry estimate_kind null (ADR 0021)`);
        if (t.source == null) errors.push(`${id}: Medicines templates need a source object (ADR 0021)`);
        // Every prose field, never the serialised template: a citation label
        // is the cited work's own title and is the one exempt field.
        for (const field of templateProseFields(t)) {
          for (const why of medicinesBannedLanguage(field)) {
            errors.push(`${id}: banned language (${why}): ${field.slice(0, 60)}`);
          }
          for (const sentence of overlongSentences(field)) {
            errors.push(`${id}: Medicines sentence has ${wordCount(sentence)} words; maximum is ${MEDICINES_SENTENCE_CAP}: ${sentence.slice(0, 60)}`);
          }
        }
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

      for (const why of bannedLanguage(JSON.stringify(t))) {
        errors.push(`${id}: banned language (${why})`);
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
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
