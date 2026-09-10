import { loadOwnStoredReportSnapshot } from "@/lib/genome/own-stored-report";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache, type ReactNode } from "react";
import { CapabilityUnavailable } from "@/components/capability-unavailable";
import { ClaimBlock } from "@/components/figures/claim-block";
import { ReportSkeleton } from "@/components/reports/report-skeleton";
import { CitationItem, ReportCallCoverage } from "@/components/reports/report-evidence";
import { ReportInterpretation, ReportSummary, ReportSummarySources } from "@/components/reports/report-summary";
import { annotateReportSources, legacySourceId, reportSourceIds } from "@/lib/claims/presentation";
import { SensitiveGate } from "@/components/reports/sensitive-gate";
import { SupportPanel } from "@/components/reports/support-panel";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { SubjectBar } from "@/components/subjects/subject-bar";
import { NAV_LABELS } from "@/copy/navigation";
import {
  CONFIRMATION_LEVELS,
  EVIDENCE_PUBLIC_LABELS,
  evidenceDefinitionFor,
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
  NOT_COVERED_ARRAY,
  NOT_COVERED_VCF,
  NO_CALL,
  NO_FILE_YET,
  NO_RANGE_YET,
  PROVENANCE_LINE,
  REPORTS_TITLE,
  SOURCES_HEADING,
  STRAND_FLIP_NOTE,
  TECHNICAL_NOTE,
  UNRECOGNIZED_NOTE,
  WHAT_THIS_DOESNT_MEAN_GENERIC,
  WHAT_THIS_DOESNT_MEAN_NOT_COVERED,
  coverageSentence,
  whatYouCanDo,
} from "@/copy/reports/strings";
import { REPORT_METHOD_COPY, REPORT_SOURCES_SCOPE, SCORE_METHOD_LABEL, SOURCE_READ_SCOPE, citedSources } from "@/copy/reports/basis";
import { reportMethod, summarizeReportCalls, type ReportCallSummary } from "@/lib/genome/report-evidence";
import type { FigureClass } from "@/lib/figures/contract";
import type { GenotypeSpec } from "@/lib/figures/spec";
import { CATEGORY_LABELS } from "@/lib/genome/categories";
import {
  getSubjectFileCount,
} from "@/lib/genome/load";
import { getSubjectReportCalls } from "@/lib/genome/report-calls";
import { loadInputSources, type InputSourceView } from "@/lib/genome/input-sources";
import { InputProvenance } from "@/components/reports/input-provenance";
import {
  reportNameOf,
  resolveTemplate,
  type ReportTemplate,
  type TemplateVariant,
  type VariantOutcome,
} from "@/lib/genome/reports";
import {
  categoryFor,
  categoryLabel,
  isGatedTemplate,
  type CategoryId,
  type FindingLayer,
} from "@/lib/genome/taxonomy";
import { grantedLayers, LAYER_PURPOSES, viewerMaySee } from "@/lib/family/access";
import { resolveSubjectRoute } from "@/lib/family/subject-route";
import { loadSharedReportSnapshot } from "@/lib/family/shared-report-results";
import { resolveStoredSharedReport, selectSharedReport, sharedReportsForSlug } from "@/lib/family/shared-report-display";
import { filterOwnAnalysisFiles, loadOwnAnalysisCandidateFiles } from "@/lib/genome/own-analysis-access";
import { route } from "@/lib/primary-routes";
import { createAdminClient } from "@/lib/supabase/admin";

const VCF_TYPES = new Set<string>(["vcf", "gvcf"]);
const VISIBLE_CITATIONS = 3;
const CHIP =
  "inline-flex items-center rounded-full border border-line px-2 py-0.5 text-sm text-ink";
const REQUIRED_ACCURACY = { "data-density-required-accuracy": "true" } as const;

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

/**
 * One renderer, two domains (design §2.2): the account's own records and,
 * through the Family graph, another adult's shared record. A family segment
 * reads its genotypes from that person's own subject, is answered only after
 * the Tier-2 gate, and only for the layer they granted.
 */
const loadReport = cache(async (segment: string, slug: string, source?: string | string[]) => {
  if (source !== undefined && typeof source !== "string") return { kind: "not-found" } as const;
  const context = await resolveSubjectRoute(segment, {
    anyOf: ["reports.monogenic", "reports.polygenic"],
  });
  if (context.kind !== "ok") return context;
  const admin = createAdminClient();
  if (!context.person && source !== undefined) {
    const own = await loadOwnStoredReportSnapshot(admin, { subjectId: context.dataSubjectId, fileId: source, slug });
    const stored = own.reports[0];
    if (!own.authorized || !stored) return { kind: "not-found" } as const;
    return { ...context, shared: own, sharedReport: stored, sharedChoices: [stored], sharedLegacyAvailable: false,
      template: stored.report.catalogSnapshot.template,
      files: [{ id: stored.fileId, file_type: own.sources[0].fileType }], fileCount: await getSubjectFileCount(admin, context.dataSubjectId) };
  }
  const shared = context.person ? await loadSharedReportSnapshot(admin, {
    subjectId: context.dataSubjectId, counterpartAccountId: context.person.counterpartAccountId,
    purposes: grantedLayers(context.person).map(layer => layer === "variant_call" ? "reports.monogenic" : "reports.polygenic"),
  }) : null;
  if (shared && !shared.authorized) return { kind: "not-found" } as const;
  const sharedChoices = shared ? sharedReportsForSlug(shared.reports, slug) : [];
  const legacyCandidates = context.person
    ? await loadOwnAnalysisCandidateFiles(admin, context.dataSubjectId, { legacyOnly: true }) : null;
  const sharedLegacyAvailable = (legacyCandidates?.length ?? 0) > 0;
  const sharedReport = shared && source !== "legacy" ? selectSharedReport(shared.reports, slug, source) : null;
  if (sharedReport) {
    const input = shared!.sources.find(item => item.fileId === sharedReport.fileId);
    return { ...context, shared, sharedReport, sharedChoices, sharedLegacyAvailable,
      template: sharedReport.report.catalogSnapshot.template,
      files: [{ id: sharedReport.fileId, file_type: input?.fileType ?? "unknown" }],
      fileCount: new Set(shared!.sources.map(item => item.fileId)).size + (legacyCandidates?.length ?? 0),
    };
  }
  // An explicit source never silently changes to another file or legacy data.
  if (context.person && source !== undefined && !(source === "legacy" && sharedLegacyAvailable)) return { kind: "not-found" } as const;
  if (source !== "legacy" && shared?.unavailableReports.some(row => row.slug === slug)) {
    if (!(await shared.confirm()).authorized) return { kind: "not-found" } as const;
    return { kind: "shared-unavailable" } as const;
  }
  // The results read the processed files; the subject bar counts every file
  // in the record, whatever its status.
  const [{ data: raw }, candidateFiles, fileCount] = await Promise.all([
    admin
      .from("report_templates")
      .select(
        "slug, category, title, summary, evidence, variants, pgs_id, citations, layer, estimate_kind",
      )
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle(),
    legacyCandidates ?? loadOwnAnalysisCandidateFiles(admin, context.dataSubjectId),
    context.person
      ? admin.from("genome_files").select("id", { count: "exact", head: true })
        .eq("subject_id", context.dataSubjectId).is("single_logical_sample_verified_at", null).then(result => result.count ?? 0)
      : getSubjectFileCount(admin, context.dataSubjectId),
  ]);
  if (!raw) return { kind: "not-found" } as const;
  const layer = (raw.layer ?? "estimate") as FindingLayer;
  if (context.person && !viewerMaySee(context.person, LAYER_PURPOSES[layer])) return { kind: "not-found" } as const;
  const files = await filterOwnAnalysisFiles(admin, context.dataSubjectId,
    layer === "variant_call" ? "reports.monogenic" : "reports.polygenic", context.person ? candidateFiles.filter(file => file.single_logical_sample_verified_at === null) : candidateFiles);
  return { ...context, files, fileCount, shared, sharedReport: null, sharedChoices, sharedLegacyAvailable, template: raw as unknown as ReportTemplate };
});

export async function generateMetadata(
  props: PageProps<"/genome/[subject]/reports/[slug]">,
): Promise<Metadata> {
  const { slug, subject: segment } = await props.params;
  const params = await props.searchParams;
  const context = await loadReport(segment, slug, params.source);
  const current = context.kind === "ok" && context.shared ? await context.shared.confirm() : null;
  return {
    title:
      context.kind === "ok" && (!current || current.authorized)
        ? `${context.displayLabel} · ${reportNameOf(context.template.title)}`
        : "Report",
  };
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
  reportSlug,
  sourceIds,
  variant,
  outcome,
  conflict,
  subjectId,
  figureClass,
  layer,
  notCovered,
  showLocus,
  densityPrimaryClaim,
}: {
  reportSlug: string;
  sourceIds: readonly string[];
  variant: TemplateVariant;
  outcome: VariantOutcome;
  conflict: boolean;
  subjectId: string;
  figureClass: FigureClass;
  layer: FindingLayer;
  notCovered: string;
  /** Only a multi-variant report labels each block; with one variant there is nothing to tell apart. */
  showLocus: boolean;
  densityPrimaryClaim: boolean;
}) {
  // Built outside JSX so the readability gate scans the rendered text, not a
  // template with placeholder slots.
  const locusLabel = `${variant.gene} rs${variant.rsid}`;
  let body: ReactNode;
  if (conflict) {
    body = (
      <p {...REQUIRED_ACCURACY} className="text-sm text-ink">
        {FILES_DISAGREE}
      </p>
    );
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
      <ClaimBlock
        subject={{ subjectId }}
        figures={[figure]}
        aria-label={locusLabel}
        densityPrimaryClaim={densityPrimaryClaim}
      >
        <ReportInterpretation slug={reportSlug} rsid={variant.rsid} genotype={outcome.genotype}
          text={outcome.interpretation} sourceIds={sourceIds} />
        {layer === "estimate" ? (
          <p {...REQUIRED_ACCURACY} className="mt-2 text-sm text-ink">
            {NO_RANGE_YET}
          </p>
        ) : null}
        {outcome.strandFlipped ? <TechnicalNote>{STRAND_FLIP_NOTE}</TechnicalNote> : null}
      </ClaimBlock>
    );
  } else if (outcome.status === "not-covered") {
    body = (
      <div data-outcome="not-covered" className="space-y-1 text-sm leading-relaxed text-ink">
        <p {...REQUIRED_ACCURACY}>{notCovered}</p>
        <p {...REQUIRED_ACCURACY}>{LIMIT_OF_FILE}</p>
      </div>
    );
  } else {
    // no-call, and unrecognized treated as no-call for display (A14): the
    // mismatch is noted, never reinterpreted, and the letters are not shown.
    body = (
      <div data-outcome={outcome.status} className="space-y-1 text-sm leading-relaxed text-ink">
        <p {...REQUIRED_ACCURACY}>{NO_CALL}</p>
        <p {...REQUIRED_ACCURACY}>{LIMIT_OF_FILE}</p>
        {outcome.status === "unrecognized" ? (
          <TechnicalNote>{UNRECOGNIZED_NOTE}</TechnicalNote>
        ) : null}
      </div>
    );
  }

  return (
    <div data-variant-result={variant.rsid} className="space-y-2">
      {showLocus ? (
        <p data-slot="variant-locus" className="font-mono text-sm text-ink-muted">
          {variant.gene} · rs{variant.rsid}
        </p>
      ) : null}
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

  const sourceParam = searchParams.source;
  const context = await loadReport(subjectSegment, slug, sourceParam);
  if (context.kind === "not-found") notFound();
  if (context.kind === "shared-unavailable") {
    return <section role="status" className="mx-auto max-w-prose space-y-4">
      <h1 className="display text-3xl">Saved result unavailable</h1>
      <p>This saved result is missing the source details needed to show it.</p>
      <Link className="underline" href={route("family.person", { person: subjectSegment })}>Back to shared results</Link>
    </section>;
  }
  // The Family domain has one gate, on the person page; a report reached
  // before it is sent there and fetches nothing derived.
  if (context.kind === "gate") {
    redirect(route("family.person", { person: context.personSegment }));
  }
  if (context.kind === "jurisdiction") {
    return (
      <CapabilityUnavailable
        eyebrow={NAV_LABELS.family}
        title={REPORTS_TITLE}
        backHref={route("family.index")}
      />
    );
  }
  const { user, subject, dataSubjectId, person, domain, files, fileCount, template, shared, sharedReport, sharedChoices, sharedLegacyAvailable } = context;

  const reportName = reportNameOf(template.title);
  const layer: FindingLayer = template.layer ?? "estimate";
  // A layer this person has not shared is not readable through a direct URL
  // either; the answer is the one an unknown record gets.
  if (person && !viewerMaySee(person, LAYER_PURPOSES[layer])) notFound();
  const figureClass: FigureClass = layer === "variant_call" ? "variant-call" : "estimate";
  const categoryId = safeCategoryFor(template);
  const evidenceLabel = EVIDENCE_PUBLIC_LABELS[template.evidence] ?? template.evidence;
  const evidenceDefinition = evidenceDefinitionFor(template.evidence, layer);

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
  const subjectParams = { subject: subject.routeSegment };
  const reportsHref = route("genome.reports", subjectParams);
  const revealHref = route(
    "genome.report",
    { ...subjectParams, slug: template.slug },
    { query: { reveal: "1", ...(sharedReport ? { source: sharedReport.fileId } : person && sourceParam === "legacy" ? { source: "legacy" } : {}) } },
  );
  // "Not now" returns to the library at this report's category section; a
  // template with an unmapped legacy category returns to that category's id.
  // The link names the report's layer: the list renders one group at a time
  // and, with both layers populated, opens on the first, so the hash resolves
  // only on the group that holds this category.
  const returnHref = route("genome.reports", subjectParams, {
    query: { layer },
    hash: categoryId ?? template.category,
  });

  // Array files and VCF files fail to cover a position for different
  // reasons. A VCF usually lists only the positions where the subject
  // differs from the reference, so whenever ANY processed file is a VCF or
  // gVCF the missing position may be "tested and normal" and the VCF
  // explanation is the honest one; only an all-array record gets the
  // fixed-probe-set explanation.
  const hasVcf = files.some((file) => VCF_TYPES.has(file.file_type));
  const notCovered = hasVcf ? NOT_COVERED_VCF : NOT_COVERED_ARRAY;

  const existingSourceIds = template.citations.map(legacySourceId);
  const summarySourceIds = reportSourceIds(template);
  let yourResult: ReactNode;
  let coveredPositions = 0;
  let callSummary: ReportCallSummary | null = null;
  let anyNotCovered = false;
  let inputSources: InputSourceView[] = [];
  let inputState: "recorded" | "noCall" | "conflict" | "absent" = "absent";
  if (showResults) {
    const { genotypes, conflicts: legacyConflicts, calls, checkedFileIds } = hasData && !sharedReport
      ? await getSubjectReportCalls(
          createAdminClient(),
          dataSubjectId,
          [template],
        )
      : { genotypes: new Map<number, string>(), conflicts: new Set<number>(), calls: [], checkedFileIds: [] };
    const recordedFiles = new Set(calls.map((call) => call.file_id));
    inputSources = sharedReport ? (shared?.sources ?? []).filter(item => item.fileId === sharedReport.fileId) : (await loadInputSources(createAdminClient(), dataSubjectId, checkedFileIds,
      { kind: "report", purpose: layer === "variant_call" ? "reports.monogenic" : "reports.polygenic" }))
      .map((source) => ({ ...source, hasResultRecord: recordedFiles.has(source.fileId) }));
    const conflicts = sharedReport ? new Set(sharedReport.report.conflictingRsids) : legacyConflicts;
    inputState = sharedReport ? (conflicts.size ? "conflict"
      : sharedReport.report.variants.some(item => item.outcome.status === "no-call") ? "noCall"
      : sharedReport.report.variants.some(item => item.outcome.status === "genotyped" || item.outcome.status === "unrecognized") ? "recorded" : "absent") : conflicts.size ? "conflict" : [...genotypes.values()].includes("--") ? "noCall" : calls.length ? "recorded" : "absent";
    const resolved = sharedReport ? resolveStoredSharedReport(sharedReport) : resolveTemplate(template, (rsid) => genotypes.get(rsid));
    if (!resolved) notFound();
    callSummary = hasData && resolved.variants.length > 0 ? summarizeReportCalls(resolved, conflicts) : null;
    coveredPositions = callSummary?.interpreted ?? 0;
    anyNotCovered =
      hasData && resolved.variants.some((item) => item.outcome.status === "not-covered");
    // The first claim block on the page is the density measurement's primary
    // claim (docs/density-baseline.json); a variant without a genotype
    // renders no block, so the marker goes to the first that does.
    const primaryClaimRsid = resolved.variants.find(
      ({ variant, outcome }) => outcome.status === "genotyped" && !conflicts.has(variant.rsid),
    )?.variant.rsid;

    yourResult = hasData ? (
      <div className="space-y-6">
        {resolved.variants.map(({ variant, outcome }) => (
          <VariantResult
            key={variant.rsid}
            reportSlug={template.slug}
            sourceIds={summarySourceIds}
            variant={variant}
            outcome={outcome}
            conflict={conflicts.has(variant.rsid)}
            subjectId={dataSubjectId}
            figureClass={figureClass}
            layer={layer}
            notCovered={notCovered}
            showLocus={template.variants.length > 1}
            densityPrimaryClaim={variant.rsid === primaryClaimRsid}
          />
        ))}
      </div>
    ) : (
      <p className="text-sm text-ink">{person ? "No completed result is shared for this report yet." : fileCount === 0 ? NO_FILE_YET : (
        <>Choose this result type in <Link className="underline" href={reportsHref}>Reports</Link> to see what your file supports.</>
      )}</p>
    );
  } else {
    yourResult = (
      <SensitiveGate
        userId={user.id}
        category={template.category}
        categoryLabel={CATEGORY_LABELS[template.category] ?? template.category}
        revealHref={revealHref}
        returnHref={returnHref}
      />
    );
  }

  // D16, "fewer claims, not more caveats": one generic bullet that is true
  // for traits and conditions alike, and a second only when a shown result
  // has a position the file does not cover.
  const doesntMeanBullets = anyNotCovered
    ? [WHAT_THIS_DOESNT_MEAN_GENERIC, WHAT_THIS_DOESNT_MEAN_NOT_COVERED]
    : [WHAT_THIS_DOESNT_MEAN_GENERIC];

  // The mandated coverage sentence (§2 §4.4e) names "this estimate", so it
  // renders on that layer only, and only with a shown result.
  const coverageLine =
    showResults && hasData && layer === "estimate" && template.variants.length > 0
      ? coverageSentence(coveredPositions, new Set(template.variants.map((variant) => variant.rsid)).size)
      : null;

  const annotatedCitations = annotateReportSources(summarySourceIds, template.citations);
  const visibleCitations = annotatedCitations.slice(0, VISIBLE_CITATIONS);
  const moreCitations = annotatedCitations.slice(VISIBLE_CITATIONS);

  // No awaited work follows this authority recheck. Metadata generation also
  // confirms its own projection; neither cached context grants lasting access.
  if (shared && !(await shared.confirm()).authorized) notFound();

  return (
    <article
      data-surface="reading"
      data-density-primary-content="true"
      className="mx-auto max-w-[44rem] space-y-8"
    >
      <Breadcrumbs
        items={[
          { label: domain.label, href: domain.href },
          {
            label: subject.displayLabel,
            href: person
              ? route("family.person", { person: subject.routeSegment })
              : undefined,
          },
          { label: REPORTS_TITLE, href: reportsHref },
          { label: reportName },
        ]}
      />
      <SubjectBar subject={subject} fileCount={fileCount} viewerAccountId={user.id} />

      <header className="space-y-4">
        <div className="space-y-1">
          {categoryId ? (
            // The nine-category label, never the legacy one; utility classes,
            // not the `.eyebrow` class (D31).
            <p className="text-[13px] uppercase tracking-[0.14em] text-ink-muted">
              {categoryLabel(categoryId)}
            </p>
          ) : null}
          <h1 className="display text-3xl">{reportName}</h1>
        </div>
        {sharedChoices.length + Number(sharedLegacyAvailable) > 1 ? <nav aria-label="Saved result source" className="flex flex-wrap gap-3 text-sm">
          {sharedChoices.map((row, index) => <Link key={row.fileId}
            href={route("genome.report", { ...subjectParams, slug }, { query: {
              source: row.fileId, ...(revealParam === "1" ? { reveal: "1" } : {}),
            } })}
            aria-current={sharedReport?.fileId === row.fileId ? "page" : undefined}
            className="inline-flex min-h-11 items-center underline underline-offset-2">
            <span data-ui-chrome-kind="item-count">Saved result {index + 1}</span>
          </Link>)}
          {sharedLegacyAvailable ? <Link
            href={route("genome.report", { ...subjectParams, slug }, { query: {
              source: "legacy", ...(revealParam === "1" ? { reveal: "1" } : {}),
            } })}
            aria-current={!sharedReport ? "page" : undefined}
            className="inline-flex min-h-11 items-center underline underline-offset-2">Other files</Link> : null}
        </nav> : null}
        {sharedReport ? <p className="text-sm text-ink-muted">Saved on <time dateTime={sharedReport.completedAt}>
          {sharedReport.completedAt.slice(0, 10)}</time>. Each saved result uses one source file.</p> : null}
        <ul data-slot="chip-row" className="space-y-2 text-sm">
          <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span data-chip="layer" className={CHIP}>
              {LAYER_LABELS[layer]}
            </span>
            <span className="text-ink-muted">{LAYER_DEFINITIONS[layer]}</span>
          </li>
          <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <Link
              href={route("science.index", { hash: "evidence" })}
              data-chip="evidence"
              className={`${CHIP} underline-offset-2 hover:underline`}
            >
              {evidenceLabel}
            </Link>
            <span className="text-ink-muted">{evidenceDefinition}</span>
          </li>
          <li>
            {/* X4: the chip names the subject the computation used, which is
                the counterpart's own record on a Family route. */}
            <span data-chip="subject" data-subject-id={dataSubjectId} className={CHIP}>
              {subject.displayLabel}
            </span>
          </li>
        </ul>
      </header>

      <ReportSkeleton
        whatThisIs={
          <div className="space-y-3">
            <ReportSummary slug={template.slug} text={template.summary} sourceIds={summarySourceIds} />
            <p data-slot="report-method" className="text-sm leading-relaxed text-ink-muted">{REPORT_METHOD_COPY[reportMethod(template)]}</p>
          </div>
        }
        yourResult={yourResult}
        whatThisDoesntMean={
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink">
            {doesntMeanBullets.map((bullet) => (
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
            {/* inherit-figure-exempt: a count of the template's citations, not a result figure */}
            <p>{citedSources(template.citations.length)}</p>
            <p className="text-ink-muted">{REPORT_SOURCES_SCOPE}</p>
            {/* inherit-figure-exempt: counts of template positions read from the file, not a result figure */}
            {coverageLine ? <p>{coverageLine}</p> : null}
            {callSummary ? <ReportCallCoverage summary={callSummary} /> : null}
            {CONFIRMATION_LEVELS.has(template.evidence) ? (
              <div data-confirmation-block="true" className="space-y-1">
                <p {...REQUIRED_ACCURACY}>{CONFIRMATION_BLOCK}</p>
                <p>{COUNSELLOR_NO_ROUTE}</p>
              </div>
            ) : null}
          </div>
        }
        whatYouCanDo={
          // Brief line 630 is conditional; reviewed exceptions offer a
          // discussion option without treatment or intake advice.
          <p {...REQUIRED_ACCURACY} className="text-sm leading-relaxed text-ink">
            {whatYouCanDo(categoryId, template.slug)}
          </p>
        }
        whereThisComesFrom={
          <div className="space-y-3 text-sm leading-relaxed">
            <h3 className="font-medium text-ink">{SOURCES_HEADING}</h3>
            <p className="text-ink-muted">{SOURCE_READ_SCOPE}</p>
            <ul className="space-y-1">
              {visibleCitations.map(({ citation, anchor, number }, index) => (
                <li key={`${citation.label}-${index}`} id={anchor}>
                  {number ? <span data-ui-chrome-kind="item-count" className="font-medium">{number}. </span> : null}
                  <CitationItem citation={citation} reportClaim={summarySourceIds.length ? { slug: template.slug, sourceIds: summarySourceIds } : undefined} />
                </li>
              ))}
            </ul>
            {moreCitations.length > 0 ? (
              <details>
                <summary className="cursor-pointer text-ink-muted">{MORE_SOURCES}</summary>
                <ul className="mt-2 space-y-1">
                  {moreCitations.map(({ citation, anchor, number }, index) => (
                    <li key={`${citation.label}-${index}`} id={anchor}>
                      {number ? <span data-ui-chrome-kind="item-count" className="font-medium">{number}. </span> : null}
                      <CitationItem citation={citation} reportClaim={summarySourceIds.length ? { slug: template.slug, sourceIds: summarySourceIds } : undefined} />
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <ReportSummarySources sourceIds={summarySourceIds} existingIds={existingSourceIds} />
            {summarySourceIds.length > 0 ? <Link href="/science#sources" className="underline underline-offset-2">About these sources</Link> : null}
            {reportMethod(template) === "polygenic-score" ? (
              <p data-slot="score-method-source">
                {SCORE_METHOD_LABEL}: {" "}
                <a href={`https://www.pgscatalog.org/score/${template.pgs_id}/`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  {template.pgs_id}
                </a>
              </p>
            ) : null}
            {/* The template's variants: gene, dbSNP record and GRCh38 locus. */}
            <ul data-slot="variant-provenance" className="space-y-1 font-mono text-ink-muted">
              {template.variants.map((variant) => (
                <li key={variant.rsid}>
                  {variant.gene} ·{" "}
                  <a
                    href={`https://www.ncbi.nlm.nih.gov/snp/rs${variant.rsid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    rs{variant.rsid}
                  </a>
                  {/* inherit-figure-exempt: variant coordinates are provenance, not a result figure */}
                  {` · chr${chromosomeName(variant.chrom)}:${variant.pos38} ${variant.ref}→${variant.alt}`}
                </li>
              ))}
            </ul>
            <p className="text-ink-muted">{PROVENANCE_LINE}</p>
            {showResults ? <InputProvenance sources={inputSources} subject={{ subjectId: dataSubjectId }}
              state={inputState} coverage={{ read: coveredPositions, needed: new Set(template.variants.map((variant) => variant.rsid)).size }} /> : null}
          </div>
        }
      />

      {showResults && showSupport ? <SupportPanel carrier={carrier} /> : null}

      <footer className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href={route("genome.data", subjectParams)} className="underline underline-offset-2">
          {DATA_AND_METHODS}
        </Link>
        <Link
          href={route(
            "copilot.scope",
            { scope: subject.routeSegment },
            { query: { report: template.slug } },
          )}
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
