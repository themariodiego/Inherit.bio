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
 * src/copy/genome/data.ts; every href from a route id. The search itself,
 * the genotype figures and the coverage pair are src/lib/genome/browser.ts —
 * the module both figures name as `computed:genome/browser`.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GenomeBrowser } from "@/components/browse/genome-browser";
import { ClaimBlock } from "@/components/figures/claim-block";
import { InputProvenance } from "@/components/reports/input-provenance";
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
  TABLE_INPUT_NOTE,
  TABLE_COVERAGE_NOTE,
  TRACK_INPUT_NOTE,
  TRAIT_TOPICS,
  clinicalGeneStatus,
  lookingFor,
  resultsLabel,
  resultsTruncated,
} from "@/copy/genome/data";
import { NAV_LABELS } from "@/copy/navigation";
import { COVERAGE_PILLS, FILES_DISAGREE } from "@/copy/reports/strings";
import {
  EMPTY,
  REGION_ROW_LIMIT,
  browserCoverage,
  genotypeFigures,
  search,
} from "@/lib/genome/browser";
import { getSubjectFileCount } from "@/lib/genome/load";
import { getPreparedSourceFiles } from "@/lib/genome/prepared-sources";
import { loadInputSources } from "@/lib/genome/input-sources";
import { formatLocus } from "@/lib/genome/locus";
import { chromToName } from "@/lib/genome/types";
import { route } from "@/lib/primary-routes";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: BROWSER_H1 };

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
    getPreparedSourceFiles(admin, subject.id),
    getSubjectFileCount(admin, subject.id),
  ]);
  let selectedActive: (typeof files)[number] | null = files[0] ?? null;
  let outcome = q && selectedActive ? await search(admin, subject.id, selectedActive.id, q) : EMPTY;
  if (q && selectedActive) {
    const currentIds = new Set((await getPreparedSourceFiles(admin, subject.id)).map(file => file.id));
    if (!currentIds.has(selectedActive.id)) selectedActive = null;
    if (outcome.checkedFileIds.some(id => !currentIds.has(id))) outcome = EMPTY;
  }
  const active = selectedActive;
  const { hits, truncated, locus, message, showReportsLink, clinicalGene, trait } = outcome;

  // One genotype figure per covered row; the block owns the attribution and
  // hands the rendered nodes back for the table layout.
  const { specs, figureIndex } = genotypeFigures(hits);

  const showResults = hits.length > 0;
  const showRegion = locus !== null && active !== null;
  // The search owns its input snapshot. A file can finish processing after
  // the outer read selected the track; never substitute that older set here.
  const checkedIds = outcome.checkedFileIds;
  const sourceFacts = await loadInputSources(admin, subject.id,
    [...checkedIds, ...(showRegion ? [active.id] : [])], { kind: "prepared" });
  const tableInputs = sourceFacts.filter((source) => checkedIds.includes(source.fileId))
    .map((source) => ({ ...source, hasResultRecord: outcome.inputFileIds.includes(source.fileId) }));
  const inputState = hits.some((hit) => hit.conflict) ? "conflict"
    : hits.some((hit) => hit.genotype === "--") ? "noCall"
    : outcome.inputFileIds.length ? "recorded" : "absent";

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
                scrollable
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
      {outcome.inputScope || showRegion ? <div data-slot="browser-input-provenance" className="space-y-8">
        {outcome.inputScope ? <div data-slot="table-input-provenance" className="space-y-3">
          <p className="text-sm text-ink-muted">{TABLE_INPUT_NOTE}</p>
          {showResults ? <p className="text-sm text-ink-muted">{TABLE_COVERAGE_NOTE}</p> : null}
          <InputProvenance sources={tableInputs} subject={{ subjectId: subject.id }} state={inputState}
            coverage={showResults ? browserCoverage(hits) : undefined} />
        </div> : null}
        {showRegion ? <div data-slot="track-input-provenance" className="space-y-3">
          <p className="text-sm text-ink-muted">{TRACK_INPUT_NOTE}</p>
          <InputProvenance sources={sourceFacts.filter((source) => source.fileId === active.id)} subject={{ subjectId: subject.id }} />
        </div> : null}
      </div> : null}
    </div>
  );
}
