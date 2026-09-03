import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CarrierPanel } from "@/components/family/carrier-panel";
import {
  HealthPictureTable,
  type HealthPictureColumn,
  type HealthPictureRow,
} from "@/components/family/health-picture-table";
import type { HealthPictureCellState } from "@/components/family/health-picture-cell";
import { ResultGate } from "@/components/family/result-gate";
import { TradeOffPanel, type TradeOffRow } from "@/components/family/trade-off-panel";
import { ClaimBlock } from "@/components/figures/claim-block";
import { TermDefinition } from "@/components/figures/term-definition";
import { isFixtureSlug } from "@/components/reports/library";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import {
  BASELINE_TERM_TEXT,
  COMPARISON_BANNER,
  EACH_TURNS_IT_ON,
  HEALTH_PICTURE_H1,
  HOW_SURE_HEADING,
  HOW_SURE_LEAD,
  NOT_DIAGNOSTIC,
  NO_RANGE_YET,
  PROVENANCE_LINE,
  SIDE_BY_SIDE_HEADING,
  WHERE_FROM_HEADING,
  WHERE_FROM_LEAD,
  coverageLead,
  needsTwoPeople,
} from "@/copy/family/health-picture";
import { NAV_LABELS } from "@/copy/navigation";
import { LAYER_PURPOSES, familyCapability, permits, viewerMaySee } from "@/lib/family/access";
import {
  readCarrierConditions,
  readClassifiedVariants,
  resolveCarrierPair,
  type CarrierPairSummary,
} from "@/lib/family/carrier-pair";
import { listFamilyPeople, type FamilyPerson } from "@/lib/family/graph";
import { acknowledged } from "@/lib/family/tier2";
import {
  getPublishedTemplates,
  getSubjectFileCount,
  getSubjectGenotypesByRsid,
  getSubjectProcessedFiles,
  templateRsids,
} from "@/lib/genome/load";
import { resolveTemplate, type ReportTemplate } from "@/lib/genome/reports";
import { categoryFor, CATEGORY_TAXONOMY, type FindingLayer } from "@/lib/genome/taxonomy";
import { route } from "@/lib/primary-routes";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * `/family/health-picture` — the side-by-side surface (design §2.3;
 * register family.health-picture, `wide-data`, 90rem).
 *
 * Order: breadcrumbs, h1, the banner, the trade-off panel, the carrier
 * panel, one table per layer, "How sure we are", "Where this comes from".
 * There is no subject bar: no single person owns this page, and every
 * column header carries a full chip instead.
 *
 * Who appears: the viewer, and every person who has turned this on from
 * their own account while the viewer has turned it on toward them. Under two
 * columns the page says so and fetches nothing. Nothing derived is read
 * before the one Tier-2 gate of the domain, so a gated response carries no
 * result in its markup or in its RSC payload.
 *
 * What this page never does: no cell is derived from another cell, no
 * column is summed, ranked or called highest, no header sorts, and nothing
 * anywhere computes how the people in it are related.
 */

export const metadata: Metadata = { title: HEALTH_PICTURE_H1 };

const LAYER_ORDER: readonly FindingLayer[] = ["variant_call", "estimate"];
const CATEGORY_RANK = new Map(CATEGORY_TAXONOMY.map((entry, index) => [entry.id, index]));

interface ColumnSource {
  column: HealthPictureColumn;
  /** Null for the viewer's own column. */
  person: FamilyPerson | null;
  routeSegment: string;
  genotypes: ReadonlyMap<number, string>;
  conflicts: ReadonlySet<number>;
  hasFile: boolean;
}

function cellFor(
  source: ColumnSource,
  template: ReportTemplate,
): { state: HealthPictureCellState; covered: boolean } {
  if (!source.hasFile) return { state: { kind: "no-file" }, covered: false };
  const resolved = resolveTemplate(template, (rsid) => source.genotypes.get(rsid));
  const letters = resolved.variants
    .map((entry) => (entry.outcome.status === "genotyped" ? entry.outcome.genotype : null))
    .filter((genotype): genotype is string => genotype !== null)
    .map((genotype) => genotype.split("").join("/"));
  if (letters.length > 0) return { state: { kind: "letters", genotypes: letters }, covered: true };
  const disagrees = template.variants.some((variant) => source.conflicts.has(variant.rsid));
  return { state: { kind: disagrees ? "disagree" : "not-covered" }, covered: false };
}

export default async function FamilyHealthPicturePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const [self, people] = await Promise.all([
    resolveSubjectForAccount(user.id, "me"),
    listFamilyPeople(user.id),
  ]);

  // Both directions must be live and sharing must not be paused: this page
  // exists only where each person has agreed, from their own account, to be
  // seen beside the other (X12.2, register requiredLivePurposeFromBothSubjects).
  const shared = people.filter(
    (person) =>
      viewerMaySee(person, "family.heritability") &&
      person.grantsFromViewer.has("family.heritability"),
  );
  const contributors = shared.map((person) => person.counterpartAccountId);
  const [thirdParty, heritability, carrierMatch] = await Promise.all([
    familyCapability(user.id, contributors, "third_party_adult_analysis"),
    familyCapability(user.id, contributors, "family_heritability"),
    familyCapability(user.id, contributors, "carrier_match"),
  ]);
  const decision = permits(thirdParty) ? heritability : thirdParty;
  const allowed = permits(decision);

  const columnCount = self === null ? 0 : 1 + shared.length;
  const gated = !(await acknowledged(user));
  const ready = allowed && columnCount >= 2 && !gated;

  const sources: ColumnSource[] = [];
  const rowsByLayer = new Map<FindingLayer, HealthPictureRow[]>();
  const pairs: { key: string; summary: CarrierPairSummary; person: FamilyPerson }[] = [];
  const shownRsids = new Set<number>();

  if (ready && self !== null) {
    const admin = createAdminClient();
    const entries = [
      { person: null as FamilyPerson | null, subjectId: self.id, segment: "me", subject: self, label: self.displayLabel },
      ...shared.map((person) => ({
        person,
        subjectId: person.dataSubjectId,
        segment: person.handle.routeSegment,
        subject: { ...person.handle, displayLabel: person.displayLabel },
        label: person.displayLabel,
      })),
    ];

    const allTemplates = await getPublishedTemplates(admin);
    const templates = allTemplates.filter((template) => !isFixtureSlug(template.slug));
    const rsids = templateRsids(templates);

    for (const entry of entries) {
      const [read, files, count] = await Promise.all([
        getSubjectGenotypesByRsid(admin, entry.subjectId, rsids),
        getSubjectProcessedFiles(admin, entry.subjectId),
        getSubjectFileCount(admin, entry.subjectId),
      ]);
      sources.push({
        column: {
          subject: entry.subject,
          dataSubjectId: entry.subjectId,
          displayLabel: entry.label,
          files: count,
        },
        person: entry.person,
        routeSegment: entry.segment,
        genotypes: read.genotypes,
        conflicts: read.conflicts,
        hasFile: files.length > 0,
      });
    }

    for (const template of templates) {
      const layer: FindingLayer = template.layer ?? "estimate";
      const cells = sources.map((source) => cellFor(source, template));
      if (!cells.some((cell) => cell.covered)) continue;
      for (const variant of template.variants) shownRsids.add(variant.rsid);
      const hrefs = sources.map((source) =>
        source.person === null || viewerMaySee(source.person, LAYER_PURPOSES[layer])
          ? route("genome.report", { subject: source.routeSegment, slug: template.slug })
          : null,
      );
      const list = rowsByLayer.get(layer) ?? [];
      list.push({
        slug: template.slug,
        title: template.title,
        category: categoryFor(template),
        cells: cells.map((cell) => cell.state),
        hrefs,
      });
      rowsByLayer.set(layer, list);
    }
    for (const list of rowsByLayer.values()) {
      list.sort(
        (left, right) =>
          (CATEGORY_RANK.get(left.category) ?? 0) - (CATEGORY_RANK.get(right.category) ?? 0) ||
          left.title.localeCompare(right.title, "en"),
      );
    }

    // The carrier pipeline, behind its own response guard
    // (register family.health-picture, `response:carrier-arithmetic`). With
    // no classified position in the reference table — today's state — this
    // costs one query, reads no genotype, and the panel says it has nothing
    // to check yet.
    const refVariants = permits(carrierMatch) ? await readClassifiedVariants(admin) : [];
    const conditions = refVariants.length > 0 ? await readCarrierConditions(admin) : [];
    for (const person of permits(carrierMatch) ? shared : []) {
      pairs.push({
        key: person.handle.id,
        person,
        summary: await resolveCarrierPair(
          admin,
          { dataSubjectId: self.id, displayLabel: self.displayLabel },
          { dataSubjectId: person.dataSubjectId, displayLabel: person.displayLabel },
          refVariants,
          conditions,
        ),
      });
    }
  }

  const answeredRows = sources.map(
    (source, index) =>
      [...rowsByLayer.values()]
        .flat()
        .filter((row) => row.cells[index].kind === "letters").length,
  );
  const tradeOffRows: TradeOffRow[] = sources.map((source, index) => ({
    dataSubjectId: source.column.dataSubjectId,
    displayLabel: source.column.displayLabel,
    results: answeredRows[index],
  }));

  return (
    <div data-surface="wide-data" className="mx-auto max-w-[90rem] space-y-10">
      <Breadcrumbs
        items={[
          { label: NAV_LABELS.family, href: route("family.index") },
          { label: HEALTH_PICTURE_H1 },
        ]}
      />
      <header className="space-y-3">
        <h1 className="display text-3xl">{HEALTH_PICTURE_H1}</h1>
      </header>

      {!allowed ? (
        <section
          role="status"
          className="max-w-prose space-y-3 rounded-2xl border border-line bg-card p-6"
        >
          <p className="text-base leading-relaxed text-ink">{decision.userFacingCopy}</p>
        </section>
      ) : columnCount < 2 ? (
        <section role="status" className="max-w-prose space-y-3">
          <p className="text-base leading-relaxed text-ink">
            {/* inherit-figure-exempt: a count of the people who agreed, not a result */}
            {needsTwoPeople(columnCount)}
          </p>
          <p className="text-base leading-relaxed text-ink-muted">{EACH_TURNS_IT_ON}</p>
        </section>
      ) : gated ? (
        <ResultGate />
      ) : (
        <>
          <p
            data-slot="comparison-banner"
            data-density-required-accuracy
            className="max-w-prose text-base leading-relaxed text-ink"
          >
            {COMPARISON_BANNER}
          </p>
          <p className="max-w-prose text-sm leading-relaxed text-ink-muted">
            <TermDefinition term="baseline" text={BASELINE_TERM_TEXT} />
          </p>

          <TradeOffPanel rows={tradeOffRows} />

          <CarrierPanel
            groups={pairs.map((pair) => {
              const other = sources.find(
                (source) => source.column.dataSubjectId === pair.person.dataSubjectId,
              )!;
              return {
                key: pair.key,
                people: [sources[0].column, other.column] as [
                  HealthPictureColumn,
                  HealthPictureColumn,
                ],
                matches: pair.summary.matches,
                classifiedPositions: pair.summary.classifiedPositions,
                positionsBothCover: pair.summary.positionsBothCover,
              };
            })}
            viewerAccountId={user.id}
            unavailableCopy={permits(carrierMatch) ? undefined : carrierMatch.userFacingCopy}
          />

          <section aria-labelledby="side-by-side-heading" className="space-y-6">
            <h2 id="side-by-side-heading" className="text-lg font-semibold">
              {SIDE_BY_SIDE_HEADING}
            </h2>
            {LAYER_ORDER.filter((layer) => (rowsByLayer.get(layer) ?? []).length > 0).map(
              (layer) => (
                <HealthPictureTable
                  key={layer}
                  layer={layer}
                  columns={sources.map((source) => source.column)}
                  rows={rowsByLayer.get(layer) ?? []}
                  viewerAccountId={user.id}
                />
              ),
            )}
          </section>

          <section aria-labelledby="how-sure-heading" className="space-y-4">
            <h2 id="how-sure-heading" className="text-lg font-semibold">
              {HOW_SURE_HEADING}
            </h2>
            <p className="max-w-prose text-base leading-relaxed text-ink">{HOW_SURE_LEAD}</p>
            {sources.map((source) => (
              <div key={source.column.dataSubjectId} className="max-w-prose space-y-2">
                <p className="text-sm leading-relaxed text-ink-muted">
                  {coverageLead(source.column.displayLabel)}
                </p>
                <ClaimBlock
                  subject={{ subjectId: source.column.dataSubjectId }}
                  figures={[
                    {
                      kind: "coverage",
                      class: "quality",
                      basis: "observed",
                      provenance: { kind: "computed", module: "family/health-picture" },
                      read: [...shownRsids].filter((rsid) => source.genotypes.has(rsid)).length,
                      needed: shownRsids.size,
                    },
                  ]}
                />
              </div>
            ))}
            <p className="max-w-prose text-sm leading-relaxed text-ink-muted">{NO_RANGE_YET}</p>
            <p
              data-density-required-accuracy
              className="max-w-prose text-sm leading-relaxed text-ink-muted"
            >
              {NOT_DIAGNOSTIC}
            </p>
          </section>

          <section aria-labelledby="where-from-heading" className="space-y-3">
            <h2 id="where-from-heading" className="text-lg font-semibold">
              {WHERE_FROM_HEADING}
            </h2>
            <p className="max-w-prose text-base leading-relaxed text-ink">{WHERE_FROM_LEAD}</p>
            <p className="max-w-prose text-sm leading-relaxed text-ink-muted">{PROVENANCE_LINE}</p>
          </section>
        </>
      )}
    </div>
  );
}
