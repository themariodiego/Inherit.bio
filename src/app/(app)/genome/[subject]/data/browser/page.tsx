/**
 * /genome/[subject]/data/browser — the expert path's genome browser (brief
 * §7.3, §1.4–§1.6, §2.2, X4, X6, X13). Server composition: auth and subject
 * resolution, one search (an rsID, a gene symbol or a locus), one attributed
 * claim block per results table with every genotype rendered as an observed
 * `genotype` figure, and the embedded first-party track for the region.
 *
 * rsIDs, coordinates and allele letters are a position's identity, not
 * result figures: they render as text without thousands grouping, marked
 * with the exempt comment the report page uses. Nothing else numeric is
 * shown: an allele frequency has no honest figure kind and a clinical
 * classification beside a raw genotype would be a naked clinical claim.
 *
 * Three headings: the h1, "Results" and "Region". Every string comes from
 * src/copy/genome/data.ts; every href from a route id.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GenomeBrowser } from "@/components/browse/genome-browser";
import { ClaimBlock } from "@/components/figures/claim-block";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { SubjectBar } from "@/components/subjects/subject-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BROWSER_H1,
  BROWSER_NO_FILE,
  DATA_CRUMB,
  FIRST_PARTY_NOTE,
  FULL_LIBRARY,
  OR_START_FROM_REPORTS,
  POSITIONS_BUILD,
  REGION_HEADING,
  RESULTS_HEADING,
  SEARCH_BUTTON,
  SEARCH_LABEL,
  SEARCH_PLACEHOLDER,
  TABLE_HEADINGS,
  TRAIT_TOPICS,
  UNRECOGNIZED_CHROMOSOME,
  clinicalGeneStatus,
  lookingFor,
  noReferenceMatch,
  resultsLabel,
  resultsTruncated,
  rsidNotCovered,
  rsidUnknown,
} from "@/copy/genome/data";
import { NAV_LABELS } from "@/copy/navigation";
import { COVERAGE_PILLS, FILES_DISAGREE, GENOTYPE_LABEL } from "@/copy/reports/strings";
import type { GenotypeSpec } from "@/lib/figures/spec";
import {
  getSubjectFileCount,
  getSubjectGenotypesByRsid,
  getSubjectProcessedFiles,
  type Db,
} from "@/lib/genome/load";
import {
  formatLocus,
  locusAround,
  locusSpanning,
  parseLocusQuery,
  type Locus,
} from "@/lib/genome/locus";
import { CLINICAL_GENES, matchTraitSuggestion, type TraitTopic } from "@/lib/genome/search-guidance";
import { chromToName, parseRsid } from "@/lib/genome/types";
import { route } from "@/lib/primary-routes";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: BROWSER_H1 };

/** Rows the region search returns at most; the page says so when it is reached. */
const REGION_ROW_LIMIT = 200;

interface Hit {
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

interface SuggestedReport {
  slug: string;
  name: string;
}

interface Outcome {
  hits: Hit[];
  truncated: boolean;
  locus: Locus | null;
  message: string | null;
  showReportsLink: boolean;
  clinicalGene: string | null;
  trait: { topic: TraitTopic; reports: SuggestedReport[] } | null;
}

const EMPTY: Outcome = {
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
  const [{ genotypes, conflicts }, { data: mine }, { data: reference }] = await Promise.all([
    getSubjectGenotypesByRsid(admin, subjectId, [rsid]),
    admin
      .from("user_variants")
      .select("chrom, pos, ref, alt")
      .eq("subject_id", subjectId)
      .eq("rsid", rsid)
      .limit(1),
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
      message: rsidNotCovered(rsid, reference.gene_symbol),
      locus: locusAround(reference.chrom, reference.pos38),
    };
  }
  return { ...EMPTY, message: rsidUnknown(rsid) };
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
  const { genotypes, conflicts } = await getSubjectGenotypesByRsid(
    admin,
    subjectId,
    refs.map((row) => row.rsid),
  );
  const positions = refs.flatMap((row) => (row.pos38 ? [row.pos38] : []));
  return {
    ...EMPTY,
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

async function search(admin: Db, subjectId: string, fileId: string, query: string): Promise<Outcome> {
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

export default async function BrowserPage(props: PageProps<"/genome/[subject]/data/browser">) {
  const { subject: segment } = await props.params;
  const searchParams = await props.searchParams;
  const q = (typeof searchParams.q === "string" ? searchParams.q : "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();
  const subject = await resolveSubjectForAccount(user.id, segment);
  if (!subject) notFound();
  const subjectParams = { subject: subject.routeSegment };

  const admin = createAdminClient();
  // The search reads the processed files; the subject bar counts every file
  // in the record, whatever its status.
  const [files, fileCount] = await Promise.all([
    getSubjectProcessedFiles(admin, subject.id),
    getSubjectFileCount(admin, subject.id),
  ]);
  const active = files[0] ?? null;
  const outcome = q && active ? await search(admin, subject.id, active.id, q) : EMPTY;
  const { hits, truncated, locus, message, showReportsLink, clinicalGene, trait } = outcome;

  // One genotype figure per covered row; the block owns the attribution and
  // hands the rendered nodes back for the table layout.
  const specs: GenotypeSpec[] = [];
  const figureIndex = hits.map((hit) => {
    if (hit.genotype === null) return null;
    specs.push({
      kind: "genotype",
      class: "variant-call",
      basis: "observed",
      provenance: { kind: "computed", module: "genome/browser" },
      genotype: hit.genotype,
      label: GENOTYPE_LABEL,
    });
    return specs.length - 1;
  });

  const showResults = hits.length > 0;
  const showRegion = locus !== null && active !== null;

  return (
    <div
      data-surface="standard"
      data-density-primary-content="true"
      className="mx-auto max-w-5xl space-y-8"
    >
      <Breadcrumbs
        items={[
          { label: NAV_LABELS["my-genome"], href: route("genome.subject", subjectParams) },
          { label: subject.displayLabel },
          { label: DATA_CRUMB, href: route("genome.data", subjectParams) },
          { label: BROWSER_H1 },
        ]}
      />
      <SubjectBar subject={subject} fileCount={fileCount} viewerAccountId={user.id} />

      <header className="space-y-4">
        <h1 className="display text-3xl">{BROWSER_H1}</h1>
        {active ? (
          <form className="flex gap-2" action={route("genome.browser", subjectParams)} method="get">
            <Input
              name="q"
              defaultValue={q}
              placeholder={SEARCH_PLACEHOLDER}
              aria-label={SEARCH_LABEL}
              className="max-w-md font-mono text-sm"
            />
            <Button type="submit">{SEARCH_BUTTON}</Button>
          </form>
        ) : (
          <p className="max-w-prose text-sm text-ink-muted">{BROWSER_NO_FILE}</p>
        )}
      </header>

      {clinicalGene ? (
        <div role="status" className="rounded-xl border border-line bg-card p-4 text-sm">
          <p className="max-w-prose">{clinicalGeneStatus(clinicalGene)}</p>
        </div>
      ) : null}

      {trait ? (
        <div className="rounded-xl border border-line bg-card p-4 text-sm">
          <p className="max-w-prose">{lookingFor(TRAIT_TOPICS[trait.topic])}</p>
          <ul className="mt-2 space-y-1">
            {trait.reports.map((report) => (
              <li key={report.slug}>
                <Link
                  href={route("genome.report", { subject: subject.routeSegment, slug: report.slug })}
                  className="underline underline-offset-2 hover:text-forest"
                >
                  {report.name}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 max-w-prose text-xs text-ink-muted">
            <Link href={route("genome.reports", subjectParams)} className="underline underline-offset-2">
              {FULL_LIBRARY}
            </Link>
          </p>
        </div>
      ) : null}

      {message ? (
        <p className="max-w-prose rounded-xl border border-line bg-card p-4 text-sm text-ink-muted">
          {message}
          {showReportsLink ? (
            <>
              {" "}
              <Link href={route("genome.reports", subjectParams)} className="underline underline-offset-2">
                {OR_START_FROM_REPORTS}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      {showResults || showRegion ? (
        <div className="space-y-16 md:space-y-20 lg:space-y-24">
          {showResults ? (
            <section
              id="results"
              aria-labelledby="results-heading"
              data-density-top-level-section="true"
              className="space-y-4"
            >
              <h2 id="results-heading" className="text-lg font-semibold text-ink">
                {RESULTS_HEADING}
              </h2>
              <p className="max-w-prose text-sm text-ink-muted">{POSITIONS_BUILD}</p>
              <ClaimBlock
                subject={{ subjectId: subject.id }}
                figures={specs}
                aria-label={resultsLabel(q)}
                className="overflow-x-auto p-0"
                renderFigures={(nodes) => (
                  <table className="w-full min-w-[36rem] text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-ink-muted">
                        <th scope="col" className="px-4 py-2 font-normal">
                          {TABLE_HEADINGS.variant}
                        </th>
                        <th scope="col" className="px-4 py-2 font-normal">
                          {TABLE_HEADINGS.position}
                        </th>
                        <th scope="col" className="px-4 py-2 font-normal">
                          {TABLE_HEADINGS.gene}
                        </th>
                        <th scope="col" className="px-4 py-2 font-normal">
                          {TABLE_HEADINGS.genotype}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {hits.map((hit, index) => {
                        const figure = figureIndex[index];
                        return (
                          <tr
                            key={`${hit.chrom}:${hit.pos ?? "none"}:${hit.rsid ?? "none"}:${index}`}
                            className="border-b border-line last:border-0"
                          >
                            <td className="px-4 py-2 font-mono">
                              {hit.rsid !== null ? `rs${hit.rsid}` : "—"}
                            </td>
                            <td className="px-4 py-2 font-mono text-xs">
                              {/* inherit-figure-exempt: genomic coordinates and the reference/alternate letters are the position’s identity, not a result figure */}
                              {hit.pos === null
                                ? "—"
                                : `chr${chromToName(hit.chrom)}:${hit.pos}${hit.ref && hit.alt ? ` ${hit.ref}→${hit.alt}` : ""}`}
                            </td>
                            <td className="px-4 py-2">{hit.gene ?? "—"}</td>
                            <td className="px-4 py-2">
                              {figure !== null ? (
                                nodes[figure]
                              ) : hit.conflict ? (
                                <span className="text-sm text-ink">{FILES_DISAGREE}</span>
                              ) : (
                                <span className="text-sm text-ink-muted">{COVERAGE_PILLS["not-covered"]}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              >
                {truncated ? (
                  <p className="max-w-prose px-4 py-3 text-sm text-ink-muted">
                    {/* inherit-figure-exempt: a row limit, not a result figure */}
                    {resultsTruncated(REGION_ROW_LIMIT)}
                  </p>
                ) : null}
              </ClaimBlock>
            </section>
          ) : null}

          {showRegion ? (
            <section
              aria-labelledby="region-heading"
              data-density-top-level-section="true"
              className="space-y-4"
            >
              <h2 id="region-heading" className="text-lg font-semibold text-ink">
                {REGION_HEADING}
              </h2>
              <p className="max-w-prose font-mono text-sm text-ink-muted">
                {/* inherit-figure-exempt: the region shown is a coordinate range, not a result figure */}
                {formatLocus(locus)}
              </p>
              <GenomeBrowser fileId={active.id} locus={locus} />
              <p className="max-w-prose text-sm text-ink-muted">{FIRST_PARTY_NOTE}</p>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
