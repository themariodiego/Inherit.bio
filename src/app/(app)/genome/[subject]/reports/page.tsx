import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { CapabilityUnavailable } from "@/components/capability-unavailable";
import { Count, type CountClass } from "@/components/reports/count";
import { isFixtureSlug } from "@/components/reports/library";
import {
  ReportLibrary,
  type LibraryCard,
  type LibraryGroup,
} from "@/components/reports/report-library";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { SubjectBar } from "@/components/subjects/subject-bar";
import { NAV_LABELS } from "@/copy/navigation";
import { REPORTS_PREPARING } from "@/copy/genome/preparation";
import { EVIDENCE_PUBLIC_LABELS } from "@/copy/reports/evidence";
import {
  CANNOT_NUMBER_HREF,
  CANNOT_NUMBER_WHY,
  CATEGORY_DESCRIPTIONS,
  LAYER_DEFINITIONS,
  LAYER_LABELS,
  LIBRARY_EMPTY,
  LIST_NO_FILE,
  REPORTS_TITLE,
} from "@/copy/reports/strings";
import {
  getPublishedTemplates,
  getSubjectFileCount,
  hasFileInPreparation,
} from "@/lib/genome/load";
import { getSubjectReportCalls } from "@/lib/genome/report-calls";
import { resolveTemplate, type ReportTemplate } from "@/lib/genome/reports";
import { loadPersonalPreviews } from "@/lib/genome/report-previews";
import { loadInputSources } from "@/lib/genome/input-sources";
import { InputProvenance } from "@/components/reports/input-provenance";
import { ClaimBlock } from "@/components/figures/claim-block";
import { reportCoverage, unavailablePolygenicCount } from "@/lib/genome/report-evidence";
import {
  CATEGORY_TAXONOMY,
  LAYERS,
  categoryFor,
  type CategoryId,
  type FindingLayer,
} from "@/lib/genome/taxonomy";
import { grantedLayers } from "@/lib/family/access";
import { loadOwnAnalysisCandidateFiles } from "@/lib/genome/own-analysis-access";
import { OwnReportChoicesEntry } from "@/components/reports/own-report-choices-entry";
import { resolveSubjectRoute } from "@/lib/family/subject-route";
import { loadSharedReportSnapshot } from "@/lib/family/shared-report-results";
import { resolveStoredSharedReport } from "@/lib/family/shared-report-display";
import { route } from "@/lib/primary-routes";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";

const LAYER_CLASS: Record<FindingLayer, CountClass> = {
  variant_call: "variant-call",
  estimate: "estimate",
};

/** Templates carry a legacy category; an unmapped one is left out rather than crashing the list. */
function safeCategoryFor(template: ReportTemplate): CategoryId | null {
  try {
    return categoryFor(template);
  } catch {
    return null;
  }
}

/**
 * One resolver for both domains (design §2.2): the account's own records, and
 * another adult's shared record reached through the Family graph. A family
 * segment reads its rows from that person's own subject, renders only the
 * layers they granted, and answers nothing at all before the Tier-2 gate.
 */
const loadSubject = cache(async (segment: string) =>
  resolveSubjectRoute(segment, { anyOf: ["reports.monogenic", "reports.polygenic"] }),
);

export async function generateMetadata(
  props: PageProps<"/genome/[subject]/reports">,
): Promise<Metadata> {
  const { subject: segment } = await props.params;
  const context = await loadSubject(segment);
  return {
    title: context.kind === "ok" ? `${context.displayLabel} · ${REPORTS_TITLE}` : REPORTS_TITLE,
  };
}

export default async function ReportsPage(
  props: PageProps<"/genome/[subject]/reports">,
) {
  const [{ subject: subjectSegment }, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const context = await loadSubject(subjectSegment);
  if (context.kind === "not-found") notFound();
  // The one Tier-2 gate of the Family domain lives on the person page; a
  // report list reached before it is sent there and fetches nothing.
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
  const { user, subject, dataSubjectId, person, domain } = context;
  // A layer another adult has not shared is not listed at all; with no layer
  // granted the record answers like an unknown one.
  const allowedLayers = person ? grantedLayers(person) : LAYERS;
  if (allowedLayers.length === 0) notFound();

  const admin = createAdminClient();
  const shared = person ? await loadSharedReportSnapshot(admin, {
    subjectId: dataSubjectId, counterpartAccountId: person.counterpartAccountId,
    purposes: allowedLayers.map(layer => layer === "variant_call" ? "reports.monogenic" : "reports.polygenic"),
  }) : null;
  if (shared && !shared.authorized) notFound();
  // The results read the processed files; the subject bar counts every file
  // in the record, whatever its status.
  const [files, legacyOrOwnFileCount, allTemplates, preparing] = await Promise.all([
    loadOwnAnalysisCandidateFiles(admin, dataSubjectId, { legacyOnly: person !== null }),
    person ? admin.from("genome_files").select("id", { count: "exact", head: true })
      .eq("subject_id", dataSubjectId).is("single_logical_sample_verified_at", null).then(result => result.count ?? 0)
      : getSubjectFileCount(admin, dataSubjectId),
    getPublishedTemplates(admin),
    // A narrower question than the count above: a rejected or retired file is
    // counted and is no reason to tell a reader that coverage is coming.
    hasFileInPreparation(admin, dataSubjectId),
  ]);
  // Test fixtures never reach the user-facing library.
  const stored = new Map<string, NonNullable<ReturnType<typeof resolveStoredSharedReport>>>();
  // The reader orders completed results newest first. List cards summarize that
  // saved result; the detail page keeps every source separately selectable.
  for (const row of shared?.reports ?? []) {
    const result = resolveStoredSharedReport(row);
    if (result && !stored.has(result.template.slug)) stored.set(result.template.slug, result);
  }
  const templateBySlug = new Map(allTemplates.map(template => [template.slug, template]));
  for (const result of stored.values()) templateBySlug.set(result.template.slug, result.template);
  const templates = [...templateBySlug.values()].filter(t => !isFixtureSlug(t.slug));
  // Each layer has its own input map: one selected purpose cannot populate
  // another layer's coverage, genotypes or personalized text.
  const layerCalls = new Map(await Promise.all(allowedLayers.map(async layer => [layer,
    // D-099: gate the legacy half on the live purpose grant for the reader's
    // OWN record. On a relative's record the authority is their Family
    // permission, already checked above, and this reader holds no own-subject
    // grant there — asking for one would remove legacy sharing, not gate it.
    await getSubjectReportCalls(admin, dataSubjectId, templates.filter(t => (t.layer ?? "estimate") === layer),
      { gateLegacy: person === null }),
  ] as const)));
  const resolved = templates.map((t) =>
    stored.get(t.slug) ?? resolveTemplate(t, (rsid) => layerCalls.get(t.layer ?? "estimate")?.genotypes.get(rsid)),
  );
  const previewContributors = new Map<string, string[]>();
  const previews = await loadPersonalPreviews(admin, {
    viewerAccountId: user.id,
    ownerAccountId: subject.ownerAccountId,
    subjectClass: subject.subjectClass,
    subjectId: dataSubjectId,
    isFamily: person !== null,
  }, templates.filter(t => (t.layer ?? "estimate") === "estimate"), files,
  layerCalls.get("estimate")?.conflicts ?? new Set(), previewContributors);
  const previewInputs = await loadInputSources(admin, dataSubjectId, [...previewContributors.values()].flat(),
    { kind: "report", purpose: "reports.polygenic" });

  if (shared && !(await shared.confirm()).authorized) notFound();
  const fileCount = legacyOrOwnFileCount + new Set(shared?.sources.map(source => source.fileId) ?? []).size;
  const layerHasResult = (layer: FindingLayer) => (layerCalls.get(layer)?.fileCount ?? 0) > 0
    || [...stored.values()].some(result => (result.template.layer ?? "estimate") === layer);
  const subjectParams = { subject: subject.routeSegment };

  // One group per layer; a layer with zero templates is absent, not empty.
  const byLayer = new Map<FindingLayer, typeof resolved>(
    LAYERS.map((layer) => [layer, []]),
  );
  for (const report of resolved) {
    byLayer.get(report.template.layer ?? "estimate")!.push(report);
  }
  const nonEmptyLayers = LAYERS.filter(
    (layer) => allowedLayers.includes(layer) && byLayer.get(layer)!.length > 0,
  );
  const requestedLayer =
    typeof searchParams.layer === "string" ? searchParams.layer : undefined;
  // The list opens on the general library (the estimate group) when it has
  // any report; the layer order of the tabs stays the taxonomy's.
  const activeLayer: FindingLayer | undefined =
    nonEmptyLayers.find((layer) => layer === requestedLayer) ??
    nonEmptyLayers.find((layer) => layer === "estimate") ??
    nonEmptyLayers[0];

  // The unavailable-score notice counts only polygenic reports this reader
  // may open, not single-position reports with useful nonnumeric results.
  const estimateCount = allowedLayers.includes("estimate")
    ? unavailablePolygenicCount(byLayer.get("estimate")!.map(({ template }) => template))
    : 0;

  let groups: LibraryGroup[] = [];
  if (activeLayer) {
    const byCategory = new Map<CategoryId, LibraryCard[]>();
    for (const { template, covered } of byLayer.get(activeLayer)!) {
      const category = safeCategoryFor(template);
      if (!category) continue;
      const list = byCategory.get(category) ?? [];
      list.push({
        slug: template.slug,
        title: template.title,
        summary: template.summary,
        evidenceLabel: EVIDENCE_PUBLIC_LABELS[template.evidence] ?? template.evidence,
        genes: template.variants.map((variant) => variant.gene),
        status: (stored.has(template.slug) || (layerCalls.get(activeLayer)?.fileCount ?? 0) > 0) ? (covered ? "covered" : "not-covered") : "awaiting",
        preview: previews.get(template.slug),
      });
      byCategory.set(category, list);
    }
    groups = CATEGORY_TAXONOMY.flatMap((category) => {
      const cards = byCategory.get(category.id);
      return cards && cards.length > 0
        ? [{
          id: category.id,
          label: category.label,
          description: CATEGORY_DESCRIPTIONS[category.id],
          // Put usable reviewed takeaways before the category's Show all
          // boundary. Stable within each set; this is not a health ranking.
          cards: [...cards].sort((a, b) => Number(Boolean(b.preview)) - Number(Boolean(a.preview))),
        }]
        : [];
    });
  }

  const definitionId = `layer-${activeLayer}-definition`;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <Breadcrumbs
        items={[
          { label: domain.label, href: domain.href },
          {
            label: subject.displayLabel,
            href: person
              ? route("family.person", { person: subject.routeSegment })
              : undefined,
          },
          { label: REPORTS_TITLE },
        ]}
      />
      <SubjectBar subject={subject} fileCount={fileCount} viewerAccountId={user.id} />

      <header className="space-y-3">
        <h1 className="display text-3xl">{REPORTS_TITLE}</h1>
        {fileCount === 0 ? <p className="text-sm text-ink-muted">{shared?.access.some(access => access.kind === "canonical")
          ? "No completed result is shared yet." : LIST_NO_FILE}</p>
          : preparing ? <p role="status" className="text-sm text-ink-muted">{REPORTS_PREPARING}</p> : null}
        {/* One count line per non-empty layer, each carrying its own layer
            noun (G4.3), so a future variant_call layer is never described
            as estimates: the covered count, then the layer total. */}
        {nonEmptyLayers.map((layer) => {
          const reports = byLayer.get(layer)!;
          const covered = reports.filter((report) => report.covered).length;
          const describedBy = `layer-${layer}-definition`;
          const counts = (
            <>
              {layerHasResult(layer) ? (
                <>
                  <Count
                    value={covered}
                    layerClass={LAYER_CLASS[layer]}
                    qualifier={person ? "covered by a shared file" : "covered by your file"}
                    describedBy={describedBy}
                  />
                  {", out of "}
                </>
              ) : null}
              <Count
                value={reports.length}
                layerClass={LAYER_CLASS[layer]}
                describedBy={describedBy}
              />
              {" in the library."}
            </>
          );
          return layer === activeLayer ? (
            <p key={layer} className="text-sm">{counts}</p>
          ) : (
            <details key={layer} className="text-sm">
              <summary className="w-fit cursor-pointer">{counts}</summary>
              <p id={describedBy} className="mt-2 max-w-prose text-ink-muted">
                {LAYER_DEFINITIONS[layer]}
              </p>
            </details>
          );
        })}
        {estimateCount > 0 ? (
          <p className="text-sm text-ink-muted">
            <Count value={estimateCount} layerClass="estimate" wording="unavailable"
              describedBy="layer-estimate-definition" />{" "}
            <Link href={CANNOT_NUMBER_HREF} className="underline underline-offset-2">
              {CANNOT_NUMBER_WHY}
            </Link>
          </p>
        ) : null}
      </header>
      {!person ? <OwnReportChoicesEntry subject={subject.routeSegment} /> : null}

      {nonEmptyLayers.length > 1 ? (
        <nav aria-label="Report groups" className="flex gap-1 border-b border-line">
          {nonEmptyLayers.map((layer) => (
            <Link
              key={layer}
              href={route("genome.reports", subjectParams, { query: { layer } })}
              aria-current={layer === activeLayer ? "page" : undefined}
              aria-describedby={`layer-${layer}-definition`}
              className={cn(
                "-mb-px inline-flex min-h-11 items-center border-b-2 px-3 py-2 text-sm",
                layer === activeLayer
                  ? "border-forest font-medium text-ink"
                  : "border-transparent text-ink-muted hover:text-ink",
              )}
            >
              {LAYER_LABELS[layer]}
            </Link>
          ))}
        </nav>
      ) : null}

      {activeLayer ? (
        <section
          aria-labelledby={`layer-${activeLayer}-title`}
          data-layer={activeLayer}
          className="space-y-6"
        >
          <div className="space-y-2">
            <p id={`layer-${activeLayer}-title`} className="text-lg font-semibold text-ink">
              {LAYER_LABELS[activeLayer]}
            </p>
            <p id={definitionId} className="max-w-prose text-sm text-ink-muted">
              {LAYER_DEFINITIONS[activeLayer]}
            </p>
          </div>
          <ReportLibrary
            groups={groups}
            subject={subject.routeSegment}
            historySubjectId={dataSubjectId}
            layerClass={LAYER_CLASS[activeLayer]}
            describedBy={definitionId}
          />
        </section>
      ) : (
        <p className="text-sm text-ink-muted">{LIBRARY_EMPTY}</p>
      )}
      {previews.size > 0 ? <section id="preview-input-provenance" data-slot="preview-input-provenance" className="space-y-4">
        <InputProvenance sources={previewInputs} subject={{ subjectId: dataSubjectId }} />
        <ul className="space-y-2 text-sm text-ink-muted">
          {[...previewContributors].map(([slug, ids]) => {
            // A preview exists only for a template this page resolved, so the
            // lookup cannot miss; the coverage numbers come from the one
            // function the report page uses, so the two cannot disagree.
            const report = resolved.find((entry) => entry.template.slug === slug)!;
            return <li key={slug} id={`preview-input-${slug}`}>
              {report.template.title}
              {/* inherit-figure-exempt: input labels identify records, not genetic quantities */}
              {` — ${ids.map((id) => `File ${previewInputs.findIndex((source) => source.fileId === id) + 1}`).join(", ")}`}
              <ClaimBlock subject={{ subjectId: dataSubjectId }} className="border-0 bg-transparent p-0" figures={[{
                kind: "coverage", class: "quality", basis: "observed", provenance: { kind: "computed", module: "genome/reports" },
                ...reportCoverage(report.template, report, layerCalls.get("estimate")?.conflicts ?? new Set()),
              }]} />
            </li>;
          })}
        </ul>
      </section> : null}
    </div>
  );
}
