import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
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
  cannotNumberSentence,
} from "@/copy/reports/strings";
import {
  getPublishedTemplates,
  getSubjectFileCount,
  getSubjectGenotypesByRsid,
  getSubjectProcessedFiles,
  templateRsids,
} from "@/lib/genome/load";
import { resolveTemplate, type ReportTemplate } from "@/lib/genome/reports";
import {
  CATEGORY_TAXONOMY,
  LAYERS,
  categoryFor,
  type CategoryId,
  type FindingLayer,
} from "@/lib/genome/taxonomy";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
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

const loadSubject = cache(async (segment: string) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const subject = await resolveSubjectForAccount(user.id, segment);
  return subject ? { user, subject } : null;
});

export async function generateMetadata(
  props: PageProps<"/genome/[subject]/reports">,
): Promise<Metadata> {
  const { subject: segment } = await props.params;
  const context = await loadSubject(segment);
  return {
    title: context ? `${context.subject.displayLabel} · ${REPORTS_TITLE}` : REPORTS_TITLE,
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
  if (!context) notFound();
  const { user, subject } = context;

  const admin = createAdminClient();
  // The results read the processed files; the subject bar counts every file
  // in the record, whatever its status.
  const [files, fileCount, allTemplates] = await Promise.all([
    getSubjectProcessedFiles(admin, subject.id),
    getSubjectFileCount(admin, subject.id),
    getPublishedTemplates(admin),
  ]);
  // Test fixtures never reach the user-facing library.
  const templates = allTemplates.filter((t) => !isFixtureSlug(t.slug));
  const { genotypes } = await getSubjectGenotypesByRsid(
    admin,
    subject.id,
    templateRsids(templates),
  );
  const resolved = templates.map((t) =>
    resolveTemplate(t, (rsid) => genotypes.get(rsid)),
  );

  const hasData = files.length > 0;
  const hubHref = `/genome/${subject.routeSegment}`;
  const reportsHref = `${hubHref}/reports`;

  // One group per layer; a layer with zero templates is absent, not empty.
  const byLayer = new Map<FindingLayer, typeof resolved>(
    LAYERS.map((layer) => [layer, []]),
  );
  for (const report of resolved) {
    byLayer.get(report.template.layer ?? "estimate")!.push(report);
  }
  const nonEmptyLayers = LAYERS.filter((layer) => byLayer.get(layer)!.length > 0);
  const requestedLayer =
    typeof searchParams.layer === "string" ? searchParams.layer : undefined;
  const activeLayer: FindingLayer | undefined =
    nonEmptyLayers.find((layer) => layer === requestedLayer) ?? nonEmptyLayers[0];

  const estimateCount = byLayer.get("estimate")!.length;

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
        status: hasData ? (covered ? "covered" : "not-covered") : "awaiting",
      });
      byCategory.set(category, list);
    }
    groups = CATEGORY_TAXONOMY.flatMap((category) => {
      const cards = byCategory.get(category.id);
      return cards && cards.length > 0
        ? [{ id: category.id, label: category.label, description: CATEGORY_DESCRIPTIONS[category.id], cards }]
        : [];
    });
  }

  const definitionId = activeLayer ? `layer-${activeLayer}-definition` : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <Breadcrumbs
        items={[
          { label: NAV_LABELS["my-genome"], href: hubHref },
          { label: subject.displayLabel },
          { label: REPORTS_TITLE },
        ]}
      />
      <SubjectBar subject={subject} fileCount={fileCount} viewerAccountId={user.id} />

      <header className="space-y-3">
        <h1 className="display text-3xl">{REPORTS_TITLE}</h1>
        {!hasData ? <p className="text-sm text-ink-muted">{LIST_NO_FILE}</p> : null}
        {/* One count line per non-empty layer, each carrying its own layer
            noun (G4.3), so a future variant_call layer is never described
            as estimates: the covered count, then the layer total. */}
        {nonEmptyLayers.map((layer) => {
          const reports = byLayer.get(layer)!;
          const covered = reports.filter((report) => report.covered).length;
          const describedBy = layer === activeLayer ? definitionId : undefined;
          return (
            <p key={layer} className="text-sm">
              {hasData ? (
                <>
                  <Count
                    value={covered}
                    layerClass={LAYER_CLASS[layer]}
                    qualifier="covered by your file"
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
            </p>
          );
        })}
        {estimateCount > 0 ? (
          <p className="text-sm text-ink-muted">
            {cannotNumberSentence(estimateCount)}{" "}
            <Link href={CANNOT_NUMBER_HREF} className="underline underline-offset-2">
              {CANNOT_NUMBER_WHY}
            </Link>
          </p>
        ) : null}
      </header>

      {nonEmptyLayers.length > 1 ? (
        <nav aria-label="Report groups" className="flex gap-1 border-b border-line">
          {nonEmptyLayers.map((layer) => (
            <Link
              key={layer}
              href={`${reportsHref}?layer=${layer}`}
              aria-current={layer === activeLayer ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm",
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
            baseHref={reportsHref}
            layerClass={LAYER_CLASS[activeLayer]}
          />
        </section>
      ) : (
        <p className="text-sm text-ink-muted">{LIBRARY_EMPTY}</p>
      )}
    </div>
  );
}
