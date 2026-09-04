import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bannedLanguage,
  medicinesBannedLanguage,
  MEDICINES_CATEGORY,
} from "../../../scripts/validate-templates";
import {
  CATEGORY_DESCRIPTIONS,
  NOTHING_TO_DO,
  WHAT_YOU_CAN_DO_MEDICINES,
  whatYouCanDo,
} from "../../copy/reports/strings";
import { genotypeKey, resolveVariant, type Citation, type TemplateVariant } from "./reports";
import {
  CATEGORY_TAXONOMY,
  LEGACY_CATEGORY_DEFAULTS,
  TEMPLATE_CATEGORY_EXCEPTIONS,
  categoryFor,
  type CategoryId,
} from "./taxonomy";

// The Medicines category ships as per-position reports (ADR 0021, which
// supersedes ADR 0018). This file pins the shipped state — what every
// Medicines template is, says and never says — and keeps the pins from the
// dossier (docs/withheld/pharmacogenomics.md, element 4) for the candidates
// ADR 0021 still excludes, read from the built designs under
// docs/withheld/pharmacogenomics/designs/ so the evidence and the tests
// cannot drift apart. Every failure names the rule that produces it.

const REPO = new URL("../../../", import.meta.url);
const DESIGNS = new URL("../../../docs/withheld/pharmacogenomics/designs/", import.meta.url);

interface SeedTemplate {
  slug: string;
  category: string;
  title: string;
  summary: string;
  evidence: string;
  layer?: string;
  estimate_kind?: string | null;
  variants: TemplateVariant[];
  pgs_id: string | null;
  citations: Citation[];
  source?: Record<string, { name: string; url: string; accessedOn: string; licence?: string }>;
}

interface FixtureTemplate {
  slug: string;
  category: string;
  title: string;
  summary: string;
  variants: TemplateVariant[];
}

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, REPO)), "utf8");
}

function loadDesign(relative: string): FixtureTemplate[] {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, DESIGNS)), "utf8")) as FixtureTemplate[];
}

const medicines = JSON.parse(source("data/templates/medicines.json")) as SeedTemplate[];
const design1 = loadDesign("1-guideline-statement/medicines.json");
const design3 = loadDesign("3-diplotype-caller/medicines.json");
const design3TwoEntry = loadDesign("3-diplotype-caller/medicines.two-entry.json");

/** The day every fact in the templates was read (docs/design/pharmacogenomics-research-2026-09-03.md). */
const READ_ON = "2026-09-03";

/**
 * The shipped positions: GRCh38 coordinate, reference and CPIC alternate
 * allele, and the verified guideline PMID(s), each from the research note’s
 * §3.1 table and §3.2 citation table (three sources in agreement for every
 * coordinate; PubMed and CPIC’s own publication table for every PMID).
 */
const SHIPPED: Record<
  string,
  { rsid: number; gene: string; chrom: number; pos38: number; ref: string; alt: string; pmids: string[] }
> = {
  "vkorc1-rs9923231-one-position": { rsid: 9923231, gene: "VKORC1", chrom: 16, pos38: 31096368, ref: "C", alt: "T", pmids: ["28198005"] },
  "cyp2c19-rs4244285-one-position": { rsid: 4244285, gene: "CYP2C19", chrom: 10, pos38: 94781859, ref: "G", alt: "A", pmids: ["35034351"] },
  "cyp2c19-rs12248560-one-position": { rsid: 12248560, gene: "CYP2C19", chrom: 10, pos38: 94761900, ref: "C", alt: "T", pmids: ["35034351"] },
  "cyp2c9-rs1799853-one-position": { rsid: 1799853, gene: "CYP2C9", chrom: 10, pos38: 94942290, ref: "C", alt: "T", pmids: ["28198005", "32189324"] },
  "cyp2c9-rs1057910-one-position": { rsid: 1057910, gene: "CYP2C9", chrom: 10, pos38: 94981296, ref: "A", alt: "C", pmids: ["28198005", "32189324"] },
  "slco1b1-rs4149056-one-position": { rsid: 4149056, gene: "SLCO1B1", chrom: 12, pos38: 21178615, ref: "T", alt: "C", pmids: ["35152405"] },
  "tpmt-rs1800462-one-position": { rsid: 1800462, gene: "TPMT", chrom: 6, pos38: 18143724, ref: "C", alt: "G", pmids: ["41618934"] },
  "tpmt-rs1800460-one-position": { rsid: 1800460, gene: "TPMT", chrom: 6, pos38: 18138997, ref: "C", alt: "T", pmids: ["41618934"] },
  "nudt15-rs116855232-one-position": { rsid: 116855232, gene: "NUDT15", chrom: 13, pos38: 48045719, ref: "C", alt: "T", pmids: ["41618934"] },
  "dpyd-rs3918290-one-position": { rsid: 3918290, gene: "DPYD", chrom: 1, pos38: 97450058, ref: "C", alt: "T", pmids: ["29152729"] },
  "cyp3a5-rs776746-one-position": { rsid: 776746, gene: "CYP3A5", chrom: 7, pos38: 99672916, ref: "T", alt: "C", pmids: ["25801146"] },
};

/** The one sentence the DPYD report must lead with (the note’s fact; brief-critical false-reassurance case). */
const DPYD_SENTENCE =
  "C on both copies here does not rule out a DPYD deficiency, because other positions cause it.";

/** Words no Medicines report body may carry: §6.4’s rows plus the phenotype and response words of ADR 0021. */
const FORBIDDEN_IN_BODY = /\bdosage\b|\bsupplement\b|we recommend you take|metaboli[sz]er|\brespon(?:d|ds|ded|ding|se|ses|sive)\b/i;

/** The candidates ADR 0021 excludes, by the names and rsIDs the research note verifies for them. */
const EXCLUDED = /CYP2D6|HLA-B|HCP5|rs2395029|IFNL3|IFNL4|rs12979860|UGT1A1|rs3064744|rs1142345|G6PD|rs1050828|rs1050829/;

describe("the Medicines category ships (ADR 0021)", () => {
  it("is one of the nine categories and is reached only through the pharmacogenomics slug", () => {
    expect(CATEGORY_TAXONOMY.map((category) => category.id)).toContain("medicines");
    expect(CATEGORY_TAXONOMY).toHaveLength(9);
    expect(LEGACY_CATEGORY_DEFAULTS[MEDICINES_CATEGORY]).toBe("medicines");
    expect(
      Object.entries(LEGACY_CATEGORY_DEFAULTS).filter(([, id]) => id === "medicines").map(([slug]) => slug),
    ).toEqual([MEDICINES_CATEGORY]);
    expect(Object.values(TEMPLATE_CATEGORY_EXCEPTIONS)).not.toContain("medicines");
  });

  it("carries the eleven templates the research note verifies, and nothing else", () => {
    expect(medicines.map((template) => template.slug).sort()).toEqual(Object.keys(SHIPPED).sort());
    for (const template of medicines) {
      expect(template.category, template.slug).toBe(MEDICINES_CATEGORY);
      expect(categoryFor(template), template.slug).toBe<CategoryId>("medicines");
    }
  });

  it("is a variant call at the rubric level the research note allows, with one position per report", () => {
    for (const template of medicines) {
      // Brief line 1163 places pharmacogenomic star alleles in variant_call;
      // the rubric’s `clinical` is ACMG/AMP P/LP and `established` needs the
      // sibling check, so `emerging` is the level defined for a guideline
      // position (research note §4 item 13; ADR 0011).
      expect(template.layer, template.slug).toBe("variant_call");
      expect(template.estimate_kind, template.slug).toBeNull();
      expect(template.evidence, template.slug).toBe("emerging");
      expect(template.pgs_id, template.slug).toBeNull();
      expect(template.variants, template.slug).toHaveLength(1);
    }
  });

  it("reads the note’s verified GRCh38 coordinate, reference and CPIC alternate allele at every position", () => {
    for (const template of medicines) {
      const expected = SHIPPED[template.slug];
      const [variant] = template.variants;
      expect(
        { rsid: variant.rsid, gene: variant.gene, chrom: variant.chrom, pos38: variant.pos38, ref: variant.ref, alt: variant.alt },
        template.slug,
      ).toEqual({ rsid: expected.rsid, gene: expected.gene, chrom: expected.chrom, pos38: expected.pos38, ref: expected.ref, alt: expected.alt });
      // Every diploid key the validator derives resolves to a genotyped outcome.
      const het = [variant.ref, variant.alt].sort().join("");
      for (const key of [variant.ref + variant.ref, het, variant.alt + variant.alt]) {
        const outcome = resolveVariant(variant, `${key[0]}/${key[1]}`);
        expect(outcome.status, `${template.slug} ${key}`).toBe("genotyped");
        expect(outcome.status === "genotyped" && outcome.interpretation.startsWith("Your file shows"), key).toBe(true);
      }
    }
  });

  it("cites the verified guideline PMID(s) and the day each source was read, with CPIC and dbSNP named as sources", () => {
    for (const template of medicines) {
      expect(template.citations.map((citation) => citation.pmid).sort(), template.slug).toEqual(
        [...SHIPPED[template.slug].pmids].sort(),
      );
      for (const citation of template.citations) {
        expect(citation.label, template.slug).toMatch(/^CPIC guideline for /);
        expect(citation.accessedOn, template.slug).toBe(READ_ON);
      }
      const provenance = template.source!;
      expect(Object.keys(provenance).sort(), template.slug).toEqual(["cpic", "dbsnp"]);
      expect(provenance.cpic.licence, template.slug).toMatch(/^CC0 1\.0/);
      expect(provenance.cpic.url, template.slug).toMatch(/^https:\/\/api\.cpicpgx\.org\/v1\//);
      expect(provenance.dbsnp.url, template.slug).toBe(
        `https://api.ncbi.nlm.nih.gov/variation/v0/refsnp/${template.variants[0].rsid}`,
      );
      for (const entry of Object.values(provenance)) expect(entry.accessedOn, template.slug).toBe(READ_ON);
    }
  });

  it("says which letters the file shows, which named forms carry that letter, and what the position cannot tell the reader", () => {
    for (const template of medicines) {
      // Slot 2 (brief line 949): the single most important thing it cannot say.
      expect(template.summary, template.slug).toMatch(/cannot say|says nothing about|is not a \*\d+A? call/);
      for (const [key, text] of Object.entries(template.variants[0].interpretations)) {
        expect(text, `${template.slug} ${key}`).toMatch(/^Your file shows [ACGT] on (?:both copies|one copy and [ACGT] on the other)/);
      }
      // The named form(s), by CPIC’s star name or VKORC1’s two named forms.
      const text = JSON.stringify(template.variants[0].interpretations);
      expect(text, template.slug).toMatch(/\*\d+[AB]?\b|reference form of VKORC1/);
    }
  });

  it("carries no dosage, supplement, metabolizer, response, frequency or effect-size language, and trips no gate row", () => {
    for (const template of medicines) {
      const text = JSON.stringify(template);
      expect(text, `${template.slug}: §6.4 and ADR 0021 words`).not.toMatch(FORBIDDEN_IN_BODY);
      expect(text, `${template.slug}: no % anywhere`).not.toMatch(/%/);
      expect(text, `${template.slug}: no worded ratio`).not.toMatch(/\d+(?:\.\d+)?\s*(?:x|×|times|-fold)\b/i);
      expect(text, `${template.slug}: no phenotype word`).not.toMatch(
        /\b(?:poor|intermediate|rapid|ultrarapid|extensive|normal)\s+(?:metaboli|function|activity)/i,
      );
      expect(bannedLanguage(text), template.slug).toEqual([]);
      expect(medicinesBannedLanguage(text), template.slug).toEqual([]);
      expect(text, `${template.slug}: no excluded gene or position`).not.toMatch(EXCLUDED);
    }
  });

  it("leads the DPYD report with the sentence that a reference result does not rule out a deficiency", () => {
    const dpyd = medicines.find((template) => template.slug === "dpyd-rs3918290-one-position")!;
    expect(dpyd.summary.startsWith(DPYD_SENTENCE)).toBe(true);
    // The reference-homozygous reading repeats it, so the sentence sits
    // beside the letters and not only above them.
    expect(dpyd.variants[0].interpretations.CC).toContain(DPYD_SENTENCE);
    expect(medicines.filter((template) => JSON.stringify(template).includes("deficiency")).map((t) => t.slug)).toEqual([
      "dpyd-rs3918290-one-position",
    ]);
  });

  it("names the forms that carry the -806T letter on the CYP2C19 *17 position and never calls the reader *17", () => {
    const star17 = medicines.find((template) => template.slug === "cyp2c19-rs12248560-one-position")!;
    expect(star17.summary).toContain("*44 and *45");
    expect(star17.summary).toContain("not a *17 call");
    expect(star17.variants[0].interpretations.TT).toContain("*17 needs a second position not read here");
  });
});

describe("the report renderer’s fixed strings for Medicines (ADR 0021)", () => {
  it("renders the Medicines “What you can do” string for that category only", () => {
    expect(whatYouCanDo("medicines")).toBe(WHAT_YOU_CAN_DO_MEDICINES);
    expect(WHAT_YOU_CAN_DO_MEDICINES).toBe(
      "A doctor who prescribes for you may want to know this result. Inherit does not say what any doctor should do with it.",
    );
    for (const category of CATEGORY_TAXONOMY.map((entry) => entry.id).filter((id) => id !== "medicines")) {
      expect(whatYouCanDo(category), category).toBe(NOTHING_TO_DO);
    }
    expect(whatYouCanDo(null)).toBe(NOTHING_TO_DO);
    expect(bannedLanguage(WHAT_YOU_CAN_DO_MEDICINES)).toEqual([]);
    expect(medicinesBannedLanguage(WHAT_YOU_CAN_DO_MEDICINES)).toEqual([]);
    // The report page selects it through the one function, by the nine-category id.
    const page = source("src/app/(app)/genome/[subject]/reports/[slug]/page.tsx");
    expect(page).toContain("{whatYouCanDo(categoryId)}");
    expect(page).not.toContain("{NOTHING_TO_DO}");
  });

  it("describes the category as what the reports are, and the list no longer states an absence", () => {
    expect(CATEGORY_DESCRIPTIONS.medicines).toBe(
      "The letters your file shows at single DNA positions that prescribing guidelines name.",
    );
    expect(CATEGORY_DESCRIPTIONS.medicines).not.toMatch(/respond|may/i);
    const list = source("src/app/(app)/genome/[subject]/reports/page.tsx");
    expect(list).not.toContain("category-absent");
    expect(list).not.toContain("MEDICINES_ABSENT");
    expect(source("src/copy/reports/strings.ts")).not.toContain("MEDICINES_ABSENT");
  });
});

// ---------------------------------------------------------------------------
// The exclusions ADR 0021 keeps, pinned from the dossier’s built designs.
//
// Design 3’s TPMT diplotype caller, as a pure function over the six CPIC
// TPMT forms the research note verified: *1 (no change), *2 (rs1800462 G),
// *3B (rs1800460 T), *3C (rs1142345 C), *3A (*3B and *3C on the same copy)
// and *41 (rs1142345 G). It counts variant letters per position from
// unphased genotypes and looks for the pairs of forms that produce exactly
// those counts. It is kept because it is the evidence for why TPMT *3C
// (rs1142345) does not ship and why no report names a pair of forms.
// ---------------------------------------------------------------------------

type Counts = { g462: number; t460: number; c345: number; g345: number };

const TPMT_FORMS: Record<string, Counts> = {
  "*1": { g462: 0, t460: 0, c345: 0, g345: 0 },
  "*2": { g462: 1, t460: 0, c345: 0, g345: 0 },
  "*3A": { g462: 0, t460: 1, c345: 1, g345: 0 },
  "*3B": { g462: 0, t460: 1, c345: 0, g345: 0 },
  "*3C": { g462: 0, t460: 0, c345: 1, g345: 0 },
  "*41": { g462: 0, t460: 0, c345: 0, g345: 1 },
};

interface TpmtGenotypes {
  rs1800462: string | undefined;
  rs1800460: string | undefined;
  rs1142345: string | undefined;
}

type TpmtCall =
  | { status: "called"; diplotype: string }
  | { status: "indeterminate"; candidates: string[]; reason: string }
  | { status: "no-call"; reason: string };

/** Copies of `allele` in a two-letter unphased call; null when it is not one. */
function copiesOf(genotype: string | undefined, allele: string): number | null {
  if (genotype === undefined) return null;
  const key = genotypeKey(genotype);
  if (key === null || key.length !== 2) return null;
  return [...key].filter((letter) => letter === allele).length;
}

function pairCounts(a: string, b: string): Counts {
  const x = TPMT_FORMS[a];
  const y = TPMT_FORMS[b];
  return { g462: x.g462 + y.g462, t460: x.t460 + y.t460, c345: x.c345 + y.c345, g345: x.g345 + y.g345 };
}

function sameCounts(x: Counts, y: Counts): boolean {
  return x.g462 === y.g462 && x.t460 === y.t460 && x.c345 === y.c345 && x.g345 === y.g345;
}

export function callTpmtDiplotype(genotypes: TpmtGenotypes): TpmtCall {
  const g462 = copiesOf(genotypes.rs1800462, "G");
  const t460 = copiesOf(genotypes.rs1800460, "T");
  const c345 = copiesOf(genotypes.rs1142345, "C");
  const g345 = copiesOf(genotypes.rs1142345, "G");
  for (const [rsid, count] of [
    ["rs1800462", g462],
    ["rs1800460", t460],
    ["rs1142345", c345 ?? g345],
  ] as const) {
    if (count === null) return { status: "no-call", reason: `${rsid} is not a two-letter call` };
  }
  const observed: Counts = { g462: g462!, t460: t460!, c345: c345!, g345: g345! };
  const names = Object.keys(TPMT_FORMS);
  const candidates: string[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i; j < names.length; j++) {
      if (sameCounts(pairCounts(names[i], names[j]), observed)) {
        candidates.push(`${names[i]}/${names[j]}`);
      }
    }
  }
  if (candidates.length === 1) return { status: "called", diplotype: candidates[0] };
  if (candidates.length === 0) {
    return { status: "no-call", reason: "no pair of the six defined forms produces these counts" };
  }
  return {
    status: "indeterminate",
    candidates,
    reason: "unphased calls: the changes may sit on the same copy or on different copies",
  };
}

// The validator’s rules, mirrored here and pinned to the source so the mirror
// cannot drift: one ref and one alt per variant, both `^[ACGT]+$`; haploid
// keys only for chromosomes 24 (Y) and 25 (MT).
const VALIDATOR_REF_ALT = /^[ACGT]+$/;

function validatorGenotypeKeys(ref: string, alt: string, chrom: number): string[] {
  if (chrom === 24 || chrom === 25) return [ref, alt];
  const het = [ref, alt].sort().join("");
  return [ref + ref, het, alt + alt];
}

/** scripts/seed.ts: the first template to mention an rsID wins ref_variants. */
function seedRefVariants(templates: FixtureTemplate[]): Map<number, { ref: string; alt: string }> {
  const refVariants = new Map<number, { ref: string; alt: string }>();
  for (const t of templates) {
    for (const v of t.variants) {
      if (!refVariants.has(v.rsid)) refVariants.set(v.rsid, { ref: v.ref, alt: v.alt });
    }
  }
  return refVariants;
}

describe("why no report names a pair of forms: the diplotype caller over unphased calls (design 3)", () => {
  it("calls the pairs that only one combination of forms can produce", () => {
    expect(callTpmtDiplotype({ rs1800462: "C/C", rs1800460: "C/C", rs1142345: "T/T" })).toEqual({
      status: "called",
      diplotype: "*1/*1",
    });
    expect(callTpmtDiplotype({ rs1800462: "C/G", rs1800460: "C/C", rs1142345: "T/T" })).toEqual({
      status: "called",
      diplotype: "*1/*2",
    });
    expect(callTpmtDiplotype({ rs1800462: "C/C", rs1800460: "C/T", rs1142345: "T/T" })).toEqual({
      status: "called",
      diplotype: "*1/*3B",
    });
    expect(callTpmtDiplotype({ rs1800462: "C/C", rs1800460: "C/C", rs1142345: "C/G" })).toEqual({
      status: "called",
      diplotype: "*3C/*41",
    });
  });

  it("returns indeterminate for *1/*3A versus *3B/*3C, because both produce the same unphased input", () => {
    expect(
      sameCounts(pairCounts("*1", "*3A"), pairCounts("*3B", "*3C")),
      "*1/*3A and *3B/*3C produce the same unphased genotypes at all three positions",
    ).toBe(true);
    expect(
      callTpmtDiplotype({ rs1800462: "C/C", rs1800460: "C/T", rs1142345: "C/T" }),
      "unphased heterozygosity at rs1800460 and rs1142345 cannot be resolved (PharmCAT’s own disclaimer on TPMT *3A)",
    ).toEqual({
      status: "indeterminate",
      candidates: ["*1/*3A", "*3B/*3C"],
      reason: "unphased calls: the changes may sit on the same copy or on different copies",
    });
  });

  it("refuses to call when a position is missing, a no-call, or not a two-letter call", () => {
    expect(callTpmtDiplotype({ rs1800462: undefined, rs1800460: "C/T", rs1142345: "C/T" })).toEqual({
      status: "no-call",
      reason: "rs1800462 is not a two-letter call",
    });
    expect(callTpmtDiplotype({ rs1800462: "C/C", rs1800460: "--", rs1142345: "C/T" })).toEqual({
      status: "no-call",
      reason: "rs1800460 is not a two-letter call",
    });
  });
});

describe("the exclusions ADR 0021 keeps: what the schema cannot carry", () => {
  const tpmt = design3.find((t) => t.slug === "tpmt-three-positions-diplotype")!;
  const multiAlt = tpmt.variants.find((v) => v.rsid === 1142345)!;

  it("TPMT *3C: rs1142345 has two alt alleles (C for *3C, G for *41) and the single-alt schema rejects it", () => {
    expect(multiAlt.alt).toBe("C,G");
    expect(
      VALIDATOR_REF_ALT.test(multiAlt.alt),
      'scripts/validate-templates.ts: `bad ref/alt` — ref and alt must each match /^[ACGT]+$/',
    ).toBe(false);
    expect(source("scripts/validate-templates.ts")).toContain('/^[ACGT]+$/.test(v.alt ?? "")');
    expect(validatorGenotypeKeys(multiAlt.ref, multiAlt.alt, multiAlt.chrom)).toEqual(["TT", "C,GT", "C,GC,G"]);
    expect(genotypeKey("T/C,G"), "reports.ts genotypeKey: an allele outside [ACGT]+ makes the call null").toBeNull();
    // No shipped Medicines template reaches for the position.
    expect(medicines.flatMap((t) => t.variants.map((v) => v.rsid))).not.toContain(1142345);
  });

  it("TPMT *3C: the two-entry workaround silently drops the *41 alt in the seed’s refVariants (first entry wins)", () => {
    const entries = design3TwoEntry[0].variants.filter((v) => v.rsid === 1142345);
    expect(entries.map((v) => v.alt)).toEqual(["C", "G"]);
    expect(
      seedRefVariants(design3TwoEntry).get(1142345),
      "scripts/seed.ts refVariants: `if (!refVariants.has(v.rsid))` keeps the first alt only",
    ).toEqual({ ref: "T", alt: "C" });
    expect(source("scripts/seed.ts")).toContain("if (!refVariants.has(v.rsid))");
    const [altC] = entries;
    expect(resolveVariant(altC, "T/G")).toEqual({ status: "unrecognized", genotype: "GT" });
    expect(resolveVariant(altC, "C/G")).toEqual({ status: "unrecognized", genotype: "CG" });
  });

  it("G6PD: a hemizygous chromosome-23 call has no key, so every person with one X is unrecognized", () => {
    const g6pd = design3.find((t) => t.slug === "g6pd-two-positions-x-chromosome")!;
    for (const variant of g6pd.variants) {
      expect(variant.chrom).toBe(23);
      expect(
        validatorGenotypeKeys(variant.ref, variant.alt, variant.chrom),
        "scripts/validate-templates.ts genotypeKeys: haploid keys only for chrom 24 (Y) and 25 (MT)",
      ).toEqual([variant.ref + variant.ref, [variant.ref, variant.alt].sort().join(""), variant.alt + variant.alt]);
      for (const haploid of [variant.ref, variant.alt]) {
        expect(
          resolveVariant(variant, haploid),
          `reports.ts resolveVariant: a one-letter call "${haploid}" matches no diploid key at rs${variant.rsid}`,
        ).toEqual({ status: "unrecognized", genotype: haploid });
      }
    }
    expect(source("scripts/validate-templates.ts")).toContain("if (chrom === 24 || chrom === 25) return [ref, alt];");
    expect(medicines.every((t) => t.variants.every((v) => v.chrom >= 1 && v.chrom <= 22))).toBe(true);
  });

  it("guideline-level response statements (design 1) still trip the §6.4 row and a deterministic or treatment claim", () => {
    for (const template of design1) {
      const rows = bannedLanguage(JSON.stringify(template));
      expect(rows, template.slug).toContain("treatment advice (§6.4)");
      expect(
        rows.some((row) => row === "deterministic claim" || row === "treatment claim"),
        `${template.slug}: scripts/validate-templates.ts BANNED_PATTERNS`,
      ).toBe(true);
    }
  });
});
