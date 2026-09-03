// Resolves report templates against a user's variant store.
// Honesty rules: a variant absent from the user's file is 'not-covered'
// (rendered as "your file does not cover this variant"), a '--' call is
// 'no-call', and a genotype that matches neither the template alleles nor
// their strand complement is 'unrecognized' — never silently reinterpreted.

import type { EstimateKind, EvidenceLevel, FindingLayer } from "./taxonomy";

export interface TemplateVariant {
  rsid: number;
  gene: string;
  chrom: number;
  pos38: number;
  ref: string;
  alt: string;
  interpretations: Record<string, string>;
}

export interface Citation {
  pmid?: string;
  doi?: string;
  label: string;
}

export interface ReportTemplate {
  slug: string;
  category: string;
  title: string;
  summary: string;
  evidence: EvidenceLevel;
  variants: TemplateVariant[];
  pgs_id: string | null;
  citations: Citation[];
  /** Finding layer; present when the row was selected with it. */
  layer?: FindingLayer;
  /** Estimate kind for layer = 'estimate'; null for variant_call. */
  estimate_kind?: EstimateKind | null;
}

export type VariantOutcome =
  | { status: "genotyped"; genotype: string; interpretation: string; strandFlipped: boolean }
  | { status: "no-call" }
  | { status: "not-covered" }
  | { status: "unrecognized"; genotype: string };

export interface ResolvedVariant {
  variant: TemplateVariant;
  outcome: VariantOutcome;
}

export interface ResolvedReport {
  template: ReportTemplate;
  variants: ResolvedVariant[];
  /** True when at least one template variant has a genotyped outcome. */
  covered: boolean;
}

const COMPLEMENT: Record<string, string> = { A: "T", T: "A", C: "G", G: "C" };

function complement(seq: string): string | null {
  let out = "";
  for (const ch of seq) {
    const c = COMPLEMENT[ch];
    if (!c) return null;
    out = out + c;
  }
  return out;
}

/** 'A/G' | 'G/A' | 'A' -> sorted key 'AG' / 'A'; null for no-calls. */
export function genotypeKey(genotype: string): string | null {
  const alleles = genotype.split("/").filter((a) => a.length > 0);
  if (alleles.length === 0) return null;
  if (alleles.some((a) => !/^[ACGT]+$/.test(a))) return null;
  return alleles.sort().join("");
}

export function resolveVariant(
  v: TemplateVariant,
  genotype: string | undefined,
): VariantOutcome {
  if (genotype === undefined) return { status: "not-covered" };
  const key = genotypeKey(genotype);
  if (key === null) return { status: "no-call" };

  const direct = v.interpretations[key];
  if (direct !== undefined) {
    return {
      status: "genotyped",
      genotype: key,
      interpretation: direct,
      strandFlipped: false,
    };
  }

  // Some array probes report the opposite strand; accept the complement only
  // when it maps cleanly onto the template alleles.
  const flippedAlleles = key
    .split("")
    .map((a) => COMPLEMENT[a] ?? "")
    .sort()
    .join("");
  const flipped = v.interpretations[flippedAlleles];
  // Ambiguous A/T and C/G variants cannot be strand-resolved: refuse.
  const palindromic =
    complement(v.ref) === v.alt || complement(v.alt) === v.ref;
  if (flipped !== undefined && !palindromic) {
    return {
      status: "genotyped",
      genotype: flippedAlleles,
      interpretation: flipped,
      strandFlipped: true,
    };
  }

  return { status: "unrecognized", genotype: key };
}

export function resolveTemplate(
  template: ReportTemplate,
  genotypeOf: (rsid: number) => string | undefined,
): ResolvedReport {
  const variants = template.variants.map((variant) => ({
    variant,
    outcome: resolveVariant(variant, genotypeOf(variant.rsid)),
  }));
  return {
    template,
    variants,
    covered: variants.some((r) => r.outcome.status === "genotyped"),
  };
}
