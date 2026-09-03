import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, type ReactNode } from "react";
import { ClaimBlock } from "@/components/figures/claim-block";
import { ReportSkeleton } from "@/components/reports/report-skeleton";
import { SensitiveGate } from "@/components/reports/sensitive-gate";
import { SupportPanel } from "@/components/reports/support-panel";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { SubjectBar } from "@/components/subjects/subject-bar";
import { NAV_LABELS } from "@/copy/navigation";
import {
  CONFIRMATION_LEVELS,
  EVIDENCE_DEFINITIONS,
  EVIDENCE_PUBLIC_LABELS,
} from "@/copy/reports/evidence";
import {
  ALL_REPORTS,
  ASK_ABOUT_THIS,
  CONFIRMATION_BLOCK,
  COUNSELLOR_NO_ROUTE,
  DATA_AND_METHODS,
  FILES_DISAGREE,
  GENOTYPE_LABEL,
  LAYER_DEFINITIONS,
  LAYER_LABELS,
  LIMIT_OF_FILE,
  MORE_SOURCES,
  NOTHING_TO_DO,
  NOT_COVERED_ARRAY,
  NOT_COVERED_VCF,
  NO_CALL,
  NO_FILE_YET,
  NO_RANGE_YET,
  PROVENANCE_LINE,
  REPORTS_TITLE,
  STRAND_FLIP_NOTE,
  TECHNICAL_NOTE,
  UNRECOGNIZED_NOTE,
  WHAT_THIS_DOESNT_MEAN_DEFAULT,
  coverageSentence,
  supportingStudies,
} from "@/copy/reports/strings";
import type { FigureClass } from "@/lib/figures/contract";
import type { GenotypeSpec } from "@/lib/figures/spec";
import { CATEGORY_LABELS } from "@/lib/genome/categories";
import {
  getSubjectGenotypesByRsid,
  getSubjectProcessedFiles,
} from "@/lib/genome/load";
import {
  resolveTemplate,
  type Citation,
  type ReportTemplate,
  type TemplateVariant,
  type VariantOutcome,
} from "@/lib/genome/reports";
import {
  categoryFor,
  isGatedTemplate,
  type CategoryId,
  type FindingLayer,
} from "@/lib/genome/taxonomy";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const VCF_TYPES = new Set<string>(["vcf", "gvcf"]);
const VISIBLE_CITATIONS = 3;
const CHIP =
  "inline-flex items-center rounded-full border border-line px-2 py-0.5 text-sm text-ink";

/** A template with an unmapped legacy category still renders; "Not now" then returns to the list top. */
function safeCategoryFor(template: ReportTemplate): CategoryId | null {
  try {
    return categoryFor(template);
  } catch {
    return null;
  }
}

/** Sorted genotype key ("AC") → the two letters ("A/C"); longer keys render as stored. */
function genotypeLetters(key: string): string {
  return key.length === 2 ? `${key[0]}/${key[1]}` : key;
}

function chromosomeName(chrom: number): string {
  return chrom === 23 ? "X" : chrom === 24 ? "Y" : chrom === 25 ? "MT" : String(chrom);
}

const loadReport = cache(async (segment: string, slug: string) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const subject = await resolveSubjectForAccount(user.id, segment);
  if (!subject) return null;
  const admin = createAdminClient();
  const [{ data: raw }, files] = await Promise.all([
    admin
      .from("report_templates")
      .select(
        "slug, category, title, summary, evidence, variants, pgs_id, citations, layer, estimate_kind",
      )
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle(),
    getSubjectProcessedFiles(admin, subject.id),
  ]);
  if (!raw) return null;
  return { user, subject, files, template: raw as unknown as ReportTemplate };
});

export async function generateMetadata(
  props: PageProps<"/genome/[subject]/reports/[slug]">,
): Promise<Metadata> {
  const { slug, subject: segment } = await props.params;
  const context = await loadReport(segment, slug);
  return {
    title: context ? `${context.subject.displayLabel} · ${context.template.title}` : "Report",
  };
}

function CitationItem({ citation }: { citation: Citation }) {
  const link = "underline underline-offset-2";
  if (citation.pmid) {
    return (
      <a
        href={`https://pubmed.ncbi.nlm.nih.gov/${citation.pmid}/`}
        target="_blank"
        rel="noopener noreferrer"
        className={link}
      >
        {citation.label} (PMID {citation.pmid})
      </a>
    );
  }
  if (citation.doi) {
    return (
      <a
        href={`https://doi.org/${citation.doi}`}
        target="_blank"
        rel="noopener noreferrer"
        className={link}
      >
        {citation.label} (doi:{citation.doi})
      </a>
    );
  }
  return <>{citation.label}</>;
}

function TechnicalNote({ children }: { children: ReactNode }) {
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-ink-muted">{TECHNICAL_NOTE}</summary>
      <p className="mt-1 text-ink-muted">{children}</p>
    </details>
  );
}

function VariantResult({
  variant,
  outcome,
  conflict,
  subjectId,
  figureClass,
  layer,
  notCovered,
}: {
  variant: TemplateVariant;
  outcome: VariantOutcome;
  conflict: boolean;
  subjectId: string;
  figureClass: FigureClass;
  layer: FindingLayer;
  notCovered: string;
}) {
  let body: ReactNode;
  if (conflict) {
    body = <p className="text-sm text-ink">{FILES_DISAGREE}</p>;
  } else if (outcome.status === "genotyped") {
    const figure: GenotypeSpec = {
      kind: "genotype",
      class: figureClass,
      basis: "observed",
      provenance: { kind: "computed", module: "genome/reports" },
      genotype: genotypeLetters(outcome.genotype),
      label: GENOTYPE_LABEL,
    };
    body = (
      <ClaimBlock subject={{ subjectId }} figures={[figure]}>
        <p className="mt-3 text-sm leading-relaxed text-ink">{outcome.interpretation}</p>
        {layer === "estimate" ? (
          <p className="mt-2 text-sm text-ink">{NO_RANGE_YET}</p>
        ) : null}
        {outcome.strandFlipped ? <TechnicalNote>{STRAND_FLIP_NOTE}</TechnicalNote> : null}
      </ClaimBlock>
    );
  } else if (outcome.status === "not-covered") {
    body = (
      <div data-outcome="not-covered" className="space-y-1 text-sm leading-relaxed text-ink">
        <p>{notCovered}</p>
        <p>{LIMIT_OF_FILE}</p>
      </div>
    );
  } else {
    // no-call, and unrecognized treated as no-call for display (A14): the
    // mismatch is noted, never reinterpreted, and the letters are not shown.
    body = (
      <div data-outcome={outcome.status} className="space-y-1 text-sm leading-relaxed text-ink">
        <p>{NO_CALL}</p>
        <p>{LIMIT_OF_FILE}</p>
        {outcome.status === "unrecognized" ? (
          <TechnicalNote>{UNRECOGNIZED_NOTE}</TechnicalNote>
        ) : null}
      </div>
    );
  }

  return (
    <div data-variant-result={variant.rsid} className="space-y-2">
      <p className="font-mono text-sm text-ink-muted">
        {variant.gene} · rs{variant.rsid} · chr{chromosomeName(variant.chrom)}
      </p>
      {body}
    </div>
  );
}

export default async function ReportDetailPage(
  props: PageProps<"/genome/[subject]/reports/[slug]">,
) {
  const [{ slug, subject: subjectSegment }, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const revealParam =
    typeof searchParams.reveal === "string" ? searchParams.reveal : undefined;

  const context = await loadReport(subjectSegment, slug);
  if (!context) notFound();
  const { user, subject, files, template } = context;

  const layer: FindingLayer = template.layer ?? "estimate";
  const figureClass: FigureClass = layer === "variant_call" ? "variant-call" : "estimate";
  const categoryId = safeCategoryFor(template);
  const evidenceLabel = EVIDENCE_PUBLIC_LABELS[template.evidence] ?? template.evidence;
  const evidenceDefinition = EVIDENCE_DEFINITIONS[template.evidence];

  // Gating is per template (legacy sensitive categories + the clinical-
  // confirmation content rule), preserved template-for-template across the
  // taxonomy change. The result is withheld SERVER-side: it is built only
  // when showResults, so a gated response carries no result in markup or in
  // the RSC payload.
  const sensitive = isGatedTemplate(template);
  const carrierStyle = template.category === "reproductive-family";
  const carrier = /\bcarrier\b/i.test(template.title);
  const hasData = files.length > 0;
  const gated = sensitive && hasData;
  const showSupport = (sensitive || carrierStyle) && hasData;
  const showResults = !gated || revealParam === "1";
  const hubHref = `/genome/${subject.routeSegment}`;
  const reportsHref = `${hubHref}/reports`;
  const revealHref = `${reportsHref}/${encodeURIComponent(template.slug)}?reveal=1`;

  // Array files and VCF files fail to cover a position for different
  // reasons; when the subject has both kinds the array explanation is used.
  const hasArray = files.some((file) => !VCF_TYPES.has(file.file_type));
  const notCovered = hasArray ? NOT_COVERED_ARRAY : NOT_COVERED_VCF;

  let yourResult: ReactNode;
  let coveredPositions = 0;
  if (showResults) {
    const { genotypes, conflicts } = hasData
      ? await getSubjectGenotypesByRsid(
          createAdminClient(),
          subject.id,
          template.variants.map((variant) => variant.rsid),
        )
      : { genotypes: new Map<number, string>(), conflicts: new Set<number>() };
    const resolved = resolveTemplate(template, (rsid) => genotypes.get(rsid));
    coveredPositions = resolved.variants.filter(
      (item) => item.outcome.status === "genotyped",
    ).length;

    yourResult = hasData ? (
      <div className="space-y-6">
        {resolved.variants.map(({ variant, outcome }) => (
          <VariantResult
            key={variant.rsid}
            variant={variant}
            outcome={outcome}
            conflict={conflicts.has(variant.rsid)}
            subjectId={subject.id}
            figureClass={figureClass}
            layer={layer}
            notCovered={notCovered}
          />
        ))}
      </div>
    ) : (
      <p className="text-sm text-ink">{NO_FILE_YET}</p>
    );
  } else {
    yourResult = (
      <SensitiveGate
        userId={user.id}
        category={template.category}
        categoryLabel={CATEGORY_LABELS[template.category] ?? template.category}
        revealHref={revealHref}
        returnHref={reportsHref}
        returnAnchor={categoryId ?? undefined}
      />
    );
  }

  const visibleCitations = template.citations.slice(0, VISIBLE_CITATIONS);
  const moreCitations = template.citations.slice(VISIBLE_CITATIONS);

  return (
    <article className="mx-auto max-w-[44rem] space-y-8">
      <Breadcrumbs
        items={[
          { label: NAV_LABELS["my-genome"], href: hubHref },
          { label: subject.displayLabel },
          { label: REPORTS_TITLE, href: reportsHref },
          { label: template.title },
        ]}
      />
      <SubjectBar subject={subject} fileCount={files.length} />

      <header className="space-y-4">
        <h1 className="display text-3xl">{template.title}</h1>
        <ul data-slot="chip-row" className="space-y-2 text-sm">
          <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span data-chip="layer" className={CHIP}>
              {LAYER_LABELS[layer]}
            </span>
            <span className="text-ink-muted">{LAYER_DEFINITIONS[layer]}</span>
          </li>
          <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <Link
              href="/science#evidence"
              data-chip="evidence"
              className={`${CHIP} underline-offset-2 hover:underline`}
            >
              {evidenceLabel}
            </Link>
            <span className="text-ink-muted">{evidenceDefinition}</span>
          </li>
          <li>
            <span data-chip="subject" data-subject-id={subject.id} className={CHIP}>
              {subject.displayLabel}
            </span>
          </li>
        </ul>
      </header>

      <ReportSkeleton
        whatThisIs={<p className="text-base leading-relaxed text-ink">{template.summary}</p>}
        yourResult={yourResult}
        whatThisDoesntMean={
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink">
            {WHAT_THIS_DOESNT_MEAN_DEFAULT.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        }
        howSureWeAre={
          <div className="space-y-3 text-sm leading-relaxed text-ink">
            <p>
              <span className="font-medium">{evidenceLabel}</span>
              <span className="text-ink-muted">{` — ${evidenceDefinition}`}</span>
            </p>
            <p>{supportingStudies(template.citations.length)}</p>
            {showResults && hasData && layer === "estimate" ? (
              // The mandated coverage sentence (§2 §4.4e): the numerals are
              // counts of template positions read from the file, not a risk
              // figure. It names "this estimate", so it renders on that layer only.
              <p>{coverageSentence(coveredPositions, template.variants.length)}</p>
            ) : null}
            {CONFIRMATION_LEVELS.has(template.evidence) ? (
              <div data-confirmation-block="true" className="space-y-1">
                <p>{CONFIRMATION_BLOCK}</p>
                <p>{COUNSELLOR_NO_ROUTE}</p>
              </div>
            ) : null}
            {showResults && showSupport ? <SupportPanel carrier={carrier} /> : null}
          </div>
        }
        whatYouCanDo={<p className="text-sm leading-relaxed text-ink">{NOTHING_TO_DO}</p>}
        whereThisComesFrom={
          <div className="space-y-3 text-sm leading-relaxed">
            <ul className="space-y-1">
              {visibleCitations.map((citation, index) => (
                <li key={`${citation.label}-${index}`}>
                  <CitationItem citation={citation} />
                </li>
              ))}
            </ul>
            {moreCitations.length > 0 ? (
              <details>
                <summary className="cursor-pointer text-ink-muted">{MORE_SOURCES}</summary>
                <ul className="mt-2 space-y-1">
                  {moreCitations.map((citation, index) => (
                    <li key={`${citation.label}-${index}`}>
                      <CitationItem citation={citation} />
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <p className="text-ink-muted">{PROVENANCE_LINE}</p>
          </div>
        }
      />

      <footer className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href={`${hubHref}/data`} className="underline underline-offset-2">
          {DATA_AND_METHODS}
        </Link>
        <Link
          href={`/copilot/${subject.routeSegment}?report=${encodeURIComponent(template.slug)}`}
          className="underline underline-offset-2"
        >
          {ASK_ABOUT_THIS}
        </Link>
        <Link href={reportsHref} className="underline underline-offset-2">
          {ALL_REPORTS}
        </Link>
      </footer>
    </article>
  );
}
