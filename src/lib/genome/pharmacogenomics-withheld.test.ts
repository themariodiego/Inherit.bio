import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bannedLanguage } from "../../../scripts/validate-templates";
import { genotypeKey, resolveVariant, type TemplateVariant } from "./reports";
import {
  LEGACY_CATEGORY_DEFAULTS,
  TEMPLATE_CATEGORY_EXCEPTIONS,
  categoryFor,
} from "./taxonomy";

// Pins for the withheld dossier of the Medicines category
// (docs/withheld/pharmacogenomics.md, element 4). The three designs live
// under docs/withheld/pharmacogenomics/designs/ and are read from there, so
// the evidence the dossier cites and the rules pinned here cannot drift
// apart. Every failure below names the rule that produces it.

const DESIGNS = new URL("../../../docs/withheld/pharmacogenomics/designs/", import.meta.url);
const REPO = new URL("../../../", import.meta.url);

interface FixtureTemplate {
  slug: string;
  category: string;
  title: string;
  summary: string;
  variants: TemplateVariant[];
}

function loadDesign(relative: string): FixtureTemplate[] {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, DESIGNS)), "utf8")) as FixtureTemplate[];
}

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, REPO)), "utf8");
}

const design1 = loadDesign("1-guideline-statement/medicines.json");
const design2 = loadDesign("2-bare-position/medicines.json");
const design3 = loadDesign("3-diplotype-caller/medicines.json");
const design3TwoEntry = loadDesign("3-diplotype-caller/medicines.two-entry.json");

// ---------------------------------------------------------------------------
// Design 3: a diplotype caller over unphased calls, as a pure function.
//
// Six TPMT forms from the CPIC allele definitions the research document
// verified: *1 (no change), *2 (rs1800462 G), *3B (rs1800460 T), *3C
// (rs1142345 C), *3A (*3B and *3C on the same copy) and *41 (rs1142345 G).
// The caller counts variant letters per position from unphased genotypes
// and looks for the pairs of forms that produce exactly those counts.
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

describe("design 3: the diplotype caller over unphased calls", () => {
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
    expect(callTpmtDiplotype({ rs1800462: "C/C", rs1800460: "C/C", rs1142345: "C/T" })).toEqual({
      status: "called",
      diplotype: "*1/*3C",
    });
    expect(callTpmtDiplotype({ rs1800462: "C/C", rs1800460: "T/T", rs1142345: "C/C" })).toEqual({
      status: "called",
      diplotype: "*3A/*3A",
    });
    // A C/G call at rs1142345 is *3C on one copy and *41 on the other: the
    // caller can say so from the genotype alone.
    expect(callTpmtDiplotype({ rs1800462: "C/C", rs1800460: "C/C", rs1142345: "C/G" })).toEqual({
      status: "called",
      diplotype: "*3C/*41",
    });
  });

  it("returns indeterminate for *1/*3A versus *3B/*3C, because both produce the same unphased input", () => {
    // Phase is the only difference between the two truths, and unphased
    // calls carry no phase: the two pairs give identical counts.
    expect(
      sameCounts(pairCounts("*1", "*3A"), pairCounts("*3B", "*3C")),
      "*1/*3A and *3B/*3C produce the same unphased genotypes at all three positions",
    ).toBe(true);
    const call = callTpmtDiplotype({ rs1800462: "C/C", rs1800460: "C/T", rs1142345: "C/T" });
    expect(
      call,
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
    // A haploid call has one letter: the caller cannot count two copies.
    expect(callTpmtDiplotype({ rs1800462: "C", rs1800460: "C/C", rs1142345: "T/T" })).toEqual({
      status: "no-call",
      reason: "rs1800462 is not a two-letter call",
    });
  });
});

describe("design 3: the template schema cannot carry what the caller needs", () => {
  const tpmt = design3.find((t) => t.slug === "tpmt-three-positions-diplotype")!;
  const multiAlt = tpmt.variants.find((v) => v.rsid === 1142345)!;

  it("rs1142345 has two alt alleles (C for *3C, G for *41) and the single-alt schema rejects it", () => {
    expect(multiAlt.alt).toBe("C,G");
    expect(
      VALIDATOR_REF_ALT.test(multiAlt.alt),
      'scripts/validate-templates.ts: `bad ref/alt` — ref and alt must each match /^[ACGT]+$/',
    ).toBe(false);
    expect(source("scripts/validate-templates.ts")).toContain("/^[ACGT]+$/.test(v.alt ?? \"\")");
    // The keys the validator would demand are not genotypes any parser emits.
    expect(validatorGenotypeKeys(multiAlt.ref, multiAlt.alt, multiAlt.chrom)).toEqual([
      "TT",
      "C,GT",
      "C,GC,G",
    ]);
    // And a multi-allelic genotype string is a no-call to the resolver.
    expect(
      genotypeKey("T/C,G"),
      "reports.ts genotypeKey: an allele outside [ACGT]+ makes the call null (a no-call)",
    ).toBeNull();
  });

  it("the two-entry workaround silently drops the *41 alt in the seed’s refVariants (first entry wins)", () => {
    const entries = design3TwoEntry[0].variants.filter((v) => v.rsid === 1142345);
    expect(entries.map((v) => v.alt)).toEqual(["C", "G"]);
    const refVariants = seedRefVariants(design3TwoEntry);
    expect(
      refVariants.get(1142345),
      "scripts/seed.ts refVariants: `if (!refVariants.has(v.rsid))` keeps the first alt only, so ref_variants never learns G",
    ).toEqual({ ref: "T", alt: "C" });
    expect(source("scripts/seed.ts")).toContain("if (!refVariants.has(v.rsid))");
  });

  it("resolveVariant cannot reach the second alt: T/G and C/G are unrecognized on the T>C entry", () => {
    const [altC, altG] = design3TwoEntry[0].variants.filter((v) => v.rsid === 1142345);
    expect(
      resolveVariant(altC, "T/G"),
      "reports.ts resolveVariant: G matches no key of {TT, CT, CC} and its complement C/A matches none either",
    ).toEqual({ status: "unrecognized", genotype: "GT" });
    expect(
      resolveVariant(altC, "C/G"),
      "reports.ts resolveVariant: a *3C/*41 person is unrecognized on the *3C entry",
    ).toEqual({ status: "unrecognized", genotype: "CG" });
    expect(
      resolveVariant(altG, "C/G"),
      "reports.ts resolveVariant: and unrecognized on the *41 entry too",
    ).toEqual({ status: "unrecognized", genotype: "CG" });
    // The caller, given the same genotype, names the pair; the template cannot.
    expect(callTpmtDiplotype({ rs1800462: "C/C", rs1800460: "C/C", rs1142345: "C/G" })).toEqual({
      status: "called",
      diplotype: "*3C/*41",
    });
  });

  it("a hemizygous chromosome-23 call has no key: the validator demands diploid keys only, so it is unrecognized", () => {
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
          `reports.ts resolveVariant: a one-letter call "${haploid}" matches no diploid key, so a person with one X is unrecognized at rs${variant.rsid} — the reference base included`,
        ).toEqual({ status: "unrecognized", genotype: haploid });
      }
    }
    expect(source("scripts/validate-templates.ts")).toContain("if (chrom === 24 || chrom === 25) return [ref, alt];");
  });
});

describe("design 2: bare position reports land nowhere the taxonomy calls Medicines", () => {
  it("the shipped taxonomy has no legacy slug for the category, so categoryFor throws (total mapping)", () => {
    expect(Object.values(LEGACY_CATEGORY_DEFAULTS)).not.toContain("medicines");
    for (const template of design2) {
      expect(
        () => categoryFor({ slug: template.slug, category: template.category }),
        "taxonomy.ts categoryFor: an unknown legacy slug throws rather than mapping silently",
      ).toThrow('Unknown legacy category "pharmacogenomics"');
    }
  });

  it("re-slugged to a shipped legacy category, every template lands in Food, drink and metabolism", () => {
    for (const template of design2) {
      expect(TEMPLATE_CATEGORY_EXCEPTIONS).not.toHaveProperty(template.slug);
      const landing = categoryFor({ slug: template.slug, category: "lifestyle-wellness" });
      expect(
        landing,
        `taxonomy.ts LEGACY_CATEGORY_DEFAULTS: ${template.slug} lands under the legacy category’s default, never under Medicines`,
      ).toBe("food-drink-metabolism");
      expect(landing).not.toBe("medicines");
    }
  });

  it("is the control: the variant_call layer, plain-register prose and no banned language", () => {
    for (const template of design2 as (FixtureTemplate & { layer?: string })[]) {
      expect(template.layer).toBe("variant_call");
      expect(bannedLanguage(JSON.stringify(template)), template.slug).toEqual([]);
    }
  });
});

describe("design 1: guideline-level response statements carry the banned rows", () => {
  it("every template trips the §6.4 treatment-advice row and a deterministic or treatment claim", () => {
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

describe("every design", () => {
  it("carries no allele frequency and no effect size: no percent sign and no numeric multiplier", () => {
    for (const template of [...design1, ...design2, ...design3, ...design3TwoEntry]) {
      const text = JSON.stringify(template);
      expect(text, `${template.slug}: no % anywhere`).not.toMatch(/%/);
      expect(text, `${template.slug}: no worded ratio`).not.toMatch(/\d+(?:\.\d+)?\s*(?:x|×|times|-fold)\b/i);
    }
  });
});
