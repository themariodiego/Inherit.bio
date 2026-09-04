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
import { grantedLayers } from "@/lib/family/access";
import { resolveSubjectRoute } from "@/lib/family/subject-route";
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
  // The results read the processed files; the subject bar counts every file
  // in the record, whatever its status.
  const [files, fileCount, allTemplates] = await Promise.all([
    getSubjectProcessedFiles(admin, dataSubjectId),
    getSubjectFileCount(admin, dataSubjectId),
    getPublishedTemplates(admin),
  ]);
  // Test fixtures never reach the user-facing library.
  const templates = allTemplates.filter((t) => !isFixtureSlug(t.slug));
  const { genotypes } = await getSubjectGenotypesByRsid(
    admin,
    dataSubjectId,
    templateRsids(templates),
  );
  const resolved = templates.map((t) =>
    resolveTemplate(t, (rsid) => genotypes.get(rsid)),
  );

  const hasData = files.length > 0;
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
  const activeLayer: FindingLayer | undefined =
    nonEmptyLayers.find((layer) => layer === requestedLayer) ?? nonEmptyLayers[0];

  // The "cannot give you a number" line counts only a layer this reader may
  // actually open.
  const estimateCount = allowedLayers.includes("estimate")
    ? byLayer.get("estimate")!.length
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
              href={route("genome.reports", subjectParams, { query: { layer } })}
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
            subject={subject.routeSegment}
            layerClass={LAYER_CLASS[activeLayer]}
          />
        </section>
      ) : (
        <p className="text-sm text-ink-muted">{LIBRARY_EMPTY}</p>
      )}
    </div>
  );
}
