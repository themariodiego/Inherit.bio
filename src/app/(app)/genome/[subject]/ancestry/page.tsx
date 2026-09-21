import { loadSharedAncestrySnapshot } from "@/lib/family/shared-ancestry-results";
import type { AncestryResultRow } from "@/lib/ancestry/captured-rows";
import type { InputSourceView } from "@/lib/genome/input-sources";
/**
 * /genome/[subject]/ancestry — what the file supports about broad regions
 * and parent lines (brief §4.6, §4 §7.3–7.6, A.8, G4.4, X16.5). Server
 * composition: auth and subject resolution, the three stored ancestry
 * results and the versioned region geometry. Captured model/version selects
 * the historical or seven-region presentation. Geometry is decoded on the
 * server and passed as plain data; nothing here recomputes an estimate.
 *
 * Six headings: the h1 and five h2s (regions, mother’s line, father’s line,
 * Neanderthals, where this comes from). No segmented control renders while
 * only the continental tier qualifies (design §4.3).
 */
import type { Metadata } from "next";
import { InputProvenance } from "@/components/reports/input-provenance";
import { loadInputSources } from "@/lib/genome/input-sources";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { CapabilityUnavailable } from "@/components/capability-unavailable";
import { AncestryRegions, type AncestryResultView } from "@/components/results/ancestry/ancestry-regions";
import { RegionalAncestryRegions } from "@/components/results/ancestry/regional-ancestry-regions";
import { LineageCard, type LineageCall } from "@/components/results/ancestry/lineage-card";
import { NeanderthalCard } from "@/components/results/ancestry/neanderthal-card";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { SubjectBar } from "@/components/subjects/subject-bar";
import { H1, REGIONS_HEADING, SECTION_LABEL, SOURCES_HEADING, storedModelLine } from "@/copy/ancestry";
import { NAV_LABELS } from "@/copy/navigation";
import { ANCESTRY_PREPARING } from "@/copy/genome/preparation";
import { DATA_AND_METHODS } from "@/copy/reports/strings";
import { mapShapes } from "@/lib/ancestry/geometry";
import { regionalMapShapes } from "@/lib/ancestry/regional-geometry";
import { isSevenRegionPanel, sevenRegionResult, REGIONAL_REFERENCE, REGIONAL_SOURCES } from "@/lib/ancestry/regional-panel";
import { SEVEN_ANCESTRY_PANEL } from "@/lib/uploads/own-ancestry-content-v3";
import { MIN_MARKERS, PANEL, SOURCES, LINEAGE_TREES } from "@/lib/ancestry/panel";
import { presentShares } from "@/lib/ancestry/present";
import { tierQualifies } from "@/lib/ancestry/regions";
import { regionsView } from "@/lib/ancestry/view";
import { POPS, type Pop, type ShareRange } from "@/lib/genome/admixture";
import { getSubjectFileCount, hasFileInPreparation } from "@/lib/genome/load";
import { viewerMaySee } from "@/lib/family/access";
import { resolveSubjectRoute } from "@/lib/family/subject-route";
import { route } from "@/lib/primary-routes";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadAncestryResultSnapshot } from "@/lib/ancestry/own-results";

/**
 * One resolver for both domains (design §2.2): this account's own records,
 * and another adult's record reached through the Family graph, whose rows
 * are read from their own subject and only while their `ancestry` grant is
 * live.
 */
const loadSubject = cache(async (segment: string) =>
  resolveSubjectRoute(segment, { anyOf: ["ancestry"] }),
);

export async function generateMetadata(
  props: PageProps<"/genome/[subject]/ancestry">,
): Promise<Metadata> {
  const { subject: segment } = await props.params;
  const context = await loadSubject(segment);
  return {
    title:
      context.kind === "ok" ? `${context.displayLabel} · ${SECTION_LABEL}` : SECTION_LABEL,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The stored intervals, checked as strictly as the proportions beside them.
 *
 * A population is skipped rather than the whole result refused: results
 * captured before 2026-09-14 carry no `ranges` at all, a population whose
 * resamples all agreed carries none of its own, and both render as the "no
 * range yet" row the page has always had. What is NOT tolerated is a range
 * that is present and wrong — reversed, out of bounds, or not bracketing its
 * own share — because that would print a number about a person's ancestry
 * that no measurement produced.
 */
function admixtureRanges(raw: unknown, proportions: Record<Pop, number>): Partial<Record<Pop, ShareRange>> {
  if (!isRecord(raw)) return {};
  const ranges: Partial<Record<Pop, ShareRange>> = {};
  for (const pop of POPS) {
    const value = raw[pop];
    if (!isRecord(value)) continue;
    const { low, high } = value;
    if (typeof low !== "number" || typeof high !== "number") continue;
    if (!Number.isFinite(low) || !Number.isFinite(high)) continue;
    if (low < 0 || high > 1 || low >= high) continue;
    if (proportions[pop] < low - RANGE_TOLERANCE || proportions[pop] > high + RANGE_TOLERANCE) continue;
    ranges[pop] = { low, high };
  }
  return ranges;
}

/** The 3-dp rounding and sum repair between the fit and the stored share. */
const RANGE_TOLERANCE = 0.005;

/** The stored `AdmixtureResult`, checked field by field; anything else renders as no result. */
function admixtureView(raw: unknown, supportNote: string): AncestryResultView | null {
  if (!isRecord(raw) || !isRecord(raw.proportions) || typeof raw.markersUsed !== "number") return null;
  const proportions = {} as Record<Pop, number>;
  for (const pop of POPS) {
    const value = raw.proportions[pop];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    proportions[pop] = value;
  }
  const markersUsed = raw.markersUsed;
  return {
    markersUsed,
    supportNote,
    shown: tierQualifies("continental", markersUsed),
    view: regionsView(presentShares({ proportions }, { ranges: admixtureRanges(raw.ranges, proportions) })),
  };
}

/** The stored `HaplogroupCall`, or the `{ haplogroup: null }` row written when the file has no such chromosome. */
function lineageCall(raw: unknown): LineageCall | null {
  if (!isRecord(raw)) return null;
  return {
    haplogroup: typeof raw.haplogroup === "string" ? raw.haplogroup : null,
    path: Array.isArray(raw.path) ? raw.path.filter((step): step is string => typeof step === "string") : undefined,
    matched: typeof raw.matched === "number" ? raw.matched : undefined,
    tested: typeof raw.tested === "number" ? raw.tested : undefined,
  };
}

const DOI_PREFIX = "doi:";

export default async function AncestryPage(
  props: PageProps<"/genome/[subject]/ancestry">,
) {
  const { subject: segment } = await props.params;
  const context = await loadSubject(segment);
  if (context.kind === "not-found") notFound();
  if (context.kind === "gate") {
    redirect(route("family.person", { person: context.personSegment }));
  }
  if (context.kind === "jurisdiction") {
    return (
      <CapabilityUnavailable
        eyebrow={NAV_LABELS.family}
        title={SECTION_LABEL}
        backHref={route("family.index")}
      />
    );
  }
  const { user, subject, dataSubjectId, person, domain } = context;
  // Ancestry about another adult needs their own live grant for it; without
  // one the record answers like an unknown one.
  if (person && !viewerMaySee(person, "ancestry")) notFound();

  const admin = createAdminClient();
  let rows: AncestryResultRow[], fileCount: number | null, preparing: boolean;
  let regionInputs: InputSourceView[], maternalInputs: InputSourceView[], paternalInputs: InputSourceView[];
  let confirmationRequired = false, preparedUnavailable = false;
  if (person) {
    const captured = await loadSharedAncestrySnapshot(admin, {
      subjectId: dataSubjectId, counterpartAccountId: person.counterpartAccountId,
    });
    const current = await captured.confirm();
    if (!current.authorized) notFound();
    rows = current.rows; fileCount = current.fileCount; preparing = current.preparing;
    confirmationRequired = current.confirmationRequired; preparedUnavailable = current.preparedUnavailable;
    [regionInputs, maternalInputs, paternalInputs] = ["admixture", "mtdna", "ydna"].map(kind => {
      const result = rows.find(row => row.kind === kind);
      return result?.result != null ? current.sources.filter(source => source.fileId === result.file_id) : [];
    });
  } else {
    const resultClient = await createClient();
    const [count, captured, inPreparation] = await Promise.all([
      getSubjectFileCount(admin, dataSubjectId), loadAncestryResultSnapshot(admin, resultClient, dataSubjectId),
      hasFileInPreparation(admin, dataSubjectId),
    ]);
    const selectedRows = ["admixture", "mtdna", "ydna"].map(kind => captured.rows.find(row => row.kind === kind));
    [regionInputs, maternalInputs, paternalInputs] = await Promise.all(
      selectedRows.map(result => {
        return loadInputSources(admin, dataSubjectId, result?.result != null ? [result.file_id] : [], { kind: "report", purpose: "ancestry" });
      }),
    );
    const current = new Set(await captured.confirm());
    rows = selectedRows.filter((row): row is AncestryResultRow => row !== undefined && current.has(row));
    fileCount = count; preparing = inPreparation;
  }
  const admix = rows.find(row => row.kind === "admixture");
  const mt = rows.find(row => row.kind === "mtdna");
  const y = rows.find(row => row.kind === "ydna");
  const sevenRegion = isSevenRegionPanel(admix);
  const regions = admix && !sevenRegion ? admixtureView(admix.result, admix.support_note ?? "") : null;
  const subjectParams = { subject: subject.routeSegment };

  return (
    <div className="page-stack mx-auto max-w-5xl space-y-8">
      <Breadcrumbs
        items={[
          { label: domain.label, href: domain.href },
          {
            label: subject.displayLabel,
            href: person
              ? route("family.person", { person: subject.routeSegment })
              : undefined,
          },
          { label: SECTION_LABEL },
        ]}
      />
      <SubjectBar subject={subject} fileCount={fileCount} viewerAccountId={user.id} />
      <h1 className="display text-3xl">{H1}</h1>
      {confirmationRequired ? <p role="status" data-slot="ancestry-sharing-confirmation" className="max-w-prose text-sm leading-relaxed text-ink">
        {person!.displayLabel} needs to confirm ancestry sharing again. They can do this on their permissions page. Newer saved results can then appear here.
      </p> : null}
      {preparedUnavailable ? <p role="status" data-slot="ancestry-prepared-unavailable" className="max-w-prose text-sm leading-relaxed text-ink">
        Ancestry from a prepared genome is not yet available in Family. Other authorized results are shown below.
      </p> : null}
      {person && rows.length === 0 ? <p role="status" className="max-w-prose text-sm leading-relaxed text-ink">
        No ancestry result is shared yet.
      </p> : null}
      {preparing ? (
        <p role="status" className="max-w-prose text-sm leading-relaxed text-ink">{ANCESTRY_PREPARING}</p>
      ) : null}

      <section data-testid="admixture" aria-labelledby="regions-heading" className="space-y-4">
        <h2 id="regions-heading" className="text-lg font-semibold text-ink">
          {REGIONS_HEADING}
        </h2>
        {sevenRegion ? <RegionalAncestryRegions
          subjectId={dataSubjectId}
          shapes={regionalMapShapes()}
          panel={SEVEN_ANCESTRY_PANEL}
          minMarkers={SEVEN_ANCESTRY_PANEL.minimumMarkers}
          reference={REGIONAL_REFERENCE}
          result={sevenRegionResult(admix)}
        /> : <AncestryRegions
          subjectId={dataSubjectId}
          shapes={mapShapes()}
          panel={{ markers: PANEL.markers, version: PANEL.version, known: admix?.model_id === PANEL.id && admix.model_version === PANEL.version }}
          minMarkers={MIN_MARKERS}
          result={regions}
        />}
        {admix ? <InputProvenance nested sources={regionInputs} subject={{ subjectId: dataSubjectId }} /> : null}
        {admix ? <p className="text-sm text-ink-muted">{storedModelLine(admix.model_id, admix.model_version)}</p> : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <LineageCard
          parent="mother"
          subjectId={dataSubjectId}
          call={mt ? lineageCall(mt.result) : null}
          supportNote={mt?.support_note ?? null}
          defineTerm
          knownTree={mt?.model_id === LINEAGE_TREES.mother.id && mt.model_version === LINEAGE_TREES.mother.version}
          modelRecord={mt ? { id: mt.model_id, version: mt.model_version } : undefined}
        />
        <LineageCard
          parent="father"
          subjectId={dataSubjectId}
          call={y ? lineageCall(y.result) : null}
          supportNote={y?.support_note ?? null}
          defineTerm={false}
          knownTree={y?.model_id === LINEAGE_TREES.father.id && y.model_version === LINEAGE_TREES.father.version}
          modelRecord={y ? { id: y.model_id, version: y.model_version } : undefined}
        />
      </div>

      {/* Input quality qualifies a RESULT (G4.6). A row exists now for a line
          that could not be read as well as for one that could - the canonical
          path reads the lineage markers and records what it found either way -
          so the test is the call, not the row. Under "this line could not be
          read" there is nothing for call rate or coverage to be about, and a
          provenance block there would be furniture. */}
      {lineageCall(mt?.result)?.haplogroup != null
        ? <div data-slot="maternal-input-provenance"><InputProvenance nested sources={maternalInputs} subject={{ subjectId: dataSubjectId }} /></div> : null}
      {lineageCall(y?.result)?.haplogroup != null
        ? <div data-slot="paternal-input-provenance"><InputProvenance nested sources={paternalInputs} subject={{ subjectId: dataSubjectId }} /></div> : null}

      <NeanderthalCard />

      <section aria-labelledby="sources-heading" className="space-y-3">
        <h2 id="sources-heading" className="text-lg font-semibold text-ink">
          {SOURCES_HEADING}
        </h2>
        <ul data-slot="ancestry-sources" className="space-y-2 text-sm leading-relaxed">
          {(sevenRegion ? REGIONAL_SOURCES : SOURCES).map((source) => (
            <li key={source.id}>
              <span className="font-medium text-ink">{source.title}</span>
              <span className="text-ink-muted">{` — ${source.detail}`}</span>
              {source.id.startsWith(DOI_PREFIX) ? (
                <>
                  {" "}
                  <a
                    href={`https://doi.org/${source.id.slice(DOI_PREFIX.length)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink-muted underline underline-offset-2"
                  >
                    {source.id}
                  </a>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <footer className="text-sm">
        <Link href={route("genome.data", subjectParams)} className="link-target underline underline-offset-2">
          {DATA_AND_METHODS}
        </Link>
      </footer>
    </div>
  );
}
