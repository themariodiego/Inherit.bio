import type { Metadata } from "next";
import { loadEmbryoInputFacts } from "@/lib/embryos/input-facts-load";
import { notFound, redirect } from "next/navigation";
import { CompareTable } from "@/components/embryo/compare/compare-table";
import { ContextStrip } from "@/components/embryo/compare/context-strip";
import { QcTable } from "@/components/embryo/compare/qc-table";
import { StandingStatement } from "@/components/embryo/compare/standing-statement";
import { TradeOffPanel } from "@/components/embryo/compare/trade-off-panel";
import { formatDate } from "@/components/embryo/format";
import { EmbryoResultGate } from "@/components/embryo/result-gate";
import { BlockingState, EmbryoErrorState, EmbryoUnavailable } from "@/components/embryo/states";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import {
  COMPARE_H1,
  HOW_SURE_HEADING,
  NOT_DIAGNOSTIC,
  NO_COHORT_SENTENCE,
  NO_RANGE_YET,
  QUALITY_CHECK_HEADING,
  REGISTRY_EMPTY_SENTENCE,
  READ_FAILED_HEADING,
  READ_FAILED_SENTENCE,
  SHAPE_BLOCKED_HEADING,
  SHAPE_BLOCKED_SENTENCE,
  SIDE_BY_SIDE_HEADING,
  WHERE_FROM_HEADING,
} from "@/copy/embryos/compare";
import { PROVENANCE_LINE_EMBRYO } from "@/copy/embryos/detail";
import {
  EMBRYOS_H1,
  FILES_NOT_ADDED_SENTENCE,
  REQUEST_DATA_BUTTON,
  ROLE_OTHER_PARENT,
  waitingRole,
  STILL_CHECKING_STATUS,
  waitingForResultsBody,
} from "@/copy/embryos/index";
import { BACK_TO_EMBRYOS_LINK } from "@/copy/embryos/request-data";
import { qcRunOn } from "@/copy/embryos/qc";
import {
  EMBRYO_ANALYSIS,
  analysisConsent,
  cohortCapability,
  permits,
  resolveResultSurfaceState,
} from "@/lib/embryos/access";
import { allowedConditions, registryIsEmpty } from "@/lib/embryos/allowed-conditions";
import { EmbryoReadError, isCanonicalId, rowsOrThrow, selectCohort, type EmbryoCohortView } from "@/lib/embryos/cohorts";
import { EmbryoShapeError, type ComparisonResultRow, type RscEmbryoComparison } from "@/lib/embryos/policy";
import { projectComparison, type EmbryoQcRow, type EmbryoScoreRow } from "@/lib/embryos/projection";
import { acknowledged } from "@/lib/embryos/tier2";
import type { FindingLayer } from "@/lib/genome/taxonomy";
import { route } from "@/lib/primary-routes";
import { createAdminClient } from "@/lib/supabase/admin";
import { acknowledgeEmbryoGate } from "../acknowledge";
import { loadCohorts, loadViewer } from "../context";

export const metadata: Metadata = { title: COMPARE_H1 };

/**
 * `/embryos/compare` — the comparison (design §2.4; register embryos.compare,
 * wide-data, 90rem). The states of §1.4 render in the order a reader meets
 * them: the jurisdiction, the zero-cohort blocking state (no private row
 * fetched), an unknown cohort as 404, the file still being checked, the
 * missing grant, the one Tier-2 gate of the domain, and only then the
 * matrix. While the gate is unset nothing derived is read.
 *
 * Columns are embryos in ordinal order, every one of them; rows are the
 * registered conditions — none today, and the table says so.
 */

/** The register's closed query: one canonical lowercase UUID or nothing. */
function cohortQuery(value: string | string[] | undefined): string | null | undefined {
  if (value === undefined) return null;
  if (typeof value !== "string" || !isCanonicalId(value)) return undefined;
  return value;
}

/** The layer a registered condition renders under: carrier status is a specific variant, the rest are estimates. */
function layerOf(): ReadonlyMap<string, FindingLayer> {
  return new Map(
    allowedConditions().map((entry) => [
      entry.condition_id,
      entry.permitted_result_kinds.includes("carrier_status") ? "variant_call" : "estimate",
    ]),
  );
}

async function loadComparison(cohort: EmbryoCohortView): Promise<RscEmbryoComparison> {
  const admin = createAdminClient();
  const embryoIds = cohort.embryos.map((embryo) => embryo.id);
  const registered = new Set(allowedConditions().map((entry) => entry.condition_id));
  const [qcResult, scoreResult] = await Promise.all([
    admin.from("embryo_qc").select("*").in("embryo_id", embryoIds),
    // A score outside the registry is never read (requestRule).
    registered.size > 0
      ? admin
          .from("embryo_scores")
          .select("embryo_id, condition_id, condition_name, finding, evidence_label, coverage_state, citation_ids, not_covered_reason")
          .in("embryo_id", embryoIds)
          .in("condition_id", [...registered])
      : { data: [] as never[], error: null },
  ]);
  // A failed read is the error state, never an empty comparison (R11).
  const qcRows = rowsOrThrow("embryo_qc", qcResult);
  const scoreRows = rowsOrThrow("embryo_scores", scoreResult);
  const sourceFacts = new Map(await Promise.all(cohort.embryos.map(async (embryo) =>
    [embryo.id, await loadEmbryoInputFacts(admin, cohort.id, embryo.subjectId)] as const)));
  return projectComparison({
    cohortId: cohort.id,
    embryos: cohort.embryos.map((embryo) => ({
      id: embryo.id,
      cohort_id: cohort.id,
      sample_ordinal: embryo.sampleOrdinal,
      display_label: embryo.displayLabel,
      status: embryo.status,
    })),
    qcRows: qcRows.map((qc) => ({ ...qc, source_facts: sourceFacts.get(qc.embryo_id) })) as unknown as EmbryoQcRow[],
    scores: scoreRows as unknown as EmbryoScoreRow[],
    registeredConditionIds: registered,
  });
}

export default async function EmbryoComparePage(props: PageProps<"/embryos/compare">) {
  const viewer = await loadViewer();
  if (!viewer) redirect("/auth/sign-in");
  const { user, decision } = viewer;
  const { cohort: rawCohort } = await props.searchParams;

  const crumbs = <Breadcrumbs items={[{ label: EMBRYOS_H1, href: route("embryos.index") }, { label: COMPARE_H1 }]} />;
  const heading = (
    <header className="space-y-3">
      <h1 className="display text-3xl">{COMPARE_H1}</h1>
    </header>
  );
  const frame = (children: React.ReactNode, surface: "wide-data" | "standard" = "standard") => (
    <div data-surface={surface} className={surface === "wide-data" ? "mx-auto max-w-[90rem] space-y-8" : "mx-auto max-w-4xl space-y-8"}>
      {crumbs}
      {heading}
      {children}
    </div>
  );

  if (!permits(decision)) {
    return frame(<EmbryoUnavailable decision={decision} action={{ label: BACK_TO_EMBRYOS_LINK, href: route("embryos.index") }} />);
  }

  const query = cohortQuery(rawCohort);
  if (query === undefined) notFound();
  const cohorts = await loadCohorts(user.id);
  const cohort = selectCohort(cohorts, query);
  if (query !== null && !cohort) notFound();
  if (!cohort) {
    return frame(
      <BlockingState state="empty" action={{ label: REQUEST_DATA_BUTTON, href: route("embryos.request-data"), primary: true }}>
        {NO_COHORT_SENTENCE}
      </BlockingState>,
    );
  }

  const cohortDecision = await cohortCapability(user.id, cohort, EMBRYO_ANALYSIS);
  const state = resolveResultSurfaceState({
    decision: cohortDecision,
    cohort,
    acknowledged: await acknowledged(user),
  });

  switch (state) {
    case "jurisdiction-unavailable":
      return frame(<EmbryoUnavailable decision={cohortDecision} action={{ label: BACK_TO_EMBRYOS_LINK, href: route("embryos.index") }} />);
    case "empty":
      return frame(<BlockingState state="empty">{FILES_NOT_ADDED_SENTENCE}</BlockingState>);
    case "processing":
      return frame(<BlockingState state="processing">{STILL_CHECKING_STATUS}</BlockingState>);
    case "consent-required":
      return frame(
        <BlockingState state="consent-required">
          {waitingForResultsBody(waitingRole(analysisConsent(cohort)) ?? ROLE_OTHER_PARENT)}
        </BlockingState>,
      );
    case "gated":
      return frame(<EmbryoResultGate action={acknowledgeEmbryoGate} />);
    case "complete":
      break;
  }

  let comparison: RscEmbryoComparison;
  try {
    comparison = await loadComparison(cohort);
  } catch (error) {
    if (error instanceof EmbryoShapeError) {
      // The register's embryo-closed-schema-v1 refusal: nothing is shown.
      console.error("feature.blocked", { route: "embryos.compare", shape: error.shape, path: error.path });
      return frame(
        <EmbryoErrorState heading={SHAPE_BLOCKED_HEADING} action={{ label: BACK_TO_EMBRYOS_LINK, href: route("embryos.index") }}>
          {SHAPE_BLOCKED_SENTENCE}
        </EmbryoErrorState>,
      );
    }
    if (error instanceof EmbryoReadError) {
      console.error("embryo.read-failed", { route: "embryos.compare", table: error.table });
      return frame(
        <EmbryoErrorState heading={READ_FAILED_HEADING} action={{ label: BACK_TO_EMBRYOS_LINK, href: route("embryos.index") }}>
          {READ_FAILED_SENTENCE}
        </EmbryoErrorState>,
      );
    }
    throw error;
  }
  if (comparison.embryos.length === 0) {
    return frame(<BlockingState state="processing">{STILL_CHECKING_STATUS}</BlockingState>);
  }

  const subjectIds = new Map(cohort.embryos.map((embryo) => [embryo.id, embryo.subjectId]));
  const layers = layerOf();
  const rowsFor = (layer: FindingLayer): ComparisonResultRow[] =>
    comparison.result_rows.filter((row) => layers.get(row.findings[0].condition_id) === layer);
  const conditionNames = new Map(
    comparison.result_rows.map((row) => [row.findings[0].condition_id, row.findings[0].condition_name]),
  );
  const computedAt = comparison.embryos
    .map((embryo) => embryo.qc.computed_at)
    .sort()
    .at(-1);

  return frame(
    <>
      <StandingStatement text={comparison.standing_statement} />
      <ContextStrip counts={comparison.context_counts} />
      <TradeOffPanel tradeOffs={comparison.trade_offs} conditionNames={conditionNames} embryoCount={comparison.embryos.length} />

      <section aria-labelledby="side-by-side-heading" data-density-top-level-section className="space-y-6">
        <h2 id="side-by-side-heading" className="text-lg font-semibold text-ink">
          {SIDE_BY_SIDE_HEADING}
        </h2>
        {(["variant_call", "estimate"] as const).map((layer) => (
          <CompareTable key={layer} layer={layer} embryos={comparison.embryos} rows={rowsFor(layer)} subjectIds={subjectIds} />
        ))}
      </section>

      <section aria-labelledby="quality-check-heading" data-density-top-level-section className="space-y-4">
        <h2 id="quality-check-heading" className="text-lg font-semibold text-ink">
          {QUALITY_CHECK_HEADING}
        </h2>
        <QcTable embryos={comparison.embryos} subjectIds={subjectIds} />
      </section>

      <section aria-labelledby="how-sure-heading" data-density-top-level-section className="space-y-3">
        <h2 id="how-sure-heading" className="text-lg font-semibold text-ink">
          {HOW_SURE_HEADING}
        </h2>
        {comparison.result_rows.length > 0 ? (
          <p className="max-w-prose text-sm leading-relaxed text-ink">{NO_RANGE_YET}</p>
        ) : null}
        <p data-density-required-accuracy className="max-w-prose text-sm leading-relaxed text-ink">
          {NOT_DIAGNOSTIC}
        </p>
      </section>

      <section aria-labelledby="where-from-heading" data-density-top-level-section className="space-y-3">
        <h2 id="where-from-heading" className="text-lg font-semibold text-ink">
          {WHERE_FROM_HEADING}
        </h2>
        <p className="max-w-prose text-sm leading-relaxed text-ink">{PROVENANCE_LINE_EMBRYO}</p>
        {registryIsEmpty() ? (
          <p data-slot="registry-status" className="max-w-prose text-sm leading-relaxed text-ink">
            {REGISTRY_EMPTY_SENTENCE}
          </p>
        ) : null}
        {computedAt ? (
          // inherit-figure-exempt: the date the quality check ran is UI chrome
          <p className="max-w-prose text-sm leading-relaxed text-ink-muted">{qcRunOn(formatDate(computedAt))}</p>
        ) : null}
      </section>
    </>,
    "wide-data",
  );
}
