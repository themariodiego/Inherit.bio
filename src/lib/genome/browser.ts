/**
 * The genome browser's search and the figures it yields (brief §7.3, X4).
 *
 * Every letter the browser shows is produced here, which is what
 * `computed:genome/browser` on those figures states. An rsID or a gene
 * search resolves its genotypes through `getPreparedSourceGenotypes`, which
 * yields one agreed call per position or records a conflict; a region search
 * reads the active prepared source's own rows. The coverage pair under the
 * results table counts those same hits: a position is read only when it
 * yielded letters, so a no-call (`--`) and a position two files disagree
 * about are both uncovered.
 *
 * The page composes and renders; it computes none of this, so the two
 * derivations stay unit-testable without a React tree.
 */
import "server-only";
import {
  UNRECOGNIZED_CHROMOSOME,
  noReferenceMatch,
  rsidNotCovered,
  rsidUnknown,
} from "@/copy/genome/data";
import { GENOTYPE_LABEL } from "@/copy/reports/strings";
import type { ComputedModule } from "@/lib/figures/contract";
import type { GenotypeSpec } from "@/lib/figures/spec";
import type { Db } from "./load";
import {
  locusAround,
  locusSpanning,
  parseLocusQuery,
  type Locus,
} from "./locus";
import { getPreparedSourceGenotypes } from "./prepared-sources";
import { CLINICAL_GENES, matchTraitSuggestion, type TraitTopic } from "./search-guidance";
import { parseRsid } from "./types";

/** The module every browser figure names as the origin of its number. */
export const BROWSER_MODULE = "genome/browser" satisfies ComputedModule;

const BROWSER_PROVENANCE = { kind: "computed", module: BROWSER_MODULE } as const;

/** Rows the region search returns at most; the page says so when it is reached. */
export const REGION_ROW_LIMIT = 200;

export interface Hit {
  rsid: number | null;
  chrom: number;
  /** GRCh38 position; null for a reference row with no lifted position. */
  pos: number | null;
  ref: string | null;
  alt: string | null;
  gene: string | null;
  /** The observed letters, or null when the file does not cover the position. */
  genotype: string | null;
  /** True when the subject's files disagree at this position. */
  conflict: boolean;
}

export interface SuggestedReport {
  slug: string;
  name: string;
}

export interface Outcome {
  inputFileIds: string[];
  checkedFileIds: string[];
  inputScope: "subject" | "active" | null;
  hits: Hit[];
  truncated: boolean;
  locus: Locus | null;
  message: string | null;
  showReportsLink: boolean;
  clinicalGene: string | null;
  trait: { topic: TraitTopic; reports: SuggestedReport[] } | null;
}

export const EMPTY: Outcome = {
  inputFileIds: [],
  checkedFileIds: [],
  inputScope: null,
  hits: [],
  truncated: false,
  locus: null,
  message: null,
  showReportsLink: false,
  clinicalGene: null,
  trait: null,
};

/**
 * The report name is the title up to its gene suffix (`Caffeine metabolism ·
 * CYP1A2` → `Caffeine metabolism`), the same rule as the report page's h1.
 */
function reportNameOf(title: string): string {
  const index = title.indexOf(" · ");
  return index === -1 ? title : title.slice(0, index);
}

/** One rsID: the subject's files must agree, or the row says they disagree. */
async function searchRsid(admin: Db, subjectId: string, rsid: number): Promise<Outcome> {
  const { genotypes, conflicts, inputFileIds, checkedFileIds } = await getPreparedSourceGenotypes(admin, subjectId, [rsid]);
  const [{ data: mine }, { data: reference }] = await Promise.all([
    checkedFileIds.length ? admin
      .from("user_variants")
      .select("chrom, pos, ref, alt")
      .eq("subject_id", subjectId)
      .in("file_id", checkedFileIds)
      .eq("rsid", rsid)
      .limit(1) : Promise.resolve({ data: [] }),
    admin
      .from("ref_variants")
      .select("rsid, chrom, pos38, ref, alt, gene_symbol")
      .eq("rsid", rsid)
      .maybeSingle(),
  ]);
  const observed = mine?.[0];
  const genotype = genotypes.get(rsid) ?? null;
  const conflict = conflicts.has(rsid);
  if (observed && (genotype !== null || conflict)) {
    return {
      ...EMPTY,
      inputFileIds,
      checkedFileIds,
      inputScope: "subject",
      hits: [
        {
          rsid,
          chrom: observed.chrom,
          pos: observed.pos,
          ref: observed.ref,
          alt: observed.alt,
          gene: reference?.gene_symbol ?? null,
          genotype,
          conflict,
        },
      ],
      locus: locusAround(observed.chrom, observed.pos),
    };
  }
  if (reference?.pos38) {
    return {
      ...EMPTY,
      inputFileIds,
      checkedFileIds,
      inputScope: "subject",
      message: rsidNotCovered(rsid, reference.gene_symbol),
      locus: locusAround(reference.chrom, reference.pos38),
    };
  }
  return { ...EMPTY, inputFileIds, checkedFileIds, inputScope: "subject", message: rsidUnknown(rsid) };
}

/** A region of the active file, newest processed file first, capped at REGION_ROW_LIMIT rows. */
async function searchLocus(admin: Db, fileId: string, locus: Locus): Promise<Outcome> {
  const { data } = await admin
    .from("user_variants")
    .select("rsid, chrom, pos, ref, alt, genotype")
    .eq("file_id", fileId)
    .eq("chrom", locus.chrom)
    .gte("pos", locus.start)
    .lte("pos", locus.end)
    .order("pos")
    .limit(REGION_ROW_LIMIT);
  const rows = data ?? [];
  return {
    ...EMPTY,
    inputFileIds: rows.length ? [fileId] : [],
    checkedFileIds: [fileId],
    inputScope: "active",
    hits: rows.map((row) => ({ ...row, gene: null, conflict: false })),
    truncated: rows.length === REGION_ROW_LIMIT,
    locus,
  };
}

/** A gene symbol: every reference position for it, joined to the subject's agreed genotypes. */
async function searchGene(admin: Db, subjectId: string, query: string): Promise<Outcome | null> {
  const { data: refs } = await admin
    .from("ref_variants")
    .select("rsid, chrom, pos38, ref, alt, gene_symbol")
    .ilike("gene_symbol", query)
    .order("pos38")
    .limit(100);
  if (!refs || refs.length === 0) return null;
  const { genotypes, conflicts, inputFileIds, checkedFileIds } = await getPreparedSourceGenotypes(
    admin,
    subjectId,
    refs.map((row) => row.rsid),
  );
  const positions = refs.flatMap((row) => (row.pos38 ? [row.pos38] : []));
  return {
    ...EMPTY,
    inputFileIds,
    checkedFileIds,
    inputScope: "subject",
    hits: refs.map((row) => ({
      rsid: row.rsid,
      chrom: row.chrom,
      pos: row.pos38,
      ref: row.ref,
      alt: row.alt,
      gene: row.gene_symbol,
      genotype: genotypes.get(row.rsid) ?? null,
      conflict: conflicts.has(row.rsid),
    })),
    locus: locusSpanning(refs[0].chrom, positions),
  };
}

/** A trait word: the published reports the guidance names, by their current titles. */
async function searchTrait(admin: Db, query: string): Promise<Outcome | null> {
  const suggestion = matchTraitSuggestion(query);
  if (!suggestion) return null;
  const { data: templates } = await admin
    .from("report_templates")
    .select("slug, title")
    .in("slug", [...suggestion.slugs])
    .eq("status", "published");
  const titleBySlug = new Map((templates ?? []).map((row) => [row.slug, row.title]));
  const reports = suggestion.slugs.flatMap((slug) => {
    const title = titleBySlug.get(slug);
    return title ? [{ slug, name: reportNameOf(title) }] : [];
  });
  return reports.length > 0 ? { ...EMPTY, trait: { topic: suggestion.topic, reports } } : null;
}

export async function search(admin: Db, subjectId: string, fileId: string, query: string): Promise<Outcome> {
  const rsid = parseRsid(query);
  if (rsid) return searchRsid(admin, subjectId, rsid);
  const locusQuery = parseLocusQuery(query);
  if (locusQuery?.kind === "unknown-chromosome") return { ...EMPTY, message: UNRECOGNIZED_CHROMOSOME };
  if (locusQuery) return searchLocus(admin, fileId, locusQuery.locus);
  const gene = await searchGene(admin, subjectId, query);
  if (gene) return gene;
  if (CLINICAL_GENES.has(query.toUpperCase())) {
    return { ...EMPTY, clinicalGene: query.toUpperCase() };
  }
  const trait = await searchTrait(admin, query);
  if (trait) return trait;
  return { ...EMPTY, message: noReferenceMatch(query), showReportsLink: true };
}

/**
 * One observed `genotype` figure per covered row. `figureIndex` maps a hit to
 * its figure so the table can place the rendered node in its own cell, and is
 * null for a row with no letters to show.
 */
export function genotypeFigures(hits: readonly Hit[]): {
  specs: GenotypeSpec[];
  figureIndex: (number | null)[];
} {
  const specs: GenotypeSpec[] = [];
  const figureIndex = hits.map((hit) => {
    if (hit.genotype === null) return null;
    specs.push({
      kind: "genotype",
      class: "variant-call",
      basis: "observed",
      provenance: BROWSER_PROVENANCE,
      genotype: hit.genotype,
      label: GENOTYPE_LABEL,
    });
    return specs.length - 1;
  });
  return { specs, figureIndex };
}

/**
 * The coverage pair under the results table: the searched positions that
 * yielded letters, over every position searched. A no-call and a position
 * the files disagree about were not read, and neither is counted.
 */
export function browserCoverage(hits: readonly Hit[]): {
  read: number;
  needed: number;
  module: typeof BROWSER_MODULE;
} {
  return {
    read: hits.filter((hit) => hit.genotype !== null && hit.genotype !== "--" && !hit.conflict).length,
    needed: hits.length,
    module: BROWSER_MODULE,
  };
}
