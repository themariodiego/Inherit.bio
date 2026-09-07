import type { Metadata } from "next";
import { InputProvenance } from "@/components/reports/input-provenance";
import { loadInputSources, type InputSourceView } from "@/lib/genome/input-sources";
import { redirect } from "next/navigation";
import { CarrierPanel } from "@/components/family/carrier-panel";
import { CarrierInputProvenance } from "@/components/family/carrier-input-provenance";
import {
  HealthPictureTable,
  type HealthPictureColumn,
  type HealthPictureRow,
} from "@/components/family/health-picture-table";
import type { HealthPictureCellState } from "@/components/family/health-picture-cell";
import { ResultGate } from "@/components/family/result-gate";
import { TradeOffPanel, type TradeOffRow } from "@/components/family/trade-off-panel";
import { TermDefinition } from "@/components/figures/term-definition";
import { isFixtureSlug } from "@/components/reports/library";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import {
  BASELINE_TERM_TEXT,
  COMPARISON_BANNER,
  EACH_TURNS_IT_ON,
  HEALTH_PICTURE_H1,
  HEALTH_PICTURE_UNAVAILABLE,
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
  getSubjectGenotypesByRsid,
  templateRsids,
} from "@/lib/genome/load";
import { loadHealthPictureSnapshot } from "@/lib/family/health-picture-results";
import { HEALTH_PICTURE_LAYERS, projectHealthPicture } from "@/lib/family/health-picture-projection";
import type { SharedReportPurpose } from "@/lib/family/shared-report-results";
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
 * anywhere computes how the people in it are related. A column opens on
 * the joint grant in both directions; a cell of another adult renders their
 * letters only under that layer's own grant from them (D-038).
 */

export const metadata: Metadata = { title: HEALTH_PICTURE_H1 };

const LAYER_ORDER: readonly FindingLayer[] = ["variant_call", "estimate"];
const CATEGORY_RANK = new Map<string | null, number>(CATEGORY_TAXONOMY.map((entry, index) => [entry.id, index]));

interface ColumnSource {
  inputSources: InputSourceView[];
  resultInputs: { key: string; title: string; fileIds: string[]; state: "recorded" | "conflict" | "absent" }[];
  column: HealthPictureColumn;
  routeSegment: string;
  legacy: Map<SharedReportPurpose, Awaited<ReturnType<typeof getSubjectGenotypesByRsid>>>;
  allowedPurposes: Set<SharedReportPurpose>;
}

function cellFor(
  source: ColumnSource,
  template: ReportTemplate,
  layer: FindingLayer,
): { state: HealthPictureCellState; covered: boolean } {
  const purpose = LAYER_PURPOSES[layer] as SharedReportPurpose;
  if (!source.allowedPurposes.has(purpose)) return { state: { kind: "not-shared" }, covered: false };
  const read = source.legacy.get(purpose);
  if (!read) return { state: { kind: "version-unavailable" }, covered: false };
  if (!read.fileCount) return { state: { kind: "no-prepared-file" }, covered: false };
  const resolved = resolveTemplate(template, (rsid) => read.genotypes.get(rsid));
  const letters = resolved.variants
    .map((entry) => (entry.outcome.status === "genotyped" ? entry.outcome.genotype : null))
    .filter((genotype): genotype is string => genotype !== null)
    .map((genotype) => genotype.split("").join("/"));
  if (letters.length > 0) return { state: { kind: "letters", genotypes: letters }, covered: true };
  const disagrees = template.variants.some((variant) => read.conflicts.has(variant.rsid));
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
  const pairs: { key: string; summary: CarrierPairSummary; person: FamilyPerson; inputSources: { a: InputSourceView[]; b: InputSourceView[] } }[] = [];
  let snapshotAvailable = true;
  let columnStates = new Map<FindingLayer, HealthPictureCellState[]>();

  if (ready && self !== null) {
    const admin = createAdminClient();
    const entries = [
      { subjectId: self.id, segment: "me", subject: self, label: self.displayLabel },
      ...shared.map((person) => ({
        subjectId: person.dataSubjectId,
        segment: person.handle.routeSegment,
        subject: { ...person.handle, displayLabel: person.displayLabel },
        label: person.displayLabel,
      })),
    ];

    const snapshot = await loadHealthPictureSnapshot(admin, { selfSubjectId: self.id,
      counterparts: shared.map(person => ({ subjectId: person.dataSubjectId, accountId: person.counterpartAccountId })),
      purposes: ["reports.monogenic", "reports.polygenic"],
    });
    // Only exact captured legacy IDs can dispatch the old resolver, and only
    // for an individually authorized layer. Empty selections perform no reads.
    const needsLegacy = snapshot.state.authorized && snapshot.state.columns.some(column =>
      column.legacyFileIds.length > 0 && column.access.some(access => access.kind !== "not-shared"));
    const templates = needsLegacy ? (await getPublishedTemplates(admin)).filter(template =>
      !isFixtureSlug(template.slug) && LAYER_ORDER.includes(template.layer ?? "estimate")) : [];
    for (const entry of entries) {
      const captured = snapshot.state.columns.find(column => column.subjectId === entry.subjectId);
      if (!captured) continue;
      const source: ColumnSource = {
        inputSources: [], resultInputs: [],
        column: { subject: entry.subject, dataSubjectId: entry.subjectId, displayLabel: entry.label, files: null },
        routeSegment: entry.segment, legacy: new Map(),
        allowedPurposes: new Set(captured.access.filter(access => access.kind !== "not-shared").map(access => access.purpose)),
      };
      for (const { purpose, layer } of HEALTH_PICTURE_LAYERS) {
        if (!source.allowedPurposes.has(purpose) || captured.legacyFileIds.length === 0) continue;
        const layerTemplates = templates.filter(template => (template.layer ?? "estimate") === layer);
        if (layerTemplates.length === 0) continue;
        const rsids = templateRsids(layerTemplates);
        const read = await getSubjectGenotypesByRsid(admin, entry.subjectId, rsids, captured.legacyFileIds);
        source.legacy.set(purpose, read);
        const inputs = read.checkedFileIds.length ? await loadInputSources(admin, entry.subjectId, read.checkedFileIds) : [];
        for (const input of inputs) {
          const previous = source.inputSources.find(existing => existing.fileId === input.fileId);
          const contributes = read.inputFileIds.includes(input.fileId);
          if (previous) previous.hasResultRecord = previous.hasResultRecord || contributes;
          else source.inputSources.push({ ...input, hasResultRecord: contributes });
        }
      }
      sources.push(source);
    }

    for (const template of templates) {
      const layer: FindingLayer = template.layer ?? "estimate";
      const cells = sources.map((source) => cellFor(source, template, layer));
      if (!cells.some((cell) => cell.covered)) continue;
      sources.forEach((source, index) => {
        const read = source.legacy.get(LAYER_PURPOSES[layer] as SharedReportPurpose);
        if (!read || cells[index].state.kind === "not-shared") return;
        const fileIds = [...new Set(template.variants.flatMap(variant => [...(read.inputFilesByRsid.get(variant.rsid) ?? [])]))].sort();
        source.resultInputs.push({ key: `${layer}:${template.slug}`, title: template.title, fileIds,
          state: cells[index].state.kind === "disagree" ? "conflict" : fileIds.length ? "recorded" : "absent" });
      });
      const hrefs = sources.map((source) =>
        source.routeSegment !== "me" && source.legacy.has(LAYER_PURPOSES[layer] as SharedReportPurpose)
          ? route("genome.report", { subject: source.routeSegment, slug: template.slug }, { query: { source: "legacy" } })
          : null,
      );
      const list = rowsByLayer.get(layer) ?? [];
      list.push({
        key: `legacy:${layer}:${template.slug}`,
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
    const ownCaptured = snapshot.state.columns.find(column => column.subjectId === self.id);
    const permittedLegacy = (subjectId: string) => {
      const column = snapshot.state.columns.find(item => item.subjectId === subjectId);
      return column?.access.some(access => access.purpose === "reports.monogenic" && access.kind !== "not-shared") ? column.legacyFileIds : [];
    };
    const refVariants = permits(carrierMatch) && ownCaptured && permittedLegacy(self.id).length > 0
      ? await readClassifiedVariants(admin) : [];
    const conditions = refVariants.length > 0 ? await readCarrierConditions(admin) : [];
    for (const person of permits(carrierMatch) && snapshot.state.authorized ? shared : []) {
      const summary = await resolveCarrierPair(
        admin,
        { dataSubjectId: self.id, displayLabel: self.displayLabel },
        { dataSubjectId: person.dataSubjectId, displayLabel: person.displayLabel },
        permittedLegacy(self.id).length && permittedLegacy(person.dataSubjectId).length ? refVariants : [], conditions, { a: permittedLegacy(self.id), b: permittedLegacy(person.dataSubjectId) },
      );
      const pairInputsA = [...(summary.checkedFileIds?.a ?? []), ...(summary.runsInputFileIds?.a ?? [])];
      const pairInputsB = [...(summary.checkedFileIds?.b ?? []), ...(summary.runsInputFileIds?.b ?? [])];
      pairs.push({
        key: person.handle.id,
        person,
        summary,
        inputSources: {
          a: pairInputsA.length ? await loadInputSources(admin, self.id, pairInputsA) : [],
          b: pairInputsB.length ? await loadInputSources(admin, person.dataSubjectId, pairInputsB) : [],
        },
      });
    }
    // LAST await: the capture confirms every joint column, layer and source
    // after all legacy/provenance work. A successful loader confirmation returns
    // this same capture; any replacement also withholds prepared legacy output.
    // Never retain one revoked column.
    const confirmed = await snapshot.confirm();
    const projection = projectHealthPicture(confirmed, entries.map(entry => ({ subjectId: entry.subjectId, segment: entry.segment })));
    snapshotAvailable = confirmed === snapshot.state && confirmed.authorized && projection.rows.length === HEALTH_PICTURE_LAYERS.length;
    if (!snapshotAvailable) { sources.length = 0; pairs.length = 0; rowsByLayer.clear(); }
    else {
      columnStates = new Map(projection.rows.map(group => [group.layer, group.states]));
      for (const group of projection.rows) rowsByLayer.set(group.layer, [...(rowsByLayer.get(group.layer) ?? []), ...group.rows]);
    }
  }

  const answeredRows = sources.map(
    (source, index) =>
      [...rowsByLayer.values()]
        .flat()
        .filter((row) => { const cell = row.cells[index]; return cell.kind === "letters" || (cell.kind === "sources" && cell.entries.some(entry => entry.state.kind === "letters")); }).length,
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
      ) : !snapshotAvailable ? (
        <p role="status" className="max-w-prose text-base leading-relaxed">{HEALTH_PICTURE_UNAVAILABLE}</p>
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
            {LAYER_ORDER.map(
              (layer) => (
                <HealthPictureTable
                  key={layer}
                  layer={layer}
                  columns={sources.map((source) => source.column)}
                  rows={rowsByLayer.get(layer) ?? []}
                  viewerAccountId={user.id}
                  states={columnStates.get(layer)}
                />
              ),
            )}
          </section>

          <section aria-labelledby="how-sure-heading" className="space-y-4">
            <h2 id="how-sure-heading" className="text-lg font-semibold">
              {HOW_SURE_HEADING}
            </h2>
            <p className="max-w-prose text-base leading-relaxed text-ink">{HOW_SURE_LEAD}</p>
            {sources.filter(source => source.inputSources.length > 0).map(source => (
              <div key={source.column.dataSubjectId} className="max-w-prose space-y-2">
                <p className="text-sm leading-relaxed text-ink-muted">{coverageLead(source.column.displayLabel)}</p>
                <InputProvenance nested sources={source.inputSources} subject={{ subjectId: source.column.dataSubjectId }}
                  state={[...source.legacy.values()].some(read => read.conflicts.size) ? "conflict" : source.resultInputs.some(result => result.fileIds.length > 0) ? "recorded" : "absent"} />
                <ul data-slot="family-result-inputs" className="space-y-1 text-sm text-ink-muted">
                  {source.resultInputs.map(result => <li key={result.key}>
                    {/* inherit-figure-exempt: labels refer only to this authorized legacy provenance list */}
                    {`${result.title} — ${result.fileIds.length ? result.fileIds.map(id => {
                      const index = source.inputSources.findIndex(input => input.fileId === id);
                      return index < 0 ? "source details unavailable" : `File ${index + 1}`;
                    }).join(", ") : "no position recorded in the checked files"}${result.state === "conflict" ? "; conflicting calls" : ""}`}
                  </li>)}
                </ul>
              </div>
            ))}
            {pairs.filter((pair) => pair.summary.classifiedPositions > 0).map((pair) => <CarrierInputProvenance key={pair.key}
              summary={pair.summary} sources={pair.inputSources}
              subjects={{ a: { id: sources[0].column.dataSubjectId, label: sources[0].column.displayLabel }, b: { id: pair.person.dataSubjectId, label: pair.person.displayLabel } }} />)}
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
